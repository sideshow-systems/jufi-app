import type { Express } from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Umgebung } from './umgebung.js';

/**
 * Feste Testwerte, keine echten Geheimnisse. test-umgebung.ts legt dieselben in
 * process.env, weil encryptSecret den TOTP-Schluessel von dort liest; die
 * Umgebung der App bekommt sie ueber TEST_UMGEBUNG.
 */
export const TEST_SITZUNGSGEHEIMNIS = 'nur-fuer-tests-ein-geheimnis-mit-mindestens-32-zeichen';
export const TEST_TOTP_SCHLUESSEL = Buffer.alloc(32, 7).toString('base64');

/**
 * Eine erfundene Adresse statt der des Testservers: der Port ist bei jedem Lauf
 * ein anderer, die Origin-Pruefung braucht aber einen festen Wert. Der Browser
 * setzt Origin selbst; im Test setzt ihn sende.
 */
export const TEST_UMGEBUNG: Umgebung = {
	basisUrl: 'http://jufi.test',
	sitzungsGeheimnis: TEST_SITZUNGSGEHEIMNIS,
};

const LESENDE_METHODEN = ['GET', 'HEAD', 'OPTIONS'];

/**
 * fetch wie aus der eigenen Oberflaeche: schreibende Anfragen tragen den Origin
 * aus TEST_UMGEBUNG und einen JSON-Body. Ohne diese Hilfe muesste jeder Test
 * daran denken und scheiterte sonst mit 403 statt am eigentlich Geprueften.
 * kopf kommt zuletzt und ueberschreibt, damit ein Test einen fremden Origin
 * vorgeben kann.
 */
export function sende(
	url: string,
	pfad: string,
	optionen: { methode?: string; body?: unknown; cookie?: string; kopf?: Record<string, string> } = {},
): Promise<Response> {
	const methode = (optionen.methode ?? 'GET').toUpperCase();
	const kopf: Record<string, string> = {};
	const schreibend = !LESENDE_METHODEN.includes(methode);
	if (schreibend) {
		kopf['Origin'] = TEST_UMGEBUNG.basisUrl;
		kopf['Content-Type'] = 'application/json';
	}
	if (optionen.cookie) kopf['Cookie'] = optionen.cookie;
	Object.assign(kopf, optionen.kopf);
	return fetch(`${url}${pfad}`, {
		method: methode,
		headers: kopf,
		body: schreibend && optionen.body !== undefined ? JSON.stringify(optionen.body) : undefined,
	});
}

export interface TestServer {
	url: string;
	schliessen(): Promise<void>;
}

/**
 * Startet die App auf einem freien Port (0), damit parallel laufende Testdateien
 * sich nie um einen Port streiten. Ueber 127.0.0.1 statt localhost: fetch loest
 * localhost je nach Node-Fassung zuerst als ::1 auf, der Server lauscht aber nur
 * auf IPv4.
 */
export function starteTestServer(app: Express): Promise<TestServer> {
	return new Promise((resolve, reject) => {
		const server = createServer(app);
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${port}`,
				schliessen: () =>
					new Promise<void>((fertig, fehler) => {
						// fetch haelt Verbindungen offen; ohne das wartet close() auf deren Ablauf.
						server.closeAllConnections();
						server.close((err) => (err ? fehler(err) : fertig()));
					}),
			});
		});
	});
}
