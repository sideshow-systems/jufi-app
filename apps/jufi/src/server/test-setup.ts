import type { Express } from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

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
