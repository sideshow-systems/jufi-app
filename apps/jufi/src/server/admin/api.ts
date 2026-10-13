import { Router } from 'express';
import { mitStandardwerten, type AppDeps } from '../abhaengigkeiten.js';
import { routenAus } from '../routen.js';
import { anmeldeRouten } from './anmeldung.js';
import { adminDaten } from './daten.js';
import { passkeyRouten } from './passkeys.js';
import { adminKontext, brauchtAdmin, loescheAdminCookie } from './sitzung.js';
import { vereinsRouten } from './vereine.js';

/**
 * Admin-Routen, die ohne Sitzung erreichbar sein muessen (Anmelden, Einrichten).
 * Alles andere verlangt brauchtAdmin; schutz.spec.ts prueft, dass jede Route in
 * genau einer der beiden Listen steht.
 */
export const OEFFENTLICHE_ADMIN_ROUTEN: readonly string[] = [
	'POST /einrichtung/pruefen',
	'POST /einrichtung/abschliessen',
	'POST /anmelden',
	'POST /anmelden/totp',
	'POST /anmelden/passkey/optionen',
	'POST /anmelden/passkey',
];

/**
 * Alle Endpunkte unter /admin/api/v1. Jeder haengt direkt an diesem Router, ohne
 * Unter-Router: adminRouten liest die Liste aus dem stack, und der Schutz-Test
 * prueft jeden Eintrag. Eine Route in einem Unter-Router bliebe unsichtbar.
 * Geschuetzte Routen nennen brauchtAdmin als ersten Handler, nicht per
 * router.use: das waere eine Schicht ohne Route, und oeffentliche Routen
 * muessten davor stehen -- eine Reihenfolge, die beim Einfuegen leicht kippt.
 *
 * Eine Funktion statt eines festen Routers wie vereinsApi, weil die Routen
 * Uhr, Umgebung und Backoff aus deps brauchen.
 */
export function adminApi(appDeps: AppDeps): Router {
	const deps = mitStandardwerten(appDeps);
	const { prisma } = deps;
	const router = Router({ caseSensitive: true });

	anmeldeRouten(router, deps);
	passkeyRouten(router, deps);
	// Ohne prisma: die Vereinsrouten lesen Vereinsdaten nur ueber adminDaten.
	vereinsRouten(router, { jetzt: deps.jetzt, umgebung: deps.umgebung, daten: adminDaten(prisma) });

	router.get('/ich', brauchtAdmin, async (_req, res, next) => {
		try {
			const { admin } = adminKontext(res);
			const daten = await prisma.plattformAdmin.findUnique({
				where: { id: admin.id },
				select: {
					benutzername: true,
					totpAktivAm: true,
					_count: { select: { passkeys: true, recoveryCodes: { where: { verwendetAm: null } } } },
				},
			});
			// Zwischen Sitzungspruefung und hier geloescht: wie ohne Sitzung.
			if (!daten) {
				res.status(401).json({ fehler: 'nicht angemeldet' });
				return;
			}
			res.json({
				benutzername: daten.benutzername,
				totpAktiv: daten.totpAktivAm !== null,
				passkeys: daten._count.passkeys,
				wiederherstellungscodesUebrig: daten._count.recoveryCodes,
			});
		} catch (error) {
			next(error);
		}
	});

	router.post('/abmelden', brauchtAdmin, async (req, res, next) => {
		try {
			const { sitzungId } = adminKontext(res);
			// deleteMany: ein Doppelklick auf Abmelden soll nicht mit 500 enden.
			await prisma.adminSession.deleteMany({ where: { id: sitzungId } });
			loescheAdminCookie(req, res);
			res.status(204).end();
		} catch (error) {
			next(error);
		}
	});

	return router;
}

/** Methode und Pfad jeder Route eines adminApi-Routers, fuer den Schutz-Test. */
export function adminRouten(router: Router): { methode: string; pfad: string }[] {
	return routenAus(router, 'adminApi');
}
