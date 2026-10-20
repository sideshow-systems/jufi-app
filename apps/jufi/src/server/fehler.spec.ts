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
		app.get('/pfad', (_req, _res, next) => {
			next(
				Object.assign(new Error('geheim: Sandra'), {
					name: 'PrismaClientKnownRequestError',
					code: 'P2010',
					meta: { x: 'Wert' },
				}),
			);
		});
		app.get('/ohne-code', (_req, _res, next) => next(new TypeError('geheim: Thomas')));
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

	it('loggt bei einem 500 nur Name und Code, nie Meldung oder meta', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const r = await fetch(`${server.url}/pfad?token=geheim-in-der-query`);
			expect(r.status).toBe(500);
			expect(await r.json()).toEqual({ fehler: 'interner Fehler' });

			expect(log.mock.calls).toEqual([['[GET /pfad] PrismaClientKnownRequestError P2010']]);
			const alles = JSON.stringify(log.mock.calls);
			expect(alles).not.toContain('geheim');
			expect(alles).not.toContain('Sandra');
			expect(alles).not.toContain('Wert');
		} finally {
			log.mockRestore();
		}
	});

	it('loggt ohne code nur den Namen', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const r = await fetch(`${server.url}/ohne-code`);
			expect(r.status).toBe(500);
			expect(log.mock.calls).toEqual([['[GET /ohne-code] TypeError']]);
		} finally {
			log.mockRestore();
		}
	});
});
