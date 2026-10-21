import {
	AngularNodeAppEngine,
	createNodeRequestHandler,
	isMainModule,
	writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { createPrismaClientFromEnv } from '@jufi/db';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { createApp } from './server/app.js';
import { VerzeichnisSpeicher } from './server/dateien/speicher.js';
import { Bus } from './server/echtzeit/bus.js';
import { Hub } from './server/echtzeit/hub.js';
import { fehlerbehandlung } from './server/fehler.js';
import { starteMailArbeiter } from './server/mail/arbeiter.js';
import { nodemailerVersand } from './server/mail/versand.js';
import { Nachlauf } from './server/nachlauf.js';
import { starteAufraeumen } from './server/threads/aufraeumen.js';
import { umgebungAusEnv, type Umgebung } from './server/umgebung.js';
import { htmlAusAntwort } from './server/verein/html-antwort.js';
import { VERSION } from './version.generated.js';

/** Symbol.for, damit das neu geladene Modul denselben Schluessel findet wie das alte. */
const DEV_HUB = Symbol.for('jufi.devHub');

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

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
 *
 * Steht aus Gruenden der Lesbarkeit vor seinem ersten Nutzer (seitenHtml in betriebsApp, die
 * Link-Vorschau), damit niemand ein Problem mit der zeitlichen Totzone vermutet: Die Closure
 * liest ihn erst bei einer Anfrage, noetig waere die Reihenfolge nicht. Der Konstruktor lief
 * schon vor dieser Stufe auf Modulebene. Er braucht weder Umgebung noch Datenbank und hat
 * keinen Nebeneffekt, darf also auch im Worker der Routenextraktion stehen; aufgerufen wird
 * er dort nie. Verworfen: eine zweite Engine in betriebsApp -- zwei Stellen mit derselben
 * Proxy-Einstellung, von denen eine vergessen wird.
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
 *
 * Der Hub gehoert aus demselben Grund in betriebsApp: Er lauscht unter ng serve auf einem Port und
 * pingt im Takt, beides hat im Bau nichts zu suchen.
 */
const { app, betrieb } = isMainThread ? betriebsApp() : { app: express(), betrieb: undefined };

interface Betrieb {
	hub: Hub;
	/** Nur unter ng serve gebraucht (starteDevHub). */
	wsDevPort: number;
}

function betriebsApp(): { app: express.Express; betrieb: Betrieb } {
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
	// Ein Bus fuer Routen und Hub: Was die Routen melden, muss beim Hub ankommen (Plan-Entscheidung 1).
	const bus = new Bus();
	// Einmal hier erzeugt und beiden gegeben: Routen und Aufraeumer muessen dasselbe Verzeichnis
	// meinen, sonst raeumte der Aufraeumer ein anderes auf, als die Routen fuellen. Der Konstruktor
	// legt nichts an, es bleibt also bei "im Bau nichts mit Nebenwirkung" (betriebsApp laeuft nur im Hauptthread).
	const dateiSpeicher = new VerzeichnisSpeicher(umgebung.dateienPfad);
	const app = createApp({
		prisma,
		version: VERSION,
		umgebung,
		nachlauf,
		bus,
		dateiSpeicher,
		// Erst bei einer Anfrage gerufen, nie beim Bau. null: Angular beansprucht den Pfad nicht.
		seitenHtml: async (req) => htmlAusAntwort(await angularApp.handle(req)),
	});
	const hub = new Hub({ prisma, umgebung, jetzt: () => new Date(), bus });

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
			// Neben dem Mail-Arbeiter und aus demselben Grund erst nach SELECT 1 (Plan-Entscheidung 13).
			const aufraeumen = starteAufraeumen({ prisma, jetzt: () => new Date(), speicher: dateiSpeicher });
			// Ein laufender Versand soll nicht mitten im SMTP-Gespraech abbrechen und
			// ein Nachlauf ("Passwort vergessen?") nicht mitten in seiner Transaktion;
			// ohne diese Handler beendete SIGTERM den Prozess sofort. Danach
			// ausdruecklich beenden, weil ein Handler das Standardverhalten ersetzt. Der Hub
			// schliesst die Sockets mit 1012, damit die Clients sich nach dem Neustart wieder
			// verbinden, statt auf einen gekappten Socket zu warten; das Aufraeumen soll seine
			// Abfrage zu Ende bringen.
			let beendet = false;
			const beende = () => {
				if (beendet) return;
				beendet = true;
				Promise.allSettled([
					arbeiter.stoppe(),
					aufraeumen.stoppe(),
					hub.schliesseAlle(),
					nachlauf.warteAufAlle(),
				]).finally(() => process.exit(0));
			};
			process.once('SIGTERM', beende);
			process.once('SIGINT', beende);
		})
		.catch((error: unknown) => {
			// Nur die Klasse: die Meldung einer Verbindungsstoerung kann die DATABASE_URL samt Passwort enthalten.
			console.error(
				`Datenbank nicht erreichbar (${error instanceof Error ? error.name : 'Fehler'}), Mail-Arbeiter und Aufraeumen nicht gestartet`,
			);
			process.exit(1);
		});

	return { app, betrieb: { hub, wsDevPort: umgebung.wsDevPort } };
}

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
	// Im Betrieb nimmt der Hub die Upgrades desselben Servers an; Traefik reicht sie durch.
	betrieb?.hub.haengeAn(
		app.listen(port, () => {
			console.log(`JuFi laeuft auf http://localhost:${port}`);
		}),
	);
} else if (betrieb) {
	starteDevHub(betrieb);
}

