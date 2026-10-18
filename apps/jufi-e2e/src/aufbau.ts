import { bereiteTestDatenbankVor } from '@jufi/db/testing';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BASIS_URL, PORT, TESTPASSWORT, ZUSTAND } from './hilfen';

const SERVER = 'dist/apps/jufi/server/server.mjs';
const CLI = 'apps/cli/dist/main.js';
const ADMIN = 'e2e-admin';
const HEALTHZ_FRIST_MS = 30_000;
const BEENDEN_FRIST_MS = 10_000;
/**
 * Je Anfrage an den Server. Ohne Grenze hinge ein fetch an einem Server, der die
 * Verbindung annimmt und nie antwortet (etwa bei haengender Datenbank), und die
 * Frist der Healthz-Schleife wuerde nie mehr geprueft.
 */
const ANFRAGE_FRIST_MS = 2_000;
/** Das CLI legt nur einen Datensatz an; haengt es laenger, haengt seine Datenbankverbindung. */
const CLI_FRIST_MS = 30_000;

const execFileAsync = promisify(execFile);

/**
 * globalSetup des E2E-Laufs: frische Datenbank, Produktionsbau als Server auf
 * PORT, ein Plattform-Admin ueber das CLI. Die zurueckgegebene Funktion ist der
 * globalTeardown (so erlaubt es Playwright) und beendet den Server; Aufbau und
 * Abbau stehen damit in einer Datei und teilen sich den Prozess.
 *
 * Der Produktionsbau statt ng serve: Geprueft werden soll, was ausgeliefert wird,
 * samt Sicherheits-Headern und Server-Bundle; ng serve baut anders und
 * braeuchte bei jedem Lauf eine halbe Minute Kompilieren im Hintergrund.
 */
export default async function aufbau(): Promise<() => Promise<void>> {
	await pruefePortFrei();
	// Vor allem anderen: Ohne erzeugtes Passwort liefe der Ablauf mit leerem Wert los.
	if (!TESTPASSWORT) throw new Error('E2E: kein Testpasswort erzeugt');

	const datenbankUrl = await bereiteTestDatenbankVor('e2e');
	await rm(ZUSTAND, { recursive: true, force: true });
	await mkdir(ZUSTAND, { recursive: true });

	const umgebung = serverUmgebung(datenbankUrl);
	const log = join(ZUSTAND, 'server.log');
	const server = starteServer(umgebung, log);
	// Bricht der Lauf mitten im Aufbau ab (Strg+C, Absturz), ruft Playwright weder den
	// catch unten noch den Teardown auf, und der eigene Server bliebe als Waise auf PORT
	// zurueck; der naechste Lauf scheiterte dann an der Portpruefung. Ein exit-Handler
	// darf nur synchron arbeiten, kill ist synchron. beende meldet ihn wieder ab.
	process.once('exit', serverBeenden);
	function serverBeenden(): void {
		server.kill('SIGTERM');
	}
	try {
		await warteAufHealthz(server, log);
		const link = await legeAdminAn(umgebung);
		await pruefeServerDatenbank(link);
		process.env['E2E_ADMIN_LINK'] = link;
	} catch (fehler) {
		await beende(server, serverBeenden);
		throw fehler;
	}
	return () => beende(server, serverBeenden);
}

/**
 * Alles, was server.ts und das CLI aus der Umgebung lesen, steht hier ausdruecklich.
 * Beide laden die .env der Wurzel mit process.loadEnvFile, das gesetzte Variablen
 * nicht ueberschreibt (auch leere nicht). Fehlte hier eine, kaeme ihr Wert still
 * aus der .env -- bei DATABASE_URL hiesse das: der Lauf leert die
 * Entwicklungsdatenbank nicht, schreibt aber hinein. Darum auch die WEBAUTHN-Werte
 * leer statt weggelassen: leer heisst fuer den Server "aus dem Host ableiten"
 * (umgebung.ts), und localhost:4210 ist dann rpId und Ursprung.
 */
function serverUmgebung(datenbankUrl: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		NODE_ENV: 'production',
		PORT: String(PORT),
		DATABASE_URL: datenbankUrl,
		BASIS_URL,
		// Je Lauf neu: Sitzungen eines frueheren Laufs sollen nicht gelten, und kein
		// Geheimnis der Entwicklung landet im Test.
		SESSION_SECRET: randomBytes(32).toString('base64'),
		TOTP_ENC_KEY: randomBytes(32).toString('base64'),
		WEBAUTHN_RP_ID: '',
		WEBAUTHN_ORIGIN: '',
		// Mailpit aus docker-compose.dev.yml; der Ablauf verschickt nichts, der Mail-Arbeiter laeuft trotzdem mit.
		SMTP_HOST: 'localhost',
		SMTP_PORT: '1025',
		SMTP_USER: '',
		SMTP_PASS: '',
		MAIL_ABSENDER: 'e2e@example.test',
		MAIL_ANTWORT: 'e2e@example.test',
		MAIL_BETREFF_PRAEFIX: '[E2E] ',
	};
}

