import {
	decryptSecret,
	encryptSecret,
	generateRecoveryCodes,
	generateTotpSecret,
	hashPassword,
	hashRecoveryCode,
	hashToken,
	pruefeZwischenmarke,
	signiereZwischenmarke,
	totpUri,
	verifyPassword,
	verifyTotp,
	type AttemptTracker,
} from '@jufi/auth';
import { normalisiereBenutzername, PASSWORT_HINWEIS, pruefePasswort } from '@jufi/domain';
import type { Request, RequestHandler, Response, Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { adminKontext, brauchtAdmin, legeAdminSitzungAn, setzeAdminCookie } from './sitzung.js';

/**
 * Einrichtung per Einmal-Link, Anmeldung mit Passwort und TOTP, TOTP einrichten.
 *
 * Zwischen Passwort und TOTP gibt es kein halbfertiges Cookie, nur die signierte
 * Zwischenmarke (libs/auth): sonst liesse sich der zweite Faktor umgehen, indem
 * man nach dem Passwort einfach weiterklickt (wie hwyd, routes/auth.ts).
 */

const LINK_UNGUELTIG = { fehler: 'Dieser Link gilt nicht mehr' };
const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };
const EINRICHTUNG_ABGELAUFEN = { fehler: 'Einrichtung abgelaufen, bitte neu beginnen' };
const TOTP_SCHON_EINGERICHTET = { fehler: 'TOTP ist schon eingerichtet' };

/**
 * Argon2id-Hash ohne passendes Passwort, mit denselben Parametern wie
 * hashPassword. Fuer unbekannte Namen und Admins vor der Einrichtung: geprueft
 * wird trotzdem, damit die Antwortzeit nicht verraet, ob es den Namen gibt
 * (wie hwyd). Verworfen: sofort 401 -- die fehlenden ~50 ms Argon2 waeren messbar.
 */
const PLATZHALTER_HASH =
	'$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$0000000000000000000000000000000000000000000';

/**
 * Laenger als die Zwischenmarke der Anmeldung (5 Minuten): Wer TOTP zum ersten
 * Mal einrichtet, installiert womoeglich erst noch eine App und schreibt die
 * Wiederherstellungscodes ab.
 */
const TOTP_EINRICHTUNG_GUELTIG_MS = 10 * 60 * 1000;

/** Was zwischen start und bestaetigen beim Browser liegt, verschluesselt. */
interface TotpEinrichtung {
	adminId: string;
	geheimnis: string;
	hashes: string[];
	ablaufMs: number;
}

/** Express 4 faengt abgelehnte Promises nicht selbst; ohne das hinge die Anfrage. */
function asynchron(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
	return (req, res, next) => {
		fn(req, res).catch(next);
	};
}

function text(wert: unknown): string {
	return typeof wert === 'string' ? wert : '';
}

/** Die laengste Sperre unter den Schluesseln in ms, 0 wenn ein Versuch erlaubt ist. */
function sperre(versuche: AttemptTracker, schluessel: string[]): number {
	return Math.max(0, ...schluessel.map((s) => versuche.remaining(s)));
}

function zuVieleVersuche(res: Response, ms: number): void {
	res.status(429).json({ fehler: 'Zu viele Versuche', wartenSekunden: Math.ceil(ms / 1000) });
}

/**
 * Zaehlt einen Fehlversuch und antwortet. Loest genau dieser Versuch die Sperre
 * aus, kommt schon 429 mit der Wartezeit statt 401: sonst erfuhre der Browser
 * erst beim naechsten Versuch, dass er warten muss ("der vierte Fehlversuch ist
 * 429"). Verraten wird damit nichts -- die Antwort haengt nur an der Zahl der
 * Fehlversuche, nicht daran, was falsch war.
 */
function scheitere(versuche: AttemptTracker, schluessel: string[], res: Response, fehler: object, status = 401): void {
	for (const s of schluessel) versuche.fail(s);
	const ms = sperre(versuche, schluessel);
	if (ms > 0) {
		zuVieleVersuche(res, ms);
		return;
	}
	res.status(status).json(fehler);
}

