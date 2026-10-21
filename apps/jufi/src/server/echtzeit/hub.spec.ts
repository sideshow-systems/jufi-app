import { MITGLIEDER_COOKIE, MITGLIEDER_SITZUNG_SEKUNDEN } from '@jufi/auth';
import { createPrismaClientFromEnv, vereinDb, type PrismaClient } from '@jufi/db';
import type { EchtzeitSignal, ThreadBearbeitung, VerlaufAnsicht } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { meldeAdminAn } from '../admin/test-admin.js';
import { createApp } from '../app.js';
import { legeSitzungAn } from '../mitglieder/sitzung.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, TEST_UMGEBUNG } from '../test-setup.js';
import { legeThreadAn, ordneZu } from '../threads/test-threads.js';
import { legeVereinAn } from '../test-vereine.js';
import { Bus } from './bus.js';
import { Hub } from './hub.js';

const T0 = new Date('2026-10-22T10:00:00.000Z');
// Kurz, damit der Ping-Test nicht 30 Sekunden wartet; die Tests stellen die Uhr, nicht die Zeit.
const PING_MS = 50;
/**
 * So lange gilt "nichts empfangen". Kein Beweis, aber jeder solche Test zeigt vorher im selben
 * Ablauf, dass ein Signal desselben Ereignisses bei einem anderen Socket ankam: Bis dahin hat
 * der Hub fuer alle Sockets entschieden, die 300 ms decken nur noch den Weg durchs Netz.
 */
const STILLE_MS = 300;

/** Wie ein Upgrade-Versuch ausging: offen, mit HTTP-Status abgelehnt, oder ohne Antwort zerstoert. */
type Ausgang = { art: 'offen'; client: Client } | { art: 'abgelehnt'; status: number } | { art: 'zerstoert' };

/**
 * Ein Socket des Tests. Der Schliesscode wird ab dem Anlegen mitgeschrieben, denn der Hub kann
 * schliessen, bevor der Test auf das Ereignis wartet.
 */
interface Client {
	ws: WebSocket;
	geschlossen: Promise<number>;
	/** Alles, was der Hub geschickt hat, in Empfangsreihenfolge. */
	signale: EchtzeitSignal[];
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

	/** App und Hub an einem Bus; hubPrisma ersetzt nur den Client des Hubs (Test der Nachpruefung). */
	async function starte(hubPrisma: PrismaClient = prisma): Promise<void> {
		bus = new Bus();
		const app = createApp({
			prisma,
			version: { version: '1.2.3', commit: 'abc' },
			umgebung: TEST_UMGEBUNG,
			jetzt: () => uhr,
			bus,
		});
		server = createServer(app);
		hub = new Hub({ prisma: hubPrisma, umgebung: TEST_UMGEBUNG, jetzt: () => uhr, bus, pingMs: PING_MS });
		hub.haengeAn(server);
		await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
		port = (server.address() as AddressInfo).port;
	}

	async function stoppe(): Promise<void> {
		for (const ws of clients.splice(0)) ws.terminate();
		await hub.schliesseAlle();
		server.closeAllConnections();
		await new Promise<void>((fertig, fehler) => server.close((err) => (err ? fehler(err) : fertig())));
	}

	beforeEach(async () => {
		uhr = T0;
		await starte();
	});

