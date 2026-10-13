import {
	AngularNodeAppEngine,
	createNodeRequestHandler,
	isMainModule,
	writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { assertSecrets } from '@jufi/auth';
import { createPrismaClientFromEnv } from '@jufi/db';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app.js';
import { fehlerbehandlung } from './server/fehler.js';
import { VERSION } from './version.generated.js';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = createApp({ prisma: createPrismaClientFromEnv(), version: VERSION });

/**
 * Hinter dem Proxy muss Angular die X-Forwarded-*-Header ausdruecklich
 * akzeptieren. Ohne das verwirft sanitizeRequestHeaders jeden davon und warnt
 * bei jeder Anfrage. Angular leitet daraus sonst http://<host> ab statt der
 * tatsaechlichen Adresse.
 *
 * Ausgewertet werden von Angular nur -proto, -host und -port (createRequestUrl
 * in @angular/ssr). Die anderen zwei stehen hier, weil Proxys sie mitschicken
 * und sie sonst jede Anfrage eine Warnzeile kosten.
 *
 * Das ist eine sicherheitsrelevante Einstellung: wer diese Header setzen kann,
 * bestimmt die vom Server gesehene Adresse. Zulaessig ist es, weil die App
 * keinen veroeffentlichten Port hat und nur ueber den Proxy erreichbar ist, der
 * die Header fuer nicht vertrauenswuerdige Clients selbst ueberschreibt.
 */
const angularApp = new AngularNodeAppEngine({
	trustProxyHeaders: [
		'x-forwarded-proto',
		'x-forwarded-host',
		'x-forwarded-port',
		'x-forwarded-for',
		'x-forwarded-server',
	],
});

app.use(
	express.static(browserDistFolder, {
		maxAge: '1y',
		index: false,
		redirect: false,
	}),
);

app.use('/**', (req, res, next) => {
	angularApp
		.handle(req)
		.then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
		.catch(next);
});

app.use(fehlerbehandlung);

if (isMainModule(import.meta.url) || process.env['pm_id']) {
	// Erst pruefen, dann lauschen: ein Schluessel mit der falschen Laenge liesse
	// die App sonst fehlerfrei starten, und der Fehler zeigte sich erst bei der
	// ersten Anmeldung.
	try {
		assertSecrets();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}

	const port = process.env['PORT'] ?? 4000;
	app.listen(port, () => {
		console.log(`JuFi laeuft auf http://localhost:${port}`);
	});
}

export const reqHandler = createNodeRequestHandler(app);