/**
 * Unter ng serve gibt es kein app.listen: Vite ruft die App als Middleware, und an dessen Server
 * kommt der Hub nicht heran. Er lauscht darum auf einem eigenen Port, und proxy.conf.json leitet
 * /<slug>/ws dorthin (Plan-Entscheidung 12). Verworfen: der Hub am Server von Vite -- die
 * Dev-Server-API reicht ihn nicht heraus, und HMR haengt dort schon am Upgrade.
 *
 * Laedt Vite diese Datei nach einer Aenderung neu, laeuft betriebsApp erneut und baut einen neuen
 * Bus samt Hub; der alte haengt dann an einem Bus, an den keine Route mehr meldet, und haelt den
 * Port. Der Griff auf globalThis ueberlebt das Neuladen: Der neue Hub schliesst erst den alten
 * samt seinem Server und lauscht dann. Ein eigener Server je Hub statt einem gemeinsamen, weil
 * haengeAn nicht wiederholbar ist -- der Upgrade-Handler eines geschlossenen Hubs bliebe am Server
 * und zerstoerte jedes Upgrade. Die Kette ueber vorher.schliesse wartet auch auf ein noch
 * laufendes listen des Vorgaengers, damit zwei schnelle Neuladungen nicht um den Port streiten.
 */
function starteDevHub({ hub, wsDevPort }: Betrieb): void {
	const griff = globalThis as { [DEV_HUB]?: { schliesse(): Promise<void> } };
	const vorher = griff[DEV_HUB];
	const gestartet = (async (): Promise<Server> => {
		await vorher?.schliesse();
		// Anfragen ohne Upgrade gehoeren nicht hierher; der Proxy schickt nur /<slug>/ws.
		const server = createServer((_req, res) => res.writeHead(404).end());
		hub.haengeAn(server);
		await new Promise<void>((fertig, fehler) => {
			server.once('error', fehler);
			server.listen(wsDevPort, 'localhost', () => {
				server.off('error', fehler);
				fertig();
			});
		});
		console.log(`JuFi-Hub (Entwicklung) lauscht auf ws://localhost:${wsDevPort}`);
		return server;
	})();
	gestartet.catch((error: unknown) => {
		// Meist EADDRINUSE: Ein anderer Prozess haelt den Port. Die App laeuft weiter, nur ohne Live.
		console.error(
			`JuFi-Hub (Entwicklung) nicht gestartet auf Port ${wsDevPort}:`,
			error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.name) : typeof error,
		);
	});
	griff[DEV_HUB] = {
		async schliesse() {
			const server = await gestartet.catch(() => undefined);
			await hub.schliesseAlle();
			if (!server) return;
			await new Promise<void>((fertig) => server.close(() => fertig()));
		},
	};
}

export const reqHandler = createNodeRequestHandler(app);
