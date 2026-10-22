import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import type { ThreadAnsicht, ThreadBearbeitung } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sammleEreignisse } from '../echtzeit/test-bus.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeThreadAn, ordneZu, trageEinTest, type TestModul } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');
/** Donnerstag, 22.10.2026, 18:00 in Berlin: nach JETZT, Antworten sind also noch offen. */
const FRIST = new Date('2026-10-22T16:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

const MODULE: TestModul[] = [
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

describe('Veroeffentlichen, Archiv, Anpinnen und Loeschen', () => {
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
		const verein = await legeVereinAn(prisma, { slug: `verwalten-${randomUUID().slice(0, 8)}` });
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
		await db.untergruppeMitglied.create({ data: { untergruppeId: aal.id, personId: lena.personId } });

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const veroeffentliche = (id: string, cookie: string) =>
			sende(server.url, api(`/threads/${id}/veroeffentlichen`), { methode: 'POST', cookie });
		const archiviere = (id: string, body: unknown, cookie: string) =>
			sende(server.url, api(`/threads/${id}/archiv`), { methode: 'PUT', body, cookie });
		const pinne = (id: string, body: unknown, cookie: string) =>
			sende(server.url, api(`/threads/${id}/angepinnt`), { methode: 'PUT', body, cookie });
		const loesche = (id: string, cookie: string) =>
			sende(server.url, api(`/threads/${id}`), { methode: 'DELETE', cookie });
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const aenderungen = (s: number) =>
			prisma.aenderung.findMany({ where: { vereinId: verein.id, stand: s }, orderBy: { art: 'asc' } });
		const arten = async (s: number) => (await aenderungen(s)).map((a) => a.art).sort();
		const zeile = (id: string) => prisma.thread.findUniqueOrThrow({ where: { id } });
		/** Ein Thread von Thomas fuer Aal mit den drei Modulen, direkt in der Datenbank; ohne Angabe veroeffentlicht. */
		const thread = (daten: Parameters<typeof legeThreadAn>[3] = {}) =>
			legeThreadAn(prisma, verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: thomas.personId,
				untergruppenIds: [aal.id],
				module: MODULE,
				...daten,
			});
		const austausch = () =>
			prisma.thread.findFirstOrThrow({ where: { vereinId: verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' } });
		const nachricht = (threadId: string, daten: { geloescht?: boolean } = {}) =>
			prisma.verlaufEintrag.create({
				data: {
					vereinId: verein.id,
					threadId,
					art: 'NACHRICHT',
					autorId: sandra.personId,
					text: daten.geloescht ? null : 'Hallo',
					geloeschtAm: daten.geloescht ? JETZT : null,
					geloeschtVonId: daten.geloescht ? sandra.personId : null,
					stand: 1,
					angelegtAm: JETZT,
				},
			});
		return {
			verein,
			db,
			thomas,
			tina,
			lars,
			sandra,
			lena,
			aal,
			api,
			veroeffentliche,
			archiviere,
			pinne,
			loesche,
			stand,
			aenderungen,
			arten,
			zeile,
			thread,
			austausch,
			nachricht,
			ereignisse: () => ereignisse.fuer(verein.id),
		};
	}

	describe('POST /threads/:id/veroeffentlichen', () => {
		it('setzt veroeffentlichtAm, schreibt den Systemeintrag mit dem Stand und meldet THREAD, SICHTBARKEIT, VERLAUF', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			const vorher = await s.stand();
			const r = await s.veroeffentliche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(200);
			const b = (await r.json()) as ThreadBearbeitung;
			const stand = await s.stand();
			expect(stand).toBe(vorher + 1);
			expect(b).toMatchObject({ id: t.threadId, veroeffentlicht: true });

			expect((await s.zeile(t.threadId)).veroeffentlichtAm).toEqual(JETZT);
			const eintraege = await prisma.verlaufEintrag.findMany({ where: { threadId: t.threadId } });
			expect(eintraege).toHaveLength(1);
			expect(eintraege[0]).toMatchObject({
				art: 'SYSTEM',
				systemArt: 'VEROEFFENTLICHT',
				systemDaten: {},
				autorId: s.thomas.personId,
				stand,
				angelegtAm: JETZT,
			});
			expect(await s.arten(stand)).toEqual(['SICHTBARKEIT', 'THREAD', 'VERLAUF']);
			const verlauf = (await s.aenderungen(stand)).find((a) => a.art === 'VERLAUF');
			expect(verlauf?.objektId).toBe(eintraege[0]?.id);
			// Die Veroeffentlichung ist Aktivitaet: Der Thread ist fuer die Zielgruppe erst jetzt da.
			expect((await s.zeile(t.threadId)).letzteAktivitaetStand).toBe(stand);
		});

		it('danach sieht Sandra den Thread, und der Systemeintrag zaehlt nicht als Nachricht', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			const vorher = await sende(server.url, s.api(`/threads/${t.threadId}`), { cookie: s.sandra.cookie });
			expect(vorher.status).toBe(404);
			expect((await s.veroeffentliche(t.threadId, s.thomas.cookie)).status).toBe(200);
			const r = await sende(server.url, s.api(`/threads/${t.threadId}`), { cookie: s.sandra.cookie });
			expect(r.status).toBe(200);
			const ansicht = (await r.json()) as ThreadAnsicht;
			expect(ansicht.entwurf).toBe(false);
			expect(ansicht.verlauf.eintraege).toBe(0);
		});

		it('ein zweites Mal ist eine Wiederholung: 200, kein neuer Stand, kein zweiter Eintrag', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			expect((await s.veroeffentliche(t.threadId, s.thomas.cookie)).status).toBe(200);
			const stand = await s.stand();
			const r = await s.veroeffentliche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(200);
			expect(((await r.json()) as ThreadBearbeitung).veroeffentlicht).toBe(true);
			expect(await s.stand()).toBe(stand);
			expect(await prisma.verlaufEintrag.count({ where: { threadId: t.threadId } })).toBe(1);
			expect((await s.zeile(t.threadId)).veroeffentlichtAm).toEqual(JETZT);
		});

		it('ein schon veroeffentlichter Thread bleibt unveraendert', async () => {
			const s = await szenario();
			const t = await s.thread();
			const vorher = await s.stand();
			expect((await s.veroeffentliche(t.threadId, s.thomas.cookie)).status).toBe(200);
			expect(await s.stand()).toBe(vorher);
			expect(await prisma.verlaufEintrag.count({ where: { threadId: t.threadId } })).toBe(0);
		});

		it('ohne verbliebene Untergruppe 409 KEINE_ZIELGRUPPE am Feld zielgruppe, nichts geschrieben', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			// Die letzte gewaehlte Untergruppe wird geloescht: die Verknuepfung verschwindet mit ihr.
			await prisma.untergruppe.delete({ where: { id: s.aal.id } });
			const vorher = await s.stand();
			const r = await s.veroeffentliche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({
				fehler: 'Der Thread hat keine Zielgruppe mehr. Bitte zuerst eine Untergruppe wählen.',
				code: 'KEINE_ZIELGRUPPE',
				feld: 'zielgruppe',
			});
			expect(await s.stand()).toBe(vorher);
			expect((await s.zeile(t.threadId)).veroeffentlichtAm).toBeNull();
			expect(await prisma.verlaufEintrag.count({ where: { threadId: t.threadId } })).toBe(0);
		});

		it('Lars mit "Alle Threads bearbeiten" darf den Entwurf von Thomas veroeffentlichen', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			expect((await s.veroeffentliche(t.threadId, s.lars.cookie)).status).toBe(200);
		});

		it('wer nicht bearbeiten darf, und eine unbekannte ID bekommen 404, nichts geschrieben', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			const vorher = await s.stand();
			for (const cookie of [s.sandra.cookie, s.tina.cookie]) {
				const r = await s.veroeffentliche(t.threadId, cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
			const unbekannt = await s.veroeffentliche('gibt-es-nicht', s.thomas.cookie);
			expect(unbekannt.status).toBe(404);
			expect(await unbekannt.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.stand()).toBe(vorher);
			expect((await s.zeile(t.threadId)).veroeffentlichtAm).toBeNull();
		});

		it('ohne Anmeldung 401', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			const r = await sende(server.url, s.api(`/threads/${t.threadId}/veroeffentlichen`), { methode: 'POST' });
			expect(r.status).toBe(401);
		});
	});

	describe('PUT /threads/:id/archiv', () => {
		it('archiviert: ARCHIVIERT, eine Aenderung LISTE, letzte Aktivitaet unveraendert', async () => {
			const s = await szenario();
			const t = await s.thread();
			const vorher = await s.zeile(t.threadId);
			const stand0 = await s.stand();
			const r = await s.archiviere(t.threadId, { archiviert: true }, s.thomas.cookie);
			expect(r.status).toBe(200);
			expect(await r.json()).toMatchObject({ id: t.threadId, archiviert: true });
			const stand = await s.stand();
			expect(stand).toBe(stand0 + 1);
			const nachher = await s.zeile(t.threadId);
			expect(nachher.archivModus).toBe('ARCHIVIERT');
			expect(nachher.letzteAktivitaetStand).toBe(vorher.letzteAktivitaetStand);
			expect(nachher.letzteAktivitaetAm).toEqual(vorher.letzteAktivitaetAm);
			expect(nachher.bearbeitetStand).toBe(vorher.bearbeitetStand);
			expect(await s.arten(stand)).toEqual(['LISTE']);
		});

		it('stellt wieder her: AKTIV_HALTEN', async () => {
			const s = await szenario();
			const t = await s.thread({ archivModus: 'ARCHIVIERT' });
			const stand0 = await s.stand();
			const r = await s.archiviere(t.threadId, { archiviert: false }, s.thomas.cookie);
			expect(r.status).toBe(200);
			expect(await r.json()).toMatchObject({ archiviert: false });
			expect((await s.zeile(t.threadId)).archivModus).toBe('AKTIV_HALTEN');
			expect(await s.arten(stand0 + 1)).toEqual(['LISTE']);
		});

		it('ein Thread, den die Datumsregel archiviert hat, laesst sich zurueckholen', async () => {
			const s = await szenario();
			// Der letzte Termin lag am 01.10.2026, die Karenz von sieben Tagen ist am 22.10. um.
			const t = await s.thread({
				module: [
					{
						typ: 'TERMIN',
						termin: {
							startDatum: '2026-10-01',
							endDatum: null,
							beginn: '18:00',
							ende: null,
							ort: null,
							treffpunkt: null,
						},
					},
				],
			});
			const b = await s.archiviere(t.threadId, { archiviert: true }, s.thomas.cookie);
			// Schon archiviert (Datumsregel): Wiederholung, kein Stand, AUTOMATISCH bleibt.
			expect(((await b.json()) as ThreadBearbeitung).archiviert).toBe(true);
			expect((await s.zeile(t.threadId)).archivModus).toBe('AUTOMATISCH');
			const stand = await s.stand();
			const r = await s.archiviere(t.threadId, { archiviert: false }, s.thomas.cookie);
			expect(r.status).toBe(200);
			expect(((await r.json()) as ThreadBearbeitung).archiviert).toBe(false);
			expect((await s.zeile(t.threadId)).archivModus).toBe('AKTIV_HALTEN');
			expect(await s.stand()).toBe(stand + 1);
		});

		it('der gewuenschte Zustand ist schon da: 200 ohne neuen Stand und ohne Aenderung', async () => {
			const s = await szenario();
			const t = await s.thread();
			// Nicht archiviert: "false" aendert nichts, auch nicht den Modus AUTOMATISCH.
			const stand = await s.stand();
			const r = await s.archiviere(t.threadId, { archiviert: false }, s.thomas.cookie);
			expect(r.status).toBe(200);
			expect(await r.json()).toMatchObject({ archiviert: false });
			expect(await s.stand()).toBe(stand);
			expect((await s.zeile(t.threadId)).archivModus).toBe('AUTOMATISCH');

			expect((await s.archiviere(t.threadId, { archiviert: true }, s.thomas.cookie)).status).toBe(200);
			const nachArchiv = await s.stand();
			const zweites = await s.archiviere(t.threadId, { archiviert: true }, s.thomas.cookie);
			expect(zweites.status).toBe(200);
			expect(await zweites.json()).toMatchObject({ archiviert: true });
			expect(await s.stand()).toBe(nachArchiv);
			expect(await prisma.aenderung.count({ where: { vereinId: s.verein.id, art: 'LISTE' } })).toBe(1);
		});

		it('ein Koerper ohne boolesches archiviert ergibt 400 am Feld, nichts geschrieben', async () => {
			const s = await szenario();
			const t = await s.thread();
			const stand = await s.stand();
			for (const body of [{ archiviert: 'ja' }, { archiviert: 1 }, { archiviert: null }, {}]) {
				const r = await s.archiviere(t.threadId, body, s.thomas.cookie);
				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'archiviert' });
			}
			expect(await s.stand()).toBe(stand);
			expect((await s.zeile(t.threadId)).archivModus).toBe('AUTOMATISCH');
		});

		it('am Austausch 409 AUSTAUSCH ohne Feld, auch fuer Lars', async () => {
			const s = await szenario();
			const a = await s.austausch();
			const stand = await s.stand();
			const r = await s.archiviere(a.id, { archiviert: true }, s.lars.cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({
				fehler: 'Am Jugendsprecher-Austausch lassen sich nur Titel, Modus und Anpinnen ändern.',
				code: 'AUSTAUSCH',
			});
			expect(await s.stand()).toBe(stand);
			expect((await s.zeile(a.id)).archivModus).toBe('AUTOMATISCH');
		});

		it('wer nicht bearbeiten darf, und eine unbekannte ID bekommen 404', async () => {
			const s = await szenario();
			const t = await s.thread();
			const stand = await s.stand();
			for (const cookie of [s.sandra.cookie, s.tina.cookie]) {
				const r = await s.archiviere(t.threadId, { archiviert: true }, cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
			expect((await s.archiviere('gibt-es-nicht', { archiviert: true }, s.thomas.cookie)).status).toBe(404);
			// Auch am Austausch: Wer ihn nicht bearbeiten darf, erfaehrt nichts von AUSTAUSCH.
			const a = await s.austausch();
			expect((await s.archiviere(a.id, { archiviert: true }, s.thomas.cookie)).status).toBe(404);
			expect(await s.stand()).toBe(stand);
			expect((await s.zeile(t.threadId)).archivModus).toBe('AUTOMATISCH');
		});
	});

	describe('PUT /threads/:id/angepinnt', () => {
		it('pinnt an und loest wieder: je eine Aenderung LISTE, letzte Aktivitaet unveraendert', async () => {
			const s = await szenario();
			const t = await s.thread();
			const vorher = await s.zeile(t.threadId);
			const stand0 = await s.stand();
			const r = await s.pinne(t.threadId, { angepinnt: true }, s.thomas.cookie);
			expect(r.status).toBe(200);
			expect(await r.json()).toMatchObject({ id: t.threadId, angepinnt: true });
			expect(await s.arten(stand0 + 1)).toEqual(['LISTE']);
			const gepinnt = await s.zeile(t.threadId);
			expect(gepinnt.angepinnt).toBe(true);
			expect(gepinnt.letzteAktivitaetStand).toBe(vorher.letzteAktivitaetStand);

			const l = await s.pinne(t.threadId, { angepinnt: false }, s.thomas.cookie);
			expect(l.status).toBe(200);
			expect(await l.json()).toMatchObject({ angepinnt: false });
			expect(await s.arten(stand0 + 2)).toEqual(['LISTE']);
			expect((await s.zeile(t.threadId)).angepinnt).toBe(false);
		});

		it('der gewuenschte Zustand ist schon da: 200 ohne neuen Stand', async () => {
			const s = await szenario();
			const t = await s.thread();
			const stand = await s.stand();
			const r = await s.pinne(t.threadId, { angepinnt: false }, s.thomas.cookie);
			expect(r.status).toBe(200);
			expect(await s.stand()).toBe(stand);
			expect((await s.pinne(t.threadId, { angepinnt: true }, s.thomas.cookie)).status).toBe(200);
			const nachPin = await s.stand();
			expect((await s.pinne(t.threadId, { angepinnt: true }, s.thomas.cookie)).status).toBe(200);
			expect(await s.stand()).toBe(nachPin);
		});

		it('ein Koerper ohne boolesches angepinnt ergibt 400 am Feld', async () => {
			const s = await szenario();
			const t = await s.thread();
			const stand = await s.stand();
			for (const body of [{ angepinnt: 'ja' }, { angepinnt: 0 }, { angepinnt: null }, {}]) {
				const r = await s.pinne(t.threadId, body, s.thomas.cookie);
				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'angepinnt' });
			}
			expect(await s.stand()).toBe(stand);
		});

		it('am Austausch darf Lars mit "Alle Threads bearbeiten" anpinnen und loesen, Thomas bekommt 404', async () => {
			const s = await szenario();
			// legeVereinAn legt den Austausch angepinnt an: erst loesen, dann wieder anpinnen.
			const a = await s.austausch();
			expect(a.angepinnt).toBe(true);
			const stand = await s.stand();
			expect((await s.pinne(a.id, { angepinnt: false }, s.thomas.cookie)).status).toBe(404);
			expect(await s.stand()).toBe(stand);

			const geloest = await s.pinne(a.id, { angepinnt: false }, s.lars.cookie);
			expect(geloest.status).toBe(200);
			expect(await geloest.json()).toMatchObject({ art: 'JUGENDSPRECHER_AUSTAUSCH', angepinnt: false });
			expect(await s.arten(stand + 1)).toEqual(['LISTE']);
			const r = await s.pinne(a.id, { angepinnt: true }, s.lars.cookie);
			expect(r.status).toBe(200);
			expect(await r.json()).toMatchObject({ angepinnt: true });
			expect(await s.arten(stand + 2)).toEqual(['LISTE']);
			expect((await s.zeile(a.id)).angepinnt).toBe(true);
		});

		it('wer nicht bearbeiten darf, und eine unbekannte ID bekommen 404', async () => {
			const s = await szenario();
			const t = await s.thread();
			const stand = await s.stand();
			for (const cookie of [s.sandra.cookie, s.tina.cookie]) {
				const r = await s.pinne(t.threadId, { angepinnt: true }, cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
			expect((await s.pinne('gibt-es-nicht', { angepinnt: true }, s.thomas.cookie)).status).toBe(404);
			expect(await s.stand()).toBe(stand);
			expect((await s.zeile(t.threadId)).angepinnt).toBe(false);
		});
	});

	describe('DELETE /threads/:id', () => {
		it('loescht einen Entwurf samt Modulen und Systemeintraegen: 204, eine Aenderung GELOESCHT mit threadId', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			await prisma.verlaufEintrag.create({
				data: {
					vereinId: s.verein.id,
					threadId: t.threadId,
					art: 'SYSTEM',
					autorId: s.thomas.personId,
					systemArt: 'VEROEFFENTLICHT',
					systemDaten: {},
					stand: 1,
				},
			});
			const stand0 = await s.stand();
			const r = await s.loesche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(204);
			const stand = await s.stand();
			expect(stand).toBe(stand0 + 1);

			expect(await prisma.thread.count({ where: { id: t.threadId } })).toBe(0);
			expect(await prisma.threadModul.count({ where: { threadId: t.threadId } })).toBe(0);
			expect(await prisma.umfrageModul.count({ where: { threadId: t.threadId } })).toBe(0);
			expect(await prisma.verlaufEintrag.count({ where: { threadId: t.threadId } })).toBe(0);
			expect(await prisma.threadUntergruppe.count({ where: { threadId: t.threadId } })).toBe(0);
			const a = await s.aenderungen(stand);
			expect(a).toHaveLength(1);
			expect(a[0]).toMatchObject({ art: 'GELOESCHT', threadId: t.threadId, objektId: t.threadId });
		});

		it('loescht einen Thread mit 2 Dateien und 3 Fotos: 204, keine Zeilen mehr, 2 + 6 Schluessel auf der Loeschliste', async () => {
			const s = await szenario();
			const t = await s.thread({
				module: [...MODULE, { typ: 'DATEIEN', dateien: [{}, {}] }, { typ: 'FOTOS', fotos: [{}, {}, {}] }],
			});
			expect(t.dateiIds).toHaveLength(5);
			const r = await s.loesche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(204);
			expect(await prisma.thread.count({ where: { id: t.threadId } })).toBe(0);
			expect(await prisma.datei.count({ where: { id: { in: t.dateiIds } } })).toBe(0);
			const dateien = t.dateiIds.slice(0, 2).map((id) => `${s.verein.id}/${id}`);
			const fotos = t.dateiIds.slice(2).flatMap((id) => [`${s.verein.id}/${id}`, `${s.verein.id}/${id}.vorschau`]);
			const liste = await prisma.dateiLoeschung.findMany({ where: { vereinId: s.verein.id } });
			expect(liste).toHaveLength(8);
			expect(liste.map((l) => l.schluessel).sort()).toEqual([...dateien, ...fotos].sort());
		});

		it('ein weiteres DELETE desselben Threads ist 404', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			expect((await s.loesche(t.threadId, s.thomas.cookie)).status).toBe(204);
			const stand = await s.stand();
			const r = await s.loesche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.stand()).toBe(stand);
		});

		it('mit einer leeren Antwort 409 NICHT_LOESCHBAR, nichts geschrieben', async () => {
			const s = await szenario();
			const t = await s.thread();
			await prisma.umfrageAntwort.create({
				data: {
					vereinId: s.verein.id,
					umfrageId: t.modulIds[2] as string,
					fuerId: s.lena.personId,
					vonId: s.sandra.personId,
					abgegebenAm: JETZT,
					clientId: randomUUID(),
				},
			});
			const stand = await s.stand();
			const r = await s.loesche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({
				fehler: 'Der Thread hat Antworten oder Nachrichten und lässt sich nicht löschen. Archiviere ihn stattdessen.',
				code: 'NICHT_LOESCHBAR',
			});
			expect(await s.stand()).toBe(stand);
			expect(await prisma.thread.count({ where: { id: t.threadId } })).toBe(1);
		});

		it('mit einem Helfer-Eintrag 409 NICHT_LOESCHBAR, nichts geschrieben (Review Focus 3)', async () => {
			const s = await szenario();
			const t = await s.thread({ module: [{ typ: 'HELFER', positionen: [{ text: 'Kuchen', anzahl: 4 }] }] });
			await trageEinTest(s.db, t.positionIds['kuchen'] as string, s.sandra.personId, s.sandra.personId);
			const stand = await s.stand();
			const r = await s.loesche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({
				fehler: 'Der Thread hat Antworten oder Nachrichten und lässt sich nicht löschen. Archiviere ihn stattdessen.',
				code: 'NICHT_LOESCHBAR',
			});
			expect(await s.stand()).toBe(stand);
			expect(await prisma.thread.count({ where: { id: t.threadId } })).toBe(1);
			expect(await prisma.helferEintrag.count({ where: { positionId: t.positionIds['kuchen'] } })).toBe(1);
		});

		it('mit einer leeren Helferliste 204, Liste und Positionen gehen mit', async () => {
			const s = await szenario();
			const t = await s.thread({ module: [{ typ: 'HELFER', positionen: [{ text: 'Kuchen', anzahl: 4 }] }] });
			const r = await s.loesche(t.threadId, s.thomas.cookie);
			expect(r.status).toBe(204);
			expect(await prisma.helferModul.count({ where: { id: t.modulIds[0] } })).toBe(0);
			expect(await prisma.helferPosition.count({ where: { id: t.positionIds['kuchen'] } })).toBe(0);
		});

		it('mit einer Nachricht 409, mit nur einer geloeschten Nachricht 204', async () => {
			const s = await szenario();
			const mit = await s.thread();
			await s.nachricht(mit.threadId);
			const r = await s.loesche(mit.threadId, s.thomas.cookie);
			expect(r.status).toBe(409);
			expect(((await r.json()) as { code: string }).code).toBe('NICHT_LOESCHBAR');

			const nurGeloescht = await s.thread();
			await s.nachricht(nurGeloescht.threadId, { geloescht: true });
			expect((await s.loesche(nurGeloescht.threadId, s.thomas.cookie)).status).toBe(204);
			expect(await prisma.thread.count({ where: { id: nurGeloescht.threadId } })).toBe(0);
		});

		it('eine Nachricht, die nach der Vorpruefung entsteht, verhindert das Loeschen (Zaehlung unter der Sperre)', async () => {
			const s = await szenario();
			const t = await s.thread();
			let loeschen: Promise<Response> | undefined;
			// Eine fremde Transaktion haelt die Vereinszeile: DELETE besteht seine Vorpruefung und
			// wartet dann in mitAenderung. Die Nachricht entsteht erst jetzt, vor dem Commit, und
			// nur eine Zaehlung nach der Sperre sieht sie.
			await prisma.$transaction(async (tx) => {
				await tx.verein.update({
					where: { id: s.verein.id },
					data: { aenderungsstand: { increment: 1 } },
				});
				loeschen = s.loesche(t.threadId, s.thomas.cookie);
				await new Promise((weiter) => setTimeout(weiter, 400));
				await tx.verlaufEintrag.create({
					data: {
						vereinId: s.verein.id,
						threadId: t.threadId,
						art: 'NACHRICHT',
						autorId: s.sandra.personId,
						text: 'Zu spaet',
						stand: 1,
						angelegtAm: JETZT,
					},
				});
			});
			const r = await loeschen;
			expect(r?.status).toBe(409);
			expect(await prisma.thread.count({ where: { id: t.threadId } })).toBe(1);
		});

		it('am Austausch 409 AUSTAUSCH ohne Feld, auch fuer Lars', async () => {
			const s = await szenario();
			const a = await s.austausch();
			const r = await s.loesche(a.id, s.lars.cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({
				fehler: 'Am Jugendsprecher-Austausch lassen sich nur Titel, Modus und Anpinnen ändern.',
				code: 'AUSTAUSCH',
			});
			expect(await prisma.thread.count({ where: { id: a.id } })).toBe(1);
		});

		it('wer nur liest (Familie), wer nicht bearbeiten darf und eine unbekannte ID bekommen 404', async () => {
			const s = await szenario();
			const t = await s.thread();
			const stand = await s.stand();
			for (const cookie of [s.sandra.cookie, s.tina.cookie]) {
				const r = await s.loesche(t.threadId, cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
			expect((await s.loesche('gibt-es-nicht', s.thomas.cookie)).status).toBe(404);
			expect(await s.stand()).toBe(stand);
			expect(await prisma.thread.count({ where: { id: t.threadId } })).toBe(1);
		});

		it('Lars darf den Thread von Thomas loeschen', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });
			expect((await s.loesche(t.threadId, s.lars.cookie)).status).toBe(204);
		});
	});

	describe('Ereignisse auf dem Bus', () => {
		type Aend = { threadId: string | null; art: string; objektId: string };
		const nachSchluessel = (a: Aend, b: Aend) => `${a.art}${a.objektId}`.localeCompare(`${b.art}${b.objektId}`);
		/**
		 * Das eine erwartete Ereignis: Stand und Aenderungen wie in der Datenbank, keine Verlaufseintraege.
		 * Die Reihenfolge der Aenderungen ist nicht zugesichert (die Datenbank sortiert Arten nach der
		 * Enum-Reihenfolge), darum werden beide Seiten sortiert.
		 */
		const aenderungEreignis = async (s: Awaited<ReturnType<typeof szenario>>) => {
			const stand = await s.stand();
			const geschrieben = await s.aenderungen(stand);
			return {
				typ: 'aenderung',
				vereinId: s.verein.id,
				stand,
				aenderungen: geschrieben
					.map((a) => ({ threadId: a.threadId, art: a.art, objektId: a.objektId }))
					.sort(nachSchluessel),
				eintraege: [],
			};
		};
		const gemeldet = (s: Awaited<ReturnType<typeof szenario>>) =>
			s
				.ereignisse()
				.map((e) => (e.typ === 'aenderung' ? { ...e, aenderungen: [...e.aenderungen].sort(nachSchluessel) } : e));

		it('Veroeffentlichen meldet THREAD, SICHTBARKEIT und VERLAUF; ein zweites Mal nichts', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false });

			expect((await s.veroeffentliche(t.threadId, s.thomas.cookie)).status).toBe(200);
			expect((await s.veroeffentliche(t.threadId, s.thomas.cookie)).status).toBe(200);

			const erwartet = await aenderungEreignis(s);
			expect(erwartet.aenderungen.map((a) => a.art).sort()).toEqual(['SICHTBARKEIT', 'THREAD', 'VERLAUF']);
			expect(gemeldet(s)).toEqual([erwartet]);
		});

		it('Veroeffentlichen ohne Zielgruppe (409) und ohne Recht (404) meldet nichts', async () => {
			const s = await szenario();
			const t = await s.thread({ veroeffentlicht: false, untergruppenIds: [] });

			expect((await s.veroeffentliche(t.threadId, s.thomas.cookie)).status).toBe(409);
			expect((await s.veroeffentliche(t.threadId, s.sandra.cookie)).status).toBe(404);

			expect(s.ereignisse()).toEqual([]);
		});

		it('Archiv meldet LISTE; derselbe Wunsch noch einmal nichts', async () => {
			const s = await szenario();
			const t = await s.thread();

			expect((await s.archiviere(t.threadId, { archiviert: true }, s.thomas.cookie)).status).toBe(200);
			expect((await s.archiviere(t.threadId, { archiviert: true }, s.thomas.cookie)).status).toBe(200);

			const erwartet = await aenderungEreignis(s);
			expect(erwartet.aenderungen).toEqual([{ threadId: t.threadId, art: 'LISTE', objektId: t.threadId }]);
			expect(gemeldet(s)).toEqual([erwartet]);
		});

		it('Anpinnen meldet LISTE; der Doppelklick nichts', async () => {
			const s = await szenario();
			const t = await s.thread();

			expect((await s.pinne(t.threadId, { angepinnt: true }, s.thomas.cookie)).status).toBe(200);
			expect((await s.pinne(t.threadId, { angepinnt: true }, s.thomas.cookie)).status).toBe(200);

			const erwartet = await aenderungEreignis(s);
			expect(erwartet.aenderungen).toEqual([{ threadId: t.threadId, art: 'LISTE', objektId: t.threadId }]);
			expect(gemeldet(s)).toEqual([erwartet]);
		});

		it('Archiv und Anpinnen mit kaputtem Koerper (400) oder ohne Recht (404) melden nichts', async () => {
			const s = await szenario();
			const t = await s.thread();

			expect((await s.archiviere(t.threadId, {}, s.thomas.cookie)).status).toBe(400);
			expect((await s.pinne(t.threadId, {}, s.thomas.cookie)).status).toBe(400);
			expect((await s.archiviere(t.threadId, { archiviert: true }, s.sandra.cookie)).status).toBe(404);
			expect((await s.pinne(t.threadId, { angepinnt: true }, s.tina.cookie)).status).toBe(404);

			expect(s.ereignisse()).toEqual([]);
		});

		it('Loeschen meldet GELOESCHT mit der ID des Threads; ein zweites Loeschen ist 404 und meldet nichts', async () => {
			const s = await szenario();
			const t = await s.thread();

			expect((await s.loesche(t.threadId, s.thomas.cookie)).status).toBe(204);
			expect((await s.loesche(t.threadId, s.thomas.cookie)).status).toBe(404);

			const erwartet = await aenderungEreignis(s);
			expect(erwartet.aenderungen).toEqual([{ threadId: t.threadId, art: 'GELOESCHT', objektId: t.threadId }]);
			expect(gemeldet(s)).toEqual([erwartet]);
		});

		it('Loeschen mit Nachricht (409) meldet nichts', async () => {
			const s = await szenario();
			const t = await s.thread();
			await s.nachricht(t.threadId);

			expect((await s.loesche(t.threadId, s.thomas.cookie)).status).toBe(409);

			expect(s.ereignisse()).toEqual([]);
		});
	});
});
