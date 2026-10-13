import { createPrismaClient, createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { starteTestServer, type TestServer } from './test-setup.js';

const VERSION = { version: '1.2.3', commit: 'abc' };

describe('createApp', () => {
	// DATABASE_URL zeigt hier auf jufi_test_server (test-umgebung.ts).
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	let haengend: TestServer;
	let abgelehnt: TestServer;
	let abgelehntPrisma: PrismaClient;

	beforeAll(async () => {
		server = await starteTestServer(createApp({ prisma, version: VERSION }));

		// Port 1 auf 127.0.0.1: nichts lauscht dort, die Verbindung wird sofort abgelehnt.
		abgelehntPrisma = createPrismaClient({ connectionString: 'postgresql://x:y@127.0.0.1:1/z' });
		abgelehnt = await starteTestServer(createApp({ prisma: abgelehntPrisma, version: VERSION }));

		// Eine Datenbank, die nie antwortet: nur $queryRaw wird gebraucht, daher der Cast.
		const haengendPrisma = { $queryRaw: () => new Promise(() => {}) } as unknown as PrismaClient;
		haengend = await starteTestServer(createApp({ prisma: haengendPrisma, version: VERSION }));
	});

	afterAll(async () => {
		await Promise.all([server.schliessen(), abgelehnt.schliessen(), haengend.schliessen()]);
		await Promise.all([prisma.$disconnect(), abgelehntPrisma.$disconnect()]);
	});

	it('/healthz meldet ok mit Version', async () => {
		const r = await fetch(`${server.url}/healthz`);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc' });
	});

	it('/healthz meldet 503, wenn die Datenbank ablehnt', async () => {
		// Die Ursache gehoert ins Log, nicht in die Antwort; das Log bleibt im Test still.
		// Prisma schreibt seinen eigenen error-Eintrag (createPrismaClient) auf stdout.
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const prismaLog = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const r = await fetch(`${abgelehnt.url}/healthz`);
			expect(r.status).toBe(503);
			expect(await r.json()).toEqual({ status: 'degraded' });
			expect(log).toHaveBeenCalled();
		} finally {
			log.mockRestore();
			prismaLog.mockRestore();
		}
	});

	it('/healthz meldet nach spaetestens 2,5 s 503, wenn die Datenbank haengt', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const start = Date.now();
			const r = await fetch(`${haengend.url}/healthz`);
			expect(r.status).toBe(503);
			expect(await r.json()).toEqual({ status: 'degraded' });
			expect(Date.now() - start).toBeLessThan(2_500);
		} finally {
			log.mockRestore();
		}
	});

	it('setzt die Sicherheits-Header und kein X-Powered-By', async () => {
		const r = await fetch(`${server.url}/healthz`);
		expect(r.headers.get('content-security-policy')).toBe(
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
		);
		expect(r.headers.get('x-frame-options')).toBe('DENY');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(r.headers.get('x-powered-by')).toBeNull();
	});

	it('lehnt einen Body ueber 100 KB mit 413 ab', async () => {
		const r = await fetch(`${server.url}/demo/api/v1/egal`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ x: 'a'.repeat(101 * 1024) }),
		});
		expect(r.status).toBe(413);
		expect(await r.json()).toEqual({ fehler: 'Anfrage zu groß' });
	});

	it('beantwortet kaputtes JSON mit 400', async () => {
		const r = await fetch(`${server.url}/demo/api/v1/egal`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{kaputt',
		});
		expect(r.status).toBe(400);
		expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage' });
	});
});
