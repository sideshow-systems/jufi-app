import {
	challengeAusAntwort,
	decryptSecret,
	encryptSecret,
	generateRecoveryCodes,
	generateTotpSecret,
	hashPassword,
	hashRecoveryCode,
	passkeyLabel,
	registrationOptions,
	totpUri,
	verifyPassword,
	verifyTotp,
} from '@jufi/auth';
import { sperreVereinszeile, type Person, type VereinDb } from '@jufi/db';
import { PASSWORT_HINWEIS, pruefePasswort } from '@jufi/domain';
import type { Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { asynchron, text } from '../admin/asynchron.js';
import { relyingParty } from '../admin/passkeys.js';
import { reserviere, scheitere, zuVieleVersuche } from '../admin/versuche.js';
import { vereinsKontext } from '../verein.js';
import { nimmChallenge, speichereChallenge } from './challenges.js';
import { brauchtMitglied, loescheMitgliederCookie, mitgliedKontext } from './sitzung.js';

const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };
const LETZTER_WEG = { fehler: 'Das ist dein letzter Anmeldeweg' };
const KEINE_RECHTE = { fehler: 'Dafür fehlen die Rechte' };
const PASSKEY_GESCHEITERT = { fehler: 'Der Passkey konnte nicht eingerichtet werden' };
const PASSKEY_VERGEBEN = { fehler: 'Dieser Passkey ist schon eingerichtet' };
const NAME_UNGUELTIG = { fehler: 'Der Name braucht 1 bis 40 Zeichen' };
const PASSWORT_GEAENDERT = { fehler: 'Das Passwort wurde inzwischen geändert, bitte neu laden' };
const TOTP_SCHON_EINGERICHTET = { fehler: 'TOTP ist schon eingerichtet' };
const EINRICHTUNG_ABGELAUFEN = { fehler: 'Einrichtung abgelaufen, bitte neu beginnen' };
const CODE_FALSCH = { fehler: 'Code stimmt nicht' };

const MAX_NAME = 40;

/** Wie bei der Admin-Einrichtung: Zeit, die App zu installieren und die Codes abzuschreiben. */
const TOTP_EINRICHTUNG_GUELTIG_MS = 10 * 60 * 1000;

/**
 * TOTP gibt es nur fuer Erwachsene mit mindestens einem Recht (Spec 4.7): wer
 * nur sich selbst oder seine Familie sieht, braucht keinen zweiten Faktor, und
 * ein Kind verloere damit leicht den Zugang.
 */
function totpMoeglich(person: Person): boolean {
	return person.art === 'ERWACHSENER' && person.rechte.length > 0;
}

/** Name eines Passkeys, getrimmt; undefined, wenn er nicht 1 bis 40 Zeichen hat. */
function passkeyName(wert: unknown): string | undefined {
	const name = text(wert).trim();
	return name.length >= 1 && name.length <= MAX_NAME ? name : undefined;
}

/** Was zwischen start und bestaetigen beim Browser liegt, verschluesselt (wie beim Admin). */
interface TotpEinrichtung {
	zugangId: string;
	geheimnis: string;
	hashes: string[];
	ablaufMs: number;
}

function leseEinrichtung(marke: string, jetztMs: number): TotpEinrichtung | undefined {
	try {
		const wert = JSON.parse(decryptSecret(marke)) as Partial<TotpEinrichtung>;
		if (
			typeof wert.zugangId !== 'string' ||
			typeof wert.geheimnis !== 'string' ||
			!Array.isArray(wert.hashes) ||
			typeof wert.ablaufMs !== 'number' ||
			wert.ablaufMs <= jetztMs
		) {
			return undefined;
		}
		return wert as TotpEinrichtung;
	} catch {
		// Kaputt oder verfaelscht (GCM prueft den Auth-Tag): wie abgelaufen.
		return undefined;
	}
}

type Antwort = Parameters<typeof challengeAusAntwort>[0];

/** Der Transaktions-Client von vereinDb, wie $transaction ihn uebergibt. */
type Tx = Parameters<Parameters<VereinDb['$transaction']>[0]>[0];

