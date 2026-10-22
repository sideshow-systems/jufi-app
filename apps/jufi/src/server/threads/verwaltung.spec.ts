import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import {
	KEINE_MEDIEN,
	type AntwortenUebersicht,
	type ThreadAnsicht,
	type ThreadBearbeitung,
	type VerwaltungListe,
} from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { bieteAutoTest, legeThreadAn, ordneZu, setzeEinTest, trageEinTest } from './test-threads.js';

// Feste Uhr der App: "bevorstehend" und "archiviert" sollen nicht von der Wanduhr abhaengen.
const JETZT = new Date('2026-10-22T10:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

describe('Lesende Routen der Verwaltung', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => JETZT,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/**
	 * Ein Verein je Test mit Thomas (nur "Threads erstellen"), Tina (ebenfalls, aber andere
	 * Ersteller), Lars (Leitung: "Alle Threads bearbeiten"), Bernd (Betreuer: nur "Antworten im
	 * Detail") und Sandra als Mutter von Lena, die keinerlei Recht hat. Zwei Untergruppen,
	 * absichtlich nicht in alphabetischer Reihenfolge angelegt.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `verwaltung-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) =>
			legeMitgliedAn(prisma, verein, { jetzt: JETZT, ...e });
		const thomas = await mitglied({ art: 'ERWACHSENER', vorname: 'Thomas', rechte: ['THREADS_ERSTELLEN'] });
		const tina = await mitglied({ art: 'ERWACHSENER', vorname: 'Tina', rechte: ['THREADS_ERSTELLEN'] });
		const lars = await mitglied({ art: 'ERWACHSENER', vorname: 'Lars', rechte: ['ALLE_THREADS'] });
		const bernd = await mitglied({ art: 'ERWACHSENER', vorname: 'Bernd', rechte: ['ANTWORTEN_DETAIL'] });
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Mutter' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Mutter' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		const db = vereinDb(prisma, verein.id);
		const zander = await db.untergruppe.create({ data: { name: 'Zander' } });
		const aal = await db.untergruppe.create({ data: { name: 'Aal' } });

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const hole = (pfad: string, cookie?: string) => sende(server.url, api(pfad), { cookie });
		const austausch = () =>
			prisma.thread.findFirstOrThrow({ where: { vereinId: verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' } });
		return { verein, db, thomas, tina, lars, bernd, sandra, lena, zander, aal, hole, austausch };
	}

	describe('GET /verwaltung/threads', () => {
		it('Thomas sieht alle Threads samt Entwurf und Austausch, darf aber nur seine eigenen bearbeiten', async () => {
			const s = await szenario();
			const meiner = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Mein Aushang',
				erstelltVonId: s.thomas.personId,
			});
			const fremderEntwurf = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Tinas Entwurf',
				erstelltVonId: s.tina.personId,
				veroeffentlicht: false,
				module: [{ typ: 'UMFRAGE', teilnahme: true }],
			});
			const austausch = await s.austausch();

			const r = await s.hole('/verwaltung/threads', s.thomas.cookie);
			expect(r.status).toBe(200);
			const liste = (await r.json()) as VerwaltungListe;
			expect(Object.keys(liste).sort()).toEqual(['darfErstellen', 'threads', 'untergruppen']);
			expect(liste.darfErstellen).toBe(true);
			expect(liste.threads.map((t) => t.id).sort()).toEqual(
				[meiner.threadId, fremderEntwurf.threadId, austausch.id].sort(),
			);
			const zeile = (id: string) => liste.threads.find((t) => t.id === id);
			expect(zeile(meiner.threadId)).toMatchObject({
				titel: 'Mein Aushang',
				entwurf: false,
				darfBearbeiten: true,
				darfAntwortenSehen: true,
				hatAntwortModul: false,
			});
			expect(zeile(fremderEntwurf.threadId)).toMatchObject({
				titel: 'Tinas Entwurf',
				entwurf: true,
				darfBearbeiten: false,
				darfAntwortenSehen: false,
				hatAntwortModul: true,
			});
			expect(zeile(austausch.id)).toMatchObject({ art: 'JUGENDSPRECHER_AUSTAUSCH', darfBearbeiten: false });
		});

		it('Lars mit "Alle Threads bearbeiten" darf ueberall bearbeiten, auch am Austausch', async () => {
			const s = await szenario();
			await legeThreadAn(prisma, s.verein, JETZT, { erstelltVonId: s.thomas.personId });
			const r = await s.hole('/verwaltung/threads', s.lars.cookie);
			expect(r.status).toBe(200);
			const liste = (await r.json()) as VerwaltungListe;
			expect(liste.threads).toHaveLength(2);
			expect(liste.threads.every((t) => t.darfBearbeiten)).toBe(true);
			expect(liste.darfErstellen).toBe(true);
		});

		it('Bernd mit nur "Antworten im Detail" liest die Liste, darf aber weder erstellen noch bearbeiten', async () => {
			const s = await szenario();
			await legeThreadAn(prisma, s.verein, JETZT, { erstelltVonId: s.thomas.personId });
			const r = await s.hole('/verwaltung/threads', s.bernd.cookie);
			expect(r.status).toBe(200);
			const liste = (await r.json()) as VerwaltungListe;
			expect(liste.darfErstellen).toBe(false);
			expect(liste.threads.some((t) => t.darfBearbeiten)).toBe(false);
			// Die Antworten dagegen darf er sehen: ANTWORTEN_DETAIL genuegt.
			expect(liste.threads.every((t) => t.darfAntwortenSehen)).toBe(true);
		});

		it('Sandra ohne Recht bekommt 404 wie bei etwas, das es nicht gibt', async () => {
			const s = await szenario();
			const r = await s.hole('/verwaltung/threads', s.sandra.cookie);
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
		});

		it('ohne Anmeldung 401', async () => {
			const s = await szenario();
			expect((await s.hole('/verwaltung/threads')).status).toBe(401);
		});

		it('nennt die Untergruppen alphabetisch', async () => {
			const s = await szenario();
			const liste = (await (await s.hole('/verwaltung/threads', s.thomas.cookie)).json()) as VerwaltungListe;
			expect(liste.untergruppen).toEqual([
				{ id: s.aal.id, name: 'Aal' },
				{ id: s.zander.id, name: 'Zander' },
			]);
		});

		it('fuehrt nur Threads des eigenen Vereins', async () => {
			const s = await szenario();
			const anderer = await legeVereinAn(prisma, { slug: `verwaltung-fremd-${randomUUID().slice(0, 8)}` });
			await legeThreadAn(prisma, anderer, JETZT, { titel: 'Fremder Thread' });
			const liste = (await (await s.hole('/verwaltung/threads', s.thomas.cookie)).json()) as VerwaltungListe;
			expect(liste.threads.map((t) => t.titel)).toEqual(['Jugendsprecher-Austausch']);
		});
	});

	describe('GET /threads/:id/bearbeitung', () => {
		it('der Ersteller bekommt Version, Entwurf mit Schluesseln und eine Sperre je Umfrage', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Zeltlager',
				erstelltVonId: s.thomas.personId,
				untergruppenIds: [s.aal.id],
				module: [
					{ typ: 'INFO', text: 'Bringt Schlafsack mit.' },
					{ typ: 'UMFRAGE', frage: 'Kommst du mit?', teilnahme: true, vielleicht: true },
					{ typ: 'UMFRAGE', frage: 'Pizza?', optionen: ['Ja', 'Nein'] },
				],
			});
			await prisma.thread.update({ where: { id: t.threadId }, data: { bearbeitetStand: 7 } });
			// Lena hat in der ersten Umfrage geantwortet: Die Option "dabei" und die Umfrage sind belegt.
			await s.db.umfrageAntwort.create({
				data: {
					umfrageId: t.modulIds[1] as string,
					fuerId: s.lena.personId,
					vonId: s.sandra.personId,
					abgegebenAm: JETZT,
					clientId: randomUUID(),
					optionen: { create: [{ optionId: t.optionIds['dabei'] as string }] },
				},
			});

			const r = await s.hole(`/threads/${t.threadId}/bearbeitung`, s.thomas.cookie);
			expect(r.status).toBe(200);
			const b = (await r.json()) as ThreadBearbeitung;
			expect(Object.keys(b).sort()).toEqual([
				'angepinnt',
				'archiviert',
				'art',
				'darfArchivieren',
				'darfLoeschen',
				'entwurf',
				'fahrtSperre',
				'helferSperren',
				'id',
				'medien',
				'segment',
				'sperren',
				'untergruppen',
				'veroeffentlicht',
				'version',
			]);
			expect(b).toMatchObject({
				id: t.threadId,
				art: 'NORMAL',
				version: 7,
				veroeffentlicht: true,
				angepinnt: false,
				archiviert: false,
				darfArchivieren: true,
				darfLoeschen: false,
			});
			expect(b.medien).toEqual({ gesamt: KEINE_MEDIEN, module: {} });
			expect(b.helferSperren).toEqual({});
			expect(b.segment).toMatch(new RegExp(`^${t.threadId}-zeltlager$`));
			expect(b.entwurf).toMatchObject({
				titel: 'Zeltlager',
				alleUntergruppen: false,
				untergruppenIds: [s.aal.id],
			});
			const umfrage = b.entwurf.module[1];
			expect(umfrage).toMatchObject({ typ: 'UMFRAGE', id: t.modulIds[1] });
			expect(umfrage?.typ === 'UMFRAGE' && umfrage.optionen.map((o) => o.schluessel)).toEqual([
				'dabei',
				'vielleicht',
				'abgesagt',
			]);
			expect(Object.keys(b.sperren).sort()).toEqual([t.modulIds[1], t.modulIds[2]].sort());
			expect(b.sperren[t.modulIds[1] as string]).toEqual({
				beantwortet: true,
				schluessel: ['dabei'],
				mehrfachGenutzt: false,
			});
			expect(b.sperren[t.modulIds[2] as string]?.beantwortet).toBe(false);
			expect(b.untergruppen.map((u) => u.name)).toEqual(['Aal', 'Zander']);
		});

		it('Lars darf mit "Alle Threads bearbeiten" auch den Thread eines anderen bearbeiten, den Austausch aber nicht archivieren', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, { erstelltVonId: s.thomas.personId });
			const austausch = await s.austausch();

			const fremd = await s.hole(`/threads/${t.threadId}/bearbeitung`, s.lars.cookie);
			expect(fremd.status).toBe(200);
			expect(((await fremd.json()) as ThreadBearbeitung).darfArchivieren).toBe(true);
			const gespraech = await s.hole(`/threads/${austausch.id}/bearbeitung`, s.lars.cookie);
			expect(gespraech.status).toBe(200);
			const b = (await gespraech.json()) as ThreadBearbeitung;
			expect(b).toMatchObject({ art: 'JUGENDSPRECHER_AUSTAUSCH', darfArchivieren: false, darfLoeschen: false });
		});

		it('ein Jugendleiter ohne Recht am Thread, eine Familie und eine unbekannte ID bekommen dieselben 404-Bytes', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, { erstelltVonId: s.thomas.personId });
			const austausch = await s.austausch();

			const texte: string[] = [];
			const faelle: [string, string][] = [
				[t.threadId, s.tina.cookie], // darf nur eigene Threads bearbeiten
				[t.threadId, s.bernd.cookie], // Betreuer: sieht ihn, darf aber nicht bearbeiten
				[t.threadId, s.sandra.cookie], // Familie sieht den Thread, darf ihn nicht bearbeiten
				[austausch.id, s.thomas.cookie], // "Threads erstellen" genuegt am Austausch nicht
				['gibt-es-nicht', s.thomas.cookie],
			];
			for (const [id, cookie] of faelle) {
				const r = await s.hole(`/threads/${id}/bearbeitung`, cookie);
				expect(r.status).toBe(404);
				texte.push(await r.text());
			}
			expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
			expect(new Set(texte).size).toBe(1);
		});

		it('medien zaehlt Fotos, Dateien und die Hochladenden der Fotos, gesamt und je Modul', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Zeltlager',
				erstelltVonId: s.thomas.personId,
				module: [
					{ typ: 'INFO', text: 'Bringt Schlafsack mit.' },
					{ typ: 'DATEIEN', dateien: [{}, {}] },
					{ typ: 'FOTOS', hochladen: 'ALLE', fotos: [{}, { vonId: s.sandra.personId }, { vonId: s.sandra.personId }] },
					{ typ: 'FOTOS', fotos: [{ vonId: s.tina.personId }] },
				],
			});
			const r = await s.hole(`/threads/${t.threadId}/bearbeitung`, s.thomas.cookie);
			expect(r.status).toBe(200);
			const b = (await r.json()) as ThreadBearbeitung;
			expect(b.medien).toEqual({
				gesamt: { fotos: 4, dateien: 2, personen: 3 },
				module: {
					[t.modulIds[1] as string]: { fotos: 0, dateien: 2, personen: 0 },
					[t.modulIds[2] as string]: { fotos: 3, dateien: 0, personen: 2 },
					[t.modulIds[3] as string]: { fotos: 1, dateien: 0, personen: 1 },
				},
			});
		});

		it('ohne Anmeldung 401', async () => {
			const s = await szenario();
			expect((await s.hole('/threads/irgendeiner/bearbeitung')).status).toBe(401);
		});

		describe('darfLoeschen', () => {
			async function loeschbar(s: Awaited<ReturnType<typeof szenario>>, threadId: string): Promise<boolean> {
				const r = await s.hole(`/threads/${threadId}/bearbeitung`, s.thomas.cookie);
				expect(r.status).toBe(200);
				return ((await r.json()) as ThreadBearbeitung).darfLoeschen;
			}
			/** Eine Nachricht (oder ein Systemeintrag) mit dem naechsten Stand, so wie die Routen sie schreiben. */
			async function schreibe(
				s: Awaited<ReturnType<typeof szenario>>,
				threadId: string,
				e: { art: 'NACHRICHT' | 'SYSTEM'; geloescht?: boolean },
			) {
				const { aenderungsstand } = await prisma.verein.update({
					where: { id: s.verein.id },
					data: { aenderungsstand: { increment: 1 } },
					select: { aenderungsstand: true },
				});
				await prisma.verlaufEintrag.create({
					data: {
						vereinId: s.verein.id,
						threadId,
						art: e.art,
						autorId: s.thomas.personId,
						text: e.art === 'NACHRICHT' && !e.geloescht ? 'Hallo' : null,
						systemArt: e.art === 'SYSTEM' ? 'VEROEFFENTLICHT' : null,
						geloeschtAm: e.geloescht ? JETZT : null,
						geloeschtVonId: e.geloescht ? s.thomas.personId : null,
						stand: aenderungsstand,
						angelegtAm: JETZT,
					},
				});
			}

			it('true bei einem leeren Thread', async () => {
				const s = await szenario();
				const t = await legeThreadAn(prisma, s.verein, JETZT, {
					erstelltVonId: s.thomas.personId,
					module: [{ typ: 'UMFRAGE', teilnahme: true }],
				});
				expect(await loeschbar(s, t.threadId)).toBe(true);
			});

			it('false bei einer Antwort ohne Option: die Datenbank verweigerte das Loeschen ohnehin', async () => {
				const s = await szenario();
				const t = await legeThreadAn(prisma, s.verein, JETZT, {
					erstelltVonId: s.thomas.personId,
					module: [{ typ: 'UMFRAGE', teilnahme: true }],
				});
				await s.db.umfrageAntwort.create({
					data: {
						umfrageId: t.modulIds[0] as string,
						fuerId: s.lena.personId,
						vonId: s.sandra.personId,
						abgegebenAm: JETZT,
						clientId: randomUUID(),
					},
				});
				expect(await loeschbar(s, t.threadId)).toBe(false);
			});

			it('false bei einer Nachricht', async () => {
				const s = await szenario();
				const t = await legeThreadAn(prisma, s.verein, JETZT, { erstelltVonId: s.thomas.personId });
				await schreibe(s, t.threadId, { art: 'NACHRICHT' });
				expect(await loeschbar(s, t.threadId)).toBe(false);
			});

			it('true bei nur einer geloeschten Nachricht und Systemeintraegen', async () => {
				const s = await szenario();
				const t = await legeThreadAn(prisma, s.verein, JETZT, { erstelltVonId: s.thomas.personId });
				await schreibe(s, t.threadId, { art: 'NACHRICHT', geloescht: true });
				await schreibe(s, t.threadId, { art: 'SYSTEM' });
				expect(await loeschbar(s, t.threadId)).toBe(true);
			});
		});
	});

	describe('GET /threads/:id/antworten', () => {
		it('Bernd als Betreuer bekommt die Uebersicht ohne Nachtragen', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: s.thomas.personId,
				module: [{ typ: 'UMFRAGE', teilnahme: true }],
			});
			await s.db.umfrageAntwort.create({
				data: {
					umfrageId: t.modulIds[0] as string,
					fuerId: s.lena.personId,
					vonId: s.sandra.personId,
					abgegebenAm: JETZT,
					clientId: randomUUID(),
					optionen: { create: [{ optionId: t.optionIds['dabei'] as string }] },
				},
			});

			const r = await s.hole(`/threads/${t.threadId}/antworten`, s.bernd.cookie);
			expect(r.status).toBe(200);
			const u = (await r.json()) as AntwortenUebersicht;
			expect(u).toMatchObject({ threadId: t.threadId, titel: 'Bowling', darfNachtragen: false });
			expect(u.umfragen).toHaveLength(1);
			const zeile = u.umfragen[0]?.zeilen.find((z) => z.fuerId === s.lena.personId);
			expect(zeile).toMatchObject({ optionIds: [t.optionIds['dabei']], eingetragenVon: 'Sandra M.' });

			// Der Ersteller darf dagegen nachtragen.
			const ersteller = await s.hole(`/threads/${t.threadId}/antworten`, s.thomas.cookie);
			// Thomas hat nur "Threads erstellen", aber der Thread gehoert ihm.
			expect(ersteller.status).toBe(200);
			expect(((await ersteller.json()) as AntwortenUebersicht).darfNachtragen).toBe(true);
		});

		it('liefert je Helferliste Positionen mit Eintraegen, die Gefragten und wer noch ohne Eintrag ist', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Fischerfest',
				erstelltVonId: s.thomas.personId,
				module: [
					{
						typ: 'HELFER',
						positionen: [
							{ text: 'Kuchen', anzahl: 4 },
							{ text: 'Fahrer', anzahl: 2 },
						],
					},
				],
			});
			// Thomas traegt Sandra ein: Name und Notiz kommen mit, dazu wer eingetragen hat.
			await trageEinTest(s.db, t.positionIds['kuchen'] as string, s.sandra.personId, s.thomas.personId, 'Marmorkuchen');

			const r = await s.hole(`/threads/${t.threadId}/antworten`, s.thomas.cookie);
			expect(r.status).toBe(200);
			const u = (await r.json()) as AntwortenUebersicht;
			expect(u.umfragen).toEqual([]);
			expect(u.helfer).toHaveLength(1);
			const h = u.helfer[0];
			expect(h).toMatchObject({ modulId: t.modulIds[0], frist: null, fristAbgelaufen: false });
			const kuchen = h?.positionen.find((p) => p.id === t.positionIds['kuchen']);
			expect(kuchen).toMatchObject({ text: 'Kuchen', anzahl: 4, belegt: 1 });
			expect(kuchen?.eintraege).toEqual([
				{ fuerId: s.sandra.personId, name: 'Sandra M.', notiz: 'Marmorkuchen', eingetragenVon: 'Thomas M.' },
			]);
			expect(h?.positionen.find((p) => p.id === t.positionIds['fahrer'])).toMatchObject({ belegt: 0, eintraege: [] });
			// Gefragt sind die Erwachsenen (Einheit ERWACHSENER); Kinder stehen nicht darunter.
			const gefragte = h?.gefragte.map((g) => g.fuerId) ?? [];
			expect(gefragte).toContain(s.sandra.personId);
			expect(gefragte).toContain(s.thomas.personId);
			expect(gefragte).not.toContain(s.lena.personId);
			expect(h?.ohneEintrag).toBe(gefragte.length - 1);
		});

		it('liefert die Fahrgemeinschaft mit der Ansicht der Leitung: leitung true, Autos mit Mitfahrern', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: s.thomas.personId,
				module: [
					{ typ: 'UMFRAGE', teilnahme: true },
					{ typ: 'FAHRT', hin: true, rueck: false },
				],
			});
			const [umfrageId, fahrtId] = t.modulIds as [string, string];
			await s.db.umfrageAntwort.create({
				data: {
					umfrageId,
					fuerId: s.lena.personId,
					vonId: s.sandra.personId,
					abgegebenAm: JETZT,
					clientId: randomUUID(),
					optionen: { create: [{ optionId: t.optionIds['dabei'] as string }] },
				},
			});
			const autoId = await bieteAutoTest(s.db, fahrtId, s.sandra.personId, 'HIN', 3, { ort: 'Vereinsheim' });
			await setzeEinTest(s.db, fahrtId, 'HIN', s.lena.personId, autoId, s.sandra.personId);

			const r = await s.hole(`/threads/${t.threadId}/antworten`, s.thomas.cookie);
			expect(r.status).toBe(200);
			const u = (await r.json()) as AntwortenUebersicht;
			expect(u.fahrt).toMatchObject({ typ: 'FAHRT', id: fahrtId, leitung: true });
			const hin = u.fahrt?.richtungen.find((x) => x.richtung === 'HIN');
			expect(hin?.autos).toHaveLength(1);
			expect(hin?.autos[0]).toMatchObject({
				id: autoId,
				fahrer: 'Sandra M. (Mutter von Lena)',
				ort: 'Vereinsheim',
				frei: 2,
			});
			expect(hin?.autos[0]?.mitfahrer.map((m) => m.kindId)).toEqual([s.lena.personId]);
			// Bernd (nur "Antworten im Detail") sieht die Fahrgemeinschaft, ist aber nicht die Leitung.
			const bernd = (await (
				await s.hole(`/threads/${t.threadId}/antworten`, s.bernd.cookie)
			).json()) as AntwortenUebersicht;
			expect(bernd.fahrt).toMatchObject({ id: fahrtId, leitung: false });
		});

		it('ohne Fahrgemeinschaft ist fahrt null', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				erstelltVonId: s.thomas.personId,
				module: [{ typ: 'UMFRAGE', teilnahme: true }],
			});
			const u = (await (
				await s.hole(`/threads/${t.threadId}/antworten`, s.thomas.cookie)
			).json()) as AntwortenUebersicht;
			expect(u.fahrt).toBeNull();
		});

		it('Sandra, Tina ohne Recht am Thread und eine unbekannte ID bekommen dieselben 404-Bytes', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				erstelltVonId: s.thomas.personId,
				module: [{ typ: 'UMFRAGE', teilnahme: true }],
			});
			const texte: string[] = [];
			for (const [id, cookie] of [
				[t.threadId, s.sandra.cookie],
				[t.threadId, s.tina.cookie],
				['gibt-es-nicht', s.bernd.cookie],
			] as const) {
				const r = await s.hole(`/threads/${id}/antworten`, cookie);
				expect(r.status).toBe(404);
				texte.push(await r.text());
			}
			expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
			expect(new Set(texte).size).toBe(1);
		});

		it('ohne Anmeldung 401', async () => {
			const s = await szenario();
			expect((await s.hole('/threads/irgendeiner/antworten')).status).toBe(401);
		});
	});

	describe('GET /threads/:id', () => {
		it('liefert darfBearbeiten: Thomas an seinem Thread true, Sandra false', async () => {
			const s = await szenario();
			const t = await legeThreadAn(prisma, s.verein, JETZT, { erstelltVonId: s.thomas.personId });
			const ansicht = async (cookie: string) =>
				(await (await s.hole(`/threads/${t.threadId}`, cookie)).json()) as ThreadAnsicht;
			expect(await ansicht(s.thomas.cookie)).toMatchObject({ darfBearbeiten: true, darfArchivieren: true });
			expect(await ansicht(s.sandra.cookie)).toMatchObject({ darfBearbeiten: false, darfArchivieren: false });
			expect(await ansicht(s.tina.cookie)).toMatchObject({ darfBearbeiten: false, darfArchivieren: false });
		});
	});
});
