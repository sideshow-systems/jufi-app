import { Router } from 'express';
import type { AppDeps } from './app.js';

/** Nach dieser Zeit gilt die Datenbank als nicht erreichbar. */
const DB_ZEITLIMIT_MS = 2_000;

/**
 * Lebenszeichen fuer den Docker-Healthcheck und den Proxy. Kein reines
 * "ok": der Fall, den Docker erkennen soll, ist "Node laeuft, aber die
 * Datenbank ist weg". Nach aussen steht nur ok oder degraded; warum, gehoert
 * ins Log und nicht in eine Antwort, die jeder abrufen kann.
 */
export function healthRouter({ prisma, version }: AppDeps): Router {
	const router = Router();
	router.get('/', async (_req, res) => {
		try {
			await mitZeitlimit(prisma.$queryRaw`select 1`, DB_ZEITLIMIT_MS);
			res.status(200).json({ status: 'ok', version: version.version, commit: version.commit });
		} catch (error) {
			console.error('[healthz] Datenbank nicht erreichbar:', error);
			res.status(503).json({ status: 'degraded' });
		}
	});
	return router;
}

/**
 * Ohne Zeitlimit liesse eine haengende Verbindung den Healthcheck selbst
 * haengen, bis Docker ihn abbricht -- und die Ursache wuerde nirgends sichtbar.
 */
function mitZeitlimit<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Zeitueberschreitung nach ${ms} ms`)), ms);
		promise.then(
			(wert) => {
				clearTimeout(timer);
				resolve(wert);
			},
			(fehler) => {
				clearTimeout(timer);
				reject(fehler);
			},
		);
	});
}
