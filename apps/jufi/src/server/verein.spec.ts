import { createPrismaClientFromEnv } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { starteTestServer, type TestServer } from './test-setup.js';
import { legeVereinAn } from './test-vereine.js';

const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

describe('Verein aus dem Slug', () => {
	// DATABASE_URL zeigt hier auf jufi_test_server (test-umgebung.ts).
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		await legeVereinAn(prisma, { slug: 'glonntal-test', anzeigename: 'Jungfischer Glonntal' });
		await legeVereinAn(prisma, { slug: 'verein-gesperrt', status: 'GESPERRT' });
		server = await starteTestServer(createApp({ prisma, version: { version: '1.2.3', commit: 'abc' } }));
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	it('liefert Anzeigename und Farbe eines aktiven Vereins', async () => {
		const r = await fetch(`${server.url}/glonntal-test/api/v1/verein`);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({
			slug: 'glonntal-test',
			anzeigename: 'Jungfischer Glonntal',
			farbe: '#0f766e',
			hatLogo: false,
		});
	});

	it('meldet hatLogo, sobald ein Logo hinterlegt ist', async () => {
		const verein = await legeVereinAn(prisma, { slug: 'verein-mit-logo' });
		await prisma.vereinLogo.create({
			data: {
				vereinId: verein.id,
				bild: Buffer.from([1]),
				mimeType: 'image/png',
				icon192: Buffer.from([1]),
				icon512: Buffer.from([1]),
			},
		});
		const r = await fetch(`${server.url}/verein-mit-logo/api/v1/verein`);
		expect(r.status).toBe(200);
		expect(((await r.json()) as { hatLogo: boolean }).hatLogo).toBe(true);
	});

	it('gesperrter Verein ist nicht gefunden', async () => {
		const r = await fetch(`${server.url}/verein-gesperrt/api/v1/verein`);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual(NICHT_GEFUNDEN);
	});

	it('unbekannter Slug ist nicht gefunden', async () => {
		const r = await fetch(`${server.url}/gibt-es-nicht/api/v1/verein`);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual(NICHT_GEFUNDEN);
	});

	it('reservierter Slug ist nicht gefunden', async () => {
		const r = await fetch(`${server.url}/admin/api/v1/verein`);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual(NICHT_GEFUNDEN);
	});

	it('Grossschreibung und Umlaut sind nicht gefunden, ohne Datenbankfehler', async () => {
		// Ein Slug, den es nie geben kann, darf die Datenbank gar nicht erreichen.
		// Postgres wuerde "Glonntal-test" und "dämo" zwar nur nicht finden, der
		// Abfragespion macht den Test aber unabhaengig davon, was die Datenbank
		// mit seltsamen Zeichen tut (Nullbyte, ungueltiges UTF-8 ergaeben dort Fehler).
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const abfrage = vi.spyOn(prisma.verein, 'findUnique');
		try {
			for (const slug of ['Glonntal-test', 'd%C3%A4mo']) {
				const r = await fetch(`${server.url}/${slug}/api/v1/verein`);
				expect(r.status, slug).toBe(404);
				expect(await r.json(), slug).toEqual(NICHT_GEFUNDEN);
			}
			expect(abfrage).not.toHaveBeenCalled();
			expect(log).not.toHaveBeenCalled();
		} finally {
			abfrage.mockRestore();
			log.mockRestore();
		}
	});

	it('unbekannter Pfad unter der Vereins-API ist 404 JSON', async () => {
		const r = await fetch(`${server.url}/glonntal-test/api/v1/gibt-es-nicht`);
		expect(r.status).toBe(404);
		expect(r.headers.get('content-type')).toMatch(/application\/json/);
		expect(await r.json()).toEqual(NICHT_GEFUNDEN);
	});
});
