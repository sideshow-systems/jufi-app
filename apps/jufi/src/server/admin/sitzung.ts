import {
	ADMIN_COOKIE,
	ADMIN_COOKIE_PFAD,
	ADMIN_SITZUNG_SEKUNDEN,
	generateSessionToken,
	hashToken,
	readCookie,
	serializeClearedCookie,
	serializeCookie,
} from '@jufi/auth';
import type { PrismaClient } from '@jufi/db';
import type { Request, RequestHandler, Response } from 'express';
import { mitStandardwerten, type AppDeps } from '../abhaengigkeiten.js';

/** Was adminAusSitzung in res.locals ablegt; die Endpunkte lesen es ueber adminKontext. */
interface AdminLocals {
	admin: { id: string; benutzername: string };
	adminSitzungId: string;
}

/**
 * Legt eine Sitzung an und liefert das Token fuer das Cookie. Gespeichert wird
 * nur der Hash: wer die Datenbank liest, kann sich damit nicht anmelden.
 *
 * Nimmt auch einen Transaktions-Client (darum Pick statt PrismaClient), damit
 * Einrichtung und Anmeldung Sitzung und Einloesen in einem Schritt erledigen.
 * Der Ablauf steht fest ab jetzt: 12 Stunden ohne Verlaengerung (Global
 * Constraints), adminAusSitzung schreibt ihn nie fort.
 */
export async function legeAdminSitzungAn(
	prisma: Pick<PrismaClient, 'adminSession'>,
	adminId: string,
	jetzt: Date,
	userAgent?: string,
): Promise<string> {
	const token = generateSessionToken();
	await prisma.adminSession.create({
		data: {
			adminId,
			tokenHash: hashToken(token),
			ablauf: new Date(jetzt.getTime() + ADMIN_SITZUNG_SEKUNDEN * 1000),
			userAgent,
			angelegtAm: jetzt,
		},
	});
	return token;
}

/**
 * Macht aus dem Cookie jufi_admin den Admin der Anfrage. Ohne Cookie, mit
 * unbekanntem oder abgelaufenem Token geht die Anfrage ohne Admin weiter;
 * brauchtAdmin entscheidet je Route, ob das reicht. Verworfen: hier schon 401
 * -- dann kaemen die oeffentlichen Routen (Anmelden, Einrichten) nie durch.
 *
 * Nur jufi_admin zaehlt. Das Mitglieder-Cookie jufi_sitzung wird nicht gelesen,
 * auch wenn darin zufaellig ein gueltiges Admin-Token stuende: die beiden
 * Bereiche teilen sich keine Sitzung.
 */
export function adminAusSitzung(appDeps: AppDeps): RequestHandler {
	const { prisma, jetzt } = mitStandardwerten(appDeps);
	return async (req, res, next) => {
		try {
			const token = readCookie(req.headers.cookie, ADMIN_COOKIE);
			if (!token) {
				next();
				return;
			}
			const sitzung = await prisma.adminSession.findUnique({
				where: { tokenHash: hashToken(token) },
				select: { id: true, ablauf: true, admin: { select: { id: true, benutzername: true } } },
			});
			if (!sitzung) {
				next();
				return;
			}
			if (sitzung.ablauf <= jetzt()) {
				// Abgelaufene Zeilen raeumt die erste Anfrage danach weg, statt sie
				// liegen zu lassen. deleteMany statt delete: kommen zwei Anfragen
				// gleichzeitig, findet die zweite nichts mehr und soll nicht mit 500 enden.
				await prisma.adminSession.deleteMany({ where: { id: sitzung.id } });
				next();
				return;
			}
			const locals: AdminLocals = { admin: sitzung.admin, adminSitzungId: sitzung.id };
			Object.assign(res.locals, locals);
			next();
		} catch (error) {
			// Express 4 faengt abgelehnte Promises nicht selbst.
			next(error);
		}
	};
}

/**
 * 401 statt 404: der Admin-Bereich ist kein Geheimnis (Global Constraints);
 * 404-statt-403 gilt fuer Vereinsdaten. Steht als erster Handler jeder
 * geschuetzten Route, damit sie ohne Sitzung nichts liest, nicht einmal den Body.
 */
export const brauchtAdmin: RequestHandler = (_req, res, next) => {
	if (!(res.locals as Partial<AdminLocals>).admin) {
		res.status(401).json({ fehler: 'nicht angemeldet' });
		return;
	}
	next();
};

/**
 * Admin und Sitzung der Anfrage, getippt. Wirft, wenn eine Route ohne
 * brauchtAdmin hier ankommt, statt mit undefined weiterzurechnen (wie
 * vereinsKontext).
 */
export function adminKontext(res: Response): { admin: { id: string; benutzername: string }; sitzungId: string } {
	const locals = res.locals as Partial<AdminLocals>;
	if (!locals.admin || !locals.adminSitzungId) throw new Error('adminKontext ohne Admin-Sitzung aufgerufen');
	return { admin: locals.admin, sitzungId: locals.adminSitzungId };
}

/**
 * Secure genau dann, wenn die Anfrage ueber https kam (req.secure, hinter trust
 * proxy 1 aus X-Forwarded-Proto). Verworfen: Secure fest -- lokal ueber http
 * schickte der Browser das Cookie dann nie zurueck. append statt setHeader,
 * damit ein anderes Cookie derselben Antwort nicht ueberschrieben wird.
 */
export function setzeAdminCookie(req: Request, res: Response, token: string): void {
	res.append(
		'Set-Cookie',
		serializeCookie(ADMIN_COOKIE, token, {
			path: ADMIN_COOKIE_PFAD,
			maxAgeSeconds: ADMIN_SITZUNG_SEKUNDEN,
			secure: req.secure,
		}),
	);
}

export function loescheAdminCookie(req: Request, res: Response): void {
	res.append('Set-Cookie', serializeClearedCookie(ADMIN_COOKIE, { path: ADMIN_COOKIE_PFAD, secure: req.secure }));
}
