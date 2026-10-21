import { createPrismaClientFromEnv } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { erwarteNichts, erwarteUmfeldAenderung, sammleEreignisse } from '../echtzeit/test-bus.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

describe('Meine Jungfischer', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	// Die Uhr der App; nur der Volljaehrigkeitstest stellt sie.
	let uhr: Date | null = null;
	const ereignisse = sammleEreignisse();

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr ?? new Date(),
				bus: ereignisse.bus,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test: Zuordnungen und Einwilligungen zaehlen, also darf kein anderer Test hineinreichen. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `jungfischer-${randomUUID().slice(0, 8)}` });
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const mutter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Mia', nachname: 'Mutter' });
		const kind = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', vorname: 'Kai', nachname: 'Kind' });
		const verknuepfe = (
			erwachsenerId: string,
			jungfischerId: string,
			erziehungsberechtigt = true,
			beziehung: 'MUTTER' | 'VATER' | 'GROSSMUTTER' = 'MUTTER',
		) =>
			prisma.bezugsperson.create({
				data: { vereinId: verein.id, erwachsenerId, jungfischerId, beziehung, erziehungsberechtigt },
			});
		const willigtEin = (jungfischerId: string, erteiltVon: string) =>
			prisma.einwilligung.create({
				data: { vereinId: verein.id, jungfischerId, erteiltVon, art: 'DSGVO_ART8', textVersion: '1' },
			});
		await verknuepfe(mutter.personId, kind.personId);
		const post = (cookie: string, kindId: string, was: 'zugang' | 'einladung' | 'einwilligung', body: unknown = {}) =>
			sende(server.url, api(`/meine-jungfischer/${kindId}/${was}`), { methode: 'POST', body, cookie });
		const liste = async (cookie: string) => {
			const r = await sende(server.url, api('/meine-jungfischer'), { cookie });
			return { status: r.status, json: (await r.json()) as { kinder: Record<string, any>[] } };
		};
		const person = (id: string) => prisma.person.findUniqueOrThrow({ where: { id } });
		return { verein, api, mutter, kind, verknuepfe, willigtEin, post, liste, person };
	}

	it('GET zeigt nur eigene Kinder, auch das einer Grossmutter (nicht erziehungsberechtigt), ohne Adressen und Rechte der Familie', async () => {
		const v = await neuerVerein();
		const fremdes = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER', vorname: 'Fremd' });
		const oma = await legeMitgliedAn(prisma, v.verein, {
			art: 'ERWACHSENER',
			vorname: 'Olga',
			nachname: 'Oma',
			rechte: ['MITGLIEDER'],
		});
		await v.verknuepfe(oma.personId, v.kind.personId, false, 'GROSSMUTTER');
		const gruppe = await prisma.untergruppe.create({ data: { vereinId: v.verein.id, name: 'Hechte' } });
		await prisma.untergruppeMitglied.create({
			data: { vereinId: v.verein.id, untergruppeId: gruppe.id, personId: v.kind.personId },
		});
		await v.willigtEin(v.kind.personId, v.mutter.personId);

		const mutter = await v.liste(v.mutter.cookie);
		expect(mutter.status).toBe(200);
		expect(mutter.json.kinder).toHaveLength(1);
		const [k] = mutter.json.kinder;
		expect(k).toMatchObject({
			id: v.kind.personId,
			vorname: 'Kai',
			nachname: 'Kind',
			jugendsprecher: false,
			untergruppen: [{ id: gruppe.id, name: 'Hechte' }],
			zugang: { erlaubt: true, vorhanden: true, einwilligungGueltig: true },
			ichBinErziehungsberechtigt: true,
			volljaehrig: false,
		});
		expect(k?.['familie']).toHaveLength(2);
		const text = JSON.stringify(k?.['familie']);
		expect(text).not.toContain('@');
		expect(text).not.toContain('MITGLIEDER');
		expect(JSON.stringify(mutter.json)).not.toContain(fremdes.personId);

		const grossmutter = await v.liste(oma.cookie);
		expect(grossmutter.json.kinder).toHaveLength(1);
		expect(grossmutter.json.kinder[0]).toMatchObject({ id: v.kind.personId, ichBinErziehungsberechtigt: false });
	});

	it('GET ohne Anmeldung: 401; Erwachsener ohne Kinder: leere Liste; entferntes Kind fehlt', async () => {
		const v = await neuerVerein();
		expect((await sende(server.url, v.api('/meine-jungfischer'))).status).toBe(401);
		const fremd = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		expect((await v.liste(fremd.cookie)).json.kinder).toEqual([]);
		await prisma.person.update({ where: { id: v.kind.personId }, data: { entferntAm: new Date() } });
		expect((await v.liste(v.mutter.cookie)).json.kinder).toEqual([]);
	});

	it('Grossmutter widerruft: 404, auch bei Zugang und Einladung', async () => {
		const v = await neuerVerein();
		const oma = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(oma.personId, v.kind.personId, false, 'GROSSMUTTER');
		await v.willigtEin(v.kind.personId, v.mutter.personId);
		expect((await v.post(oma.cookie, v.kind.personId, 'einwilligung', { erteilen: false })).status).toBe(404);
		expect((await v.post(oma.cookie, v.kind.personId, 'einwilligung', { erteilen: true })).status).toBe(404);
		expect((await v.post(oma.cookie, v.kind.personId, 'zugang', { erlaubt: false })).status).toBe(404);
		expect((await v.post(oma.cookie, v.kind.personId, 'einladung')).status).toBe(404);
		expect(await prisma.einwilligung.count({ where: { jungfischerId: v.kind.personId, widerrufenAm: null } })).toBe(1);
		expect(await prisma.zugang.count({ where: { personId: v.kind.personId } })).toBe(1);
	});

	it('Mutter erteilt Einwilligung: zweiter Aufruf legt keine zweite an', async () => {
		const v = await neuerVerein();
		const r1 = await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: true });
		expect(r1.status).toBe(200);
		const r2 = await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: true });
		expect(r2.status).toBe(200);
		const zeilen = await prisma.einwilligung.findMany({ where: { jungfischerId: v.kind.personId } });
		expect(zeilen).toHaveLength(1);
		expect(zeilen[0]).toMatchObject({
			erteiltVon: v.mutter.personId,
			art: 'DSGVO_ART8',
			textVersion: '1',
			widerrufenAm: null,
		});
	});

	it('Erteilen nach Widerruf legt eine neue an; der alte Nachweis bleibt', async () => {
		const v = await neuerVerein();
		await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: true });
		await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: false });
		await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: true });
		const zeilen = await prisma.einwilligung.findMany({ where: { jungfischerId: v.kind.personId } });
		expect(zeilen).toHaveLength(2);
		expect(zeilen.filter((z) => z.widerrufenAm === null)).toHaveLength(1);
	});

	it('Widerruf der einzigen gueltigen Einwilligung loescht Zugang, Passkeys, Sitzungen und offene Einladungen des Kindes', async () => {
		const v = await neuerVerein();
		await v.willigtEin(v.kind.personId, v.mutter.personId);
		await prisma.passkey.create({
			data: {
				vereinId: v.verein.id,
				zugangId: v.kind.zugangId,
				credentialId: `c-${randomUUID()}`,
				publicKey: 'k',
				label: 'Handy',
			},
		});
		await prisma.einladung.create({
			data: {
				vereinId: v.verein.id,
				personId: v.kind.personId,
				art: 'RESET',
				tokenHash: randomUUID(),
				ablauf: new Date(Date.now() + 86_400_000),
			},
		});
		// Vorher gilt die Sitzung des Kindes.
		expect((await sende(server.url, v.api('/meine-jungfischer'), { cookie: v.kind.cookie })).status).toBe(200);

		const r = await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: false });
		expect(r.status).toBe(200);
		expect(await prisma.zugang.count({ where: { personId: v.kind.personId } })).toBe(0);
		expect(await prisma.passkey.count({ where: { zugangId: v.kind.zugangId } })).toBe(0);
		expect(await prisma.session.count({ where: { zugangId: v.kind.zugangId } })).toBe(0);
		expect(await prisma.einladung.count({ where: { personId: v.kind.personId } })).toBe(0);
		expect((await v.person(v.kind.personId)).zugangErlaubt).toBe(false);
		expect((await sende(server.url, v.api('/meine-jungfischer'), { cookie: v.kind.cookie })).status).toBe(401);
		expect(await prisma.einwilligung.count({ where: { jungfischerId: v.kind.personId, widerrufenAm: null } })).toBe(0);
		expect(await prisma.einwilligung.count({ where: { jungfischerId: v.kind.personId } })).toBe(1);
	});

	it('Widerruf, wenn der Vater noch gueltig eingewilligt hat: Zugang bleibt', async () => {
		const v = await neuerVerein();
		const vater = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(vater.personId, v.kind.personId, true, 'VATER');
		await v.willigtEin(v.kind.personId, v.mutter.personId);
		await v.willigtEin(v.kind.personId, vater.personId);

		expect((await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: false })).status).toBe(200);
		expect(await prisma.zugang.count({ where: { personId: v.kind.personId } })).toBe(1);
		expect((await v.person(v.kind.personId)).zugangErlaubt).toBe(true);
		// Der Widerruf trifft nur die eigene Einwilligung.
		const offen = await prisma.einwilligung.findMany({ where: { jungfischerId: v.kind.personId, widerrufenAm: null } });
		expect(offen.map((w) => w.erteiltVon)).toEqual([vater.personId]);
	});

	it('Zugang: erlaubt true ohne gueltige Einwilligung ist 409, mit Einwilligung gesetzt; false entzieht', async () => {
		const v = await neuerVerein();
		await prisma.person.update({ where: { id: v.kind.personId }, data: { zugangErlaubt: false } });
		const ohne = await v.post(v.mutter.cookie, v.kind.personId, 'zugang', { erlaubt: true });
		expect(ohne.status).toBe(409);
		expect(((await ohne.json()) as { code: string }).code).toBe('EINWILLIGUNG_FEHLT');
		expect((await v.person(v.kind.personId)).zugangErlaubt).toBe(false);

		await v.willigtEin(v.kind.personId, v.mutter.personId);
		expect((await v.post(v.mutter.cookie, v.kind.personId, 'zugang', { erlaubt: true })).status).toBe(200);
		expect((await v.person(v.kind.personId)).zugangErlaubt).toBe(true);

		expect((await v.post(v.mutter.cookie, v.kind.personId, 'zugang', { erlaubt: false })).status).toBe(200);
		expect((await v.person(v.kind.personId)).zugangErlaubt).toBe(false);
		expect(await prisma.zugang.count({ where: { personId: v.kind.personId } })).toBe(0);
	});

	it('Body ohne Boolean: 400', async () => {
		const v = await neuerVerein();
		expect((await v.post(v.mutter.cookie, v.kind.personId, 'zugang', { erlaubt: 'ja' })).status).toBe(400);
		expect((await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', {})).status).toBe(400);
	});

	it('Einladung: 201 mit link, text, ablauf; ohne Einwilligung oder ohne Erlaubnis 409', async () => {
		const v = await neuerVerein();
		await prisma.zugang.delete({ where: { id: v.kind.zugangId } });
		const ohne = await v.post(v.mutter.cookie, v.kind.personId, 'einladung');
		expect(ohne.status).toBe(409);
		expect(await prisma.einladung.count({ where: { personId: v.kind.personId } })).toBe(0);

		await v.willigtEin(v.kind.personId, v.mutter.personId);
		const r = await v.post(v.mutter.cookie, v.kind.personId, 'einladung');
		expect(r.status).toBe(201);
		const antwort = (await r.json()) as { link: string; text: string; ablauf: string };
		expect(antwort.link).toContain(`/${v.verein.slug}/einladung#`);
		expect(antwort.text).toContain(antwort.link);
		const [zeile] = await prisma.einladung.findMany({ where: { personId: v.kind.personId } });
		expect(zeile).toMatchObject({ art: 'EINLADUNG', erstelltVonPersonId: v.mutter.personId });
		expect(antwort.ablauf).toBe(zeile?.ablauf.toISOString());

		await prisma.person.update({ where: { id: v.kind.personId }, data: { zugangErlaubt: false } });
		expect((await v.post(v.mutter.cookie, v.kind.personId, 'einladung')).status).toBe(409);
	});

	it('gleichzeitig Widerruf und Einloesen der Kindeinladung: nie Zugang bei widerrufener Einwilligung', async () => {
		for (let i = 0; i < 4; i++) {
			const v = await neuerVerein();
			await prisma.zugang.delete({ where: { id: v.kind.zugangId } });
			await v.willigtEin(v.kind.personId, v.mutter.personId);
			const r = await v.post(v.mutter.cookie, v.kind.personId, 'einladung');
			const token = ((await r.json()) as { link: string }).link.split('#')[1];

			const [widerruf, einloesen] = await Promise.all([
				v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: false }),
				sende(server.url, v.api('/einladung/einloesen'), {
					methode: 'POST',
					body: { token, kennung: `kai-${randomUUID().slice(0, 8)}`, passwort: 'gruene-forelle-am-see' },
				}),
			]);
			expect(widerruf.status).toBe(200);
			// Entweder gewann die Einloesung (der Widerruf hat den Zugang danach wieder genommen)
			// oder der Widerruf (die Einloesung scheitert); beides endet ohne Zugang.
			expect([200, 201, 409, 404]).toContain(einloesen.status);
			expect(await prisma.zugang.count({ where: { personId: v.kind.personId } })).toBe(0);
			expect(await prisma.einwilligung.count({ where: { jungfischerId: v.kind.personId, widerrufenAm: null } })).toBe(
				0,
			);
			expect((await v.person(v.kind.personId)).zugangErlaubt).toBe(false);
		}
	});

	it('Kind wird volljaehrig: Mutter bekommt 404 auf Zugang, Einladung, Einwilligung; GET zeigt volljaehrig ohne Aktionen', async () => {
		const v = await neuerVerein();
		await v.willigtEin(v.kind.personId, v.mutter.personId);
		const t0 = new Date('2033-05-04T20:00:00Z');
		const t1 = new Date('2033-05-05T01:00:00Z');
		// Eigene Sitzung zur Test-Uhr: die der Hilfsfunktion stammt von der Wanduhr und liefe 2033 laengst ab.
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', jetzt: t0 });
		await v.verknuepfe(mutter.personId, v.kind.personId);
		await v.willigtEin(v.kind.personId, mutter.personId);
		try {
			uhr = t0;
			const vorher = await v.liste(mutter.cookie);
			expect(vorher.json.kinder[0]).toMatchObject({ volljaehrig: false, ichBinErziehungsberechtigt: true });
			expect((await v.post(mutter.cookie, v.kind.personId, 'zugang', { erlaubt: true })).status).toBe(200);

			uhr = t1;
			const nachher = await v.liste(mutter.cookie);
			expect(nachher.json.kinder[0]).toMatchObject({
				id: v.kind.personId,
				volljaehrig: true,
				ichBinErziehungsberechtigt: false,
			});
			expect((await v.post(mutter.cookie, v.kind.personId, 'zugang', { erlaubt: false })).status).toBe(404);
			expect((await v.post(mutter.cookie, v.kind.personId, 'einladung')).status).toBe(404);
			expect((await v.post(mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: false })).status).toBe(404);
			expect((await v.post(mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: true })).status).toBe(404);
			expect(await prisma.zugang.count({ where: { personId: v.kind.personId } })).toBe(1);
		} finally {
			uhr = null;
		}
	});

	it('Kind einer fremden Familie und Grabstein-Kind: 404', async () => {
		const v = await neuerVerein();
		const anderes = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		await v.willigtEin(anderes.personId, v.mutter.personId);
		for (const was of ['zugang', 'einladung', 'einwilligung'] as const) {
			const r = await v.post(v.mutter.cookie, anderes.personId, was, { erlaubt: false, erteilen: false });
			expect(r.status).toBe(404);
		}
		expect((await v.post(v.mutter.cookie, 'gibt-es-nicht', 'zugang', { erlaubt: false })).status).toBe(404);
		expect(await prisma.zugang.count({ where: { personId: anderes.personId } })).toBe(1);

		await prisma.person.update({ where: { id: v.kind.personId }, data: { entferntAm: new Date() } });
		for (const was of ['zugang', 'einladung', 'einwilligung'] as const) {
			const r = await v.post(v.mutter.cookie, v.kind.personId, was, { erlaubt: true, erteilen: true });
			expect(r.status).toBe(404);
		}
	});

	it('Recht entfaellt unter der Sperre: Zuordnung geloest, danach 404', async () => {
		const v = await neuerVerein();
		await v.willigtEin(v.kind.personId, v.mutter.personId);
		await prisma.bezugsperson.deleteMany({ where: { erwachsenerId: v.mutter.personId } });
		expect((await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: false })).status).toBe(404);
		expect(await prisma.einwilligung.count({ where: { jungfischerId: v.kind.personId, widerrufenAm: null } })).toBe(1);
	});

	describe('Umfeld-Aenderungen auf dem Bus', () => {
		it('einwilligung erteilen: eine Aenderung ohne Thread mit dem Kind, der zweite Klick (keine neue Zeile) meldet nichts mehr', async () => {
			const v = await neuerVerein();

			expect((await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: true })).status).toBe(200);
			expect((await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: true })).status).toBe(200);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [v.kind.personId])).toBe(1);
		});

		it('einwilligung widerrufen: eine Aenderung mit dem Kind', async () => {
			const v = await neuerVerein();
			await v.willigtEin(v.kind.personId, v.mutter.personId);

			expect((await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: false })).status).toBe(200);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [v.kind.personId])).toBe(1);
		});

		it('zugang: eine Aenderung ohne Thread mit dem Kind', async () => {
			const v = await neuerVerein();
			await v.willigtEin(v.kind.personId, v.mutter.personId);

			expect((await v.post(v.mutter.cookie, v.kind.personId, 'zugang', { erlaubt: false })).status).toBe(200);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [v.kind.personId])).toBe(1);
		});

		it('400, 404 und 409 melden nichts', async () => {
			const v = await neuerVerein();
			const fremdes = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });

			expect((await v.post(v.mutter.cookie, v.kind.personId, 'einwilligung', { erteilen: 'ja' })).status).toBe(400);
			expect((await v.post(v.mutter.cookie, v.kind.personId, 'zugang', { erlaubt: 'ja' })).status).toBe(400);
			expect((await v.post(v.mutter.cookie, fremdes.personId, 'einwilligung', { erteilen: true })).status).toBe(404);
			expect((await v.post(v.mutter.cookie, 'gibt-es-nicht', 'zugang', { erlaubt: false })).status).toBe(404);
			// Erlauben ohne Einwilligung des Kindes.
			expect((await v.post(v.mutter.cookie, v.kind.personId, 'zugang', { erlaubt: true })).status).toBe(409);

			await erwarteNichts(prisma, ereignisse, v.verein.id);
		});
	});
});
