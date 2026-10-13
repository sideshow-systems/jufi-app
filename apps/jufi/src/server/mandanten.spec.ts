import { createPrismaClientFromEnv } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { starteTestServer, TEST_UMGEBUNG, type TestServer } from './test-setup.js';
import { legeVereinAn } from './test-vereine.js';
import { vereinsRouten } from './verein.js';

interface Kontext {
	url: string;
	eigen: { slug: string };
	fremd: { slug: string };
	gesperrt: { slug: string };
}

/**
 * Jede Vereins-Route braucht hier einen Fall (Spec 9). Kommt eine Route
 * hinzu, scheitert der erste Test, bis der Fall eingetragen ist.
 */
const FAELLE: Record<string, (k: Kontext) => Promise<void>> = {
	'GET /verein': async (k) => {
		// Ohne Objekt-ID: der Verein kommt allein aus dem Slug. Geprueft wird,
		// dass ein gesperrter fremder Verein nichts preisgibt.
		expect((await fetch(`${k.url}/${k.gesperrt.slug}/api/v1/verein`)).status).toBe(404);
	},
};

describe('Mandanten-Test', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	let kontext: Kontext;

	beforeAll(async () => {
		const [eigen, fremd, gesperrt] = await Promise.all([
			legeVereinAn(prisma, { slug: 'mandant-eigen' }),
			legeVereinAn(prisma, { slug: 'mandant-fremd' }),
			legeVereinAn(prisma, { slug: 'mandant-gesperrt', status: 'GESPERRT' }),
		]);
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG }),
		);
		kontext = { url: server.url, eigen, fremd, gesperrt };
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	it('jede Vereins-Route hat einen Fall', () => {
		expect(
			vereinsRouten()
				.map((r) => `${r.methode} ${r.pfad}`)
				.sort(),
		).toEqual(Object.keys(FAELLE).sort());
	});

	it.each(Object.entries(FAELLE))('%s gibt nichts aus fremden Vereinen preis', async (_name, fall) => fall(kontext));
});
