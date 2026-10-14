import {
	AngularNodeAppEngine,
	createNodeRequestHandler,
	isMainModule,
	writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { createPrismaClientFromEnv } from '@jufi/db';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { createApp } from './server/app.js';
import { fehlerbehandlung } from './server/fehler.js';
import { starteMailArbeiter } from './server/mail/arbeiter.js';
import { nodemailerVersand } from './server/mail/versand.js';
import { Nachlauf } from './server/nachlauf.js';
import { umgebungAusEnv, type Umgebung } from './server/umgebung.js';
import { VERSION } from './version.generated.js';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

/**
 * Beim Bau fuehrt Angular diese Datei aus, um die Routen auszulesen -- in einem
 * Worker-Thread (Routenextraktion in @angular/build). Dort gibt es im Docker-Bau
 * weder Geheimnisse noch eine Datenbank: die Umgebungspruefung beendete den
 * Worker, der Bau scheiterte mit "An error occurred while extracting routes".
 * Lokal fiel das nie auf, weil .env und Entwicklungsdatenbank da sind -- dafuer
 * startete jeder lokale Bau kurz einen Mail-Arbeiter gegen die Entwicklungsdatenbank.
 *
 * Im Worker steht deshalb nur ein leeres Express-Geruest, an das unten Dateien
 * und Angular-Handler gehaengt werden; mehr braucht die Extraktion nicht.
 * Produktionsstart und pnpm run dev laden die Datei im Hauptthread und bekommen
 * alles. Verworfen: Platzhalter-Geheimnisse im Dockerfile -- die
 * Datenbankabfrage unten beendete den Worker trotzdem, und Platzhalter, die
 * eine Pruefung bestehen, sind genau das, wovor die Pruefung schuetzen soll.
 * Verworfen: auf NG_ALLOWED_HOSTS pruefen, das Angular im Worker setzt -- ein
 * Nebeneffekt, kein Vertrag; isMainThread ist eine Eigenschaft von Node.
 */
const app = isMainThread ? betriebsApp() : express();

function betriebsApp(): express.Express {
	// Zuerst: createPrismaClientFromEnv laedt die .env, aus der umgebungAusEnv liest.
	const prisma = createPrismaClientFromEnv();

	// Erst pruefen, dann bauen: ein Schluessel mit der falschen Laenge liesse die App
	// sonst fehlerfrei starten, und der Fehler zeigte sich erst bei der ersten
	// Anmeldung. Auf Modulebene statt nur beim Start als Hauptmodul, damit auch
	// pnpm run dev (ng serve laedt diese Datei als Modul) mit einer kaputten .env
	// sofort scheitert, statt bis zur ersten Anmeldung zu laufen. Die Meldung
	// nennt nur die Variablen, nie ihre Werte.
	let umgebung: Umgebung;
	try {
		umgebung = umgebungAusEnv(process.env);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}

	// Hier statt in createApp, damit das Beenden unten auf genau diesen warten kann.
	const nachlauf = new Nachlauf();
	const app = createApp({ prisma, version: VERSION, umgebung, nachlauf });

	/**
	 * Der Arbeiter startet erst, wenn die Datenbank antwortet: Sein erster Durchlauf
	 * liefe sonst gegen eine Verbindung, die es nicht gibt, und jeder Takt
	 * wiederholte den Fehler im Log. Auf Modulebene statt im Hauptmodul-Zweig unten,
	 * weil pnpm run dev (ng serve) diese Datei als Modul laedt und dort sonst keine
	 * Mail ginge. Beim Neuladen im Dev-Server kann so ein zweiter Arbeiter neben dem
	 * alten laufen; das ist harmlos, weil tick jede Mail vor dem Senden beansprucht.
	 */
	prisma.$queryRaw`SELECT 1`
		.then(() => {
			const arbeiter = starteMailArbeiter({
				prisma,
				versand: nodemailerVersand(umgebung),
				jetzt: () => new Date(),
			});
			// Ein laufender Versand soll nicht mitten im SMTP-Gespraech abbrechen und
			// ein Nachlauf ("Passwort vergessen?") nicht mitten in seiner Transaktion;
			// ohne diese Handler beendete SIGTERM den Prozess sofort. Danach
			// ausdruecklich beenden, weil ein Handler das Standardverhalten ersetzt.
			let beendet = false;
			const beende = () => {
				if (beendet) return;
				beendet = true;
				Promise.allSettled([arbeiter.stoppe(), nachlauf.warteAufAlle()]).finally(() => process.exit(0));
			};
			process.once('SIGTERM', beende);
			process.once('SIGINT', beende);
		})
		.catch((error: unknown) => {
			// Nur die Klasse: die Meldung einer Verbindungsstoerung kann die DATABASE_URL samt Passwort enthalten.
			console.error(
				`Datenbank nicht erreichbar (${error instanceof Error ? error.name : 'Fehler'}), Mail-Arbeiter nicht gestartet`,
			);
			process.exit(1);
		});

	return app;
}

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
	const port = process.env['PORT'] ?? 4000;
	app.listen(port, () => {
		console.log(`JuFi laeuft auf http://localhost:${port}`);
	});
}

export const reqHandler = createNodeRequestHandler(app);
