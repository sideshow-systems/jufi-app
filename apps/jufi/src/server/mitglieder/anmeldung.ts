import {
	authenticationOptions,
	challengeAusAntwort,
	decryptSecret,
	hashRecoveryCode,
	pruefeZwischenmarke,
	signiereZwischenmarke,
	verifyPassword,
	verifyTotp,
} from '@jufi/auth';
import { sperreVereinszeile, type Person, type VereinDb, type Zugang } from '@jufi/db';
import { normalisiereBenutzername, normalisiereEmail } from '@jufi/domain';
import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { PLATZHALTER_HASH } from '../admin/anmeldung.js';
import { asynchron, text } from '../admin/asynchron.js';
import { relyingParty } from '../admin/passkeys.js';
import { erstatte, reserviere, scheitere, zuVieleVersuche } from '../admin/versuche.js';
import { vereinsKontext } from '../verein.js';
import { nimmChallenge, speichereChallenge } from './challenges.js';
import { legeSitzungAn, setzeMitgliederCookie } from './sitzung.js';

/**
 * Anmelden der Mitglieder: Passwort (mit TOTP als zweitem Schritt) oder Passkey.
 * Gebaut wie die Admin-Anmeldung (admin/anmeldung.ts, admin/passkeys.ts), aber
 * alles ueber vereinDb: Zugang, Passkey, Challenge und Wiederherstellungscode
 * eines anderen Vereins sind hier unsichtbar.
 *
 * Backoff-Schluessel mit eigenem Praefix "m", getrennt vom Admin ("ip:",
 * "admin:", "totp:"): beide teilen sich denselben AttemptTracker, und ein
 * Kind, das sich im Verein vertippt, soll den Admin auf derselben IP nicht
 * aussperren. Die Kennung traegt die vereinId, weil "lena" in zwei Vereinen
 * zwei verschiedene Kinder sind.
 */

const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };
/** RFC 5321; laenger ist keine Adresse und erst recht kein Anmeldename. */
const MAX_KENNUNG = 254;
const ABGELAUFEN = { fehler: 'Anmeldung abgelaufen, bitte neu beginnen' };
/**
 * Eigener Text statt "Anmeldung fehlgeschlagen" (Spec 4.3, Entscheidung 3): das
 * Telefon bietet ohne allowCredentials alle Passkeys dieser Domain an, auch die
 * eines anderen Vereins. Wer den falschen waehlt, soll erfahren, warum es nicht
 * geht. Verraten wird damit nichts -- dass ein Passkey hier unbekannt ist, weiss
 * sein Besitzer ohnehin, und fuer fremde credentialIds fehlt die Signatur.
 */
const FREMDER_PASSKEY = { fehler: 'Dieser Passkey gehört nicht zu diesem Verein' };

type ZugangMitPerson = Zugang & { person: Person };
type Antwort = Parameters<typeof challengeAusAntwort>[0];

/**
 * Darf diese Person sich anmelden? Entfernte Personen und Jungfischer, deren
 * Zugang die Familie gesperrt hat, nicht -- dieselbe Regel wie in
 * mitgliedAusSitzung, damit eine neue Sitzung nicht entsteht, die dort sofort
 * wieder als "nicht angemeldet" gaelte.
 */
function darfHinein(person: Person): boolean {
	return !person.entferntAm && !(person.art === 'JUNGFISCHER' && !person.zugangErlaubt);
}

/**
 * Normalisiert die Kennung so, wie sie gespeichert ist. Das "@" entscheidet,
 * wie beim Einloesen: Anmeldenamen duerfen keins enthalten (libs/domain), die
 * Adresse braucht eins. Beide Normalisierungen sind heute gleich (trim, klein);
 * getrennt gerufen, damit eine spaetere Aenderung an einer die andere nicht
 * mitzieht.
 */
function normalisiereKennung(roh: string): { art: 'email' | 'anmeldename'; wert: string } {
	const kennung = roh.includes('@')
		? { art: 'email' as const, wert: normalisiereEmail(roh) }
		: { art: 'anmeldename' as const, wert: normalisiereBenutzername(roh) };
	// Laenger als jede moegliche Kennung (Adresse hoechstens 254 Zeichen,
	// Anmeldename 30) ist wie leer: findet niemanden, und alle teilen sich einen
	// Backoff-Schluessel. Sonst laege jeder 90-kB-Body bis zu 15 Minuten als
	// Schluessel im Speicher. Nur die Laenge, nicht pruefeEmail/pruefeAnmeldename:
	// eine gespeicherte Kennung, die einer spaeter verschaerften Pruefung nicht
	// mehr genuegt, soll sich weiter anmelden koennen.
	return kennung.wert.length > MAX_KENNUNG ? { ...kennung, wert: '' } : kennung;
}

