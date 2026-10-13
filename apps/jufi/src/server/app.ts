import type { PrismaClient } from '@jufi/db';
import express from 'express';
import { fehlerbehandlung } from './fehler.js';
import { healthRouter } from './health.js';
import { sicherheitsHeader } from './sicherheit.js';
import { nichtGefunden, vereinAusSlug, vereinsApi } from './verein.js';

export interface AppDeps {
	prisma: PrismaClient;
	/** Kommt als Abhaengigkeit herein, damit Tests einen festen Wert vorgeben koennen. */
	version: { version: string; commit: string };
}

/**
 * Der Teil des Servers, der ohne Angular auskommt. server.ts haengt Dateien und
 * den Angular-Handler dahinter; die Tests bauen nur diesen Teil.
 */
export function createApp(deps: AppDeps): express.Express {
	const app = express();

	// TLS endet am Proxy davor, hier kommt http an. Ohne trust proxy hielte Express
	// jede Anfrage fuer unsicher (Cookie ohne Secure) und req.ip waere die des Proxys.
	app.set('trust proxy', true);
	app.disable('x-powered-by');

	app.use(sicherheitsHeader);
	// 100 KB (Spec 8.5). Der Parser kommt vor den Routen, damit zu grosse Bodies
	// scheitern, bevor eine Route sie sieht.
	app.use(express.json({ limit: '100kb' }));

	app.use('/healthz', healthRouter(deps));

	// Spaeter kommt /admin vor diese Zeile; pruefeSlug('admin') ist ohnehin reserviert.
	// nichtGefunden steht hier und nicht im Router, damit auch unbekannte Pfade
	// JSON-404 liefern, bevor server.ts den Angular-Handler dahinter haengt.
	app.use('/:slug/api/v1', vereinAusSlug(deps.prisma), vereinsApi, nichtGefunden);

	// Hier schon, damit Tests die Fehlerantworten ohne server.ts sehen. server.ts
	// registriert sie ein zweites Mal hinter dem Angular-Handler, weil Express
	// Fehlerbehandler nur fuer Routen davor zustaendig sind.
	app.use(fehlerbehandlung);
	return app;
}
