import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fehlerbehandlung } from './fehler.js';
import { starteTestServer, type TestServer } from './test-setup.js';

describe('fehlerbehandlung', () => {
	let server: TestServer;

	beforeAll(async () => {
		const app = express();
		// Express schreibt bei einem Fehler nach gesendeten Headern den Stacktrace nach
		// stderr, ausser die Umgebung heisst test.
		app.set('env', 'test');
		// Wie der gestreamte Angular-Handler in server.ts: Kopf und erste Bytes sind
		// raus, dann scheitert die Verarbeitung.
		app.get('/streamt-dann-fehler', (_req, res, next) => {
			res.status(200).write('anfang');
			next(new Error('Absturz mitten in der Antwort'));
		});
		app.use(fehlerbehandlung);
		server = await starteTestServer(app);
	});

	afterAll(async () => {
		await server.schliessen();
	});

	it('beendet eine Antwort, die schon begonnen hat, statt sie offen zu lassen', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const r = await fetch(`${server.url}/streamt-dann-fehler`, { signal: AbortSignal.timeout(2_000) });
			expect(r.status).toBe(200);

			// Beendet Express die Verbindung, scheitert das Lesen des Bodys sofort mit
			// einem Netzwerkfehler. Haengt die Antwort, bricht erst unser Timeout ab.
			const fehler = await r.text().then(
				() => undefined,
				(e: unknown) => e as Error,
			);
			expect(fehler).toBeDefined();
			expect(fehler?.name).not.toBe('TimeoutError');
			expect(fehler?.name).not.toBe('AbortError');
		} finally {
			log.mockRestore();
		}
	});
});
