import {
	generateSessionToken,
	hashToken,
	MITGLIEDER_COOKIE,
	MITGLIEDER_SITZUNG_SEKUNDEN,
	mitgliederCookiePfad,
	readCookie,
	serializeClearedCookie,
	serializeCookie,
} from '@jufi/auth';
import type { Person, VereinDb, Zugang } from '@jufi/db';
import type { Request, RequestHandler, Response } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { vereinsKontext } from '../verein.js';

const TAG_MS = 24 * 60 * 60 * 1000;

/** Was mitgliedAusSitzung in res.locals ablegt; die Endpunkte lesen es ueber mitgliedKontext. */
interface MitgliedLocals {
	mitglied: { person: Person; zugang: Zugang; sitzungId: string };
}

/**
 * Legt eine Sitzung an und liefert das Token fuer das Cookie. Gespeichert wird
 * nur der Hash: wer die Datenbank liest, kann sich damit nicht anmelden.
 *
 * Nimmt auch einen Transaktions-Client (darum Pick statt VereinDb), damit
 * Einladung und Anmeldung Sitzung und Einloesen in einem Schritt erledigen.
 * Schreibt die letzte Anmeldung mit: jede Sitzung entsteht aus einer Anmeldung,
 * und so kann kein Weg sie vergessen.
 */
export async function legeSitzungAn(
	db: Pick<VereinDb, 'session' | 'zugang'>,
	e: { zugangId: string; jetzt: Date; userAgent?: string },
): Promise<string> {
	const token = generateSessionToken();
	await db.session.create({
		data: {
			zugangId: e.zugangId,
			tokenHash: hashToken(token),
			ablauf: new Date(e.jetzt.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000),
			zuletztGesehen: e.jetzt,
			userAgent: e.userAgent,
			angelegtAm: e.jetzt,
		},
	});
	await db.zugang.update({ where: { id: e.zugangId }, data: { letzteAnmeldungAm: e.jetzt } });
	return token;
}

/**
 * Ob eine Sitzung ihre Person noch traegt: nicht abgelaufen, Person nicht entfernt, und
 * bei einem Jungfischer der Zugang erlaubt. Eine reine Funktion, weil zwei Stellen sie
 * brauchen: die Middleware bei jeder Anfrage und der Hub fuer offene Sockets, wenn sich
 * das Umfeld aendert (Plan-Entscheidung 4). Zwei Fassungen liefen auseinander, und ein
 * Socket bliebe offen, den die REST-Seite schon abweist.
 */
export function sitzungGilt(zeile: { ablauf: Date; zugang: { person: Person } }, jetzt: Date): boolean {
	const { person } = zeile.zugang;
	return zeile.ablauf > jetzt && !person.entferntAm && !(person.art === 'JUNGFISCHER' && !person.zugangErlaubt);
}

/**
 * Macht aus dem Cookie jufi_sitzung die Sitzung, oder null: ohne Cookie, mit
 * unbekanntem Token, abgelaufen oder ohne gueltige Person (sitzungGilt).
 *
 * Gesucht wird ueber db, also nur im Verein der Anfrage: ein Token aus einem
 * anderen Verein ist hier unbekannt. Nur jufi_sitzung zaehlt; das Admin-Cookie
 * wird nicht gelesen.
 *
 * Eine abgelaufene Sitzung wird geloescht, eine mit ungueltiger Person nicht: ein
 * Jungfischer, dessen Zugang wieder erlaubt wird, braucht keine neue Anmeldung.
 * Das Loeschen steht hier und nicht in der Middleware, damit das Upgrade des Hubs
 * dieselben Zeilen aufraeumt.
 */
export async function loeseSitzungAuf(
	db: VereinDb,
	cookieHeader: string | undefined,
	jetzt: Date,
): Promise<{ person: Person; zugang: Zugang; sitzungId: string; ablauf: Date } | null> {
	const token = readCookie(cookieHeader, MITGLIEDER_COOKIE);
	if (!token) return null;
	const sitzung = await db.session.findUnique({
		where: { tokenHash: hashToken(token) },
		select: { id: true, ablauf: true, zugang: { include: { person: true } } },
	});
	if (!sitzung) return null;
	if (sitzung.ablauf <= jetzt) {
		// deleteMany statt delete: kommen zwei Anfragen gleichzeitig, findet die
		// zweite nichts mehr und soll nicht mit 500 enden.
		await db.session.deleteMany({ where: { id: sitzung.id } });
		return null;
	}
	if (!sitzungGilt(sitzung, jetzt)) return null;
	const { person, ...zugang } = sitzung.zugang;
	return { person, zugang, sitzungId: sitzung.id, ablauf: sitzung.ablauf };
}