function leseEinrichtung(marke: string, jetztMs: number): TotpEinrichtung | undefined {
	try {
		const wert = JSON.parse(decryptSecret(marke)) as Partial<TotpEinrichtung>;
		if (
			typeof wert.adminId !== 'string' ||
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

/**
 * Haengt die Routen direkt an den Router aus adminApi, ohne Unter-Router:
 * adminRouten liest nur dessen eigene Liste (siehe api.ts).
 */
export function anmeldeRouten(router: Router, deps: VolleAppDeps): void {
	const { prisma, jetzt, anmeldeVersuche: versuche, umgebung } = deps;

	// Prueft nur, verbraucht nichts: die Seite zeigt vor dem Passwortfeld, fuer
	// wen der Link ist. Kein Backoff, das Token hat 256 Bit.
	router.post(
		'/einrichtung/pruefen',
		asynchron(async (req, res) => {
			const einrichtung = await prisma.adminEinrichtung.findUnique({
				where: { tokenHash: hashToken(text(req.body?.token)) },
				select: { ablauf: true, eingeloestAm: true, admin: { select: { benutzername: true } } },
			});
			if (!einrichtung || einrichtung.eingeloestAm || einrichtung.ablauf <= jetzt()) {
				res.status(404).json(LINK_UNGUELTIG);
				return;
			}
			res.json({ benutzername: einrichtung.admin.benutzername });
		}),
	);

	router.post(
		'/einrichtung/abschliessen',
		asynchron(async (req, res) => {
			const passwort = text(req.body?.passwort);
			const pruefung = pruefePasswort(passwort);
			if (!pruefung.ok) {
				res.status(400).json({ fehler: PASSWORT_HINWEIS[pruefung.grund] });
				return;
			}
			// Vor der Transaktion: Argon2 dauert, und so lange hielte die
			// Transaktion die Zeile gesperrt.
			const passwortHash = await hashPassword(passwort);
			const tokenHash = hashToken(text(req.body?.token));
			const zeit = jetzt();
			const ergebnis = await prisma.$transaction(async (tx) => {
				// Einloesen mit Bedingung statt Lesen-dann-Schreiben: kommen zwei
				// Anfragen gleichzeitig (Doppelklick), wartet die zweite auf die Sperre
				// der ersten, sieht danach eingeloestAm gesetzt und zaehlt 0. Verworfen:
				// findUnique und dann update -- beide laesen "offen" und beide meldeten
				// an, mit zwei Sitzungen aus einem Einmal-Link.
				const { count } = await tx.adminEinrichtung.updateMany({
					where: { tokenHash, eingeloestAm: null, ablauf: { gt: zeit } },
					data: { eingeloestAm: zeit },
				});
				if (count !== 1) return undefined;
				const { adminId } = await tx.adminEinrichtung.findUniqueOrThrow({
					where: { tokenHash },
					select: { adminId: true },
				});
				const admin = await tx.plattformAdmin.update({
					where: { id: adminId },
					data: { passwortHash },
					select: { id: true, benutzername: true },
				});
				const token = await legeAdminSitzungAn(tx, admin.id, zeit, req.get('user-agent'));
				return { benutzername: admin.benutzername, token };
			});
			if (!ergebnis) {
				res.status(404).json(LINK_UNGUELTIG);
				return;
			}
			setzeAdminCookie(req, res, ergebnis.token);
			res.json({ benutzername: ergebnis.benutzername });
		}),
	);

	router.post(
		'/anmelden',
		asynchron(async (req, res) => {
			const benutzername = normalisiereBenutzername(text(req.body?.benutzername));
			const passwort = text(req.body?.passwort);
			// req.ip unter trust proxy 1: der letzte Eintrag in X-Forwarded-For, den
			// Traefik schreibt. Was der Client davor setzt, aendert den Schluessel nicht.
			const schluessel = [`ip:${req.ip}`, `admin:${benutzername}`];
			const gesperrt = sperre(versuche, schluessel);
			if (gesperrt > 0) {
				zuVieleVersuche(res, gesperrt);
				return;
			}

			const admin = benutzername
				? await prisma.plattformAdmin.findUnique({
						where: { benutzername },
						select: { id: true, passwortHash: true, totpGeheimnis: true, totpAktivAm: true },
					})
				: null;
			// Admin ohne Passwort (Einrichtung offen) wie ein unbekannter Name: auch
			// er laeuft durch den Platzhalter, sonst verriete die Antwortzeit ihn.
			const ok = await verifyPassword(admin?.passwortHash ?? PLATZHALTER_HASH, passwort);
			if (!admin?.passwortHash || !ok) {
				scheitere(versuche, schluessel, res, FEHLGESCHLAGEN);
				return;
			}
			for (const s of schluessel) versuche.reset(s);

			if (admin.totpAktivAm && admin.totpGeheimnis) {
				res.json({
					schritt: 'totp',
					zwischenmarke: signiereZwischenmarke(admin.id, umgebung.sitzungsGeheimnis, jetzt().getTime()),
				});
				return;
			}
			// Ohne TOTP sofort angemeldet: direkt nach der Einrichtung ist es noch
			// nicht da, und die Oberflaeche bietet es gleich an (Spec 7.2).
			const token = await legeAdminSitzungAn(prisma, admin.id, jetzt(), req.get('user-agent'));
			setzeAdminCookie(req, res, token);
			res.json({ schritt: 'fertig' });
		}),
	);

	router.post(
		'/anmelden/totp',
		asynchron(async (req, res) => {
			const zeit = jetzt();
			const adminId = pruefeZwischenmarke(text(req.body?.zwischenmarke), umgebung.sitzungsGeheimnis, zeit.getTime());
			if (!adminId) {
				res.status(401).json({ fehler: 'Anmeldung abgelaufen, bitte neu beginnen' });
				return;
			}
			const schluessel = [`totp:${adminId}`];
			const gesperrt = sperre(versuche, schluessel);
			if (gesperrt > 0) {
				zuVieleVersuche(res, gesperrt);
				return;
			}

			const code = text(req.body?.code);
			const wiederherstellungscode = text(req.body?.wiederherstellungscode);
			const admin = await prisma.plattformAdmin.findUnique({
				where: { id: adminId },
				select: { totpGeheimnis: true, totpAktivAm: true },
			});
			// Zwischen Passwort und Code zurueckgesetzt (TOTP geloescht): kein Weg mehr hinein.
			if (!admin?.totpGeheimnis || !admin.totpAktivAm) {
				res.status(401).json(FEHLGESCHLAGEN);
				return;
			}

			// Der TOTP-Code vor der Transaktion, damit sie nur Schreiben umfasst.
			const codeStimmt = code ? await verifyTotp(decryptSecret(admin.totpGeheimnis), code) : false;
			const ergebnis = await prisma.$transaction(async (tx) => {
				if (!codeStimmt) {
					if (code || !wiederherstellungscode) return undefined;
					// Sofort als verwendet markieren, mit Bedingung statt Lesen-dann-
					// Schreiben: zwei gleichzeitige Anmeldungen mit demselben Code
					// bekaemen sonst beide eine Sitzung. In derselben Transaktion wie die
					// Sitzung, damit ein Fehler dazwischen den Code nicht still verbraucht.
					const { count } = await tx.adminRecoveryCode.updateMany({
						where: { adminId, codeHash: hashRecoveryCode(wiederherstellungscode), verwendetAm: null },
						data: { verwendetAm: zeit },
					});
					if (count !== 1) return undefined;
				}
				const token = await legeAdminSitzungAn(tx, adminId, zeit, req.get('user-agent'));
				const uebrig = await tx.adminRecoveryCode.count({ where: { adminId, verwendetAm: null } });
				return { token, uebrig };
			});
			if (!ergebnis) {
				scheitere(versuche, schluessel, res, FEHLGESCHLAGEN);
				return;
			}
			versuche.reset(schluessel[0] ?? '');
			setzeAdminCookie(req, res, ergebnis.token);
			res.json({ schritt: 'fertig', wiederherstellungscodesUebrig: ergebnis.uebrig });
		}),
	);

	// Anders als hwyd ohne erneutes Passwort: hier ersetzt start keinen
	// bestehenden zweiten Faktor (409, sobald TOTP aktiv ist), es richtet nur den
	// ersten ein. Ersetzen geht ueber "admin zuruecksetzen" in der Kommandozeile.
	router.post(
		'/konto/totp/start',
		brauchtAdmin,
		asynchron(async (_req, res) => {
			const { admin } = adminKontext(res);
			const daten = await prisma.plattformAdmin.findUniqueOrThrow({
				where: { id: admin.id },
				select: { totpAktivAm: true },
			});
			if (daten.totpAktivAm) {
				res.status(409).json(TOTP_SCHON_EINGERICHTET);
				return;
			}
			const geheimnis = generateTotpSecret();
			const wiederherstellungscodes = generateRecoveryCodes();
			const einrichtung: TotpEinrichtung = {
				adminId: admin.id,
				geheimnis,
				hashes: wiederherstellungscodes.map(hashRecoveryCode),
				ablaufMs: jetzt().getTime() + TOTP_EINRICHTUNG_GUELTIG_MS,
			};
			res.json({
				// Heisst zwischenmarke wie bei der Anmeldung, ist aber der verschluesselte
				// Einrichtungszustand (wie hwyd, routes/totp.ts), nicht die HMAC-Marke:
				// die traegt nur eine ID, hier muessen Geheimnis und Code-Hashes mitreisen,
				// damit vor der Bestaetigung nichts in der Datenbank liegt.
				zwischenmarke: encryptSecret(JSON.stringify(einrichtung)),
				geheimnis,
				uri: totpUri(geheimnis, `${admin.benutzername} (Admin)`),
				wiederherstellungscodes,
			});
		}),
	);

	router.post(
		'/konto/totp/bestaetigen',
		brauchtAdmin,
		asynchron(async (req, res) => {
			const { admin } = adminKontext(res);
			const einrichtung = leseEinrichtung(text(req.body?.zwischenmarke), jetzt().getTime());
			// Die Marke muss zur Sitzung gehoeren: sonst bestaetigte ein Admin mit
			// der Marke eines anderen dessen Geheimnis fuer sich.
			if (!einrichtung || einrichtung.adminId !== admin.id) {
				res.status(400).json(EINRICHTUNG_ABGELAUFEN);
				return;
			}
			const schluessel = [`totp-einrichten:${admin.id}`];
			const gesperrt = sperre(versuche, schluessel);
			if (gesperrt > 0) {
				zuVieleVersuche(res, gesperrt);
				return;
			}
			if (!(await verifyTotp(einrichtung.geheimnis, text(req.body?.code)))) {
				scheitere(versuche, schluessel, res, { fehler: 'Code stimmt nicht' });
				return;
			}
			versuche.reset(schluessel[0] ?? '');

			const zeit = jetzt();
			const aktiviert = await prisma.$transaction(async (tx) => {
				// Nur wenn TOTP noch nicht aktiv ist: eine zweite, aeltere Marke aus
				// einem anderen Tab ersetzte sonst das gerade eingerichtete Geheimnis
				// still -- an start vorbei, das bei aktivem TOTP 409 sagt.
				const { count } = await tx.plattformAdmin.updateMany({
					where: { id: admin.id, totpAktivAm: null },
					data: { totpGeheimnis: encryptSecret(einrichtung.geheimnis), totpAktivAm: zeit },
				});
				if (count !== 1) return false;
				// Alle alten Codes verfallen, nicht nur die unbenutzten: sie gehoerten
				// zu einem frueheren zweiten Faktor (wie hwyd).
				await tx.adminRecoveryCode.deleteMany({ where: { adminId: admin.id } });
				await tx.adminRecoveryCode.createMany({
					data: einrichtung.hashes.map((codeHash) => ({ adminId: admin.id, codeHash })),
				});
				return true;
			});
			if (!aktiviert) {
				res.status(409).json(TOTP_SCHON_EINGERICHTET);
				return;
			}
			res.json({ ok: true });
		}),
	);
}
