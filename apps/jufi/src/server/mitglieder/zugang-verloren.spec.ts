import { AttemptTracker } from '@jufi/auth';
import { createPrismaClientFromEnv } from '@jufi/db';
import { RESET_GUELTIG_MS } from '@jufi/domain';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { resetMail } from '../mail/texte.js';
import { Nachlauf } from '../nachlauf.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

const OK = { ok: true };

type V = { id: string; slug: string };

describe('Zugang verloren', () => {
	const prisma = createPrismaClientFromEnv();
	const uhr = new Date('2026-10-13T08:00:00Z');
	let server: TestServer;
	let nachlauf: Nachlauf;
	let versuche: AttemptTracker;
	let verein: V;
	let fremd: V;
	let gesperrt: V;

	beforeAll(async () => {
		[verein, fremd, gesperrt] = await Promise.all([
			legeVereinAn(prisma, { slug: 'reset-eigen', anzeigename: 'Jungfischer Reset' }),
			legeVereinAn(prisma, { slug: 'reset-fremd' }),
			legeVereinAn(prisma, { slug: 'reset-gesperrt', status: 'GESPERRT' }),
		]);
	});

	/**
	 * Frischer Zaehler und eigener Nachlauf: kein Backoff und keine Arbeit aus
	 * einem anderen Test. Wartet vorher auf den alten Nachlauf, damit keine
	 * Arbeit in den naechsten Test hineinlaeuft.
	 */
	async function frischeApp() {
		await nachlauf?.warteAufAlle();
		nachlauf = new Nachlauf();
		versuche = new AttemptTracker(() => uhr.getTime());
		await server?.schliessen();
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr,
				anmeldeVersuche: versuche,
				nachlauf,
			}),
		);
	}

	beforeEach(frischeApp);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Jede Anfrage von einer eigenen Adresse, wo der Test nicht ausdruecklich den Backoff je IP prueft. */
	const neueIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
	const kuerzel = () => randomUUID().slice(0, 8);

	function verloren(v: { slug: string }, body?: unknown, ip = neueIp()) {
		return sende(server.url, `/${v.slug}/api/v1/zugang-verloren`, {
			methode: 'POST',
			body,
			kopf: { 'X-Forwarded-For': ip },
		});
	}

	async function erwachsener(v: V = verein) {
		const email = `reset-${kuerzel()}@example.test`;
		const m = await legeMitgliedAn(prisma, v, { art: 'ERWACHSENER', vorname: 'Sabine', email, jetzt: uhr });
		return { ...m, email };
	}

	function offeneResets(personId: string) {
		return prisma.einladung.findMany({ where: { personId, art: 'RESET', eingeloestAm: null } });
	}

	function mails(empfaenger: string) {
		return prisma.mailWarteschlange.findMany({
			where: { empfaenger },
			orderBy: [{ angelegtAm: 'asc' }, { id: 'asc' }],
		});
	}

	/** Alle Faelle, die nach aussen gleich aussehen muessen; nur "bekannt" fuehrt zu einer Mail. */
	async function faelle() {
		const bekannt = await erwachsener();
		const jungfischerEmail = `reset-kind-${kuerzel()}@example.test`;
		const kind = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', email: jungfischerEmail, jetzt: uhr });
		const ohneZugangEmail = `reset-ohne-${kuerzel()}@example.test`;
		const ohneZugang = await prisma.person.create({
			data: { vereinId: verein.id, art: 'ERWACHSENER', vorname: 'Olaf', nachname: 'Ohne', email: ohneZugangEmail },
		});
		const entferntEmail = `reset-fort-${kuerzel()}@example.test`;
		const entfernt = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', email: entferntEmail, jetzt: uhr });
		await prisma.person.update({ where: { id: entfernt.personId }, data: { entferntAm: uhr } });
		return {
			bekannt,
			stumm: [
				{ name: 'unbekannt', body: { email: `niemand-${kuerzel()}@example.test` }, personId: null },
				{ name: 'Jungfischer', body: { email: jungfischerEmail }, personId: kind.personId },
				{ name: 'ohne Zugang', body: { email: ohneZugangEmail }, personId: ohneZugang.id },
				{ name: 'entfernt', body: { email: entferntEmail }, personId: entfernt.personId },
				{ name: 'leer', body: { email: '' }, personId: null },
				{ name: 'kein-at', body: { email: 'kein-at' }, personId: null },
				{ name: 'Zahl', body: { email: 42 }, personId: null },
				{ name: 'Liste', body: { email: [bekannt.email] }, personId: null },
				{ name: 'null', body: { email: null }, personId: null },
				{ name: 'ohne Feld', body: {}, personId: null },
				{ name: 'ohne Body', body: undefined, personId: null },
			],
			stummeAdressen: [jungfischerEmail, ohneZugangEmail, entferntEmail],
		};
	}

	it('Gleiche Antwort für alle Fälle', async () => {
		const { bekannt, stumm } = await faelle();
		const bodies: string[] = [];
		const r = await verloren(verein, { email: bekannt.email });
		expect(r.status).toBe(200);
		bodies.push(await r.text());
		for (const fall of stumm) {
			// Alles, was keine gueltige Adresse ist (leer, kein Text, kein-at), teilt
			// sich den leeren Schluessel und damit den Zaehler; hier geht es nur um die Antwort.
			await frischeApp();
			const a = await verloren(verein, fall.body);
			expect(a.status, fall.name).toBe(200);
			bodies.push(await a.text());
		}
		expect(new Set(bodies)).toEqual(new Set([JSON.stringify(OK)]));
		await nachlauf.warteAufAlle();
	});

	it('Nur der bekannte Fall erzeugt Einladung und Mail', async () => {
		const { bekannt, stumm, stummeAdressen } = await faelle();
		const mailsVorher = await prisma.mailWarteschlange.count({ where: { vereinId: verein.id } });
		const einladungenVorher = await prisma.einladung.count({ where: { vereinId: verein.id } });

		for (const fall of stumm) {
			// Frischer Zaehler je Fall: jeder soll wirklich bis in den Nachlauf kommen, nicht an 429 enden.
			await frischeApp();
			expect((await verloren(verein, fall.body)).status, fall.name).toBe(200);
		}
		await nachlauf.warteAufAlle();
		// Die stummen Faelle allein: keine Zeile, keine Einladung.
		expect(await prisma.mailWarteschlange.count({ where: { vereinId: verein.id } })).toBe(mailsVorher);
		expect(await prisma.einladung.count({ where: { vereinId: verein.id } })).toBe(einladungenVorher);
		for (const fall of stumm) {
			if (fall.personId) expect(await offeneResets(fall.personId), fall.name).toEqual([]);
		}
		for (const adresse of stummeAdressen) expect(await mails(adresse)).toEqual([]);

		// Grossgeschrieben, damit die Zeile zeigt, dass an die normalisierte Adresse geht.
		const r = await verloren(verein, { email: bekannt.email.toUpperCase() });
		expect(await r.json()).toEqual(OK);
		await nachlauf.warteAufAlle();

		const resets = await offeneResets(bekannt.personId);
		expect(resets).toHaveLength(1);
		expect(resets[0]).toMatchObject({ erstelltVonPersonId: null, angelegtAm: uhr });
		expect(resets[0]?.ablauf).toEqual(new Date(uhr.getTime() + RESET_GUELTIG_MS));
		expect(resets[0]?.ablauf).toEqual(new Date(uhr.getTime() + 60 * 60 * 1000));

		const zeilen = await mails(bekannt.email);
		expect(zeilen).toHaveLength(1);
		const zeile = zeilen[0];
		expect(zeile).toMatchObject({
			vereinId: verein.id,
			empfaenger: bekannt.email,
			bezug: `reset:${resets[0]?.id}`,
			naechsterVersuch: uhr,
			gesendetAm: null,
		});
		const link = /http:\/\/jufi\.test\/reset-eigen\/einladung#\S+/.exec(zeile?.text ?? '')?.[0] ?? '';
		expect(link).not.toBe('');
		expect(zeile?.betreff).toBe(resetMail({ vorname: 'Sabine', anzeigename: 'Jungfischer Reset', link }).betreff);
		expect(zeile?.text).toBe(resetMail({ vorname: 'Sabine', anzeigename: 'Jungfischer Reset', link }).text);
		expect(await prisma.mailWarteschlange.count({ where: { vereinId: verein.id } })).toBe(mailsVorher + 1);
	});

	it('Der Link gilt', async () => {
		const { email } = await erwachsener();
		await verloren(verein, { email });
		await nachlauf.warteAufAlle();
		const [zeile] = await mails(email);
		const token = /einladung#(\S+)/.exec(zeile?.text ?? '')?.[1] ?? '';
		expect(token).not.toBe('');

		const r = await sende(server.url, `/${verein.slug}/api/v1/einladung/pruefen`, {
			methode: 'POST',
			body: { token },
		});
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ art: 'RESET', vorname: 'Sabine', kennung: { fest: true, wert: email } });
	});

	it('Großschreibung und Rand der Adresse treffen dieselbe Person', async () => {
		const { email, personId } = await erwachsener();
		const r = await verloren(verein, { email: `  ${email.toUpperCase()}\t` });
		expect(await r.json()).toEqual(OK);
		await nachlauf.warteAufAlle();
		expect(await offeneResets(personId)).toHaveLength(1);
		expect(await mails(email)).toHaveLength(1);
	});

	it('Zweiter Aufruf ersetzt den offenen Reset-Link', async () => {
		const { email, personId } = await erwachsener();
		await verloren(verein, { email });
		await nachlauf.warteAufAlle();
		const erste = await offeneResets(personId);
		await verloren(verein, { email });
		await nachlauf.warteAufAlle();

		const offen = await offeneResets(personId);
		expect(offen).toHaveLength(1);
		expect(offen[0]?.id).not.toBe(erste[0]?.id);
		// Beide Mails stehen in der Schlange; die erste traegt einen Link, der nicht mehr gilt.
		const zeilen = await mails(email);
		expect(zeilen.map((z) => z.bezug)).toEqual([`reset:${erste[0]?.id}`, `reset:${offen[0]?.id}`]);
	});

	it('Ein Reset laesst eine offene Einladung derselben Person stehen', async () => {
		const { email, personId } = await erwachsener();
		await prisma.einladung.create({
			data: {
				vereinId: verein.id,
				personId,
				art: 'EINLADUNG',
				tokenHash: `einladung-${kuerzel()}`,
				ablauf: new Date(uhr.getTime() + 24 * 60 * 60 * 1000),
			},
		});
		await verloren(verein, { email });
		await nachlauf.warteAufAlle();
		const offen = await prisma.einladung.findMany({ where: { personId, eingeloestAm: null } });
		expect(offen.map((e) => e.art).sort()).toEqual(['EINLADUNG', 'RESET']);
	});

	describe('Backoff zählt unabhängig vom Treffer', () => {
		it('vier Aufrufe mit unbekannter Adresse: der vierte ist 429, im anderen Verein nicht', async () => {
			const email = `niemand-${kuerzel()}@example.test`;
			for (let i = 0; i < 3; i++) expect((await verloren(verein, { email })).status).toBe(200);
			const vierter = await verloren(verein, { email });
			expect(vierter.status).toBe(429);
			expect(await vierter.json()).toEqual({ fehler: 'Zu viele Versuche', wartenSekunden: 1 });
			// Grossschreibung zaehlt zum selben Schluessel.
			expect((await verloren(verein, { email: email.toUpperCase() })).status).toBe(429);

			const anderswo = await verloren(fremd, { email });
			expect(anderswo.status).toBe(200);
			expect(await anderswo.json()).toEqual(OK);
			await nachlauf.warteAufAlle();
		});

		it('vier Aufrufe mit bekannter Adresse: der vierte ist 429 und erzeugt nichts', async () => {
			const { email } = await erwachsener();
			for (let i = 0; i < 3; i++) expect((await verloren(verein, { email })).status).toBe(200);
			expect((await verloren(verein, { email })).status).toBe(429);
			await nachlauf.warteAufAlle();
			// Ein Treffer setzt nichts zurueck: drei Mails, nicht vier.
			expect(await mails(email)).toHaveLength(3);
		});

		it('je IP: vier verschiedene Adressen von derselben Adresse, der vierte ist 429', async () => {
			const ip = neueIp();
			for (let i = 0; i < 3; i++) {
				expect((await verloren(verein, { email: `ip-${kuerzel()}@example.test` }, ip)).status).toBe(200);
			}
			expect((await verloren(verein, { email: `ip-${kuerzel()}@example.test` }, ip)).status).toBe(429);
			// Ungueltige Eingaben zaehlen genauso.
			const andere = neueIp();
			for (let i = 0; i < 3; i++) expect((await verloren(verein, { email: 42 }, andere)).status).toBe(200);
			expect((await verloren(verein, {}, andere)).status).toBe(429);
			await nachlauf.warteAufAlle();
		});
	});

	it('eine 90-kB-Adresse ist 200 wie jede ungueltige und landet nicht im Backoff-Schluessel', async () => {
		const fail = vi.spyOn(versuche, 'fail');
		// Knapp unter der Grenze von express.json (100 kB), sonst antwortete schon der Parser.
		const r = await verloren(verein, { email: `${'a'.repeat(90_000)}@example.test` });
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual(OK);
		const schluessel = fail.mock.calls.map(([k]) => k);
		expect(schluessel).toHaveLength(2);
		expect(Math.max(...schluessel.map((k) => k.length))).toBeLessThan(400);
		await nachlauf.warteAufAlle();
	});

	it('Gesperrter Verein ist 404', async () => {
		const r = await verloren(gesperrt, { email: 'egal@example.test' });
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
	});

	it('Adresse aus einem anderen Verein erzeugt dort nichts', async () => {
		const { email, personId } = await erwachsener(fremd);
		expect(await (await verloren(verein, { email })).json()).toEqual(OK);
		await nachlauf.warteAufAlle();
		expect(await offeneResets(personId)).toEqual([]);
		expect(await mails(email)).toEqual([]);
	});

	it('Link und Adresse stehen nie im Log', async () => {
		const spione = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(() => {}),
		);
		const { email } = await erwachsener();
		await verloren(verein, { email });
		await nachlauf.warteAufAlle();
		const [zeile] = await mails(email);
		const token = /einladung#(\S+)/.exec(zeile?.text ?? '')?.[1] ?? '';
		expect(token).not.toBe('');
		const alles = spione.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
		expect(alles).not.toContain(token);
		expect(alles).not.toContain(email);
	});
});
