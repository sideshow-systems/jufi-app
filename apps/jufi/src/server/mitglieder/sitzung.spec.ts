import { hashToken, MITGLIEDER_COOKIE, MITGLIEDER_SITZUNG_SEKUNDEN, readCookie } from '@jufi/auth';
import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { meldeAdminAn } from '../admin/test-admin.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeSitzungAn } from './sitzung.js';
import { legeMitgliedAn } from './test-mitglieder.js';

const STUNDE_MS = 60 * 60 * 1000;
const NICHT_ANGEMELDET = { fehler: 'nicht angemeldet' };

describe('Mitglieder-Sitzung', () => {
	const prisma = createPrismaClientFromEnv();
	const t0 = new Date('2026-10-13T08:00:00Z');
	// Die Uhr der App; jeder Test stellt sie vor seiner Anfrage.
	let uhr = t0;
	let server: TestServer;
	let verein: { id: string; slug: string };
	let nachbar: { id: string; slug: string };

	beforeAll(async () => {
		[verein, nachbar] = await Promise.all([
			legeVereinAn(prisma, { slug: 'sitzung-a' }),
			legeVereinAn(prisma, { slug: 'sitzung-b' }),
		]);
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	const ich = (v: { slug: string }, cookie?: string) => sende(server.url, `/${v.slug}/api/v1/ich`, { cookie });
	const tokenAus = (cookie: string) => readCookie(cookie, MITGLIEDER_COOKIE) ?? '';

	it('GET /ich ohne Cookie ist 401', async () => {
		uhr = t0;
		const r = await ich(verein);
		expect(r.status).toBe(401);
		expect(await r.json()).toEqual(NICHT_ANGEMELDET);
	});

	it('GET /ich mit Sitzung liefert Person und Kennung (die E-Mail)', async () => {
		const m = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Anna',
			nachname: 'Beispiel',
			email: 'anna-ich@example.test',
			rechte: ['MITGLIEDER'],
			jetzt: t0,
		});
		uhr = new Date(t0.getTime() + 60_000);
		const r = await ich(verein, m.cookie);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({
			person: { id: m.personId, vorname: 'Anna', nachname: 'Beispiel', art: 'ERWACHSENER', rechte: ['MITGLIEDER'] },
			hatKinder: false,
			fotoEinwilligung: null,
			kennung: 'anna-ich@example.test',
			passkeys: [],
			hatPasswort: false,
			totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
		});
	});

	it('GET /ich eines Jungfischers nennt den Anmeldenamen als Kennung', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', anmeldename: 'lukas-ich', jetzt: t0 });
		uhr = new Date(t0.getTime() + 60_000);
		const r = await ich(verein, m.cookie);
		expect(r.status).toBe(200);
		expect(((await r.json()) as { kennung: string }).kennung).toBe('lukas-ich');
	});

	it('die Sitzung gilt nur im eigenen Verein', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', jetzt: t0 });
		uhr = new Date(t0.getTime() + 60_000);
		const r = await ich(nachbar, m.cookie);
		expect(r.status).toBe(401);
		expect(await r.json()).toEqual(NICHT_ANGEMELDET);
	});

	it('gesperrter Verein: 404, nach dem Entsperren wieder gueltig', async () => {
		const gesperrt = await legeVereinAn(prisma, { slug: 'sitzung-sperre' });
		const m = await legeMitgliedAn(prisma, gesperrt, { art: 'ERWACHSENER', jetzt: t0 });
		uhr = new Date(t0.getTime() + 60_000);
		await prisma.verein.update({ where: { id: gesperrt.id }, data: { status: 'GESPERRT' } });
		expect((await ich(gesperrt, m.cookie)).status).toBe(404);
		await prisma.verein.update({ where: { id: gesperrt.id }, data: { status: 'AKTIV' } });
		expect((await ich(gesperrt, m.cookie)).status).toBe(200);
	});

	it('abgelaufene Sitzung ist 401 und die Zeile wird geloescht', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', jetzt: t0 });
		uhr = new Date(t0.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000 + 1000);
		const r = await ich(verein, m.cookie);
		expect(r.status).toBe(401);
		expect(await prisma.session.count({ where: { tokenHash: hashToken(tokenAus(m.cookie)) } })).toBe(0);
	});

	it('Verlaengerung hoechstens einmal am Tag', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', jetzt: t0 });
		const hash = hashToken(tokenAus(m.cookie));
		const ablaufVorher = (await prisma.session.findUniqueOrThrow({ where: { tokenHash: hash } })).ablauf;

		uhr = new Date(t0.getTime() + 2 * STUNDE_MS);
		const frueh = await ich(verein, m.cookie);
		expect(frueh.status).toBe(200);
		expect(frueh.headers.get('set-cookie')).toBeNull();
		expect((await prisma.session.findUniqueOrThrow({ where: { tokenHash: hash } })).ablauf).toEqual(ablaufVorher);

		uhr = new Date(t0.getTime() + 25 * STUNDE_MS);
		const spaet = await ich(verein, m.cookie);
		expect(spaet.status).toBe(200);
		const gesetzt = spaet.headers.get('set-cookie') ?? '';
		expect(gesetzt).toContain(`${MITGLIEDER_COOKIE}=${tokenAus(m.cookie)}`);
		expect(gesetzt).toContain(`Path=/${verein.slug}/`);
		expect(gesetzt).toContain(`Max-Age=${MITGLIEDER_SITZUNG_SEKUNDEN}`);
		expect((await prisma.session.findUniqueOrThrow({ where: { tokenHash: hash } })).ablauf).toEqual(
			new Date(uhr.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000),
		);
	});

	it('Abmelden loescht Cookie und Sitzung', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', jetzt: t0 });
		uhr = new Date(t0.getTime() + 60_000);
		const r = await sende(server.url, `/${verein.slug}/api/v1/abmelden`, { methode: 'POST', cookie: m.cookie });
		expect(r.status).toBe(204);
		const gesetzt = r.headers.get('set-cookie') ?? '';
		expect(gesetzt).toContain('Max-Age=0');
		expect(gesetzt).toContain(`Path=/${verein.slug}/`);
		expect(await prisma.session.count({ where: { tokenHash: hashToken(tokenAus(m.cookie)) } })).toBe(0);
		expect((await ich(verein, m.cookie)).status).toBe(401);
	});

	it('Abmelden ohne Sitzung ist 401', async () => {
		const r = await sende(server.url, `/${verein.slug}/api/v1/abmelden`, { methode: 'POST' });
		expect(r.status).toBe(401);
	});

	it('Ueberall abmelden loescht die Sitzung des zweiten Geraets, nicht die einer anderen Person', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', jetzt: t0 });
		const andere = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', jetzt: t0 });
		// Zweites Geraet desselben Zugangs.
		const zweit = await legeSitzungAn(vereinDb(prisma, verein.id), { zugangId: m.zugangId, jetzt: t0 });
		uhr = new Date(t0.getTime() + 60_000);

		const r = await sende(server.url, `/${verein.slug}/api/v1/abmelden/alle`, { methode: 'POST', cookie: m.cookie });
		expect(r.status).toBe(204);
		expect(r.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
		expect((await ich(verein, m.cookie)).status).toBe(401);
		expect((await ich(verein, `${MITGLIEDER_COOKIE}=${zweit}`)).status).toBe(401);
		expect((await ich(verein, andere.cookie)).status).toBe(200);
	});

	it('eine entfernte Person ist nicht angemeldet', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', jetzt: t0 });
		await prisma.person.update({ where: { id: m.personId }, data: { entferntAm: t0 } });
		uhr = new Date(t0.getTime() + 60_000);
		expect((await ich(verein, m.cookie)).status).toBe(401);
	});

	it('ein gesperrter Zugang eines Jungfischers ist nicht angemeldet', async () => {
		const m = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', jetzt: t0 });
		uhr = new Date(t0.getTime() + 60_000);
		expect((await ich(verein, m.cookie)).status).toBe(200);
		await prisma.person.update({ where: { id: m.personId }, data: { zugangErlaubt: false } });
		expect((await ich(verein, m.cookie)).status).toBe(401);
	});

	it('das Admin-Cookie wird nicht gelesen', async () => {
		const { cookie } = await meldeAdminAn(prisma, t0);
		uhr = new Date(t0.getTime() + 60_000);
		const token = readCookie(cookie, 'jufi_admin') ?? '';
		const r = await ich(verein, `${MITGLIEDER_COOKIE}=${token}`);
		expect(r.status).toBe(401);
	});
});
