import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { get } from 'node:http';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FLAECHEN, vereinsfarben } from '../../app/gestaltung/farben.js';
import { createApp } from '../app.js';
import { starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';

/**
 * GET mit If-None-Match, wie ihn ein Browser beim Nachfragen schickt. fetch taugt
 * dafuer nicht: sobald der Aufrufer If-None-Match setzt, haengt es selbst
 * Cache-Control: no-cache an, und Express wertet das als erzwungene Neuladung (200).
 */
function bedingtesGet(url: string, etag: string): Promise<number> {
	return new Promise((resolve, reject) => {
		get(url, { headers: { 'If-None-Match': etag } }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		}).on('error', reject);
	});
}

interface Manifest {
	id: string;
	name: string;
	short_name: string;
	lang: string;
	start_url: string;
	scope: string;
	display: string;
	background_color: string;
	theme_color: string;
	icons: { src: string; sizes: string; type: string }[];
}

describe('PWA-Manifest und Icons', () => {
	// DATABASE_URL zeigt hier auf jufi_test_server (test-umgebung.ts).
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		await legeVereinAn(prisma, { slug: 'pwa-demo', anzeigename: 'Jungfischer Demo', farbe: '#0f766e' });
		await legeVereinAn(prisma, { slug: 'pwa-gesperrt', status: 'GESPERRT' });
		const app = createApp({ prisma, version: { version: '1', commit: 'x' }, umgebung: TEST_UMGEBUNG });
		// Stellvertreter fuer express.static und den Angular-Handler aus server.ts:
		// was die PWA-Routen nicht beanspruchen, muss bei ihm ankommen.
		app.use((_req, res) => {
			res.status(200).type('text/plain').send('durchgereicht');
		});
		server = await starteTestServer(app);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	it('liefert das Manifest eines Vereins ohne Anmeldung', async () => {
		const r = await fetch(`${server.url}/pwa-demo/manifest.webmanifest`);
		expect(r.status).toBe(200);
		expect(r.headers.get('content-type')).toMatch(/^application\/manifest\+json/);
		const m = (await r.json()) as Manifest;
		const stand = m.icons[0].src.split('?v=')[1];
		expect(stand).toMatch(/^[0-9a-f]{8}$/);
		expect(m).toEqual({
			id: '/pwa-demo/',
			name: 'Jungfischer Demo',
			short_name: 'Jungfischer Demo',
			lang: 'de',
			start_url: '/pwa-demo/',
			scope: '/pwa-demo/',
			display: 'standalone',
			background_color: FLAECHEN.hell.seite,
			theme_color: vereinsfarben('#0f766e').hell.akzent,
			icons: [
				{ src: `/pwa-demo/icon-192.png?v=${stand}`, sizes: '192x192', type: 'image/png' },
				{ src: `/pwa-demo/icon-512.png?v=${stand}`, sizes: '512x512', type: 'image/png' },
			],
		});
	});

	it('ohne Logo aendert eine neue Farbe die Icon-Adresse', async () => {
		const verein = await legeVereinAn(prisma, { slug: 'pwa-farbe', farbe: '#0f766e' });
		const vorher = (await (await fetch(`${server.url}/pwa-farbe/manifest.webmanifest`)).json()) as Manifest;
		await prisma.verein.update({ where: { id: verein.id }, data: { farbe: '#b91c1c' } });
		const nachher = (await (await fetch(`${server.url}/pwa-farbe/manifest.webmanifest`)).json()) as Manifest;
		expect(nachher.icons[0].src).not.toBe(vorher.icons[0].src);
		expect(nachher.theme_color).not.toBe(vorher.theme_color);
	});

	it('liefert ohne Logo Initialen-Icons in der richtigen Groesse', async () => {
		for (const groesse of [192, 512]) {
			const r = await fetch(`${server.url}/pwa-demo/icon-${groesse}.png`);
			expect(r.status).toBe(200);
			expect(r.headers.get('content-type')).toBe('image/png');
			expect(r.headers.get('cache-control')).toBe('no-cache');
			const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
			expect([meta.format, meta.width, meta.height]).toEqual(['png', groesse, groesse]);
		}
	});

	it('liefert mit Logo dessen Icons, das Logo selbst und 304 bei If-None-Match', async () => {
		const verein = await legeVereinAn(prisma, { slug: 'pwa-logo' });
		const bild = Buffer.from([1, 2, 3]);
		const icon192 = Buffer.from([4, 5, 6]);
		const logo = await vereinDb(prisma, verein.id).vereinLogo.create({
			data: { bild, mimeType: 'image/jpeg', icon192, icon512: Buffer.from([7, 8, 9]) },
		});

		const manifest = (await (await fetch(`${server.url}/pwa-logo/manifest.webmanifest`)).json()) as Manifest;
		expect(manifest.icons.map((i) => i.src)).toEqual([
			`/pwa-logo/icon-192.png?v=${logo.geaendertAm.toISOString()}`,
			`/pwa-logo/icon-512.png?v=${logo.geaendertAm.toISOString()}`,
		]);

		const icon = await fetch(`${server.url}/pwa-logo/icon-192.png`);
		expect(icon.status).toBe(200);
		expect(icon.headers.get('content-type')).toBe('image/png');
		expect(Buffer.from(await icon.arrayBuffer())).toEqual(icon192);

		const erste = await fetch(`${server.url}/pwa-logo/api/v1/verein/logo`);
		expect(erste.status).toBe(200);
		expect(erste.headers.get('content-type')).toBe('image/jpeg');
		expect(erste.headers.get('cache-control')).toBe('no-cache');
		expect(Buffer.from(await erste.arrayBuffer())).toEqual(bild);
		const etag = erste.headers.get('etag');
		expect(etag).toBeTruthy();

		expect(await bedingtesGet(`${server.url}/pwa-logo/api/v1/verein/logo`, etag!)).toBe(304);
		expect(await bedingtesGet(`${server.url}/pwa-logo/icon-192.png`, icon.headers.get('etag')!)).toBe(304);
	});

	it('Logo-Adresse eines Vereins ohne Logo ist 404', async () => {
		const r = await fetch(`${server.url}/pwa-demo/api/v1/verein/logo`);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
	});

	it('gesperrter, unbekannter und reservierter Verein sind 404', async () => {
		const pfade = [
			'/pwa-gesperrt/manifest.webmanifest',
			'/pwa-gesperrt/icon-192.png',
			'/pwa-gesperrt/icon-512.png',
			'/gibt-es-nicht/manifest.webmanifest',
			'/gibt-es-nicht/icon-192.png',
			'/ADMIN/manifest.webmanifest',
			'/admin/manifest.webmanifest',
		];
		for (const pfad of pfade) {
			const r = await fetch(`${server.url}${pfad}`);
			expect(r.status, pfad).toBe(404);
			expect(await r.json(), pfad).toEqual({ fehler: 'nicht gefunden' });
		}
	});

	it('reicht alle anderen Pfade weiter, ohne die Datenbank zu fragen', async () => {
		const abfrage = vi.spyOn(prisma.verein, 'findUnique');
		try {
			for (const pfad of ['/pwa-demo/icon-64.png', '/chunk-abc.js', '/pwa-demo/', '/pwa-demo/profil']) {
				const r = await fetch(`${server.url}${pfad}`);
				expect(r.status, pfad).toBe(200);
				expect(await r.text(), pfad).toBe('durchgereicht');
			}
			expect(abfrage).not.toHaveBeenCalled();
		} finally {
			abfrage.mockRestore();
		}
	});
});
