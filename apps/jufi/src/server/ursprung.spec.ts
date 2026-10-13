import { createPrismaClientFromEnv } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { starteTestServer, TEST_UMGEBUNG, type TestServer } from './test-setup.js';

const NICHT_ERLAUBT = { fehler: 'Ursprung nicht erlaubt' };

describe('Origin-Pruefung', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	// fetch direkt statt sende: sende setzt den richtigen Origin von selbst.
	const abmelden = (kopf: Record<string, string> = {}) =>
		fetch(`${server.url}/admin/api/v1/abmelden`, { method: 'POST', headers: kopf });

	it('POST ohne Origin ist 403', async () => {
		const r = await abmelden();
		expect(r.status).toBe(403);
		expect(await r.json()).toEqual(NICHT_ERLAUBT);
	});

	it('POST mit fremdem Origin ist 403', async () => {
		const r = await abmelden({ Origin: 'http://boese.test' });
		expect(r.status).toBe(403);
		expect(await r.json()).toEqual(NICHT_ERLAUBT);
	});

	it('POST mit Origin null ist 403', async () => {
		expect((await abmelden({ Origin: 'null' })).status).toBe(403);
	});

	it('POST mit dem eigenen Origin kommt durch', async () => {
		// 401, weil keine Sitzung da ist: die Origin-Pruefung hat durchgelassen.
		expect((await abmelden({ Origin: 'http://jufi.test' })).status).toBe(401);
	});

	it('GET ohne Origin kommt durch', async () => {
		expect((await fetch(`${server.url}/admin/api/v1/ich`)).status).toBe(401);
		expect((await fetch(`${server.url}/healthz`)).status).toBe(200);
	});

	it('gilt auch fuer die Vereins-API', async () => {
		const r = await fetch(`${server.url}/irgendein-verein/api/v1/verein`, { method: 'DELETE' });
		expect(r.status).toBe(403);
	});
});
