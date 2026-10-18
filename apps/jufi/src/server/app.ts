import express from 'express';
import { mitStandardwerten, type AppDeps } from './abhaengigkeiten.js';
import { adminApi } from './admin/api.js';
import { adminAusSitzung } from './admin/sitzung.js';
import { fehlerbehandlung } from './fehler.js';
import { healthRouter } from './health.js';
import { sicherheitsHeader } from './sicherheit.js';
import { mitgliedAusSitzung } from './mitglieder/sitzung.js';
import { pruefeUrsprung } from './ursprung.js';
import { nichtGefunden, vereinAusSlug, vereinsApi } from './verein.js';
import { pwaRouten } from './verein/pwa.js';

export type { AppDeps, VolleAppDeps, WebauthnPruefer } from './abhaengigkeiten.js';
export { mitStandardwerten } from './abhaengigkeiten.js';

/**
 * Der Teil des Servers, der ohne Angular auskommt. server.ts haengt Dateien und
 * den Angular-Handler dahinter; die Tests bauen nur diesen Teil.
 */
export function createApp(appDeps: AppDeps): express.Express {
	const deps = mitStandardwerten(appDeps);
	const app = express();

	// Vor allen Routen: Express liest die Einstellung, wenn es den Router anlegt.
	// /ADMIN/... ist damit nicht /admin/... -- sonst laege der Admin unter beliebig
	// vielen Schreibweisen, und das Cookie (Path=/admin/) kaeme bei keiner davon mit.
	app.set('case sensitive routing', true);
	// TLS endet am Proxy davor, hier kommt http an. Ohne trust proxy hielte Express
	// jede Anfrage fuer unsicher (Cookie ohne Secure) und req.ip waere die des Proxys.
	// Genau ein Proxy (Traefik), nicht true: bei true nimmt Express den vordersten
	// Eintrag aus X-Forwarded-For, und den schreibt der Client selbst -- ein
	// gefaelschter Header bestimmte dann req.ip und damit den Backoff-Schluessel.
	app.set('trust proxy', 1);
	app.disable('x-powered-by');

	app.use(sicherheitsHeader);
	// 100 KB (Spec 8.5). Der Parser kommt vor den Routen, damit zu grosse Bodies
	// scheitern, bevor eine Route sie sieht.
	app.use(express.json({ limit: '100kb' }));
	// App-weit vor allen Routen, damit keine schreibende Route ohne sie entsteht.
	app.use(pruefeUrsprung(new URL(deps.umgebung.basisUrl).origin));

	app.use('/healthz', healthRouter(deps));

	// Vor der Vereins-API, sonst naehme /:slug/api/v1 den Pfad mit slug "admin".
	// nichtGefunden steht hier und nicht im Router, damit auch unbekannte Pfade
	// JSON-404 liefern, bevor server.ts den Angular-Handler dahinter haengt.
	app.use('/admin/api/v1', adminAusSitzung(deps), adminApi(deps), nichtGefunden);
	app.use('/:slug/api/v1', vereinAusSlug(deps.prisma), mitgliedAusSitzung(deps), vereinsApi(deps), nichtGefunden);
	// Manifest und Icons je Verein. Ohne nichtGefunden dahinter: alle anderen Pfade
	// unter dem Slug gehoeren Angular und muessen server.ts erreichen (siehe pwaRouten).
	app.use(pwaRouten(deps));

	// Hier schon, damit Tests die Fehlerantworten ohne server.ts sehen. server.ts
	// registriert sie ein zweites Mal hinter dem Angular-Handler, weil Express
	// Fehlerbehandler nur fuer Routen davor zustaendig sind.
	app.use(fehlerbehandlung);
	return app;
}
