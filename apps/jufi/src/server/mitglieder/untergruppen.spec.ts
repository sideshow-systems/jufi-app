import { createPrismaClientFromEnv } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { erwarteNichts, erwarteUmfeldAenderung, sammleEreignisse } from '../echtzeit/test-bus.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

describe('Untergruppen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	const ereignisse = sammleEreignisse();

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, bus: ereignisse.bus }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test, damit die Zeilen zaehlbar bleiben. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `gruppen-${randomUUID().slice(0, 8)}` });
		const verwalter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['MITGLIEDER'] });
		const betreuer = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['ANTWORTEN_DETAIL'] });
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const gruppe = (name: string) => prisma.untergruppe.create({ data: { vereinId: verein.id, name } });
		const person = (art: 'JUNGFISCHER' | 'ERWACHSENER', vorname = 'Kai') =>
			prisma.person.create({
				data: {
					vereinId: verein.id,
					art,
					vorname,
					nachname: 'Test',
					geburtsdatum: art === 'JUNGFISCHER' ? new Date('2015-05-05') : undefined,
					email:
						art === 'ERWACHSENER' ? `${vorname.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test` : undefined,
				},
			});
		const liste = (cookie = verwalter.cookie) => sende(server.url, api('/untergruppen'), { cookie });
		const lege = (name: unknown, cookie = verwalter.cookie) =>
			sende(server.url, api('/untergruppen'), { methode: 'POST', body: { name }, cookie });
		const benenne = (id: string, name: unknown, cookie = verwalter.cookie) =>
			sende(server.url, api(`/untergruppen/${id}`), { methode: 'PATCH', body: { name }, cookie });
		const loesche = (id: string, cookie = verwalter.cookie) =>
			sende(server.url, api(`/untergruppen/${id}`), { methode: 'DELETE', cookie });
		const ordne = (personId: string, untergruppenIds: unknown, cookie = verwalter.cookie) =>
			sende(server.url, api(`/personen/${personId}/untergruppen`), {
				methode: 'PUT',
				body: { untergruppenIds },
				cookie,
			});
		const zugeordnet = async (personId: string) =>
			(await prisma.untergruppeMitglied.findMany({ where: { personId } })).map((z) => z.untergruppeId).sort();
		const namen = async () =>
			(await prisma.untergruppe.findMany({ where: { vereinId: verein.id } })).map((g) => g.name);
		return { verein, verwalter, betreuer, gruppe, person, liste, lege, benenne, loesche, ordne, zugeordnet, namen };
	}

	it('anlegen: 201 mit id, getrimmter Name gespeichert', async () => {
		const v = await neuerVerein();
		const r = await v.lege('  Hechte ');
		expect(r.status).toBe(201);
		const { id } = (await r.json()) as { id: string };
		expect((await prisma.untergruppe.findUniqueOrThrow({ where: { id } })).name).toBe('Hechte');
	});

	it('Name leer, zu lang oder kein Text: 400', async () => {
		const v = await neuerVerein();
		for (const name of ['', '   ', 'x'.repeat(41), 7, undefined]) {
			expect((await v.lege(name)).status).toBe(400);
		}
		expect((await v.lege('x'.repeat(40))).status).toBe(201);
	});

	it('Duplikat auch mit anderer Schreibweise: 409 NAME_VERGEBEN', async () => {
		const v = await neuerVerein();
		await v.gruppe('Hechte');
		for (const name of ['Hechte', 'hechte', ' HECHTE ']) {
			const r = await v.lege(name);
			expect(r.status).toBe(409);
			expect(await r.json()).toMatchObject({ code: 'NAME_VERGEBEN' });
		}
		expect(await v.namen()).toEqual(['Hechte']);
	});

	it('gleicher Name in einem anderen Verein ist ok', async () => {
		const v = await neuerVerein();
		const w = await neuerVerein();
		await w.gruppe('Hechte');
		expect((await v.lege('Hechte')).status).toBe(201);
	});

	it('umbenennen: neuer Name gilt, Duplikat 409, eigener Name (auch anders geschrieben) ist ok', async () => {
		const v = await neuerVerein();
		const hechte = await v.gruppe('Hechte');
		await v.gruppe('Barsche');
		expect((await v.benenne(hechte.id, 'Zander')).status).toBe(204);
		expect((await prisma.untergruppe.findUniqueOrThrow({ where: { id: hechte.id } })).name).toBe('Zander');
		const doppelt = await v.benenne(hechte.id, 'barsche');
		expect(doppelt.status).toBe(409);
		expect(await doppelt.json()).toMatchObject({ code: 'NAME_VERGEBEN' });
		expect((await v.benenne(hechte.id, 'Zander')).status).toBe(204);
		expect((await v.benenne(hechte.id, 'ZANDER')).status).toBe(204);
		expect((await v.benenne(hechte.id, '')).status).toBe(400);
	});

	it('umbenennen und loeschen einer unbekannten Gruppe: 404', async () => {
		const v = await neuerVerein();
		expect((await v.benenne('gibt-es-nicht', 'X')).status).toBe(404);
		expect((await v.loesche('gibt-es-nicht')).status).toBe(404);
	});

	it('Loeschen laesst die Personen stehen, nimmt aber die Zuordnungen mit', async () => {
		const v = await neuerVerein();
		const g = await v.gruppe('Hechte');
		const kind = await v.person('JUNGFISCHER');
		await v.ordne(kind.id, [g.id]);
		expect(await v.zugeordnet(kind.id)).toEqual([g.id]);
		expect((await v.loesche(g.id)).status).toBe(204);
		expect(await prisma.untergruppe.count({ where: { id: g.id } })).toBe(0);
		expect(await v.zugeordnet(kind.id)).toEqual([]);
		expect(await prisma.person.count({ where: { id: kind.id } })).toBe(1);
	});

	it('GET liefert Name und Zahl der Mitglieder, entfernte Kinder zaehlen nicht', async () => {
		const v = await neuerVerein();
		const g = await v.gruppe('Hechte');
		await v.gruppe('Barsche');
		const a = await v.person('JUNGFISCHER', 'A');
		const b = await v.person('JUNGFISCHER', 'B');
		await v.ordne(a.id, [g.id]);
		await v.ordne(b.id, [g.id]);
		await prisma.person.update({ where: { id: b.id }, data: { entferntAm: new Date() } });
		const r = await v.liste();
		expect(r.status).toBe(200);
		const { untergruppen } = (await r.json()) as { untergruppen: { id: string; name: string; mitglieder: number }[] };
		expect(untergruppen).toEqual([
			{ id: expect.any(String), name: 'Barsche', mitglieder: 0 },
			{ id: g.id, name: 'Hechte', mitglieder: 1 },
		]);
	});

	it('PUT ersetzt die Menge', async () => {
		const v = await neuerVerein();
		const [g1, g2, g3] = [await v.gruppe('A'), await v.gruppe('B'), await v.gruppe('C')];
		const kind = await v.person('JUNGFISCHER');
		expect((await v.ordne(kind.id, [g1.id, g2.id])).status).toBe(200);
		expect(await v.zugeordnet(kind.id)).toEqual([g1.id, g2.id].sort());
		expect((await v.ordne(kind.id, [g2.id, g3.id, g3.id])).status).toBe(200);
		expect(await v.zugeordnet(kind.id)).toEqual([g2.id, g3.id].sort());
		expect((await v.ordne(kind.id, [])).status).toBe(200);
		expect(await v.zugeordnet(kind.id)).toEqual([]);
	});

	it('PUT mit unbekannter oder fremder Gruppen-ID: 404 und Menge unveraendert', async () => {
		const v = await neuerVerein();
		const w = await neuerVerein();
		const eigene = await v.gruppe('A');
		const fremde = await w.gruppe('A');
		const kind = await v.person('JUNGFISCHER');
		await v.ordne(kind.id, [eigene.id]);
		expect((await v.ordne(kind.id, [fremde.id])).status).toBe(404);
		expect((await v.ordne(kind.id, [eigene.id, 'gibt-es-nicht'])).status).toBe(404);
		expect(await v.zugeordnet(kind.id)).toEqual([eigene.id]);
		expect(await prisma.untergruppeMitglied.count({ where: { untergruppeId: fremde.id } })).toBe(0);
	});

	it('PUT: Erwachsener, Grabstein und Unbekannte sind 404; ungueltige Liste 400', async () => {
		const v = await neuerVerein();
		const g = await v.gruppe('A');
		const erw = await v.person('ERWACHSENER');
		expect((await v.ordne(erw.id, [g.id])).status).toBe(404);
		const weg = await v.person('JUNGFISCHER', 'Weg');
		await prisma.person.update({ where: { id: weg.id }, data: { entferntAm: new Date() } });
		expect((await v.ordne(weg.id, [g.id])).status).toBe(404);
		expect((await v.ordne('gibt-es-nicht', [g.id])).status).toBe(404);
		const kind = await v.person('JUNGFISCHER');
		for (const falsch of ['A', [1], undefined, null]) expect((await v.ordne(kind.id, falsch)).status).toBe(400);
		expect(await prisma.untergruppeMitglied.count({ where: { vereinId: v.verein.id } })).toBe(0);
	});

	it('Unterstrich im Namen wirkt nicht als Platzhalter', async () => {
		const v = await neuerVerein();
		expect((await v.lege('HechtX1')).status).toBe(201);
		expect((await v.lege('Hecht_1')).status).toBe(201);
		expect((await v.lege('Hecht%')).status).toBe(201);
		expect((await v.lege('hecht_1')).status).toBe(409);
	});

	it('PUT und DELETE derselben Gruppe zugleich: nie 500', async () => {
		for (let i = 0; i < 8; i++) {
			const v = await neuerVerein();
			const g = await v.gruppe('Hechte');
			const kind = await v.person('JUNGFISCHER');
			const [put, del] = await Promise.all([v.ordne(kind.id, [g.id]), v.loesche(g.id)]);
			expect(del.status).toBe(204);
			expect([200, 404]).toContain(put.status);
			// Egal in welcher Reihenfolge: die Gruppe ist weg und mit ihr jede Zuordnung.
			expect(await v.zugeordnet(kind.id)).toEqual([]);
		}
	});

	it('Betreuer liest, schreibt nicht (404)', async () => {
		const v = await neuerVerein();
		const g = await v.gruppe('Hechte');
		const kind = await v.person('JUNGFISCHER');
		const c = v.betreuer.cookie;
		expect((await v.liste(c)).status).toBe(200);
		expect((await v.lege('Neu', c)).status).toBe(404);
		expect((await v.benenne(g.id, 'Neu', c)).status).toBe(404);
		expect((await v.ordne(kind.id, [g.id], c)).status).toBe(404);
		expect((await v.loesche(g.id, c)).status).toBe(404);
		expect(await v.namen()).toEqual(['Hechte']);
		expect(await v.zugeordnet(kind.id)).toEqual([]);
	});

	it('wer kein Jugendleiter ist, bekommt auch die Liste nicht (404)', async () => {
		const v = await neuerVerein();
		const eltern = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		expect((await v.liste(eltern.cookie)).status).toBe(404);
	});

	describe('Umfeld-Aenderungen auf dem Bus', () => {
		it('POST: eine Aenderung ohne Thread mit der neuen Untergruppe, ein Ereignis mit demselben Stand', async () => {
			const v = await neuerVerein();

			const r = await v.lege('Hechte');

			expect(r.status).toBe(201);
			const { id } = (await r.json()) as { id: string };
			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [id])).toBe(1);
		});

		it('POST: 400 und 409 melden nichts', async () => {
			const v = await neuerVerein();
			await v.gruppe('Hechte');

			expect((await v.lege('')).status).toBe(400);
			expect((await v.lege('hechte')).status).toBe(409);

			await erwarteNichts(prisma, ereignisse, v.verein.id);
		});

		it('PATCH: eine Aenderung mit der Untergruppe; 404 und 409 nicht', async () => {
			const v = await neuerVerein();
			const hechte = await v.gruppe('Hechte');
			const barsche = await v.gruppe('Barsche');
			expect((await v.benenne('gibt-es-nicht', 'X')).status).toBe(404);
			expect((await v.benenne(hechte.id, 'barsche')).status).toBe(409);
			await erwarteNichts(prisma, ereignisse, v.verein.id);

			expect((await v.benenne(barsche.id, 'Forellen')).status).toBe(204);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [barsche.id])).toBe(1);
		});

		it('DELETE: eine Aenderung mit der geloeschten Untergruppe; das zweite Loeschen (404) nicht', async () => {
			const v = await neuerVerein();
			const hechte = await v.gruppe('Hechte');

			expect((await v.loesche(hechte.id)).status).toBe(204);
			expect((await v.loesche(hechte.id)).status).toBe(404);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [hechte.id])).toBe(1);
		});

		it('PUT /personen/:id/untergruppen: eine Aenderung mit der Person; 404 und 400 nicht', async () => {
			const v = await neuerVerein();
			const kind = await v.person('JUNGFISCHER');
			const erw = await v.person('ERWACHSENER');
			const hechte = await v.gruppe('Hechte');
			expect((await v.ordne(erw.id, [hechte.id])).status).toBe(404);
			expect((await v.ordne(kind.id, ['gibt-es-nicht'])).status).toBe(404);
			expect((await v.ordne(kind.id, 'keine-liste')).status).toBe(400);
			await erwarteNichts(prisma, ereignisse, v.verein.id);

			expect((await v.ordne(kind.id, [hechte.id])).status).toBe(200);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [kind.id])).toBe(1);
		});
	});
});
