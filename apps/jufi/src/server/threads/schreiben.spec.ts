import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import type { ModulEntwurf, ThreadBearbeitung, ThreadEntwurf } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sammleEreignisse } from '../echtzeit/test-bus.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { neuerSchluessel } from './schreiben.js';
import { legeThreadAn, ordneZu, type TestModul } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');
/** Donnerstag, 22.10.2026, 18:00 in Berlin: nach JETZT, Antworten sind also noch offen. */
const FRIST = new Date('2026-10-22T16:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };
const VERALTET = { fehler: 'Der Thread wurde inzwischen geändert. Bitte neu laden.', code: 'VERALTET' };

type Umfrage = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;
type Termin = Extract<ModulEntwurf, { typ: 'TERMIN' }>;

/** Die drei Module des Bowling-Threads aus Spec 1.1, wie legeThreadAn sie anlegt. */
const BOWLING_MODULE: TestModul[] = [
	{ typ: 'INFO', text: 'Wir treffen uns an der Bahn.' },
	{
		typ: 'TERMIN',
		termin: {
			startDatum: '2026-10-24',
			endDatum: null,
			beginn: '18:00',
			ende: '20:00',
			ort: 'Bowlingcenter',
			treffpunkt: null,
		},
	},
	{ typ: 'UMFRAGE', frage: 'Kommst du mit?', teilnahme: true, vielleicht: true, frist: FRIST },
];

describe('neuerSchluessel', () => {
	it('liefert "o" und acht Zeichen aus a-z0-9, jedes Mal einen anderen', () => {
		const schluessel = Array.from({ length: 50 }, () => neuerSchluessel());
		for (const s of schluessel) expect(s).toMatch(/^o[a-z0-9]{8}$/);
		expect(new Set(schluessel).size).toBe(50);
	});
});

describe('Threads anlegen und ersetzen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	const ereignisse = sammleEreignisse();

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => JETZT,
				bus: ereignisse.bus,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/**
	 * Ein Verein je Test: Thomas und Tina haben "Threads erstellen", Lars "Alle Threads
	 * bearbeiten", Sandra ist die Mutter von Lena und hat kein Recht. Lena ist in der
	 * Untergruppe Aal, Zander ist leer.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `schreiben-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) =>
			legeMitgliedAn(prisma, verein, { jetzt: JETZT, ...e });
		const thomas = await mitglied({ art: 'ERWACHSENER', vorname: 'Thomas', rechte: ['THREADS_ERSTELLEN'] });
		const tina = await mitglied({ art: 'ERWACHSENER', vorname: 'Tina', rechte: ['THREADS_ERSTELLEN'] });
		const lars = await mitglied({ art: 'ERWACHSENER', vorname: 'Lars', rechte: ['ALLE_THREADS'] });
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Mutter' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Mutter' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		const db = vereinDb(prisma, verein.id);
		const aal = await db.untergruppe.create({ data: { name: 'Aal' } });
		const zander = await db.untergruppe.create({ data: { name: 'Zander' } });
		await db.untergruppeMitglied.create({ data: { untergruppeId: aal.id, personId: lena.personId } });

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const lege = (entwurf: unknown, cookie: string) =>
			sende(server.url, api('/threads'), { methode: 'POST', body: { entwurf }, cookie });
		const ersetze = (id: string, version: unknown, entwurf: unknown, cookie: string) =>
			sende(server.url, api(`/threads/${id}`), { methode: 'PUT', body: { version, entwurf }, cookie });
		const bearbeitung = async (id: string, cookie: string) => {
			const r = await sende(server.url, api(`/threads/${id}/bearbeitung`), { cookie });
			expect(r.status).toBe(200);
			return (await r.json()) as ThreadBearbeitung;
		};
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		/** Die Arten der Aenderungen eines Standes, sortiert. */
		const arten = async (s: number) =>
			(await prisma.aenderung.findMany({ where: { vereinId: verein.id, stand: s }, select: { art: true } }))
				.map((a) => a.art)
				.sort();
		/** Systemeintraege eines Threads, aelteste zuerst. */
		const system = (threadId: string) =>
			prisma.verlaufEintrag.findMany({
				where: { threadId, art: 'SYSTEM' },
				orderBy: [{ stand: 'asc' }, { id: 'asc' }],
			});
		/** Alles, was ein abgelehntes PUT unveraendert lassen muss. */
		const zustand = async (threadId: string) => ({
			stand: await stand(),
			thread: await prisma.thread.findUniqueOrThrow({ where: { id: threadId } }),
			module: await prisma.threadModul.findMany({ where: { threadId }, orderBy: { id: 'asc' } }),
			optionen: await prisma.umfrageOption.findMany({
				where: { umfrage: { threadId } },
				orderBy: { id: 'asc' },
			}),
			untergruppen: await prisma.threadUntergruppe.findMany({ where: { threadId }, orderBy: { untergruppeId: 'asc' } }),
			verlauf: await prisma.verlaufEintrag.count({ where: { threadId } }),
		});
		/** Der Bowling-Entwurf aus Spec 1.1 fuer die Untergruppe Aal. */
		const bowling = (): ThreadEntwurf => ({
			titel: '🎳 Bowling',
			modus: 'KOMMENTARE',
			rollenfilter: 'JUNGFISCHER_FAMILIE',
			alleUntergruppen: false,
			untergruppenIds: [aal.id],
			module: [
				{ typ: 'INFO', id: null, titel: null, text: 'Wir treffen uns an der Bahn.' },
				{
					typ: 'TERMIN',
					id: null,
					titel: null,
					termin: {
						startDatum: '2026-10-24',
						endDatum: null,
						beginn: '18:00',
						ende: '20:00',
						ort: 'Bowlingcenter',
						treffpunkt: null,
					},
				},
				{
					typ: 'UMFRAGE',
					id: null,
					titel: null,
					frage: 'Kommst du mit?',
					einheit: 'JUNGFISCHER',
					mehrfach: false,
					teilnahme: true,
					vielleicht: true,
					frist: FRIST.toISOString(),
					ergebnisse: 'ALLE',
					optionen: [],
				},
			],
		});
		/** Ein Bowling-Thread von Thomas fuer Aal, direkt in der Datenbank; ohne Angabe veroeffentlicht. */
		const bowlingThread = (daten: Parameters<typeof legeThreadAn>[3] = {}) =>
			legeThreadAn(prisma, verein, JETZT, {
				titel: '🎳 Bowling',
				erstelltVonId: thomas.personId,
				untergruppenIds: [aal.id],
				module: BOWLING_MODULE,
				...daten,
			});
		const austausch = () =>
			prisma.thread.findFirstOrThrow({ where: { vereinId: verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' } });
		return {
			verein,
			db,
			thomas,
			tina,
			lars,
			sandra,
			lena,
			aal,
			zander,
			api,
			lege,
			ersetze,
			bearbeitung,
			stand,
			arten,
			system,
			zustand,
			bowling,
			bowlingThread,
			austausch,
			ereignisse: () => ereignisse.fuer(verein.id),
		};
	}

	describe('POST /threads', () => {
		it('legt den Bowling-Entwurf als Entwurf mit drei Modulen und den festen Teilnahme-Schluesseln an', async () => {
			const s = await szenario();
			const vorher = await s.stand();
			const r = await s.lege(s.bowling(), s.thomas.cookie);
			expect(r.status).toBe(201);
			const b = (await r.json()) as ThreadBearbeitung;
			const nachher = await s.stand();
			expect(nachher).toBe(vorher + 1);

			expect(b).toMatchObject({ art: 'NORMAL', veroeffentlicht: false, angepinnt: false, version: nachher });
			expect(b.entwurf.titel).toBe('🎳 Bowling');
			expect(b.entwurf.untergruppenIds).toEqual([s.aal.id]);
			expect(b.entwurf.module.map((m) => m.typ)).toEqual(['INFO', 'TERMIN', 'UMFRAGE']);
			expect(b.entwurf.module.every((m) => m.id !== null)).toBe(true);
			const umfrage = b.entwurf.module[2] as Umfrage;
			expect(umfrage.optionen).toEqual([
				{ schluessel: 'dabei', text: 'Dabei' },
				{ schluessel: 'vielleicht', text: 'Vielleicht' },
				{ schluessel: 'abgesagt', text: 'Abgesagt' },
			]);
			expect(umfrage.frist).toBe(FRIST.toISOString());

			const thread = await prisma.thread.findUniqueOrThrow({ where: { id: b.id } });
			expect(thread).toMatchObject({
				vereinId: s.verein.id,
				art: 'NORMAL',
				veroeffentlichtAm: null,
				erstelltVonId: s.thomas.personId,
				bearbeitetStand: nachher,
				alleUntergruppen: false,
			});
			const module = await prisma.threadModul.findMany({ where: { threadId: b.id }, orderBy: { position: 'asc' } });
			expect(module.map((m) => [m.typ, m.position])).toEqual([
				['INFO', 0],
				['TERMIN', 1],
				['UMFRAGE', 2],
			]);
			expect(await s.arten(nachher)).toEqual(['MODUL', 'MODUL', 'MODUL', 'THREAD']);
			// Der Entwurf hat noch keinen Verlauf: Systemeintraege gibt es erst nach dem Veroeffentlichen.
			expect(await prisma.verlaufEintrag.count({ where: { threadId: b.id } })).toBe(0);
		});

		it('legt neue freie Optionen mit Schluesseln vom Server an', async () => {
			const s = await szenario();
			const e = s.bowling();
			e.module[2] = {
				...(e.module[2] as Umfrage),
				teilnahme: false,
				frage: 'Pizza oder Pommes?',
				optionen: [
					{ schluessel: null, text: 'Pizza' },
					{ schluessel: null, text: 'Pommes' },
				],
			};
			const r = await s.lege(e, s.thomas.cookie);
			expect(r.status).toBe(201);
			const optionen = ((await r.json()) as ThreadBearbeitung).entwurf.module[2] as Umfrage;
			expect(optionen.optionen.map((o) => o.text)).toEqual(['Pizza', 'Pommes']);
			for (const o of optionen.optionen) expect(o.schluessel).toMatch(/^o[a-z0-9]{8}$/);
		});

		it('schreibt eine doppelt genannte Untergruppe nur einmal', async () => {
			const s = await szenario();
			const r = await s.lege({ ...s.bowling(), untergruppenIds: [s.aal.id, s.aal.id] }, s.thomas.cookie);
			expect(r.status).toBe(201);
			const b = (await r.json()) as ThreadBearbeitung;
			expect(await prisma.threadUntergruppe.count({ where: { threadId: b.id } })).toBe(1);
		});

		it('schreibt bei "alle Untergruppen" keine Untergruppen, auch wenn der Entwurf welche nennt', async () => {
			const s = await szenario();
			const r = await s.lege(
				{ ...s.bowling(), alleUntergruppen: true, untergruppenIds: ['gibt-es-nicht'] },
				s.thomas.cookie,
			);
			expect(r.status).toBe(201);
			const b = (await r.json()) as ThreadBearbeitung;
			expect(b.entwurf).toMatchObject({ alleUntergruppen: true, untergruppenIds: [] });
		});

		it('Lars mit "Alle Threads bearbeiten" darf anlegen', async () => {
			const s = await szenario();
			expect((await s.lege(s.bowling(), s.lars.cookie)).status).toBe(201);
		});

		it('ohne Erstellrecht 404, und es entsteht nichts', async () => {
			const s = await szenario();
			const vorher = await s.stand();
			const r = await s.lege(s.bowling(), s.sandra.cookie);
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.stand()).toBe(vorher);
			expect(await prisma.thread.count({ where: { vereinId: s.verein.id } })).toBe(1);
		});

		it('ohne Anmeldung 401', async () => {
			const s = await szenario();
			const r = await sende(server.url, s.api('/threads'), { methode: 'POST', body: { entwurf: s.bowling() } });
			expect(r.status).toBe(401);
		});

		it('antwortet auf eine kaputte Form mit 400 am Feld', async () => {
			const s = await szenario();
			const vorher = await s.stand();
			const r = await sende(server.url, s.api('/threads'), { methode: 'POST', body: {}, cookie: s.thomas.cookie });
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'titel' });
			const modus = await s.lege({ ...s.bowling(), modus: 'LAUT' }, s.thomas.cookie);
			expect(modus.status).toBe(400);
			expect(await modus.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'modus' });
			expect(await s.stand()).toBe(vorher);
		});

		it('antwortet auf einen ungueltigen Entwurf mit dem ersten Fehler und seinem Satz', async () => {
			const s = await szenario();
			const vorher = await s.stand();
			const r = await s.lege({ ...s.bowling(), titel: '' }, s.thomas.cookie);
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Bitte einen Titel eingeben.', feld: 'titel' });
			expect(await s.stand()).toBe(vorher);
		});

		it('nimmt keine Modul-ID an: ein neuer Thread hat noch keine Module', async () => {
			const s = await szenario();
			const fremd = await s.bowlingThread();
			const e = s.bowling();
			e.module[0] = { ...e.module[0], id: fremd.modulIds[0] } as ModulEntwurf;
			const vorher = await s.stand();
			const r = await s.lege(e, s.thomas.cookie);
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'module.0' });
			expect(await s.stand()).toBe(vorher);
		});

		it('weist Datei- und Foto-Module ab, solange es keine Tabellen dafuer gibt', async () => {
			const s = await szenario();
			const e = s.bowling();
			e.module.push({ typ: 'FOTOS', id: null, titel: null, hochladen: 'JUGENDLEITER' });
			const vorher = await s.stand();
			const r = await s.lege(e, s.thomas.cookie);
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'module.3.typ' });
			expect(await s.stand()).toBe(vorher);
		});

		it('meldet eine zweite Teilnahme-Umfrage als 409 DOPPELTE_TEILNAHME', async () => {
			const s = await szenario();
			const e = s.bowling();
			e.module.push({ ...(e.module[2] as Umfrage) });
			const vorher = await s.stand();
			const r = await s.lege(e, s.thomas.cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({
				fehler: 'Es gibt schon eine Teilnahme-Umfrage.',
				code: 'DOPPELTE_TEILNAHME',
				feld: 'module.3.teilnahme',
			});
			expect(await s.stand()).toBe(vorher);
		});
	});

	describe('Ereignisse auf dem Bus', () => {
		it('POST meldet genau ein Ereignis mit THREAD und je Modul MODUL, ohne Verlaufseintraege', async () => {
			const s = await szenario();

			const r = await s.lege(s.bowling(), s.thomas.cookie);

			expect(r.status).toBe(201);
			const stand = await s.stand();
			const geschrieben = await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } });
			expect(geschrieben.map((a) => a.art).sort()).toEqual(['MODUL', 'MODUL', 'MODUL', 'THREAD']);
			expect(s.ereignisse()).toEqual([
				{
					typ: 'aenderung',
					vereinId: s.verein.id,
					stand,
					aenderungen: geschrieben.map((a) => ({ threadId: a.threadId, art: a.art, objektId: a.objektId })),
					eintraege: [],
				},
			]);
		});

		it('PUT meldet genau ein Ereignis mit den Aenderungen des Speicherns', async () => {
			const s = await szenario();
			const t = await s.bowlingThread({ veroeffentlicht: false });
			const b = await s.bearbeitung(t.threadId, s.thomas.cookie);

			const r = await s.ersetze(t.threadId, b.version, { ...b.entwurf, titel: 'Kegeln' }, s.thomas.cookie);

			expect(r.status).toBe(200);
			const stand = await s.stand();
			expect(s.ereignisse()).toEqual([
				{
					typ: 'aenderung',
					vereinId: s.verein.id,
					stand,
					aenderungen: [{ threadId: t.threadId, art: 'THREAD', objektId: t.threadId }],
					eintraege: [],
				},
			]);
		});

		it('PUT mit alter Version (409), ohne Recht (404) und mit kaputtem Koerper (400) meldet nichts', async () => {
			const s = await szenario();
			const t = await s.bowlingThread({ veroeffentlicht: false });
			const b = await s.bearbeitung(t.threadId, s.thomas.cookie);

			expect((await s.ersetze(t.threadId, b.version - 1, s.bowling(), s.thomas.cookie)).status).toBe(409);
			expect((await s.ersetze(t.threadId, b.version, s.bowling(), s.sandra.cookie)).status).toBe(404);
			expect((await s.ersetze(t.threadId, 'x', s.bowling(), s.thomas.cookie)).status).toBe(400);
			expect((await s.lege(s.bowling(), s.sandra.cookie)).status).toBe(404);
			expect((await s.lege({}, s.thomas.cookie)).status).toBe(400);

			expect(s.ereignisse()).toEqual([]);
		});
	});

	describe('PUT /threads/:id', () => {
		it('aendert den Titel: neue Version, nur eine Aenderung THREAD', async () => {
			const s = await szenario();
			const t = await s.bowlingThread({ veroeffentlicht: false });
			const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
			const r = await s.ersetze(t.threadId, b.version, { ...b.entwurf, titel: 'Bowling am Samstag' }, s.thomas.cookie);
			expect(r.status).toBe(200);
			const neu = (await r.json()) as ThreadBearbeitung;
			const stand = await s.stand();
			expect(neu.version).toBe(stand);
			expect(neu.version).not.toBe(b.version);
			expect(neu.entwurf).toEqual({ ...b.entwurf, titel: 'Bowling am Samstag' });
			expect(await s.arten(stand)).toEqual(['THREAD']);
			expect(await prisma.thread.findUniqueOrThrow({ where: { id: t.threadId } })).toMatchObject({
				titel: 'Bowling am Samstag',
				bearbeitetStand: stand,
			});
		});

		it('zaehlt ein Speichern ohne Aenderung trotzdem als Speichern', async () => {
			const s = await szenario();
			const t = await s.bowlingThread();
			const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
			const r = await s.ersetze(t.threadId, b.version, b.entwurf, s.thomas.cookie);
			expect(r.status).toBe(200);
			const stand = await s.stand();
			expect(((await r.json()) as ThreadBearbeitung).version).toBe(stand);
			expect(await s.arten(stand)).toEqual(['THREAD']);
			expect(await s.system(t.threadId)).toEqual([]);
		});

		it('mit alter Version 409 VERALTET, nichts geaendert, Stand unveraendert', async () => {
			const s = await szenario();
			const t = await s.bowlingThread();
			const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
			// Ein zweites Geraet speichert zuerst.
			expect((await s.ersetze(t.threadId, b.version, { ...b.entwurf, titel: 'Zuerst' }, s.thomas.cookie)).status).toBe(
				200,
			);
			const vorher = await s.zustand(t.threadId);
			const r = await s.ersetze(t.threadId, b.version, { ...b.entwurf, titel: 'Danach' }, s.thomas.cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual(VERALTET);
			expect(await s.zustand(t.threadId)).toEqual(vorher);
		});

		it('eine Antwort macht den offenen Editor nicht veraltet', async () => {
			const s = await szenario();
			const t = await s.bowlingThread();
			const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
			const antwort = await sende(server.url, s.api(`/umfragen/${t.modulIds[2]}/antworten/${s.lena.personId}`), {
				methode: 'PUT',
				body: { optionIds: [t.optionIds['dabei']], clientId: randomUUID() },
				cookie: s.sandra.cookie,
			});
			expect(antwort.status).toBe(200);
			expect((await s.ersetze(t.threadId, b.version, { ...b.entwurf, titel: 'Neu' }, s.thomas.cookie)).status).toBe(
				200,
			);
		});

		it('antwortet auf eine kaputte Version oder Form mit 400 am Feld', async () => {
			const s = await szenario();
			const t = await s.bowlingThread();
			const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
			const vorher = await s.zustand(t.threadId);
			for (const version of [undefined, '3', 1.5, null]) {
				const r = await s.ersetze(t.threadId, version, b.entwurf, s.thomas.cookie);
				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'version' });
			}
			const r = await s.ersetze(t.threadId, b.version, { ...b.entwurf, module: {} }, s.thomas.cookie);
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'module' });
			expect(await s.zustand(t.threadId)).toEqual(vorher);
		});

		describe('Rechte', () => {
			it('Thomas mit nur "Threads erstellen" bekommt am Thread von Tina 404', async () => {
				const s = await szenario();
				const t = await s.bowlingThread({ erstelltVonId: s.tina.personId });
				const b = await s.bearbeitung(t.threadId, s.tina.cookie);
				const vorher = await s.zustand(t.threadId);
				const r = await s.ersetze(t.threadId, b.version, { ...b.entwurf, titel: 'Uebernommen' }, s.thomas.cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
				expect(await s.zustand(t.threadId)).toEqual(vorher);
			});

			it('Lars mit "Alle Threads bearbeiten" darf den Thread von Thomas aendern', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.lars.cookie);
				expect(
					(await s.ersetze(t.threadId, b.version, { ...b.entwurf, titel: 'Von Lars' }, s.lars.cookie)).status,
				).toBe(200);
			});

			it('Sandra ohne Recht und eine unbekannte ID bekommen 404', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				expect((await s.ersetze(t.threadId, b.version, b.entwurf, s.sandra.cookie)).status).toBe(404);
				const r = await s.ersetze('gibt-es-nicht', 0, b.entwurf, s.thomas.cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			});
		});

		describe('Systemeintraege', () => {
			it('veroeffentlicht: Termin verschoben ergibt TERMIN_GEAENDERT mit dem vollstaendigen Termin', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const e = structuredClone(b.entwurf);
				(e.module[1] as Termin).termin.startDatum = '2026-10-31';
				const r = await s.ersetze(t.threadId, b.version, e, s.thomas.cookie);
				expect(r.status).toBe(200);
				const stand = await s.stand();
				const [eintrag, ...rest] = await s.system(t.threadId);
				expect(rest).toEqual([]);
				expect(eintrag).toMatchObject({
					art: 'SYSTEM',
					systemArt: 'TERMIN_GEAENDERT',
					autorId: s.thomas.personId,
					text: null,
					stand,
					angelegtAm: JETZT,
				});
				expect(eintrag?.systemDaten).toEqual({
					termin: {
						modulId: t.modulIds[1],
						startDatum: '2026-10-31',
						endDatum: null,
						beginn: '18:00',
						ende: '20:00',
						ort: 'Bowlingcenter',
						treffpunkt: null,
					},
				});
				// endDatum steht ausgeschrieben da, es fehlt nicht.
				expect(Object.hasOwn((eintrag?.systemDaten as { termin: object }).termin, 'endDatum')).toBe(true);
				expect(await s.arten(stand)).toEqual(['MODUL', 'THREAD', 'VERLAUF']);
				expect(await prisma.terminModul.findUniqueOrThrow({ where: { id: t.modulIds[1] } })).toMatchObject({
					startDatum: new Date('2026-10-31T00:00:00.000Z'),
				});
			});

			it('veroeffentlicht: Frist und Modus geaendert ergeben FRIST_GEAENDERT und MODUS_GEAENDERT', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const e = structuredClone(b.entwurf);
				e.modus = 'CHAT';
				(e.module[2] as Umfrage).frist = '2026-10-23T16:00:00.000Z';
				const r = await s.ersetze(t.threadId, b.version, e, s.thomas.cookie);
				expect(r.status).toBe(200);
				const stand = await s.stand();
				// Beide Eintraege tragen denselben Stand; ihre Reihenfolge untereinander ist ohne Belang.
				const eintraege = (await s.system(t.threadId)).filter((x) => x.stand === stand);
				expect(eintraege.map((x) => [x.systemArt, x.systemDaten]).sort()).toEqual([
					['FRIST_GEAENDERT', { frage: 'Kommst du mit?', frist: '2026-10-23T16:00:00.000Z' }],
					['MODUS_GEAENDERT', { modus: 'CHAT' }],
				]);
				expect(await s.arten(stand)).toEqual(['MODUL', 'THREAD', 'VERLAUF', 'VERLAUF']);
				const umfrage = await prisma.umfrageModul.findUniqueOrThrow({ where: { id: t.modulIds[2] } });
				expect(umfrage.frist).toEqual(new Date('2026-10-23T16:00:00.000Z'));
			});

			it('im Entwurf dieselben Aenderungen ohne Verlaufseintrag', async () => {
				const s = await szenario();
				const t = await s.bowlingThread({ veroeffentlicht: false });
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const e = structuredClone(b.entwurf);
				e.modus = 'CHAT';
				(e.module[1] as Termin).termin.startDatum = '2026-10-31';
				(e.module[2] as Umfrage).frist = null;
				const r = await s.ersetze(t.threadId, b.version, e, s.thomas.cookie);
				expect(r.status).toBe(200);
				expect(await s.system(t.threadId)).toEqual([]);
				expect(await s.arten(await s.stand())).toEqual(['MODUL', 'MODUL', 'THREAD']);
				expect(((await r.json()) as ThreadBearbeitung).entwurf).toEqual(e);
			});

			it('veroeffentlicht: eine andere Untergruppe ergibt zusaetzlich SICHTBARKEIT und zaehlt als Aktivitaet', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const r = await s.ersetze(
					t.threadId,
					b.version,
					{ ...b.entwurf, untergruppenIds: [s.zander.id] },
					s.thomas.cookie,
				);
				expect(r.status).toBe(200);
				const stand = await s.stand();
				expect(await s.arten(stand)).toEqual(['SICHTBARKEIT', 'THREAD']);
				expect(await prisma.thread.findUniqueOrThrow({ where: { id: t.threadId } })).toMatchObject({
					letzteAktivitaetStand: stand,
				});
				expect(
					(await prisma.threadUntergruppe.findMany({ where: { threadId: t.threadId } })).map((g) => g.untergruppeId),
				).toEqual([s.zander.id]);
			});

			it('veroeffentlicht: ein anderer Rollenfilter allein ergibt SICHTBARKEIT', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const e = { ...b.entwurf, rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' as const };
				expect((await s.ersetze(t.threadId, b.version, e, s.thomas.cookie)).status).toBe(200);
				expect(await s.arten(await s.stand())).toEqual(['SICHTBARKEIT', 'THREAD']);
				expect(await prisma.thread.findUniqueOrThrow({ where: { id: t.threadId } })).toMatchObject({
					rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
				});
			});

			it('im Entwurf ist eine andere Zielgruppe keine SICHTBARKEIT', async () => {
				const s = await szenario();
				const t = await s.bowlingThread({ veroeffentlicht: false });
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const e = { ...b.entwurf, alleUntergruppen: true, untergruppenIds: [] };
				expect((await s.ersetze(t.threadId, b.version, e, s.thomas.cookie)).status).toBe(200);
				expect(await s.arten(await s.stand())).toEqual(['THREAD']);
				expect(await prisma.threadUntergruppe.count({ where: { threadId: t.threadId } })).toBe(0);
			});
		});

		describe('Module', () => {
			it('loescht, verschiebt und legt an in einem Schritt, je Modul eine Aenderung MODUL', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const [info, termin, umfrage] = b.entwurf.module as [ModulEntwurf, ModulEntwurf, ModulEntwurf];
				// Info weg, Umfrage nach vorn, neue Info ans Ende.
				const neueInfo: ModulEntwurf = { typ: 'INFO', id: null, titel: 'Wichtig', text: 'Schuhe mitbringen.' };
				const r = await s.ersetze(
					t.threadId,
					b.version,
					{ ...b.entwurf, module: [umfrage, termin, neueInfo] },
					s.thomas.cookie,
				);
				expect(r.status).toBe(200);
				const neu = (await r.json()) as ThreadBearbeitung;
				expect(neu.entwurf.module.map((m) => [m.typ, m.id])).toEqual([
					['UMFRAGE', umfrage.id],
					['TERMIN', termin.id],
					['INFO', expect.any(String)],
				]);
				expect(neu.entwurf.module[2]).toMatchObject({ titel: 'Wichtig', text: 'Schuhe mitbringen.' });
				expect(await prisma.threadModul.count({ where: { id: info.id ?? '' } })).toBe(0);
				expect(await prisma.infoModul.count({ where: { id: info.id ?? '' } })).toBe(0);
				// Geloescht, verschoben (Umfrage 2 -> 0) und angelegt; der Termin bleibt an Stelle 1.
				const stand = await s.stand();
				const aenderungen = await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand, art: 'MODUL' } });
				expect(aenderungen.map((a) => a.objektId).sort()).toEqual(
					[info.id, umfrage.id, neu.entwurf.module[2]?.id].sort(),
				);
			});

			it('tauscht die Teilnahme zwischen zwei Umfragen, ohne am Unique-Index zu scheitern', async () => {
				const s = await szenario();
				const t = await s.bowlingThread({
					module: [
						{ typ: 'UMFRAGE', frage: 'Kommst du mit?', teilnahme: true },
						{ typ: 'UMFRAGE', frage: 'Pizza?', optionen: ['Ja', 'Nein'] },
					],
				});
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const [a, z] = b.entwurf.module as [Umfrage, Umfrage];
				const e: ThreadEntwurf = {
					...b.entwurf,
					module: [
						{
							...a,
							teilnahme: false,
							optionen: [
								{ schluessel: 'dabei', text: 'Klar' },
								{ schluessel: null, text: 'Nö' },
							],
						},
						{ ...z, teilnahme: true, vielleicht: false, optionen: [] },
					],
				};
				const r = await s.ersetze(t.threadId, b.version, e, s.thomas.cookie);
				expect(r.status).toBe(200);
				const neu = ((await r.json()) as ThreadBearbeitung).entwurf.module as [Umfrage, Umfrage];
				expect(neu[0]).toMatchObject({ teilnahme: false });
				expect(neu[0].optionen[0]).toEqual({ schluessel: 'dabei', text: 'Klar' });
				expect(neu[0].optionen[1]?.schluessel).toMatch(/^o[a-z0-9]{8}$/);
				expect(neu[1]).toMatchObject({
					teilnahme: true,
					optionen: [
						{ schluessel: 'dabei', text: 'Dabei' },
						{ schluessel: 'abgesagt', text: 'Abgesagt' },
					],
				});
			});

			it('ersetzt eine geloeschte Teilnahme-Umfrage durch eine neue im selben Schritt', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const alt = b.entwurf.module[2] as Umfrage;
				const e: ThreadEntwurf = {
					...b.entwurf,
					module: [
						{ ...alt, id: null, frage: 'Kommst du zum Bowling?', optionen: [] },
						...b.entwurf.module.slice(0, 2),
					],
				};
				const r = await s.ersetze(t.threadId, b.version, e, s.thomas.cookie);
				expect(r.status).toBe(200);
				const neu = ((await r.json()) as ThreadBearbeitung).entwurf.module;
				expect(neu[0]).toMatchObject({ typ: 'UMFRAGE', teilnahme: true, frage: 'Kommst du zum Bowling?' });
				expect(neu[0]?.id).not.toBe(alt.id);
				expect(await prisma.umfrageModul.count({ where: { id: alt.id ?? '' } })).toBe(0);
			});

			it('vergibt einer neuen Option einen Schluessel; eine umbenannte behaelt Schluessel und Antworten', async () => {
				const s = await szenario();
				const t = await s.bowlingThread({
					module: [{ typ: 'UMFRAGE', frage: 'Pizza?', einheit: 'JUNGFISCHER', optionen: ['Ja', 'Nein'] }],
				});
				const antwort = await sende(server.url, s.api(`/umfragen/${t.modulIds[0]}/antworten/${s.lena.personId}`), {
					methode: 'PUT',
					body: { optionIds: [t.optionIds['ja']], clientId: randomUUID() },
					cookie: s.sandra.cookie,
				});
				expect(antwort.status).toBe(200);
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const u = b.entwurf.module[0] as Umfrage;
				const e: ThreadEntwurf = {
					...b.entwurf,
					module: [
						{
							...u,
							optionen: [
								{ schluessel: null, text: 'Vielleicht' },
								{ schluessel: 'ja', text: 'Ja, gern' },
								{ schluessel: 'nein', text: 'Nein' },
							],
						},
					],
				};
				const r = await s.ersetze(t.threadId, b.version, e, s.thomas.cookie);
				expect(r.status).toBe(200);
				const optionen = (((await r.json()) as ThreadBearbeitung).entwurf.module[0] as Umfrage).optionen;
				expect(optionen.map((o) => o.text)).toEqual(['Vielleicht', 'Ja, gern', 'Nein']);
				expect(optionen[0]?.schluessel).toMatch(/^o[a-z0-9]{8}$/);
				expect(optionen.slice(1).map((o) => o.schluessel)).toEqual(['ja', 'nein']);
				// Dieselbe Optionszeile wie vorher: die Antwort haengt weiter an ihr.
				const ja = await prisma.umfrageOption.findUniqueOrThrow({ where: { id: t.optionIds['ja'] } });
				expect(ja).toMatchObject({ text: 'Ja, gern', position: 1 });
				expect(await prisma.umfrageAntwortOption.count({ where: { optionId: ja.id } })).toBe(1);
			});
		});

		describe('Konflikte mit Antworten (Spec 3.14)', () => {
			it('Review Focus 1: "Vielleicht" entfernen, nachdem Sandra damit geantwortet hat, ergibt 409 BEANTWORTET', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				// Thomas oeffnet den Editor ...
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				// ... Sandra antwortet fuer Lena mit "Vielleicht" ...
				const antwort = await sende(server.url, s.api(`/umfragen/${t.modulIds[2]}/antworten/${s.lena.personId}`), {
					methode: 'PUT',
					body: { optionIds: [t.optionIds['vielleicht']], clientId: randomUUID() },
					cookie: s.sandra.cookie,
				});
				expect(antwort.status).toBe(200);
				// ... und Thomas speichert ohne "Vielleicht".
				const vorher = await s.zustand(t.threadId);
				const e = structuredClone(b.entwurf);
				(e.module[2] as Umfrage).vielleicht = false;
				const r = await s.ersetze(t.threadId, b.version, e, s.thomas.cookie);
				expect(r.status).toBe(409);
				expect(await r.json()).toEqual({
					fehler: 'Auf „Vielleicht“ hat schon jemand geantwortet.',
					code: 'BEANTWORTET',
					feld: 'module.2.optionen',
				});
				expect(await s.zustand(t.threadId)).toEqual(vorher);
			});

			it('Review Focus 4: eine Umfrage, deren einzige Antwort keine Option hat, laesst sich nicht entfernen', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				await s.db.umfrageAntwort.create({
					data: {
						umfrageId: t.modulIds[2] as string,
						fuerId: s.lena.personId,
						vonId: s.sandra.personId,
						abgegebenAm: JETZT,
						clientId: randomUUID(),
					},
				});
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const vorher = await s.zustand(t.threadId);
				const r = await s.ersetze(
					t.threadId,
					b.version,
					{ ...b.entwurf, module: b.entwurf.module.slice(0, 2) },
					s.thomas.cookie,
				);
				expect(r.status).toBe(409);
				expect(await r.json()).toEqual({
					fehler: 'Die Umfrage „Kommst du mit?“ hat schon Antworten und lässt sich nicht entfernen.',
					code: 'BEANTWORTET',
					feld: 'module',
				});
				expect(await s.zustand(t.threadId)).toEqual(vorher);
			});
		});

		describe('Review Focus 3: Ungueltiges direkt an die API', () => {
			it('antwortet je mit 400 am Feld und laesst Thread und Stand unveraendert', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const anderer = await s.bowlingThread({ titel: 'Anderer' });
				const fremderVerein = await legeVereinAn(prisma, { slug: `schreiben-fremd-${randomUUID().slice(0, 8)}` });
				const fremdeGruppe = await vereinDb(prisma, fremderVerein.id).untergruppe.create({ data: { name: 'Fremd' } });
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const mit = (aendere: (e: ThreadEntwurf) => void) => {
					const e = structuredClone(b.entwurf);
					aendere(e);
					return e;
				};
				const info = (i: number): ModulEntwurf => ({ typ: 'INFO', id: null, titel: null, text: `Text ${i}` });
				const faelle: [ThreadEntwurf, { fehler: string; feld: string }][] = [
					[
						mit((e) => ((e.module[1] as Termin).termin.startDatum = '2026-02-30')),
						{ fehler: 'Bitte ein gültiges Datum.', feld: 'module.1.termin' },
					],
					[
						mit((e) => e.module.push(...Array.from({ length: 18 }, (_, i) => info(i)))),
						{ fehler: 'Höchstens 20 Module.', feld: 'module' },
					],
					[
						mit((e) => (e.module[0] = { ...e.module[0], text: 'a'.repeat(10_001) } as ModulEntwurf)),
						{ fehler: 'Höchstens 10 000 Zeichen.', feld: 'module.0.text' },
					],
					[
						mit((e) => (e.untergruppenIds = [fremdeGruppe.id])),
						{ fehler: 'Diese Untergruppe gibt es nicht mehr.', feld: 'zielgruppe' },
					],
					[
						mit((e) => (e.module[0] = { ...e.module[0], id: anderer.modulIds[0] } as ModulEntwurf)),
						{ fehler: 'Ungültige Anfrage', feld: 'module.0' },
					],
				];
				const vorher = await s.zustand(t.threadId);
				for (const [entwurf, erwartet] of faelle) {
					const r = await s.ersetze(t.threadId, b.version, entwurf, s.thomas.cookie);
					expect(r.status).toBe(400);
					expect(await r.json()).toEqual(erwartet);
				}
				expect(await s.zustand(t.threadId)).toEqual(vorher);
				expect(await prisma.threadUntergruppe.count({ where: { untergruppeId: fremdeGruppe.id } })).toBe(0);
			});

			it('zwei Teilnahme-Umfragen ergeben 409 DOPPELTE_TEILNAHME', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const vorher = await s.zustand(t.threadId);
				const zweite = { ...(b.entwurf.module[2] as Umfrage), id: null };
				const r = await s.ersetze(
					t.threadId,
					b.version,
					{ ...b.entwurf, module: [...b.entwurf.module, zweite] },
					s.thomas.cookie,
				);
				expect(r.status).toBe(409);
				expect(await r.json()).toEqual({
					fehler: 'Es gibt schon eine Teilnahme-Umfrage.',
					code: 'DOPPELTE_TEILNAHME',
					feld: 'module.3.teilnahme',
				});
				expect(await s.zustand(t.threadId)).toEqual(vorher);
			});

			it('ein Eingabefehler geht einer doppelten Teilnahme vor, wie bei vergleicheEntwurf', async () => {
				const s = await szenario();
				const t = await s.bowlingThread();
				const b = await s.bearbeitung(t.threadId, s.thomas.cookie);
				const zweite = { ...(b.entwurf.module[2] as Umfrage), id: null };
				const leer: ModulEntwurf = { typ: 'INFO', id: null, titel: null, text: '' };
				const r = await s.ersetze(
					t.threadId,
					b.version,
					{ ...b.entwurf, module: [...b.entwurf.module, zweite, leer] },
					s.thomas.cookie,
				);
				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Bitte einen Text eingeben.', feld: 'module.4.text' });
			});
		});

		describe('Jugendsprecher-Austausch', () => {
			it('Lars aendert Titel und Modus', async () => {
				const s = await szenario();
				const a = await s.austausch();
				const b = await s.bearbeitung(a.id, s.lars.cookie);
				const r = await s.ersetze(
					a.id,
					b.version,
					{ ...b.entwurf, titel: 'Sprecherrunde', modus: 'KOMMENTARE' },
					s.lars.cookie,
				);
				expect(r.status).toBe(200);
				expect(await prisma.thread.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
					titel: 'Sprecherrunde',
					modus: 'KOMMENTARE',
					rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
				});
				expect((await s.system(a.id)).map((x) => x.systemArt)).toEqual(['MODUS_GEAENDERT']);
			});

			it('ein Modul oder eine andere Zielgruppe ergeben 409 AUSTAUSCH am Feld', async () => {
				const s = await szenario();
				const a = await s.austausch();
				const b = await s.bearbeitung(a.id, s.lars.cookie);
				const vorher = await s.zustand(a.id);
				const modul = await s.ersetze(
					a.id,
					b.version,
					{ ...b.entwurf, module: [{ typ: 'INFO', id: null, titel: null, text: 'Hallo' }] },
					s.lars.cookie,
				);
				expect(modul.status).toBe(409);
				expect(await modul.json()).toMatchObject({ code: 'AUSTAUSCH', feld: 'module' });
				const zielgruppe = await s.ersetze(
					a.id,
					b.version,
					{ ...b.entwurf, rollenfilter: 'JUNGFISCHER_FAMILIE' },
					s.lars.cookie,
				);
				expect(zielgruppe.status).toBe(409);
				expect(await zielgruppe.json()).toMatchObject({ code: 'AUSTAUSCH', feld: 'zielgruppe' });
				const untergruppen = await s.ersetze(
					a.id,
					b.version,
					{ ...b.entwurf, alleUntergruppen: false, untergruppenIds: [s.aal.id] },
					s.lars.cookie,
				);
				expect(untergruppen.status).toBe(409);
				expect(await untergruppen.json()).toMatchObject({ code: 'AUSTAUSCH', feld: 'zielgruppe' });
				expect(await s.zustand(a.id)).toEqual(vorher);
			});

			it('Thomas mit nur "Threads erstellen" bekommt 404', async () => {
				const s = await szenario();
				const a = await s.austausch();
				const b = await s.bearbeitung(a.id, s.lars.cookie);
				const r = await s.ersetze(a.id, b.version, { ...b.entwurf, titel: 'Uebernommen' }, s.thomas.cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			});
		});
	});
});
