import { challengeAusAntwort, hashPassword, hashToken, passkeyLabel, registrationOptions } from '@jufi/auth';
import { sperreVereinszeile, type VereinDb } from '@jufi/db';
import { anmeldenameVorschlag, PASSWORT_HINWEIS, pruefeKennung, pruefePasswort } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { relyingParty } from '../admin/passkeys.js';
import { asynchron, text } from '../admin/asynchron.js';
import { vereinsKontext } from '../verein.js';
import { nimmChallenge, speichereChallenge } from './challenges.js';
import { legeSitzungAn, setzeMitgliederCookie } from './sitzung.js';

const LINK_UNGUELTIG = { fehler: 'Dieser Link gilt nicht mehr' };
const PASSKEY_GESCHEITERT = { fehler: 'Der Passkey konnte nicht eingerichtet werden' };
const KEIN_WEG = { fehler: 'Ein Passwort oder ein Passkey ist nötig' };
const EINWILLIGUNG_FEHLT = { fehler: 'Die Einwilligung der Familie fehlt noch' };
const ADRESSE_VERGEBEN = { fehler: 'Diese Adresse ist hier schon vergeben', feld: 'kennung' };
const NAME_VERGEBEN = { fehler: 'Dieser Anmeldename ist schon vergeben', feld: 'kennung' };
const PASSKEY_VERGEBEN = { fehler: 'Dieser Passkey ist schon eingerichtet' };
const KENNUNG_UNGUELTIG = {
	ERWACHSENER: { fehler: 'Bitte eine gültige E-Mail-Adresse angeben', feld: 'kennung' },
	JUNGFISCHER: {
		fehler: '3 bis 30 Zeichen: Kleinbuchstaben, Ziffern, Punkt, Binde- oder Unterstrich',
		feld: 'kennung',
	},
} as const;

/**
 * Ende des Einloesens mit Status und Antwort. Innerhalb der Transaktion
 * geworfen, damit Prisma alles zuruecknimmt, was bis dahin geschrieben wurde
 * (vor allem eingeloestAm). Verworfen: ein Rueckgabewert aus der Transaktion --
 * dann bliebe die Einladung bei 409 eingeloest, obwohl kein Zugang entstand.
 */
class Abbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: object,
	) {
		super('Einloesen abgebrochen');
	}
}

/**
 * Wandelt die Eindeutigkeitsverletzung eines einzelnen Schritts in eine
 * Antwort. Je Schritt statt am Ende der Transaktion, weil nur der Schritt weiss,
 * welches Feld vergeben war. Verworfen: error.meta.target auswerten -- dessen
 * Form haengt vom Treiber-Adapter ab und ist nicht Teil der stabilen Prisma-API.
 */
async function eindeutig<T>(schritt: Promise<T>, antwort: object): Promise<T> {
	try {
		return await schritt;
	} catch (error) {
		if ((error as { code?: unknown } | null)?.code === 'P2002') throw new Abbruch(409, antwort);
		throw error;
	}
}

type Registrierung = NonNullable<Awaited<ReturnType<VolleAppDeps['webauthn']['verifyRegistration']>>>;
type Antwort = Parameters<typeof challengeAusAntwort>[0];

/**
 * Die offene Einladung zu diesem Token samt Person, oder undefined. Alles, was
 * keinen Link ergibt, ist dasselbe undefined: unbekannt, eingeloest, abgelaufen,
 * Person entfernt, Jungfischer ohne erlaubten Zugang. Wer von aussen fragt,
 * erfaehrt nicht, welcher Fall vorlag (404 wie bei jedem ungueltigen Link).
 * Ueber vereinDb: das Token eines anderen Vereins findet sich nicht.
 */
async function offeneEinladung(db: VereinDb, token: string, jetzt: Date) {
	const einladung = await db.einladung.findFirst({
		where: { tokenHash: hashToken(token), eingeloestAm: null, ablauf: { gt: jetzt } },
		include: { person: { include: { zugang: true } } },
	});
	if (!einladung) return undefined;
	const { person } = einladung;
	if (person.entferntAm) return undefined;
	if (person.art === 'JUNGFISCHER' && !person.zugangErlaubt) return undefined;
	return { einladung, person };
}

/**
 * Einladung pruefen und Passkey-Optionen. Haengt die Routen direkt an den Router
 * von vereinsApi (kein Unter-Router, der Mandanten-Test liest die Liste von dort).
 * Kein Backoff: das Token hat 256 Bit, Raten lohnt nicht.
 */
