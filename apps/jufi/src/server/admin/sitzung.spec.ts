import { ADMIN_SITZUNG_SEKUNDEN, hashToken, MITGLIEDER_COOKIE, readCookie } from '@jufi/auth';
import { createPrismaClientFromEnv } from '@jufi/db';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { setzeAdminCookie } from './sitzung.js';
import { meldeAdminAn } from './test-admin.js';

const STUNDE_MS = 60 * 60 * 1000;
const NICHT_ANGEMELDET = { fehler: 'nicht angemeldet' };

describe('Admin-Sitzung', () => {
	const prisma = createPrismaClientFromEnv();
	const t0 = new Date('2026-10-13T08:00:00Z');
	// Die Uhr der App; jeder Test stellt sie vor seiner Anfrage.
	let uhr = t0;
	let server: TestServer;

	beforeAll(async () => {
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

	it('GET /ich mit Sitzung liefert den Benutzernamen', async () => {
		const { admin, cookie } = await meldeAdminAn(prisma, t0);
		uhr = new Date(t0.getTime() + 60_000);
		const r = await sende(server.url, '/admin/api/v1/ich', { cookie });
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({
			benutzername: admin.benutzername,
			totpAktiv: false,
			passkeys: 0,
			wiederherstellungscodesUebrig: 0,
		});
	});

	it('GET /ich zaehlt Passkeys und nur die unverbrauchten Wiederherstellungscodes', async () => {
		const { admin, cookie } = await meldeAdminAn(prisma, t0);
		await prisma.plattformAdmin.update({ where: { id: admin.id }, data: { totpAktivAm: t0 } });
		await prisma.adminPasskey.create({
			data: { adminId: admin.id, credentialId: `cred-${admin.id}`, publicKey: 'x', label: 'Mac' },
		});
		await prisma.adminRecoveryCode.createMany({
			data: [
				{ adminId: admin.id, codeHash: 'a' },
				{ adminId: admin.id, codeHash: 'b' },
				{ adminId: admin.id, codeHash: 'c', verwendetAm: t0 },
			],
		});
		uhr = new Date(t0.getTime() + 60_000);
		const r = await sende(server.url, '/admin/api/v1/ich', { cookie });
		expect(await r.json()).toEqual({
			benutzername: admin.benutzername,
			totpAktiv: true,
			passkeys: 1,
			wiederherstellungscodesUebrig: 2,
		});
	});

	it('ohne Cookie 401', async () => {
		const r = await sende(server.url, '/admin/api/v1/ich');
		expect(r.status).toBe(401);
		expect(await r.json()).toEqual(NICHT_ANGEMELDET);
	});

	it('unbekanntes Token ist wie ohne Cookie', async () => {
		const r = await sende(server.url, '/admin/api/v1/ich', { cookie: 'jufi_admin=gibt-es-nicht' });
		expect(r.status).toBe(401);
		expect(await r.json()).toEqual(NICHT_ANGEMELDET);
	});

	it('Sitzung nach 12 Stunden abgelaufen und geloescht', async () => {
		const { admin, cookie } = await meldeAdminAn(prisma, t0);
		uhr = new Date(t0.getTime() + 12 * STUNDE_MS);
		const r = await sende(server.url, '/admin/api/v1/ich', { cookie });
		expect(r.status).toBe(401);
		expect(await r.json()).toEqual(NICHT_ANGEMELDET);
		expect(await prisma.adminSession.count({ where: { adminId: admin.id } })).toBe(0);
	});

	it('Nutzung verlaengert nicht', async () => {
		const { admin, cookie } = await meldeAdminAn(prisma, t0);
		uhr = new Date(t0.getTime() + 11 * STUNDE_MS);
		const r = await sende(server.url, '/admin/api/v1/ich', { cookie });
		expect(r.status).toBe(200);
		const sitzung = await prisma.adminSession.findFirstOrThrow({ where: { adminId: admin.id } });
		expect(sitzung.ablauf).toEqual(new Date(t0.getTime() + ADMIN_SITZUNG_SEKUNDEN * 1000));
		// Kein erneutes Cookie, das die Laufzeit im Browser verlaengerte.
		expect(r.headers.get('set-cookie')).toBeNull();
	});

	it('Abmelden loescht die Sitzung und das Cookie', async () => {
		const { admin, cookie } = await meldeAdminAn(prisma, t0);
		uhr = new Date(t0.getTime() + 60_000);
		const r = await sende(server.url, '/admin/api/v1/abmelden', { methode: 'POST', cookie });
		expect(r.status).toBe(204);
		const gesetzt = r.headers.get('set-cookie') ?? '';
		expect(gesetzt).toContain('jufi_admin=;');
		expect(gesetzt).toContain('Path=/admin/');
		expect(gesetzt).toContain('Max-Age=0');
		expect(await prisma.adminSession.count({ where: { adminId: admin.id } })).toBe(0);
		expect((await sende(server.url, '/admin/api/v1/ich', { cookie })).status).toBe(401);
	});

	it('Vereins-Cookie oeffnet den Admin nicht', async () => {
		const { cookie } = await meldeAdminAn(prisma, t0);
		const token = readCookie(cookie, 'jufi_admin');
		uhr = new Date(t0.getTime() + 60_000);
		const r = await sende(server.url, '/admin/api/v1/ich', { cookie: `${MITGLIEDER_COOKIE}=${token}` });
		expect(r.status).toBe(401);
	});

	it('/ADMIN/api/v1/ich ist nicht der Admin', async () => {
		const { cookie } = await meldeAdminAn(prisma, t0);
		uhr = new Date(t0.getTime() + 60_000);
		expect((await sende(server.url, '/ADMIN/api/v1/ich', { cookie })).status).toBe(404);
		expect((await sende(server.url, '/admin/api/v1/ICH', { cookie })).status).toBe(404);
	});

	it('unbekannter Admin-Pfad ist JSON-404', async () => {
		const { cookie } = await meldeAdminAn(prisma, t0);
		uhr = new Date(t0.getTime() + 60_000);
		const r = await sende(server.url, '/admin/api/v1/gibt-es-nicht', { cookie });
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
	});

	it('speichert nur den Hash des Tokens', async () => {
		const { admin, cookie } = await meldeAdminAn(prisma, t0);
		const token = readCookie(cookie, 'jufi_admin') ?? '';
		const sitzung = await prisma.adminSession.findFirstOrThrow({ where: { adminId: admin.id } });
		expect(sitzung.tokenHash).toBe(hashToken(token));
		expect(sitzung.tokenHash).not.toContain(token);
	});
});

describe('setzeAdminCookie', () => {
	let server: TestServer;

	beforeAll(async () => {
		// Wie createApp: genau ein Proxy davor, dessen X-Forwarded-Proto zaehlt.
		const app = express();
		app.set('trust proxy', 1);
		app.get('/', (req, res) => {
			setzeAdminCookie(req, res, 'abc');
			res.status(204).end();
		});
		server = await starteTestServer(app);
	});

	afterAll(async () => {
		await server.schliessen();
	});

	it('Cookie traegt Secure nur ueber https', async () => {
		const http = await fetch(server.url);
		expect(http.headers.get('set-cookie')).toBe('jufi_admin=abc; Path=/admin/; HttpOnly; SameSite=Lax; Max-Age=43200');

		const https = await fetch(server.url, { headers: { 'X-Forwarded-Proto': 'https' } });
		expect(https.headers.get('set-cookie')).toBe(
			'jufi_admin=abc; Path=/admin/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure',
		);
	});
});
