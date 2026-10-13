import { createPrismaClientFromEnv } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppDeps } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { adminApi, adminRouten, OEFFENTLICHE_ADMIN_ROUTEN } from './api.js';

/**
 * Jede Admin-Route, die eine Sitzung verlangt. Kommt eine Route hinzu, scheitert
 * der erste Test, bis sie hier oder in OEFFENTLICHE_ADMIN_ROUTEN steht -- eine
 * vergessene Pruefung faellt so beim Eintragen auf, nicht erst im Betrieb.
 */
const GESCHUETZT = [
	'GET /ich',
	'POST /abmelden',
	'POST /konto/totp/start',
	'POST /konto/totp/bestaetigen',
	'POST /konto/passkey/optionen',
	'POST /konto/passkey',
	'GET /vereine',
	'POST /vereine',
	'GET /vereine/:id',
	'POST /vereine/:id/sperren',
	'POST /vereine/:id/entsperren',
	'POST /vereine/:id/slug',
	'POST /vereine/:id/einladung-erneuern',
	'POST /vereine/:id/notfall-link',
];

describe('Schutz der Admin-Routen', () => {
	const prisma = createPrismaClientFromEnv();
	const deps: AppDeps = { prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG };
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(createApp(deps));
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	it('jede Admin-Route ist oeffentlich oder geschuetzt eingetragen', () => {
		const vorhanden = adminRouten(adminApi(deps))
			.map((r) => `${r.methode} ${r.pfad}`)
			.sort();
		expect(vorhanden).toEqual([...OEFFENTLICHE_ADMIN_ROUTEN, ...GESCHUETZT].sort());
		// Doppelt eingetragen hiesse: unklar, ob die Route geschuetzt sein soll.
		expect(GESCHUETZT.filter((r) => OEFFENTLICHE_ADMIN_ROUTEN.includes(r))).toEqual([]);
	});

	it.each(GESCHUETZT)('%s ohne Sitzung ist 401', async (eintrag) => {
		const [methode, pfad] = eintrag.split(' ');
		// Pfadparameter mit einer erfundenen ID: der Schutz muss greifen, bevor
		// die Route nachsieht, ob es das Objekt gibt.
		const konkret = (pfad ?? '').replace(/:[A-Za-z]+/g, 'erfunden-id');
		const r = await sende(server.url, `/admin/api/v1${konkret}`, { methode, body: {} });
		expect(r.status).toBe(401);
		expect(await r.json()).toEqual({ fehler: 'nicht angemeldet' });
	});
});