export function einladungsRouten(router: Router, deps: Pick<VolleAppDeps, 'jetzt' | 'umgebung' | 'webauthn'>): void {
	const { jetzt, webauthn } = deps;

	// Prueft nur, verbraucht nichts: die Seite zeigt vor dem Einrichten, fuer wen
	// der Link ist und welche Kennung gilt.
	router.post(
		'/einladung/pruefen',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const treffer = await offeneEinladung(db, text(req.body?.token), jetzt());
			if (!treffer) {
				res.status(404).json(LINK_UNGUELTIG);
				return;
			}
			const { einladung, person } = treffer;
			const zugang = person.zugang;
			let wert: string | null;
			if (person.art === 'ERWACHSENER') {
				wert = person.email;
			} else if (zugang?.anmeldename) {
				// Bestehender Zugang: die Kennung bleibt, auch bei Reset oder neuer Einladung.
				wert = zugang.anmeldename;
			} else {
				const vergeben = await db.zugang.findMany({
					where: { anmeldename: { not: null } },
					select: { anmeldename: true },
				});
				wert = anmeldenameVorschlag(
					person.vorname,
					new Set(vergeben.map((z) => z.anmeldename).filter((n): n is string => n !== null)),
				);
			}
			const einwilligungFehlt =
				person.art === 'JUNGFISCHER' &&
				(await db.einwilligung.count({ where: { jungfischerId: person.id, widerrufenAm: null } })) === 0;
			res.json({
				vorname: person.vorname,
				art: einladung.art,
				vereinsname: verein.anzeigename,
				personArt: person.art,
				kennung: { fest: zugang !== null, wert },
				hatZugang: zugang !== null,
				einwilligungFehlt,
			});
		}),
	);

	router.post(
		'/einladung/passkey-optionen',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const zeit = jetzt();
			const treffer = await offeneEinladung(db, text(req.body?.token), zeit);
			if (!treffer) {
				res.status(404).json(LINK_UNGUELTIG);
				return;
			}
			const { person } = treffer;
			const optionen = await registrationOptions({
				rp: relyingParty(req, deps),
				user: {
					id: person.id,
					// Der Verein im Namen, damit die Auswahl am Telefon die Passkeys
					// mehrerer Vereine auf derselben Domain unterscheidet.
					name: `${person.vorname} ${person.nachname} · ${verein.anzeigename}`,
					displayName: `${person.vorname} ${person.nachname} · ${verein.anzeigename}`,
				},
				// Ein Passkey ist erst nach dem Einloesen gespeichert; vorher gibt es keinen auszuschliessen.
				existing: [],
			});
			await speichereChallenge(db, {
				challenge: optionen.challenge,
				purpose: 'register',
				personId: person.id,
				jetzt: zeit,
			});
			res.json({ optionen });
		}),
	);
	/**
	 * Loest die Einladung ein: Zugang anlegen (oder bei bestehendem Zugang alle
	 * alten Wege loeschen), Passwort und/oder Passkey setzen, anmelden.
	 *
	 * Kein Backoff wie bei der Anmeldung: das Token hat 256 Bit, Raten lohnt
	 * nicht. Die billige Vorpruefung ohne Schreiben laeuft vor Argon2 und
	 * WebAuthn, damit erfundene Tokens keine Rechenlast erzeugen (wie bei der
	 * Admin-Einrichtung).
	 *
	 * Teures (Argon2, Passkey-Pruefung) liegt vor der Transaktion, damit die
	 * Vereinszeile nur kurz gesperrt ist. Entschieden wird erst in der
	 * Transaktion: das bedingte updateMany auf die Einladung laesst von zwei
	 * gleichzeitigen Anfragen genau eine durch.
	 */
	router.post(
		'/einladung/einloesen',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const zeit = jetzt();
			const token = text(req.body?.token);

			// 1. Vorpruefung, schreibt nichts.
			const treffer = await offeneEinladung(db, token, zeit);
			if (!treffer) {
				res.status(404).json(LINK_UNGUELTIG);
				return;
			}
			const { person } = treffer;
			const passwort = text(req.body?.passwort);
			const passkeyAntwort: unknown = req.body?.passkey;
			// null wie fehlend: ein Formular, das das Feld leer mitschickt, meint keinen Passkey.
			const mitPasskey = passkeyAntwort !== undefined && passkeyAntwort !== null;
			if (passwort) {
				const pruefung = pruefePasswort(passwort);
				if (!pruefung.ok) {
					res.status(400).json({ fehler: PASSWORT_HINWEIS[pruefung.grund] });
					return;
				}
			}
			// Bei bestehendem Zugang bleibt die Kennung; eine mitgeschickte zaehlt nicht
			// und wird darum auch nicht geprueft.
			const kennung = pruefeKennung(person.art, text(req.body?.kennung));
			if (!person.zugang && !kennung.ok) {
				res.status(400).json(KENNUNG_UNGUELTIG[person.art]);
				return;
			}
			if (!passwort && !mitPasskey) {
				res.status(400).json(KEIN_WEG);
				return;
			}

			// 2. Passkey pruefen. Die Challenge ist danach verbraucht, auch wenn die
			// Pruefung scheitert; die Einladung bleibt einloesbar, das Geraet holt
			// sich mit passkey-optionen eine neue.
			let registrierung: Registrierung | null = null;
			if (mitPasskey) {
				const challenge = challengeAusAntwort(passkeyAntwort as Antwort);
				const genommen = challenge
					? await nimmChallenge(db, { challenge, purpose: 'register', personId: person.id, jetzt: zeit })
					: false;
				registrierung =
					challenge && genommen
						? await webauthn
								.verifyRegistration({
									response: passkeyAntwort as Parameters<typeof webauthn.verifyRegistration>[0]['response'],
									expectedChallenge: challenge,
									rp: relyingParty(req, deps),
								})
								// Eine Antwort, die sich nicht pruefen laesst, ist dasselbe wie eine falsche.
								.catch(() => null)
						: null;
				if (!registrierung) {
					res.status(400).json(PASSKEY_GESCHEITERT);
					return;
				}
			}
			const passwortHash = passwort ? await hashPassword(passwort) : null;
			const userAgent = req.get('user-agent');

			// 3. Entscheiden und schreiben.
			let sitzungsToken: string;
			try {
				sitzungsToken = await db.$transaction(async (tx) => {
					// Haelt Slug-Korrektur, Sperren und Erneuern (admin/daten.ts) an, bis
					// hier fertig ist; die lesen danach den neuen Zugang.
					await sperreVereinszeile(tx, verein.id);
					// Erneut lesen: zwischen vereinAusSlug und der Sperre kann der Admin den
					// Slug korrigiert oder den Verein gesperrt haben.
					const stand = await tx.verein.findFirst({ select: { slug: true, status: true } });
					if (!stand || stand.slug !== verein.slug || stand.status !== 'AKTIV') {
						throw new Abbruch(404, LINK_UNGUELTIG);
					}
					const { count } = await tx.einladung.updateMany({
						where: { tokenHash: hashToken(token), eingeloestAm: null, ablauf: { gt: zeit } },
						data: { eingeloestAm: zeit },
					});
					if (count !== 1) throw new Abbruch(404, LINK_UNGUELTIG);

					const p = await tx.person.findFirst({ where: { id: person.id }, include: { zugang: true } });
					if (!p || p.entferntAm || (p.art === 'JUNGFISCHER' && !p.zugangErlaubt)) {
						throw new Abbruch(404, LINK_UNGUELTIG);
					}
					if (
						p.art === 'JUNGFISCHER' &&
						(await tx.einwilligung.count({ where: { jungfischerId: p.id, widerrufenAm: null } })) === 0
					) {
						throw new Abbruch(409, EINWILLIGUNG_FEHLT);
					}

					let zugangId: string;
					if (p.zugang) {
						// Spec 4.4: wer einen neuen Link einloest, hat die alten Wege verloren
						// oder will sie loswerden. Alles davon geht, auch die anderen Sitzungen.
						// Verworfen: nur das Passwort ersetzen -- ein gestohlenes Geraet mit
						// Passkey oder offener Sitzung bliebe dann angemeldet.
						zugangId = p.zugang.id;
						await tx.passkey.deleteMany({ where: { zugangId } });
						await tx.recoveryCode.deleteMany({ where: { zugangId } });
						await tx.session.deleteMany({ where: { zugangId } });
						await tx.zugang.update({
							where: { id: zugangId },
							data: { passwortHash, totpGeheimnis: null, totpAktivAm: null },
						});
					} else {
						// Erneut geprueft, weil die Vorpruefung sie bei einem damals
						// bestehenden Zugang uebersprungen hat.
						if (!kennung.ok) throw new Abbruch(400, KENNUNG_UNGUELTIG[p.art]);
						if (p.art === 'ERWACHSENER') {
							await eindeutig(
								tx.person.update({ where: { id: p.id }, data: { email: kennung.wert } }),
								ADRESSE_VERGEBEN,
							);
						}
						const zugang = await eindeutig(
							tx.zugang.create({
								data: {
									personId: p.id,
									anmeldename: p.art === 'JUNGFISCHER' ? kennung.wert : null,
									passwortHash,
								},
							}),
							NAME_VERGEBEN,
						);
						zugangId = zugang.id;
					}

					if (registrierung) {
						// create statt upsert: ein Upsert uebernaehme eine credentialId, die
						// schon einem anderen Zugang gehoert.
						await eindeutig(
							tx.passkey.create({
								data: {
									zugangId,
									credentialId: registrierung.credentialId,
									publicKey: registrierung.publicKey,
									counter: registrierung.counter,
									transports: registrierung.transports,
									backedUp: registrierung.backedUp,
									label: passkeyLabel(userAgent),
								},
							}),
							PASSKEY_VERGEBEN,
						);
					}
					return legeSitzungAn(tx, { zugangId, jetzt: zeit, userAgent });
				});
			} catch (error) {
				if (error instanceof Abbruch) {
					res.status(error.status).json(error.antwort);
					return;
				}
				throw error;
			}
			setzeMitgliederCookie(req, res, verein.slug, sitzungsToken);
			res.json({ vorname: person.vorname });
		}),
	);
}
