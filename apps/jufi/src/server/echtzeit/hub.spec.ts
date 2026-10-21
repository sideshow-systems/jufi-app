import { MITGLIEDER_COOKIE, MITGLIEDER_SITZUNG_SEKUNDEN } from '@jufi/auth';
import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { meldeAdminAn } from '../admin/test-admin.js';
import { createApp } from '../app.js';
import { legeSitzungAn } from '../mitglieder/sitzung.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, TEST_UMGEBUNG } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { Bus } from './bus.js';
import { Hub } from './hub.js';

const T0 = new Date('2026-10-22T10:00:00.000Z');
// Kurz, damit der Ping-Test nicht 30 Sekunden wartet; die Tests stellen die Uhr, nicht die Zeit.
const PING_MS = 50;

/** Wie ein Upgrade-Versuch ausging: offen, mit HTTP-Status abgelehnt, oder ohne Antwort zerstoert. */
type Ausgang = { art: 'offen'; client: Client } | { art: 'abgelehnt'; status: number } | { art: 'zerstoert' };

/**
 * Ein Socket des Tests. Der Schliesscode wird ab dem Anlegen mitgeschrieben, denn der Hub kann
 * schliessen, bevor der Test auf das Ereignis wartet.
 */
interface Client {
	ws: WebSocket;
	geschlossen: Promise<number>;
}