const SITZUNG_BEENDET = Symbol('Sitzung beendet');
const NICHT_ANGEMELDET = { fehler: 'nicht angemeldet' };

/**
 * Fuehrt einen Schreibvorgang des Profils nur aus, solange die Sitzung der
 * Anfrage noch besteht, und zwar unter der Sperre der Vereinszeile. Das
 * Einloesen eines Reset- oder Einladungslinks sperrt dieselbe Zeile und loescht
 * dabei alle Sitzungen und Anmeldewege (Spec 4.4): ohne diese Pruefung legte
 * ein verlorenes Geraet, dessen Anfrage die Anmeldung noch vor dem Einloesen
 * passiert hat, danach einen Passkey, ein Passwort oder TOTP an, das den Reset
 * ueberlebt. Mit der Sperre ist die Reihenfolge eindeutig: entweder schreibt
 * das Profil zuerst und das Einloesen raeumt es weg, oder das Einloesen kommt
 * zuerst und die Sitzung ist hier schon fort.
 *
 * Verworfen: nur die Sitzung pruefen, ohne Sperre -- unter READ COMMITTED
 * saehe die Pruefung die Sitzung noch, waehrend das Einloesen gerade loescht.
 * Verworfen auch: die Sitzung nur in mitgliedAusSitzung pruefen -- zwischen
 * dort und dem Schreiben liegen Argon2 und die Passkey-Pruefung.
 *
 * Liefert SITZUNG_BEENDET, bevor irgendetwas geschrieben ist; die Route
 * antwortet dann wie bei einer abgelaufenen Sitzung mit 401.
 */
async function inEigenerSitzung<T>(res: Response, arbeit: (tx: Tx) => Promise<T>): Promise<T | typeof SITZUNG_BEENDET> {
	const { verein, db } = vereinsKontext(res);
	const { sitzungId } = mitgliedKontext(res);
	return db.$transaction(async (tx) => {
		await sperreVereinszeile(tx, verein.id);
		if ((await tx.session.count({ where: { id: sitzungId } })) !== 1) return SITZUNG_BEENDET;
		return arbeit(tx);
	});
}

function sitzungBeendet(res: Response): void {
	res.status(401).json(NICHT_ANGEMELDET);
}

/**
 * Profil, Abmelden und die eigenen Anmeldewege. Haengt die Routen an den Router
 * von vereinsApi, nicht an einen Unter-Router: der Mandanten-Test liest die
 * Liste von dort.
 *
 * Alles hier betrifft nur den Zugang der Sitzung. Passkeys werden darum immer
 * mit zugangId gesucht, nie allein ueber die Id aus dem Pfad: ein fremder
 * Passkey, auch im selben Verein, ist "nicht gefunden" (404, Rahmen-Spec 8).
 */