/**
 * Der Zugang zur Kennung im Verein der Anfrage, oder null. Mit Adresse nur
 * Erwachsene: die Adresse eines Jungfischers ist freiwillig und nur fuer
 * Benachrichtigungen (Schema, Person.email), seine Kennung ist der
 * Anmeldename. Verworfen: jede Adresse zulassen -- dann haette ein Kind zwei
 * Kennungen, und die Oberflaeche zeigte (GET /ich) nur eine davon.
 */
async function zugangZurKennung(
	db: VereinDb,
	kennung: { art: 'email' | 'anmeldename'; wert: string },
): Promise<ZugangMitPerson | null> {
	if (!kennung.wert) return null;
	if (kennung.art === 'email') {
		const person = await db.person.findFirst({
			where: { email: kennung.wert, art: 'ERWACHSENER' },
			include: { zugang: true },
		});
		if (!person?.zugang) return null;
		const { zugang, ...rest } = person;
		return { ...zugang, person: rest };
	}
	return db.zugang.findFirst({ where: { anmeldename: kennung.wert }, include: { person: true } });
}

/**
 * Haengt die Routen direkt an den Router von vereinsApi, ohne Unter-Router:
 * der Mandanten-Test liest die Liste von dort (siehe verein.ts).
 */
export function anmeldeRouten(router: Router, deps: VolleAppDeps): void {
	const { jetzt, anmeldeVersuche: versuche, umgebung, webauthn } = deps;

	router.post(
		'/anmelden',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const kennung = normalisiereKennung(text(req.body?.kennung));
			const passwort = text(req.body?.passwort);
			// Normalisiert im Schluessel: sonst zaehlten "Lena" und "lena " getrennt,
			// und wer Grossschreibung variiert, bekaeme die Versuche mehrfach.
			// reserviere vor dem ersten await (siehe versuche.ts).
			const kennungSchluessel = `m:${verein.id}:${kennung.wert}`;
			const ipSchluessel = `m-ip:${req.ip}`;
			const schluessel = [ipSchluessel, kennungSchluessel];
			const versuch = reserviere(versuche, schluessel);
			if (versuch.wartenMs > 0) {
				zuVieleVersuche(res, versuch.wartenMs);
				return;
			}

			const zugang = await zugangZurKennung(db, kennung);
			const hash = zugang && darfHinein(zugang.person) ? zugang.passwortHash : null;
			// Alles, was nicht anmelden darf (unbekannt, ohne Passwort, entfernt, ohne
			// Zugangserlaubnis), laeuft durch den Platzhalter: die Antwort und ihre
			// Dauer sind dieselben wie bei einem falschen Passwort. Verworfen: frueh
			// mit 401 antworten -- die fehlenden ~50 ms Argon2 verrieten, welche
			// Anmeldenamen es gibt, und Kindernamen sind leicht zu raten.
			const ok = await verifyPassword(hash ?? PLATZHALTER_HASH, passwort);
			if (!zugang || !hash || !ok) {
				scheitere(versuche, schluessel, versuch.loestSperreAus, res, FEHLGESCHLAGEN);
				return;
			}
			// Nur die Kennung zuruecksetzen, nicht m-ip: sonst setzte ein eigenes
			// gueltiges Konto den Zaehler eines Angreifers derselben IP zurueck.
			// Verworfen: beide zuruecksetzen -- ein Angreifer mit eigenem Konto
			// loeschte so nach jedem Raten seinen IP-Zaehler.
			versuche.reset(kennungSchluessel);
			// Der Erfolg erstattet seine eigene Zaehlung auf m-ip, damit Vereins-WLAN und
			// CGNAT nicht an der Zahl legitimer Logins sperren; die Fehlversuche anderer
			// bleiben stehen.
			erstatte(versuche, [ipSchluessel]);

			// Nur an totpAktivAm entschieden, wie beim Admin: ein kaputter Datensatz
			// (aktiv, aber ohne Geheimnis) scheitert im TOTP-Schritt, statt mit dem
			// Passwort allein anzumelden.
			if (zugang.totpAktivAm) {
				// Die Marke traegt nur die zugangId, nicht den Verein: eingeloest wird
				// sie ueber vereinDb, eine Marke aus einem anderen Verein findet dort
				// keinen Zugang. Verworfen: vereinId mit signieren -- doppelt gesichert,
				// aber ein zweites Format neben dem des Admins fuer keinen Gewinn.
				res.json({
					schritt: 'totp',
					zwischenmarke: signiereZwischenmarke('m-totp', zugang.id, umgebung.sitzungsGeheimnis, jetzt().getTime()),
				});
				return;
			}
			const zeit = jetzt();
			const userAgent = req.get('user-agent');
			const token = await db.$transaction(async (tx) => {
				// Argon2 lief ohne Sperre, und ein Reset-Link oder Passwortwechsel kann
				// inzwischen committet haben. Beide loeschen die Sitzungen (Spec 4.4);
				// eine danach angelegte ueberlebte sie 90 Tage. Darum unter derselben
				// Sperre wie Einloesen und Profil, und nur, wenn der gepruefte Hash noch
				// gilt. Verworfen: Argon2 unter der Sperre -- dann stuende jede andere
				// Vereinsentscheidung ~50 ms je Anmeldeversuch still, auch fuer Raten.
				await sperreVereinszeile(tx, verein.id);
				if ((await tx.zugang.count({ where: { id: zugang.id, passwortHash: hash } })) !== 1) return undefined;
				return legeSitzungAn(tx, { zugangId: zugang.id, jetzt: zeit, userAgent });
			});
			if (!token) {
				// Dieselbe Antwort wie beim falschen Passwort: das alte gilt ja nicht mehr.
				scheitere(versuche, schluessel, versuch.loestSperreAus, res, FEHLGESCHLAGEN);
				return;
			}
			setzeMitgliederCookie(req, res, verein.slug, token);
			res.json({ schritt: 'fertig' });
		}),
	);

	router.post(
		'/anmelden/totp',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			const zeit = jetzt();
			const zugangId = pruefeZwischenmarke(
				'm-totp',
				text(req.body?.zwischenmarke),
				umgebung.sitzungsGeheimnis,
				zeit.getTime(),
			);
			if (!zugangId) {
				res.status(401).json(ABGELAUFEN);
				return;
			}
			const schluessel = [`m-totp:${zugangId}`];
			const versuch = reserviere(versuche, schluessel);
			if (versuch.wartenMs > 0) {
				zuVieleVersuche(res, versuch.wartenMs);
				return;
			}

			const code = text(req.body?.code);
			const wiederherstellungscode = text(req.body?.wiederherstellungscode);
			const zugang = await db.zugang.findFirst({ where: { id: zugangId }, include: { person: true } });
			// Erneut geprueft: zwischen Passwort und Code kann die Person entfernt,
			// der Zugang gesperrt oder TOTP zurueckgesetzt worden sein.
			if (!zugang?.totpGeheimnis || !zugang.totpAktivAm || !darfHinein(zugang.person)) {
				scheitere(versuche, schluessel, versuch.loestSperreAus, res, FEHLGESCHLAGEN);
				return;
			}

			// Der Code vor der Transaktion, damit sie nur Schreiben umfasst.
			const codeStimmt = code ? await verifyTotp(decryptSecret(zugang.totpGeheimnis), code) : false;
			const userAgent = req.get('user-agent');
			const ergebnis = await db.$transaction(async (tx) => {
				// Wie beim Passwort: der Code wurde ohne Sperre geprueft, ein Reset-Link
				// kann TOTP, Codes und Sitzungen inzwischen geloescht haben. Gilt das
				// gepruefte Geheimnis nicht mehr, entsteht keine Sitzung -- auch nicht
				// mit einem Wiederherstellungscode, die der Reset ebenfalls loescht.
				await sperreVereinszeile(tx, verein.id);
				const unveraendert = await tx.zugang.count({
					where: { id: zugangId, totpGeheimnis: zugang.totpGeheimnis, totpAktivAm: { not: null } },
				});
				if (unveraendert !== 1) return undefined;
				if (!codeStimmt) {
					if (code || !wiederherstellungscode) return undefined;
					// Bedingtes updateMany statt Lesen-dann-Schreiben: zwei gleichzeitige
					// Anmeldungen mit demselben Code bekaemen sonst beide eine Sitzung. In
					// derselben Transaktion wie die Sitzung, damit ein Fehler dazwischen den
					// Code nicht still verbraucht (wie beim Admin).
					const { count } = await tx.recoveryCode.updateMany({
						where: { zugangId, codeHash: hashRecoveryCode(wiederherstellungscode), verwendetAm: null },
						data: { verwendetAm: zeit },
					});
					if (count !== 1) return undefined;
				}
				const token = await legeSitzungAn(tx, { zugangId, jetzt: zeit, userAgent });
				const uebrig = await tx.recoveryCode.count({ where: { zugangId, verwendetAm: null } });
				return { token, uebrig };
			});
			if (!ergebnis) {
				scheitere(versuche, schluessel, versuch.loestSperreAus, res, FEHLGESCHLAGEN);
				return;
			}
			versuche.reset(schluessel[0] ?? '');
			setzeMitgliederCookie(req, res, verein.slug, ergebnis.token);
			res.json({ schritt: 'fertig', wiederherstellungscodesUebrig: ergebnis.uebrig });
		}),
	);

	// Ohne allowCredentials (libs/auth): eine Liste verriete jedem, welche Geraete
	// im Verein registriert sind. Kein Backoff: die Route prueft nichts, und jede
	// Challenge gilt nur einmal und zwei Minuten.
	router.post(
		'/anmelden/passkey-optionen',
		asynchron(async (req, res) => {
			const { db } = vereinsKontext(res);
			const optionen = await authenticationOptions(relyingParty(req, deps));
			await speichereChallenge(db, { challenge: optionen.challenge, purpose: 'authenticate', jetzt: jetzt() });
			res.json({ optionen });
		}),
	);

	router.post(
		'/anmelden/passkey',
		asynchron(async (req, res) => {
			const { verein, db } = vereinsKontext(res);
			// Nur die IP: ein Passkey nennt vorher keine Kennung, die sich sperren
			// liesse. Derselbe Schluessel wie beim Passwort, beide Wege teilen sich
			// den Zaehler je IP (wie beim Admin).
			const schluessel = [`m-ip:${req.ip}`];
			const versuch = reserviere(versuche, schluessel);
			if (versuch.wartenMs > 0) {
				zuVieleVersuche(res, versuch.wartenMs);
				return;
			}
			const scheitert = (fehler: object = FEHLGESCHLAGEN) =>
				scheitere(versuche, schluessel, versuch.loestSperreAus, res, fehler);

			const antwort: unknown = req.body?.antwort;
			const credentialId = (antwort as { id?: unknown } | null | undefined)?.id;
			const challenge = challengeAusAntwort(antwort as Antwort);
			if (typeof credentialId !== 'string' || !credentialId || !challenge) {
				scheitert();
				return;
			}

			// Die Challenge zuerst: sie wird verbraucht, egal wie es weitergeht, und
			// eine Challenge aus einem anderen Verein ist ueber vereinDb unbekannt.
			// Erst danach der Passkey, damit niemand ohne gueltige Challenge
			// abfragen kann, welche credentialIds hier bekannt sind.
			const zeit = jetzt();
			if (!(await nimmChallenge(db, { challenge, purpose: 'authenticate', jetzt: zeit }))) {
				scheitert();
				return;
			}

			// Ueber vereinDb: ein Passkey eines anderen Vereins ist hier wie ein
			// unbekannter. Verworfen: im schlichten PrismaClient nachsehen, um
			// "fremd" von "unbekannt" zu trennen -- fuer die Meldung macht es keinen
			// Unterschied, und die Route bliebe ohne Griff in fremde Vereine.
			const passkey = await db.passkey.findUnique({
				where: { credentialId },
				select: {
					id: true,
					zugangId: true,
					credentialId: true,
					publicKey: true,
					counter: true,
					transports: true,
					zugang: { select: { person: true } },
				},
			});
			if (!passkey) {
				scheitert(FREMDER_PASSKEY);
				return;
			}
			if (!darfHinein(passkey.zugang.person)) {
				scheitert();
				return;
			}

			const geprueft = await webauthn
				.verifyAuthentication({
					response: antwort as Parameters<typeof webauthn.verifyAuthentication>[0]['response'],
					expectedChallenge: challenge,
					rp: relyingParty(req, deps),
					passkey,
				})
				// Eine Antwort, die sich nicht pruefen laesst, ist dasselbe wie eine falsche.
				.catch(() => null);
			if (!geprueft) {
				scheitert();
				return;
			}

			const userAgent = req.get('user-agent');
			const token = await db.$transaction(async (tx) => {
				// Die Pruefung lief ohne Sperre; ein Reset-Link oder das Loeschen im
				// Profil kann den Passkey inzwischen entfernt haben, samt Sitzungen.
				// Unter der Sperre und nur, wenn es ihn noch gibt. updateMany statt
				// update: ein fehlender Passkey zaehlt 0 und wird zur ueblichen 401,
				// update warf P2025 und endete als 500.
				await sperreVereinszeile(tx, verein.id);
				// Den Zaehler uebernimmt, was die Pruefung meldet, auch 0: synchronisierte
				// Schluessel melden immer 0, und die Bibliothek wertet das nicht als Klon
				// (siehe Passkey.counter im Schema).
				const { count } = await tx.passkey.updateMany({
					where: { id: passkey.id, zugangId: passkey.zugangId },
					data: { counter: geprueft.counter, lastUsedAt: zeit },
				});
				if (count !== 1) return undefined;
				return legeSitzungAn(tx, { zugangId: passkey.zugangId, jetzt: zeit, userAgent });
			});
			if (!token) {
				scheitert();
				return;
			}
			// Nur die eigene Zaehlung auf m-ip zurueck, kein Reset: sonst hebelte ein
			// Passkey-Login den Zaehler eines Angreifers derselben IP aus.
			erstatte(versuche, schluessel);
			setzeMitgliederCookie(req, res, verein.slug, token);
			res.json({ schritt: 'fertig' });
		}),
	);
}