/**
 * Ein fremder Prozess auf dem Port bekaeme sonst die Anfragen des Ablaufs, und der
 * eigene Server schiede still mit EADDRINUSE aus. Beendet wird hier nichts: Was
 * dort laeuft, gehoert jemand anderem.
 */
async function pruefePortFrei(): Promise<void> {
	for (const host of ['127.0.0.1', '::1']) {
		const belegt = await new Promise<boolean>((resolve) => {
			const verbindung = connect({ host, port: PORT });
			verbindung.once('connect', () => {
				verbindung.destroy();
				resolve(true);
			});
			verbindung.once('error', () => resolve(false));
		});
		if (belegt) {
			throw new Error(
				`E2E: Port ${PORT} ist schon belegt (${host}). Den Prozess dort selbst beenden, etwa nach lsof -i :${PORT}; der Aufbau beendet keine fremden Prozesse.`,
			);
		}
	}
}

/** Die Ausgabe des Servers geht in eine Datei: Im Bericht des Laufs stoerte sie, beim Fehlersuchen fehlte sie. */
function starteServer(umgebung: NodeJS.ProcessEnv, log: string): ChildProcess {
	const server = spawn(process.execPath, [SERVER], { env: umgebung, stdio: ['ignore', 'pipe', 'pipe'] });
	const datei = createWriteStream(log);
	server.stdout?.pipe(datei);
	server.stderr?.pipe(datei);
	return server;
}

async function warteAufHealthz(server: ChildProcess, log: string): Promise<void> {
	const ende = Date.now() + HEALTHZ_FRIST_MS;
	while (Date.now() < ende) {
		if (server.exitCode !== null) {
			throw new Error(`E2E: Server beendet mit Code ${server.exitCode}, bevor /healthz antwortete. Log: ${log}`);
		}
		try {
			// Nie ueber das Ende der Frist hinaus: Sie soll wirklich die Obergrenze sein.
			const rest = Math.max(1, Math.min(ANFRAGE_FRIST_MS, ende - Date.now()));
			const antwort = await fetch(`${BASIS_URL}/healthz`, { signal: AbortSignal.timeout(rest) });
			if (antwort.status === 200) return;
		} catch {
			// Noch nicht erreichbar oder Zeitueberschreitung dieser einen Anfrage.
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`E2E: /healthz nicht binnen ${HEALTHZ_FRIST_MS / 1000} s mit 200. Log: ${log}`);
}

/**
 * Das CLI gibt den Link mit BASIS_URL davor aus. Dass er auf PORT zeigt und nicht
 * auf den Port der .env, belegt, dass die Umgebung hier Vorrang hat.
 */
async function legeAdminAn(umgebung: NodeJS.ProcessEnv): Promise<string> {
	const { stdout } = await execFileAsync(process.execPath, [CLI, 'admin', 'anlegen', ADMIN], {
		env: umgebung,
		timeout: CLI_FRIST_MS,
	});
	const link = stdout.match(/^(\S+\/admin\/einrichten#\S+)$/m)?.[1];
	if (!link) throw new Error(`E2E: kein Einrichtungslink in der Ausgabe des CLI:\n${stdout}`);
	if (!link.startsWith(`${BASIS_URL}/`)) {
		throw new Error(
			`E2E: Link zeigt auf ${new URL(link).origin} statt ${BASIS_URL}; gilt die .env statt der Umgebung?`,
		);
	}
	return link;
}

/**
 * Das CLI hat den Admin in die Datenbank geschrieben, deren URL es bekam. Kennt der
 * Server das Token, liest er dieselbe Datenbank, also die frische und nicht die
 * der .env. Verworfen: /healthz um den Datenbanknamen erweitern -- das waere ein
 * Detail der Infrastruktur in einer oeffentlichen Antwort, nur fuer den Test.
 * Pruefen verbraucht das Token nicht.
 */
async function pruefeServerDatenbank(link: string): Promise<void> {
	const token = new URL(link).hash.slice(1);
	const antwort = await fetch(`${BASIS_URL}/admin/api/v1/einrichtung/pruefen`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: BASIS_URL },
		body: JSON.stringify({ token }),
		signal: AbortSignal.timeout(ANFRAGE_FRIST_MS),
	});
	const daten = (await antwort.json().catch(() => null)) as { benutzername?: string } | null;
	if (antwort.status !== 200 || daten?.benutzername !== ADMIN) {
		throw new Error(
			`E2E: Server kennt den neuen Admin nicht (Status ${antwort.status}); liest er eine andere Datenbank?`,
		);
	}
}

async function beende(server: ChildProcess, notfall: () => void): Promise<void> {
	process.off('exit', notfall);
	if (server.exitCode !== null || server.signalCode !== null) return;
	const beendet = new Promise<void>((resolve) => server.once('exit', () => resolve()));
	// SIGTERM laesst server.ts Mail-Arbeiter und Nachlauf zu Ende bringen.
	server.kill('SIGTERM');
	const frist = setTimeout(() => server.kill('SIGKILL'), BEENDEN_FRIST_MS);
	await beendet;
	clearTimeout(frist);
}