// Wer auf das Schliessen beim Client wartet, ist dem Server einen Schritt voraus: Dessen
// close-Ereignis kann noch ausstehen. Darum fragen die Tests anzahl mit expect.poll ab.
describe('Hub', () => {
	const prisma = createPrismaClientFromEnv();
	let uhr = T0;
	let bus: Bus;
	let hub: Hub;
	let server: Server;
	let port = 0;
	const clients: WebSocket[] = [];

	beforeEach(async () => {
		uhr = T0;
		bus = new Bus();
		const app = createApp({
			prisma,
			version: { version: '1.2.3', commit: 'abc' },
			umgebung: TEST_UMGEBUNG,
			jetzt: () => uhr,
			bus,
		});
		server = createServer(app);
		hub = new Hub({ prisma, umgebung: TEST_UMGEBUNG, jetzt: () => uhr, bus, pingMs: PING_MS });
		hub.haengeAn(server);
		await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
		port = (server.address() as AddressInfo).port;
	});

	afterEach(async () => {
		for (const ws of clients.splice(0)) ws.terminate();
		await hub.schliesseAlle();
		server.closeAllConnections();
		await new Promise<void>((fertig, fehler) => server.close((err) => (err ? fehler(err) : fertig())));
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	const url = () => `http://127.0.0.1:${port}`;

	function versuche(
		pfad: string,
		kopf: { cookie?: string; origin?: string | null } = {},
		optionen: { autoPong?: boolean } = {},
	): Promise<Ausgang> {
		const headers: Record<string, string> = {};
		if (kopf.cookie) headers['Cookie'] = kopf.cookie;
		const origin = kopf.origin === undefined ? TEST_UMGEBUNG.basisUrl : kopf.origin;
		if (origin !== null) headers['Origin'] = origin;
		const ws = new WebSocket(`ws://127.0.0.1:${port}${pfad}`, { headers, autoPong: optionen.autoPong ?? true });
		clients.push(ws);
		// Fehler nach dem ersten (etwa beim Kappen durch den Hub) gehoeren nicht zum Ausgang und
		// duerfen den Testlauf nicht als unbehandeltes Ereignis beenden.
		ws.on('error', () => undefined);
		const geschlossen = new Promise<number>((fertig) => ws.once('close', (code) => fertig(code)));
		return new Promise((fertig) => {
			ws.once('open', () => fertig({ art: 'offen', client: { ws, geschlossen } }));
			ws.once('unexpected-response', (_req, res) => {
				fertig({ art: 'abgelehnt', status: res.statusCode ?? 0 });
				res.resume();
				ws.terminate();
			});
			// Kommt nach einer Ablehnung auch (terminate); dann ist der Ausgang schon entschieden.
			ws.once('error', () => fertig({ art: 'zerstoert' }));
		});
	}

	async function oeffne(slug: string, cookie: string): Promise<Client> {
		const ausgang = await versuche(`/${slug}/ws`, { cookie });
		if (ausgang.art !== 'offen') throw new Error(`Upgrade nicht offen: ${JSON.stringify(ausgang)}`);
		return ausgang.client;
	}

	async function status(pfad: string, kopf: { cookie?: string; origin?: string | null } = {}): Promise<number> {
		const ausgang = await versuche(pfad, kopf);
		if (ausgang.art === 'abgelehnt') return ausgang.status;
		throw new Error(`erwartet abgelehnt, war ${ausgang.art}`);
	}

	async function szenario(praefix = 'hub') {
		const verein = await legeVereinAn(prisma, { slug: `${praefix}-${randomUUID().slice(0, 8)}` });
		const thomas = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Thomas',
			rechte: ['MITGLIEDER'],
			jetzt: T0,
		});
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		return { verein, thomas, api };
	}

	describe('Upgrade', () => {
		it('oeffnet mit gueltigem Cookie und eigenem Origin unter /<slug>/ws', async () => {
			const s = await szenario();
			const c = await oeffne(s.verein.slug, s.thomas.cookie);
			expect(c.ws.readyState).toBe(WebSocket.OPEN);
			expect(hub.anzahl(s.verein.id)).toBe(1);
			expect(hub.anzahl()).toBe(1);
		});

		it('ist 403 bei fremdem oder fehlendem Origin', async () => {
			const s = await szenario();
			expect(await status(`/${s.verein.slug}/ws`, { cookie: s.thomas.cookie, origin: 'http://boese.test' })).toBe(403);
			expect(await status(`/${s.verein.slug}/ws`, { cookie: s.thomas.cookie, origin: null })).toBe(403);
			expect(hub.anzahl()).toBe(0);
		});

		it('ist 404 bei unbekanntem, unmoeglichem und gesperrtem Verein', async () => {
			const s = await szenario();
			const gesperrt = await legeVereinAn(prisma, { slug: `hub-gesperrt-${randomUUID().slice(0, 8)}` });
			const m = await legeMitgliedAn(prisma, gesperrt, { art: 'ERWACHSENER', jetzt: T0 });
			await prisma.verein.update({ where: { id: gesperrt.id }, data: { status: 'GESPERRT' } });

			expect(await status(`/hub-gibt-es-nicht/ws`, { cookie: s.thomas.cookie })).toBe(404);
			expect(await status(`/ADMIN/ws`, { cookie: s.thomas.cookie })).toBe(404);
			expect(await status(`/${gesperrt.slug}/ws`, { cookie: m.cookie })).toBe(404);
			expect(hub.anzahl()).toBe(0);
		});

		it('ist 401 ohne Cookie, mit Cookie eines anderen Vereins, fuer entfernte Personen und Jungfischer ohne Zugang', async () => {
			const s = await szenario();
			const b = await szenario('hub-b');
			const entfernt = await legeMitgliedAn(prisma, s.verein, { art: 'ERWACHSENER', jetzt: T0 });
			await prisma.person.update({ where: { id: entfernt.personId }, data: { entferntAm: T0 } });
			const kind = await legeMitgliedAn(prisma, s.verein, { art: 'JUNGFISCHER', jetzt: T0 });
			await prisma.person.update({ where: { id: kind.personId }, data: { zugangErlaubt: false } });

			expect(await status(`/${s.verein.slug}/ws`)).toBe(401);
			expect(await status(`/${s.verein.slug}/ws`, { cookie: `${MITGLIEDER_COOKIE}=unbekannt` })).toBe(401);
			expect(await status(`/${s.verein.slug}/ws`, { cookie: b.thomas.cookie })).toBe(401);
			expect(await status(`/${s.verein.slug}/ws`, { cookie: entfernt.cookie })).toBe(401);
			expect(await status(`/${s.verein.slug}/ws`, { cookie: kind.cookie })).toBe(401);
			expect(hub.anzahl()).toBe(0);
		});

		it('ist 401 mit abgelaufener Sitzung', async () => {
			const s = await szenario();
			uhr = new Date(T0.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000);
			expect(await status(`/${s.verein.slug}/ws`, { cookie: s.thomas.cookie })).toBe(401);
		});

		it('zerstoert den Socket ohne Antwort bei jedem anderen Pfad', async () => {
			const s = await szenario();
			for (const pfad of [`/${s.verein.slug}/wss`, `/${s.verein.slug}/api/v1/ws`, '/ws', `/${s.verein.slug}/ws/x`]) {
				expect(await versuche(pfad, { cookie: s.thomas.cookie })).toEqual({ art: 'zerstoert' });
			}
			expect(hub.anzahl()).toBe(0);
		});

		it('nimmt einen Pfad mit Abfrage an', async () => {
			const s = await szenario();
			const ausgang = await versuche(`/${s.verein.slug}/ws?v=1`, { cookie: s.thomas.cookie });
			expect(ausgang.art).toBe('offen');
		});

		it('ist 429 ab dem elften Socket einer Person; die zehn bleiben offen', async () => {
			const s = await szenario();
			const zehn: Client[] = [];
			for (let i = 0; i < 10; i++) zehn.push(await oeffne(s.verein.slug, s.thomas.cookie));
			expect(await status(`/${s.verein.slug}/ws`, { cookie: s.thomas.cookie })).toBe(429);
			expect(zehn.every((c) => c.ws.readyState === WebSocket.OPEN)).toBe(true);
			expect(hub.anzahl(s.verein.id)).toBe(10);

			// Eine andere Person zaehlt fuer sich.
			const sandra = await legeMitgliedAn(prisma, s.verein, { art: 'ERWACHSENER', vorname: 'Sandra', jetzt: T0 });
			await oeffne(s.verein.slug, sandra.cookie);
			expect(hub.anzahl(s.verein.id)).toBe(11);
		});
	});

	describe('Schliessen, wenn die Sitzung nicht mehr gilt', () => {
		it('POST /abmelden schliesst den Socket dieser Sitzung mit 4401, der einer anderen Sitzung bleibt', async () => {
			const s = await szenario();
			const token = await legeSitzungAn(vereinDb(prisma, s.verein.id), { zugangId: s.thomas.zugangId, jetzt: T0 });
			const zweite = await oeffne(s.verein.slug, `${MITGLIEDER_COOKIE}=${token}`);
			const erste = await oeffne(s.verein.slug, s.thomas.cookie);

			const r = await sende(url(), s.api('/abmelden'), { methode: 'POST', cookie: s.thomas.cookie });
			expect(r.status).toBe(204);
			expect(await erste.geschlossen).toBe(4401);
			expect(zweite.ws.readyState).toBe(WebSocket.OPEN);
			await expect.poll(() => hub.anzahl(s.verein.id)).toBe(1);
		});

		it('Zugang entziehen schliesst den Socket des Jungfischers mit 4401', async () => {
			const s = await szenario();
			const kind = await legeMitgliedAn(prisma, s.verein, { art: 'JUNGFISCHER', vorname: 'Lena', jetzt: T0 });
			const c = await oeffne(s.verein.slug, kind.cookie);
			const leiter = await oeffne(s.verein.slug, s.thomas.cookie);

			const r = await sende(url(), s.api(`/personen/${kind.personId}/zugang`), {
				methode: 'POST',
				body: { erlaubt: false },
				cookie: s.thomas.cookie,
			});
			expect(r.status).toBe(200);
			expect(await c.geschlossen).toBe(4401);
			expect(leiter.ws.readyState).toBe(WebSocket.OPEN);
		});

		it('Verein sperren schliesst alle Sockets des Vereins mit 4401, die eines anderen Vereins bleiben', async () => {
			const a = await szenario();
			const b = await szenario('hub-b');
			const sandra = await legeMitgliedAn(prisma, a.verein, { art: 'ERWACHSENER', vorname: 'Sandra', jetzt: T0 });
			const inA = [await oeffne(a.verein.slug, a.thomas.cookie), await oeffne(a.verein.slug, sandra.cookie)];
			const inB = await oeffne(b.verein.slug, b.thomas.cookie);
			const admin = await meldeAdminAn(prisma, T0);

			const r = await sende(url(), `/admin/api/v1/vereine/${a.verein.id}/sperren`, {
				methode: 'POST',
				cookie: admin.cookie,
			});
			expect(r.status).toBe(200);
			expect(await Promise.all(inA.map((c) => c.geschlossen))).toEqual([4401, 4401]);
			expect(inB.ws.readyState).toBe(WebSocket.OPEN);
			await expect.poll(() => hub.anzahl(a.verein.id)).toBe(0);
			expect(hub.anzahl(b.verein.id)).toBe(1);
		});

		it('eine abgelaufene Sitzung faellt beim naechsten Ping mit 4401 heraus', async () => {
			const s = await szenario();
			const c = await oeffne(s.verein.slug, s.thomas.cookie);
			uhr = new Date(T0.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000);
			expect(await c.geschlossen).toBe(4401);
			await expect.poll(() => hub.anzahl(s.verein.id)).toBe(0);
		});

		it('eine verlaengerte Sitzung bleibt beim Ping offen, auch wenn der gespeicherte Ablauf vorbei ist', async () => {
			const s = await szenario();
			const c = await oeffne(s.verein.slug, s.thomas.cookie);
			// Wie die Middleware verlaengern: Eine Anfrage nach mehr als einem Tag schiebt den Ablauf
			// in der Datenbank, der Socket kennt noch den alten.
			const spaeter = new Date(T0.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000);
			await prisma.session.updateMany({
				where: { zugangId: s.thomas.zugangId },
				data: { ablauf: new Date(spaeter.getTime() + 60_000) },
			});
			uhr = spaeter;
			await new Promise((fertig) => setTimeout(fertig, PING_MS * 4));
			expect(c.ws.readyState).toBe(WebSocket.OPEN);
		});

		it('beendet einen Client, der nicht auf den Ping antwortet', async () => {
			const s = await szenario();
			const ausgang = await versuche(`/${s.verein.slug}/ws`, { cookie: s.thomas.cookie }, { autoPong: false });
			if (ausgang.art !== 'offen') throw new Error('Upgrade nicht offen');
			// 1006: Der Hub hat die Verbindung ohne Schliess-Handschlag gekappt.
			expect(await ausgang.client.geschlossen).toBe(1006);
			await expect.poll(() => hub.anzahl(s.verein.id)).toBe(0);
		});
	});

	describe('schliesseAlle', () => {
		it('schliesst alle Sockets mit 1012 und nimmt danach keine mehr an', async () => {
			const a = await szenario();
			const b = await szenario('hub-b');
			const offen = [await oeffne(a.verein.slug, a.thomas.cookie), await oeffne(b.verein.slug, b.thomas.cookie)];

			await hub.schliesseAlle();
			expect(await Promise.all(offen.map((c) => c.geschlossen))).toEqual([1012, 1012]);
			expect(hub.anzahl()).toBe(0);
			expect(await versuche(`/${a.verein.slug}/ws`, { cookie: a.thomas.cookie })).toEqual({ art: 'zerstoert' });
		});
	});
});