export function profilRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, anmeldeVersuche: versuche, webauthn, bus } = deps;

	router.get(
		'/ich',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			// select statt der ganzen Zeile: publicKey und credentialId gehoeren nicht
			// in die Oberflaeche, und ein spaeter ergaenztes Feld kaeme sonst still mit.
			const [passkeys, uebrig, kinder] = await Promise.all([
				db.passkey.findMany({
					where: { zugangId: zugang.id },
					select: { id: true, label: true, createdAt: true, lastUsedAt: true },
					orderBy: { createdAt: 'asc' },
				}),
				db.recoveryCode.count({ where: { zugangId: zugang.id, verwendetAm: null } }),
				// Die Oberflaeche zeigt "Meine Kinder" nur, wo es welche gibt; entfernte zaehlen nicht.
				db.bezugsperson.count({ where: { erwachsenerId: person.id, jungfischer: { entferntAm: null } } }),
			]);
			res.json({
				person: {
					id: person.id,
					vorname: person.vorname,
					nachname: person.nachname,
					art: person.art,
					rechte: person.rechte,
				},
				hatKinder: kinder > 0,
				// Erwachsene melden sich mit der Adresse an, Jungfischer mit dem Anmeldenamen.
				kennung: person.art === 'ERWACHSENER' ? person.email : zugang.anmeldename,
				passkeys: passkeys.map((p) => ({
					id: p.id,
					label: p.label,
					erstelltAm: p.createdAt,
					zuletztGenutztAm: p.lastUsedAt,
				})),
				hatPasswort: zugang.passwortHash !== null,
				totp: {
					moeglich: totpMoeglich(person),
					aktiv: zugang.totpAktivAm !== null,
					wiederherstellungscodesUebrig: uebrig,
				},
			});
		}),
	);

	router.post(
		'/abmelden',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { sitzungId } = mitgliedKontext(res);
			// deleteMany: ein Doppelklick auf Abmelden soll nicht mit 500 enden.
			await db.session.deleteMany({ where: { id: sitzungId } });
			// Nur pruefen, keine Aenderung: Die Sockets dieser Sitzung sollen sich schliessen, den Stand
			// des Vereins hat das nicht angefasst (Plan-Entscheidung 4).
			bus.melde({ typ: 'pruefen', vereinId: verein.id });
			loescheMitgliederCookie(req, res, verein.slug);
			res.status(204).end();
		}),
	);

	router.post(
		'/abmelden/alle',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { zugang } = mitgliedKontext(res);
			await db.session.deleteMany({ where: { zugangId: zugang.id } });
			bus.melde({ typ: 'pruefen', vereinId: verein.id });
			loescheMitgliederCookie(req, res, verein.slug);
			res.status(204).end();
		}),
	);

	/**
	 * Passwort setzen oder aendern. Mit vorhandenem Passwort ist das alte Pflicht:
	 * wer nur ein offenes Geraet in der Hand hat, soll den Zugang nicht
	 * uebernehmen koennen. Ohne vorhandenes Passwort genuegt die Sitzung -- der
	 * Zugang hat dann nur Passkeys, und die bleiben bestehen.
	 */
	router.post(
		'/profil/passwort',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein } = vereinsKontext(res);
			const { zugang, sitzungId } = mitgliedKontext(res);
			const neu = text(req.body?.neu);
			const pruefung = pruefePasswort(neu);
			if (!pruefung.ok) {
				res.status(400).json({ fehler: PASSWORT_HINWEIS[pruefung.grund] });
				return;
			}

			const bisher = zugang.passwortHash;
			if (bisher !== null) {
				// Eigener Schluessel je Zugang statt "m:<kennung>" der Anmeldung: wer
				// angemeldet ist, soll mit Raten im Profil nicht die Anmeldung seiner
				// eigenen Kennung sperren, und umgekehrt. reserviere vor dem ersten
				// await (siehe versuche.ts).
				const schluessel = [`m-passwort:${zugang.id}`];
				const versuch = reserviere(versuche, schluessel);
				if (versuch.wartenMs > 0) {
					zuVieleVersuche(res, versuch.wartenMs);
					return;
				}
				// Ohne alt laeuft es trotzdem durch Argon2 und zaehlt als Fehlversuch:
				// eine eigene 400 waere ein billiger Weg, den Zaehler zu umgehen, und
				// liesse sich vom falschen Passwort an der Antwortzeit unterscheiden.
				if (!(await verifyPassword(bisher, text(req.body?.alt)))) {
					scheitere(versuche, schluessel, versuch.loestSperreAus, res, FEHLGESCHLAGEN);
					return;
				}
				versuche.reset(schluessel[0] ?? '');
			}

			// Vor der Transaktion: Argon2 dauert, und so lange hielte sie Zeilen gesperrt.
			const passwortHash = await hashPassword(neu);
			const geaendert = await inEigenerSitzung(res, async (tx) => {
				// Nur wenn das Passwort noch das gepruefte ist: setzten zwei Anfragen
				// gleichzeitig eins (die zweite ohne alt, weil beim Lesen noch keins da
				// war), ueberschriebe sie sonst ein Passwort, das sie nie kannte.
				// Verworfen: einfach update -- dann genuegte die Sitzung allein, um ein
				// gerade gesetztes Passwort zu ersetzen.
				const { count } = await tx.zugang.updateMany({
					where: { id: zugang.id, passwortHash: bisher },
					data: { passwortHash },
				});
				if (count !== 1) return false;
				// Alle anderen Sitzungen enden: wer das Passwort aendert, weil es jemand
				// kennt, will diesen auch von seinen Geraeten werfen. Die laufende
				// bleibt, sonst stuende man nach dem Speichern auf der Anmeldeseite.
				// In derselben Transaktion, damit es kein neues Passwort mit alten
				// Sitzungen gibt.
				await tx.session.deleteMany({ where: { zugangId: zugang.id, id: { not: sitzungId } } });
				return true;
			});
			if (geaendert === SITZUNG_BEENDET) {
				sitzungBeendet(res);
				return;
			}
			if (!geaendert) {
				res.status(409).json(PASSWORT_GEAENDERT);
				return;
			}
			// Die anderen Sitzungen dieses Zugangs sind weg: ihre Sockets pruefen sich neu.
			bus.melde({ typ: 'pruefen', vereinId: verein.id });
			res.json({ ok: true });
		}),
	);

	router.post(
		'/profil/passkeys/optionen',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			const vorhandene = await db.passkey.findMany({
				where: { zugangId: zugang.id },
				select: { credentialId: true, publicKey: true, counter: true, transports: true },
			});
			const optionen = await registrationOptions({
				rp: relyingParty(req, deps),
				user: {
					id: person.id,
					// Wie beim Einloesen: der Verein im Namen unterscheidet am Telefon
					// die Passkeys mehrerer Vereine derselben Domain (Spec 4.2).
					name: `${person.vorname} ${person.nachname} · ${verein.anzeigename}`,
					displayName: `${person.vorname} ${person.nachname} · ${verein.anzeigename}`,
				},
				existing: vorhandene,
			});
			await speichereChallenge(db, {
				challenge: optionen.challenge,
				purpose: 'register',
				personId: person.id,
				jetzt: jetzt(),
			});
			res.json({ optionen });
		}),
	);

	router.post(
		'/profil/passkeys',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			// Der Name vor der Challenge: ein ungueltiger soll sie nicht verbrauchen.
			const roherName: unknown = req.body?.name;
			const ohneName = roherName === undefined || roherName === null || text(roherName).trim() === '';
			const name = ohneName ? undefined : passkeyName(roherName);
			if (!ohneName && name === undefined) {
				res.status(400).json(NAME_UNGUELTIG);
				return;
			}

			const antwort: unknown = req.body?.antwort;
			const challenge = challengeAusAntwort(antwort as Antwort);
			// personId muss passen: sonst richtete jemand mit der Challenge einer
			// anderen Person einen Passkey fuer sich ein, den diese angefordert hat.
			const genommen = challenge
				? await nimmChallenge(db, { challenge, purpose: 'register', personId: person.id, jetzt: jetzt() })
				: false;
			if (!challenge || !genommen) {
				res.status(400).json(PASSKEY_GESCHEITERT);
				return;
			}
			const ergebnis = await webauthn
				.verifyRegistration({
					response: antwort as Parameters<typeof webauthn.verifyRegistration>[0]['response'],
					expectedChallenge: challenge,
					rp: relyingParty(req, deps),
				})
				// Eine Antwort, die sich nicht pruefen laesst, ist dasselbe wie eine falsche.
				.catch(() => null);
			if (!ergebnis) {
				res.status(400).json(PASSKEY_GESCHEITERT);
				return;
			}

			const label = name ?? passkeyLabel(req.get('user-agent'));
			try {
				const passkey = await inEigenerSitzung(res, (tx) =>
					// create statt upsert: ein Upsert uebernaehme eine credentialId, die
					// schon einem anderen Zugang gehoert, womoeglich in einem anderen Verein.
					tx.passkey.create({
						data: {
							zugangId: zugang.id,
							credentialId: ergebnis.credentialId,
							publicKey: ergebnis.publicKey,
							counter: ergebnis.counter,
							transports: ergebnis.transports,
							backedUp: ergebnis.backedUp,
							label,
						},
						select: { id: true, label: true },
					}),
				);
				if (passkey === SITZUNG_BEENDET) {
					sitzungBeendet(res);
					return;
				}
				res.status(201).json(passkey);
			} catch (error) {
				// P2002: credentialId schon vergeben (excludeCredentials haelt das
				// Geraet eigentlich davon ab; hier greift die Datenbank).
				if ((error as { code?: unknown } | null)?.code === 'P2002') {
					res.status(409).json(PASSKEY_VERGEBEN);
					return;
				}
				throw error;
			}
		}),
	);

	router.patch(
		'/profil/passkeys/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { zugang } = mitgliedKontext(res);
			const label = passkeyName(req.body?.label);
			if (label === undefined) {
				res.status(400).json(NAME_UNGUELTIG);
				return;
			}
			// updateMany mit zugangId statt update ueber die Id: ein fremder Passkey
			// zaehlt 0 und ist damit nicht gefunden, ohne vorher gelesen zu werden.
			// In der eigenen Sitzung wie jedes Schreiben hier, auch wenn ein
			// Umbenennen nach einem Reset wenig anrichtete: eine Regel fuer alle
			// Schreibwege ist leichter zu pruefen als eine Abwaegung je Route.
			const ergebnis = await inEigenerSitzung(res, (tx) =>
				tx.passkey.updateMany({ where: { id: req.params['id'] ?? '', zugangId: zugang.id }, data: { label } }),
			);
			if (ergebnis === SITZUNG_BEENDET) {
				sitzungBeendet(res);
				return;
			}
			if (ergebnis.count !== 1) {
				res.status(404).json(NICHT_GEFUNDEN);
				return;
			}
			res.json({ id: req.params['id'], label });
		}),
	);

	router.delete(
		'/profil/passkeys/:id',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { zugang } = mitgliedKontext(res);
			const id = req.params['id'] ?? '';
			// inEigenerSitzung sperrt die Vereinszeile, bevor gezaehlt wird.
			const ergebnis = await inEigenerSitzung(res, async (tx) => {
				// Erst sperren, dann zaehlen: loeschte jemand zwei Passkeys zugleich, saehe
				// sonst jede Anfrage den jeweils anderen noch und beide loeschten -- der
				// Zugang stuende ohne Anmeldeweg da. Die Vereinszeile, weil das Einloesen
				// (das alle Wege ersetzt) dieselbe sperrt. Verworfen: SELECT ... FOR
				// UPDATE auf die Zugangszeile -- vereinDb laesst keine Rohabfragen zu, und
				// Prisma kennt keine Zeilensperre; Serializable -- dann scheiterte eine
				// der beiden mit einem Serialisierungsfehler, den jede Route erst in einen
				// Wiederholversuch uebersetzen muesste.
				const passkey = await tx.passkey.findFirst({ where: { id, zugangId: zugang.id }, select: { id: true } });
				if (!passkey) return 'nicht gefunden' as const;
				// Passwort frisch lesen, nicht aus der Sitzung: es kann inzwischen gesetzt sein.
				const stand = await tx.zugang.findFirst({ where: { id: zugang.id }, select: { passwortHash: true } });
				const andere = await tx.passkey.count({ where: { zugangId: zugang.id, id: { not: id } } });
				if (!stand?.passwortHash && andere === 0) return 'letzter' as const;
				await tx.passkey.delete({ where: { id } });
				return 'geloescht' as const;
			});
			if (ergebnis === SITZUNG_BEENDET) {
				sitzungBeendet(res);
				return;
			}
			if (ergebnis === 'nicht gefunden') {
				res.status(404).json(NICHT_GEFUNDEN);
				return;
			}
			if (ergebnis === 'letzter') {
				res.status(409).json(LETZTER_WEG);
				return;
			}
			res.json({ ok: true });
		}),
	);

	// Wie beim Admin ohne erneutes Passwort: start ersetzt keinen bestehenden
	// zweiten Faktor (409, sobald TOTP aktiv ist), es richtet nur den ersten ein.
	// 403 statt 404 fuer "nicht moeglich": der Zugang gehoert der Person selbst,
	// die Antwort verraet nichts ueber Fremdes.
	router.post(
		'/profil/totp/start',
		brauchtMitglied,
		asynchron(async (_req, res) => {
			const { verein, db } = vereinsKontext(res);
			const { person, zugang } = mitgliedKontext(res);
			if (!totpMoeglich(person)) {
				res.status(403).json(KEINE_RECHTE);
				return;
			}
			// Frisch gelesen: zwischen Sitzung und hier kann ein anderer Tab TOTP
			// eingerichtet haben.
			const stand = await db.zugang.findFirst({ where: { id: zugang.id }, select: { totpAktivAm: true } });
			if (stand?.totpAktivAm) {
				res.status(409).json(TOTP_SCHON_EINGERICHTET);
				return;
			}
			const geheimnis = generateTotpSecret();
			const wiederherstellungscodes = generateRecoveryCodes();
			const einrichtung: TotpEinrichtung = {
				zugangId: zugang.id,
				geheimnis,
				hashes: wiederherstellungscodes.map(hashRecoveryCode),
				ablaufMs: jetzt().getTime() + TOTP_EINRICHTUNG_GUELTIG_MS,
			};
			res.json({
				// Verschluesselter Einrichtungszustand statt einer Zeile in der
				// Datenbank: vor der Bestaetigung soll dort kein Geheimnis liegen, das
				// nie benutzt wird (wie beim Admin).
				marke: encryptSecret(JSON.stringify(einrichtung)),
				geheimnis,
				// Der Verein im Namen: wer in zwei Vereinen ist, unterscheidet die Eintraege der App.
				uri: totpUri(geheimnis, `${person.email ?? person.vorname} · ${verein.anzeigename}`),
				wiederherstellungscodes,
			});
		}),
	);

	router.post(
		'/profil/totp/bestaetigen',
		brauchtMitglied,
		asynchron(async (req, res) => {
			const { person, zugang } = mitgliedKontext(res);
			if (!totpMoeglich(person)) {
				res.status(403).json(KEINE_RECHTE);
				return;
			}
			const einrichtung = leseEinrichtung(text(req.body?.marke), jetzt().getTime());
			// Die Marke muss zum Zugang der Sitzung gehoeren: sonst bestaetigte jemand
			// mit der Marke eines anderen dessen Geheimnis fuer sich.
			if (!einrichtung || einrichtung.zugangId !== zugang.id) {
				res.status(400).json(EINRICHTUNG_ABGELAUFEN);
				return;
			}
			// Eigener Schluessel, getrennt von "m-totp:" der Anmeldung: wer sich beim
			// Einrichten vertippt, soll seine naechste Anmeldung nicht sperren.
			const schluessel = [`m-totp-einrichten:${zugang.id}`];
			const versuch = reserviere(versuche, schluessel);
			if (versuch.wartenMs > 0) {
				zuVieleVersuche(res, versuch.wartenMs);
				return;
			}
			if (!(await verifyTotp(einrichtung.geheimnis, text(req.body?.code)))) {
				scheitere(versuche, schluessel, versuch.loestSperreAus, res, CODE_FALSCH);
				return;
			}
			versuche.reset(schluessel[0] ?? '');

			const zeit = jetzt();
			const aktiviert = await inEigenerSitzung(res, async (tx) => {
				// Nur wenn TOTP noch nicht aktiv ist: eine zweite, aeltere Marke aus
				// einem anderen Tab ersetzte sonst das gerade eingerichtete Geheimnis
				// still -- an start vorbei, das bei aktivem TOTP 409 sagt.
				const { count } = await tx.zugang.updateMany({
					where: { id: zugang.id, totpAktivAm: null },
					data: { totpGeheimnis: encryptSecret(einrichtung.geheimnis), totpAktivAm: zeit },
				});
				if (count !== 1) return false;
				// Alle alten Codes verfallen: sie gehoerten zu einem frueheren zweiten Faktor.
				await tx.recoveryCode.deleteMany({ where: { zugangId: zugang.id } });
				await tx.recoveryCode.createMany({
					data: einrichtung.hashes.map((codeHash) => ({ zugangId: zugang.id, codeHash })),
				});
				return true;
			});
			if (aktiviert === SITZUNG_BEENDET) {
				sitzungBeendet(res);
				return;
			}
			if (!aktiviert) {
				res.status(409).json(TOTP_SCHON_EINGERICHTET);
				return;
			}
			res.json({ ok: true });
		}),
	);
}
