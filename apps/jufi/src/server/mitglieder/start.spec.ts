import { createPrismaClientFromEnv } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

const TAG_MS = 24 * 60 * 60 * 1000;

describe('Start: Ansprechpartner und Hinweise', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	// Feste Uhr der App: Die Grenze von 30 Tagen soll nicht von der Wanduhr abhaengen.
	const jetzt = new Date('2026-10-18T12:00:00.000Z');
	let adminId = '';

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => jetzt,
			}),
		);
		// AdminProtokoll verlangt einen Urheber (Restrict-Fremdschluessel).
		const admin = await prisma.plattformAdmin.create({ data: { benutzername: `start-${randomUUID().slice(0, 8)}` } });
		adminId = admin.id;
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test: Rechte und Protokoll gehoeren dem Verein, also darf kein Test in einen anderen hineinreichen. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `start-${randomUUID().slice(0, 8)}` });
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) => legeMitgliedAn(prisma, verein, { jetzt, ...e });
		const holeAnsprechpartner = async (cookie?: string) => {
			const r = await sende(server.url, api('/ansprechpartner'), { cookie });
			return { status: r.status, json: (await r.json()) as { ansprechpartner: Record<string, unknown>[] } };
		};
		const holeHinweise = async (cookie?: string) => {
			const r = await sende(server.url, api('/verwaltung/hinweise'), { cookie });
			return {
				status: r.status,
				json: (await r.json()) as { notfallLinks: { am: string; vorname: string | null; nachname: string | null }[] },
			};
		};
		/** Ein Notfall-Link im Protokoll, so wie admin/daten.ts ihn schreibt. */
		const protokolliere = (v: { id: string; slug: string }, personId: string | null, vorTagen: number) =>
			prisma.adminProtokoll.create({
				data: {
					adminId,
					zeitpunkt: new Date(jetzt.getTime() - vorTagen * TAG_MS),
					aktion: 'NOTFALL_LINK',
					vereinId: v.id,
					vereinSlug: v.slug,
					betroffenePersonId: personId,
				},
			});
		return { verein, api, mitglied, holeAnsprechpartner, holeHinweise, protokolliere };
	}

	describe('GET /ansprechpartner', () => {
		it('ein Kind sieht Leitung und Betreuer, aber keine Mutter ohne Rechte und keinen Grabstein', async () => {
			const v = await neuerVerein();
			const kind = await v.mitglied({ art: 'JUNGFISCHER', vorname: 'Kai', nachname: 'Kind' });
			await v.mitglied({ art: 'ERWACHSENER', vorname: 'Lena', nachname: 'Leitung', rechte: ['JUGENDLEITER_RECHTE'] });
			await v.mitglied({ art: 'ERWACHSENER', vorname: 'Bert', nachname: 'Betreuer', rechte: ['ANTWORTEN_DETAIL'] });
			await v.mitglied({ art: 'ERWACHSENER', vorname: 'Mia', nachname: 'Mutter' });
			// Entfernt, aber mit Rechten, falls ein Grabstein sie behielte: kein Ansprechpartner.
			const weg = await v.mitglied({ art: 'ERWACHSENER', vorname: 'Wolf', nachname: 'Weg', rechte: ['MITGLIEDER'] });
			await prisma.person.update({
				where: { id: weg.personId },
				data: { vorname: '', nachname: '', email: null, entferntAm: jetzt },
			});

			const r = await v.holeAnsprechpartner(kind.cookie);
			expect(r.status).toBe(200);
			// Nur die drei Felder: weder Rechte noch Adresse gehen an ein Kind.
			expect(r.json.ansprechpartner.map(({ vorname, nachname }) => `${vorname} ${nachname}`)).toEqual([
				'Bert Betreuer',
				'Lena Leitung',
			]);
			for (const eintrag of r.json.ansprechpartner) {
				expect(Object.keys(eintrag).sort()).toEqual(['id', 'nachname', 'vorname']);
			}
		});

		it('sortiert nach Nachname und Vorname, mit deutscher Reihenfolge fuer Umlaute', async () => {
			const v = await neuerVerein();
			const kind = await v.mitglied({ art: 'JUNGFISCHER' });
			const betreuer = (vorname: string, nachname: string) =>
				v.mitglied({ art: 'ERWACHSENER', vorname, nachname, rechte: ['ANTWORTEN_DETAIL'] });
			await betreuer('Zoe', 'Meier');
			await betreuer('Anna', 'Meier');
			await betreuer('Uwe', 'Zander');
			await betreuer('Olga', 'Aal');
			// Im Verein deutsch einsortiert: Aepfel zwischen Aal und Meier, nicht hinter Zander.
			await betreuer('Ida', 'Äpfel');

			const r = await v.holeAnsprechpartner(kind.cookie);
			expect(r.json.ansprechpartner.map(({ vorname, nachname }) => `${nachname} ${vorname}`)).toEqual([
				'Aal Olga',
				'Äpfel Ida',
				'Meier Anna',
				'Meier Zoe',
				'Zander Uwe',
			]);
		});

		it('ohne Sitzung 401', async () => {
			const v = await neuerVerein();
			expect((await v.holeAnsprechpartner()).status).toBe(401);
		});
	});

	describe('GET /verwaltung/hinweise', () => {
		it('zeigt Notfall-Links der letzten 30 Tage mit Namen, neueste zuerst, aelteren nicht', async () => {
			const v = await neuerVerein();
			const leitung = await v.mitglied({ art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
			const petra = await v.mitglied({ art: 'ERWACHSENER', vorname: 'Petra', nachname: 'Pech' });
			const paul = await v.mitglied({ art: 'ERWACHSENER', vorname: 'Paul', nachname: 'Panne' });
			await v.protokolliere(v.verein, petra.personId, 29);
			await v.protokolliere(v.verein, paul.personId, 2);
			await v.protokolliere(v.verein, petra.personId, 31);

			const r = await v.holeHinweise(leitung.cookie);
			expect(r.status).toBe(200);
			expect(r.json.notfallLinks).toEqual([
				{ am: new Date(jetzt.getTime() - 2 * TAG_MS).toISOString(), vorname: 'Paul', nachname: 'Panne' },
				{ am: new Date(jetzt.getTime() - 29 * TAG_MS).toISOString(), vorname: 'Petra', nachname: 'Pech' },
			]);
		});

		it('genau 30 Tage alt gehoert noch dazu', async () => {
			const v = await neuerVerein();
			const leitung = await v.mitglied({ art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
			const petra = await v.mitglied({ art: 'ERWACHSENER', vorname: 'Petra', nachname: 'Pech' });
			await v.protokolliere(v.verein, petra.personId, 30);
			expect((await v.holeHinweise(leitung.cookie)).json.notfallLinks).toHaveLength(1);
		});

		it('ein Notfall-Link im fremden Verein erscheint nicht', async () => {
			const v = await neuerVerein();
			const fremd = await neuerVerein();
			const leitung = await v.mitglied({ art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
			const fremde = await fremd.mitglied({ art: 'ERWACHSENER', vorname: 'Frieda', nachname: 'Fremd' });
			await fremd.protokolliere(fremd.verein, fremde.personId, 1);
			// Auch mit der Person des fremden Vereins als Ziel, aber unter dem eigenen Verein protokolliert: der Name kaeme nie heraus.
			await v.protokolliere(v.verein, fremde.personId, 1);

			const r = await v.holeHinweise(leitung.cookie);
			expect(r.json.notfallLinks).toEqual([
				{ am: new Date(jetzt.getTime() - TAG_MS).toISOString(), vorname: null, nachname: null },
			]);
			// Gegenprobe: im fremden Verein ist sein Eintrag sehr wohl da.
			const fremdeLeitung = await fremd.mitglied({ art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
			expect((await fremd.holeHinweise(fremdeLeitung.cookie)).json.notfallLinks).toEqual([
				{ am: new Date(jetzt.getTime() - TAG_MS).toISOString(), vorname: 'Frieda', nachname: 'Fremd' },
			]);
		});

		it('andere Aktionen im Protokoll zaehlen nicht', async () => {
			const v = await neuerVerein();
			const leitung = await v.mitglied({ art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
			await prisma.adminProtokoll.create({
				data: {
					adminId,
					zeitpunkt: new Date(jetzt.getTime() - TAG_MS),
					aktion: 'VEREIN_ANGELEGT',
					vereinId: v.verein.id,
					vereinSlug: v.verein.slug,
				},
			});
			expect((await v.holeHinweise(leitung.cookie)).json.notfallLinks).toEqual([]);
		});

		it('fuer eine inzwischen entfernte oder fehlende Person sind die Namen null', async () => {
			const v = await neuerVerein();
			const leitung = await v.mitglied({ art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
			const weg = await v.mitglied({ art: 'ERWACHSENER', vorname: 'Wolf', nachname: 'Weg' });
			await v.protokolliere(v.verein, weg.personId, 3);
			await v.protokolliere(v.verein, null, 4);
			await v.protokolliere(v.verein, 'gibt-es-nicht', 5);
			await prisma.person.update({
				where: { id: weg.personId },
				data: { vorname: '', nachname: '', email: null, entferntAm: jetzt },
			});

			const r = await v.holeHinweise(leitung.cookie);
			expect(r.json.notfallLinks).toHaveLength(3);
			for (const link of r.json.notfallLinks) expect(link).toMatchObject({ vorname: null, nachname: null });
		});

		it('ein Jugendleiter ohne JUGENDLEITER_RECHTE bekommt 404, ebenso ein Kind', async () => {
			const v = await neuerVerein();
			const petra = await v.mitglied({ art: 'ERWACHSENER', vorname: 'Petra', nachname: 'Pech' });
			await v.protokolliere(v.verein, petra.personId, 1);
			const jugendleiter = await v.mitglied({
				art: 'ERWACHSENER',
				rechte: ['MITGLIEDER', 'THREADS_ERSTELLEN', 'ALLE_THREADS', 'DOKUMENTE', 'ANTWORTEN_DETAIL', 'EINSTELLUNGEN'],
			});
			const kind = await v.mitglied({ art: 'JUNGFISCHER' });
			for (const cookie of [jugendleiter.cookie, kind.cookie, petra.cookie]) {
				const r = await sende(server.url, v.api('/verwaltung/hinweise'), { cookie });
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
			}
		});

		it('ohne Sitzung 401', async () => {
			const v = await neuerVerein();
			expect((await v.holeHinweise()).status).toBe(401);
		});
	});
});