/**
 * Macht aus dem Cookie jufi_sitzung das Mitglied der Anfrage (loeseSitzungAuf).
 * Ohne gueltige Sitzung geht die Anfrage ohne Mitglied weiter; brauchtMitglied
 * entscheidet je Route, ob das reicht. Verworfen: hier schon 401 -- dann kaemen
 * oeffentliche Routen (Anmelden, Einladung) nie durch.
 *
 * Verlaengert wird hoechstens einmal je 24 Stunden. Der Zeitpunkt der letzten
 * Verlaengerung ist ablauf minus 90 Tage und braucht darum kein eigenes Feld;
 * bei jeder Anfrage zu schreiben belastete die Datenbank fuer nichts.
 */
export function mitgliedAusSitzung(deps: Pick<VolleAppDeps, 'jetzt'>): RequestHandler {
	return async (req, res, next) => {
		try {
			const token = readCookie(req.headers.cookie, MITGLIEDER_COOKIE);
			if (!token) {
				next();
				return;
			}
			const { verein, db } = vereinsKontext(res);
			const jetzt = deps.jetzt();
			const sitzung = await loeseSitzungAuf(db, req.headers.cookie, jetzt);
			if (!sitzung) {
				next();
				return;
			}
			const verlaengertAm = sitzung.ablauf.getTime() - MITGLIEDER_SITZUNG_SEKUNDEN * 1000;
			if (jetzt.getTime() - verlaengertAm >= TAG_MS) {
				await db.session.update({
					where: { id: sitzung.sitzungId },
					data: { ablauf: new Date(jetzt.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000), zuletztGesehen: jetzt },
				});
				setzeMitgliederCookie(req, res, verein.slug, token);
			}
			const { person, zugang, sitzungId } = sitzung;
			const locals: MitgliedLocals = { mitglied: { person, zugang, sitzungId } };
			Object.assign(res.locals, locals);
			next();
		} catch (error) {
			// Express 4 faengt abgelehnte Promises nicht selbst.
			next(error);
		}
	};
}

/**
 * 401: wer nicht angemeldet ist, darf wissen, dass er sich anmelden kann. Die
 * 404-statt-403-Regel gilt fuer Vereinsdaten, die er nicht sehen darf. Steht
 * als erster Handler jeder geschuetzten Route.
 */
export const brauchtMitglied: RequestHandler = (_req, res, next) => {
	if (!(res.locals as Partial<MitgliedLocals>).mitglied) {
		res.status(401).json({ fehler: 'nicht angemeldet' });
		return;
	}
	next();
};

/** Mitglied der Anfrage, getippt; wirft, wenn eine Route ohne brauchtMitglied hier ankommt. */
export function mitgliedKontext(res: Response): MitgliedLocals['mitglied'] {
	const locals = res.locals as Partial<MitgliedLocals>;
	if (!locals.mitglied) throw new Error('mitgliedKontext ohne Mitglieder-Sitzung aufgerufen');
	return locals.mitglied;
}

/**
 * Secure genau dann, wenn die Anfrage ueber https kam (req.secure, hinter trust
 * proxy 1 aus X-Forwarded-Proto). Verworfen: Secure fest -- lokal ueber http
 * schickte der Browser das Cookie dann nie zurueck. append statt setHeader,
 * damit ein anderes Cookie derselben Antwort nicht ueberschrieben wird.
 */
export function setzeMitgliederCookie(req: Request, res: Response, slug: string, token: string): void {
	res.append(
		'Set-Cookie',
		serializeCookie(MITGLIEDER_COOKIE, token, {
			path: mitgliederCookiePfad(slug),
			maxAgeSeconds: MITGLIEDER_SITZUNG_SEKUNDEN,
			secure: req.secure,
		}),
	);
}

export function loescheMitgliederCookie(req: Request, res: Response, slug: string): void {
	res.append(
		'Set-Cookie',
		serializeClearedCookie(MITGLIEDER_COOKIE, { path: mitgliederCookiePfad(slug), secure: req.secure }),
	);
}