	afterEach(stoppe);

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
		const signale: EchtzeitSignal[] = [];
		ws.on('message', (daten) => signale.push(JSON.parse(String(daten)) as EchtzeitSignal));
		return new Promise((fertig) => {
			ws.once('open', () => fertig({ art: 'offen', client: { ws, geschlossen, signale } }));
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

	/**
	 * Thomas ist Jugendleiter und legt die Threads an, Sandra ist die Mutter von Lena und sieht
	 * damit jeden Thread fuer "Jungfischer und Familie", aber keinen "Nur Jugendleiter".
	 */
	async function familie() {
		const verein = await legeVereinAn(prisma, { slug: `hub-signal-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) => legeMitgliedAn(prisma, verein, { jetzt: T0, ...e });
		const thomas = await mitglied({
			art: 'ERWACHSENER',
			vorname: 'Thomas',
			nachname: 'Leiter',
			rechte: ['MITGLIEDER', 'THREADS_ERSTELLEN'],
		});
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Mutter' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Mutter' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const thread = (daten: Parameters<typeof legeThreadAn>[3] = {}) =>
			legeThreadAn(prisma, verein, T0, { titel: 'Bowling', erstelltVonId: thomas.personId, ...daten });
		const schreibe = async (threadId: string, cookie: string, text: string) => {
			const r = await sende(url(), api(`/threads/${threadId}/verlauf`), {
				methode: 'POST',
				body: { text, clientId: randomUUID() },
				cookie,
			});
			expect(r.status).toBe(201);
			return (await r.json()) as { eintrag: VerlaufAnsicht; stand: number };
		};
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		return { verein, thomas, sandra, lena, api, thread, schreibe, stand };
	}

	const stille = () => new Promise((fertig) => setTimeout(fertig, STILLE_MS));

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

		it('ein Abmelden waehrend des Upgrades schliesst den frisch geoeffneten Socket mit 4401', async () => {
			const s = await szenario();
			// Der Hub liest die Sitzung, dann meldet sich die Person ab, bevor er den Socket aufnimmt:
			// Die Pruefung zu pruefen sieht den Socket noch nicht, der Socket muss selbst nachpruefen.
			// Am Lesen der Sitzung statt am Laden des Vereins: Fehlte die Sitzung schon dort, endete
			// das Upgrade mit 401 und der Socket kaeme gar nicht erst auf.
			let einmal = true;
			const abmeldend = prisma.$extends({
				query: {
					session: {
						async findUnique({ args, query }) {
							const ergebnis = await query(args);
							if (einmal) {
								einmal = false;
								await prisma.session.deleteMany({ where: { zugangId: s.thomas.zugangId } });
								bus.melde({ typ: 'pruefen', vereinId: s.verein.id });
							}
							return ergebnis;
						},
					},
				},
			}) as unknown as PrismaClient;
			await stoppe();
			await starte(abmeldend);

			const c = await oeffne(s.verein.slug, s.thomas.cookie);
			expect(einmal).toBe(false);
			expect(await c.geschlossen).toBe(4401);
			await expect.poll(() => hub.anzahl(s.verein.id)).toBe(0);
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

	describe('Signale', () => {
		it('eine Nachricht im Bowling-Verlauf kommt bei Thomas und Sandra an, je mit ihrer Ansicht', async () => {
			const f = await familie();
			const bowling = await f.thread();
			const thomas = await oeffne(f.verein.slug, f.thomas.cookie);
			const sandra = await oeffne(f.verein.slug, f.sandra.cookie);

			const { eintrag, stand } = await f.schreibe(bowling.threadId, f.thomas.cookie, 'Wer faehrt mit?');
			const signal = { stand, threadId: bowling.threadId, art: 'VERLAUF', objektId: eintrag.id };
			await expect.poll(() => thomas.signale).toEqual([{ ...signal, eintrag }]);
			await expect
				.poll(() => sandra.signale)
				.toEqual([{ ...signal, eintrag: { ...eintrag, eigen: false, darfLoeschen: false } }]);
			// Spec 3.10: der Jugendleiter mit Zusatz, fuer alle gleich.
			expect(eintrag).toMatchObject({ eigen: true, absender: 'Thomas L. (Jugendleiter)', text: 'Wer faehrt mit?' });
		});

		it('eine Nachricht in einem Thread nur fuer Jugendleiter erreicht Sandra nicht', async () => {
			const f = await familie();
			const intern = await f.thread({ titel: 'Leiterrunde', rollenfilter: 'NUR_JUGENDLEITER' });
			const thomas = await oeffne(f.verein.slug, f.thomas.cookie);
			const sandra = await oeffne(f.verein.slug, f.sandra.cookie);

			const { eintrag } = await f.schreibe(intern.threadId, f.thomas.cookie, 'Nur unter uns');
			await expect.poll(() => thomas.signale.map((s) => s.objektId)).toEqual([eintrag.id]);
			await stille();
			expect(sandra.signale).toEqual([]);
		});

		it('wird Bowling nur fuer Jugendleiter, bekommt Sandra SICHTBARKEIT mit der Thread-ID', async () => {
			const f = await familie();
			const bowling = await f.thread();
			const thomas = await oeffne(f.verein.slug, f.thomas.cookie);
			const sandra = await oeffne(f.verein.slug, f.sandra.cookie);

			const b = await sende(url(), f.api(`/threads/${bowling.threadId}/bearbeitung`), { cookie: f.thomas.cookie });
			const { version, entwurf } = (await b.json()) as ThreadBearbeitung;
			const r = await sende(url(), f.api(`/threads/${bowling.threadId}`), {
				methode: 'PUT',
				body: { version, entwurf: { ...entwurf, rollenfilter: 'NUR_JUGENDLEITER' } },
				cookie: f.thomas.cookie,
			});
			expect(r.status).toBe(200);
			const stand = await f.stand();

			// Thomas sieht den Thread weiter und bekommt beides; Sandra nur, dass er weg ist.
			await expect
				.poll(() => thomas.signale.map((s) => [s.stand, s.threadId, s.art]).sort())
				.toEqual([
					[stand, bowling.threadId, 'SICHTBARKEIT'],
					[stand, bowling.threadId, 'THREAD'],
				]);
			await expect
				.poll(() => sandra.signale)
				.toEqual([expect.objectContaining({ stand, threadId: bowling.threadId, art: 'SICHTBARKEIT' })]);
		});

		it('kommt Lena in eine Untergruppe, bekommen beide threadId null, und danach gilt das neue Umfeld', async () => {
			const f = await familie();
			const aal = await vereinDb(prisma, f.verein.id).untergruppe.create({ data: { name: 'Aal' } });
			const aalThread = await f.thread({ titel: 'Aal-Training', untergruppenIds: [aal.id] });
			const thomas = await oeffne(f.verein.slug, f.thomas.cookie);
			const sandra = await oeffne(f.verein.slug, f.sandra.cookie);

			// Vorher: Lena ist in keiner Untergruppe, Sandra sieht den Thread nicht. Das laedt
			// zugleich das Umfeld des Vereins in den Hub, das die Aenderung danach verwerfen muss.
			const vorher = await f.schreibe(aalThread.threadId, f.thomas.cookie, 'Training am Samstag');
			await expect.poll(() => thomas.signale.map((s) => s.objektId)).toEqual([vorher.eintrag.id]);
			await stille();
			expect(sandra.signale).toEqual([]);

			const r = await sende(url(), f.api(`/personen/${f.lena.personId}/untergruppen`), {
				methode: 'PUT',
				body: { untergruppenIds: [aal.id] },
				cookie: f.thomas.cookie,
			});
			expect(r.status).toBe(200);
			const stand = await f.stand();
			// Ohne die ID von Lena: Das Signal geht an jeden Socket des Vereins.
			const umfeld = { stand, threadId: null, art: 'SICHTBARKEIT', objektId: '' };
			await expect.poll(() => thomas.signale.slice(1)).toEqual([umfeld]);
			await expect.poll(() => sandra.signale).toEqual([umfeld]);

			const danach = await f.schreibe(aalThread.threadId, f.thomas.cookie, 'Lena ist jetzt dabei');
			await expect
				.poll(() => sandra.signale.slice(1))
				.toEqual([
					{
						stand: danach.stand,
						threadId: aalThread.threadId,
						art: 'VERLAUF',
						objektId: danach.eintrag.id,
						eintrag: { ...danach.eintrag, eigen: false, darfLoeschen: false },
					},
				]);
		});

		it('Signale eines Vereins kommen in der Reihenfolge der Staende an', async () => {
			const f = await familie();
			const bowling = await f.thread();
			const sandra = await oeffne(f.verein.slug, f.sandra.cookie);

			const staende: number[] = [];
			for (const text of ['eins', 'zwei', 'drei', 'vier']) {
				staende.push((await f.schreibe(bowling.threadId, f.thomas.cookie, text)).stand);
			}
			await expect.poll(() => sandra.signale.map((s) => s.stand)).toEqual(staende);
		});
	});

	describe('Fehler im Hub', () => {
		/** Das Modell, dessen findMany im Hub scheitert; null, solange alles gelingt. */
		let scheitert: string | null = null;
		let fehlerLog: ReturnType<typeof vi.spyOn>;

		beforeEach(async () => {
			scheitert = null;
			// Nur der Hub bekommt den scheiternden Client; die Routen schreiben weiter echt.
			const scheiternd = prisma.$extends({
				query: {
					$allModels: {
						async findMany({ model, args, query }) {
							if (model === scheitert) throw new Error('Datenbank weg');
							return query(args);
						},
					},
				},
			}) as unknown as PrismaClient;
			await stoppe();
			await starte(scheiternd);
			// Der Hub loggt den Fehler; hier wird geprueft, dass er es tut, statt die Ausgabe zu fuellen.
			fehlerLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		});

		afterEach(() => fehlerLog.mockRestore());

		/** Der Schliesscode, oder offen, wenn der Socket nach einer Sekunde noch steht (statt bis zum Zeitlimit zu warten). */
		const schliesscode = (c: Client) =>
			Promise.race([c.geschlossen, new Promise<'offen'>((fertig) => setTimeout(() => fertig('offen'), 1000))]);

		it('scheitert das Verteilen, schliesst der Hub alle Sockets des Vereins mit 1011, die eines anderen bleiben', async () => {
			const f = await familie();
			const bowling = await f.thread();
			const b = await szenario('hub-b');
			const imVerein = [await oeffne(f.verein.slug, f.thomas.cookie), await oeffne(f.verein.slug, f.sandra.cookie)];
			const anderer = await oeffne(b.verein.slug, b.thomas.cookie);

			// Das Umfeld laedt der Hub erst mit dem ersten Ereignis; daran scheitert die Verteilung.
			scheitert = 'UntergruppeMitglied';
			await f.schreibe(bowling.threadId, f.thomas.cookie, 'Wer faehrt mit?');
			expect(await Promise.all(imVerein.map(schliesscode))).toEqual([1011, 1011]);
			expect(imVerein.flatMap((c) => c.signale)).toEqual([]);
			expect(anderer.ws.readyState).toBe(WebSocket.OPEN);
			expect(fehlerLog).toHaveBeenCalledWith('Hub: Verteilen fehlgeschlagen:', 'Error');

			// Das gescheiterte Umfeld bleibt nicht im Cache: Nach dem Neuverbinden kommt das naechste Signal an.
			scheitert = null;
			const sandra = await oeffne(f.verein.slug, f.sandra.cookie);
			const { eintrag } = await f.schreibe(bowling.threadId, f.thomas.cookie, 'Jetzt aber');
			await expect.poll(() => sandra.signale.map((s) => s.objektId)).toEqual([eintrag.id]);
		});

		it('scheitert die Pruefung, schliesst der Hub die geprueften Sockets mit 1011, die anderen bleiben', async () => {
			const s = await szenario();
			const sandra = await legeMitgliedAn(prisma, s.verein, { art: 'ERWACHSENER', vorname: 'Sandra', jetzt: T0 });
			// Sandras Sitzung laeuft spaeter ab; der Ping prueft darum nur den Socket von Thomas.
			const ende = new Date(T0.getTime() + MITGLIEDER_SITZUNG_SEKUNDEN * 1000);
			await prisma.session.updateMany({
				where: { zugangId: sandra.zugangId },
				data: { ablauf: new Date(ende.getTime() + 60_000) },
			});
			const thomas = await oeffne(s.verein.slug, s.thomas.cookie);
			const sandrasSocket = await oeffne(s.verein.slug, sandra.cookie);

			scheitert = 'Session';
			uhr = ende;
			expect(await schliesscode(thomas)).toBe(1011);
			expect(sandrasSocket.ws.readyState).toBe(WebSocket.OPEN);
			expect(fehlerLog).toHaveBeenCalledWith('Hub: Pruefen fehlgeschlagen:', 'Error');
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
