import { createPrismaClientFromEnv, type Recht } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

describe('Familie verknuepfen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test, damit die Zeilen zaehlbar bleiben. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `familie-${randomUUID().slice(0, 8)}` });
		const verwalter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['MITGLIEDER'] });
		const kind = (vorname = 'Kai') =>
			prisma.person.create({
				data: {
					vereinId: verein.id,
					art: 'JUNGFISCHER',
					vorname,
					nachname: 'Kind',
					geburtsdatum: new Date('2015-05-05'),
				},
			});
		const erwachsener = (vorname = 'Anna', rechte: Recht[] = []) =>
			prisma.person.create({
				data: {
					vereinId: verein.id,
					art: 'ERWACHSENER',
					vorname,
					nachname: 'Erw',
					email: `${vorname.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`,
					rechte,
				},
			});
		const pfad = (kindId: string, erwId: string) => `/${verein.slug}/api/v1/personen/${kindId}/familie/${erwId}`;
		const put = (kindId: string, erwId: string, body: unknown, cookie = verwalter.cookie) =>
			sende(server.url, pfad(kindId, erwId), { methode: 'PUT', body, cookie });
		const loesche = (kindId: string, erwId: string, cookie = verwalter.cookie) =>
			sende(server.url, pfad(kindId, erwId), { methode: 'DELETE', cookie });
		const zeilen = (kindId: string) => prisma.bezugsperson.findMany({ where: { jungfischerId: kindId } });
		return { verein, verwalter, kind, erwachsener, put, loesche, zeilen };
	}

	it('Mutter verknuepfen: erziehungsberechtigt vorbelegt true', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const mutter = await v.erwachsener();
		const r = await v.put(kind.id, mutter.id, { beziehung: 'MUTTER' });
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ erziehungsberechtigt: true });
		const [zeile] = await v.zeilen(kind.id);
		expect(zeile).toMatchObject({ erwachsenerId: mutter.id, beziehung: 'MUTTER', erziehungsberechtigt: true });
	});

	it('Grossmutter: vorbelegt false, die Verwaltung kann es ueberstimmen', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const oma = await v.erwachsener('Oma');
		const r = await v.put(kind.id, oma.id, { beziehung: 'GROSSMUTTER' });
		expect(await r.json()).toEqual({ erziehungsberechtigt: false });
		const r2 = await v.put(kind.id, oma.id, { beziehung: 'GROSSMUTTER', erziehungsberechtigt: true });
		expect(await r2.json()).toEqual({ erziehungsberechtigt: true });
	});

	it('ANDERE ohne Freitext: 400, mit Freitext gespeichert', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const erw = await v.erwachsener();
		for (const body of [{ beziehung: 'ANDERE' }, { beziehung: 'ANDERE', beziehungFreitext: '   ' }]) {
			expect((await v.put(kind.id, erw.id, body)).status).toBe(400);
		}
		expect(await v.zeilen(kind.id)).toHaveLength(0);
		const r = await v.put(kind.id, erw.id, { beziehung: 'ANDERE', beziehungFreitext: 'Nachbarin' });
		expect(r.status).toBe(200);
		expect((await v.zeilen(kind.id))[0]?.beziehungFreitext).toBe('Nachbarin');
	});

	it('unbekannte Beziehung und Nicht-Wahrheitswert: 400', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const erw = await v.erwachsener();
		expect((await v.put(kind.id, erw.id, { beziehung: 'CHEF' })).status).toBe(400);
		expect((await v.put(kind.id, erw.id, { beziehung: 'MUTTER', erziehungsberechtigt: 'ja' })).status).toBe(400);
	});

	it('zweites PUT aendert statt zu doppeln', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const erw = await v.erwachsener();
		await v.put(kind.id, erw.id, { beziehung: 'MUTTER' });
		await v.put(kind.id, erw.id, { beziehung: 'TANTE' });
		const zeilen = await v.zeilen(kind.id);
		expect(zeilen).toHaveLength(1);
		expect(zeilen[0]).toMatchObject({ beziehung: 'TANTE', erziehungsberechtigt: false, beziehungFreitext: null });
	});

	it('Erwachsener als Kind angegeben: 404', async () => {
		const v = await neuerVerein();
		const a = await v.erwachsener('A');
		const b = await v.erwachsener('B');
		expect((await v.put(a.id, b.id, { beziehung: 'MUTTER' })).status).toBe(404);
	});

	it('Kind als Erwachsener angegeben: 404', async () => {
		const v = await neuerVerein();
		const a = await v.kind('A');
		const b = await v.kind('B');
		expect((await v.put(a.id, b.id, { beziehung: 'MUTTER' })).status).toBe(404);
	});

	it('Grabstein als Familie: 404', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const erw = await v.erwachsener();
		const entfernt = await v.erwachsener('Weg');
		await prisma.person.update({ where: { id: entfernt.id }, data: { entferntAm: new Date() } });
		expect((await v.put(kind.id, entfernt.id, { beziehung: 'MUTTER' })).status).toBe(404);
		await prisma.person.update({ where: { id: kind.id }, data: { entferntAm: new Date() } });
		expect((await v.put(kind.id, erw.id, { beziehung: 'MUTTER' })).status).toBe(404);
		expect(await v.zeilen(kind.id)).toHaveLength(0);
	});

	it('Verwalter ohne JUGENDLEITER_RECHTE verknuepft einen Jugendleiter: 404', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const leiter = await v.erwachsener('Leiter', ['MITGLIEDER']);
		expect((await v.put(kind.id, leiter.id, { beziehung: 'ANDERE', beziehungFreitext: 'x' })).status).toBe(404);
		expect(await v.zeilen(kind.id)).toHaveLength(0);
		// Mit dem Recht geht es.
		const chef = await legeMitgliedAn(prisma, v.verein, {
			art: 'ERWACHSENER',
			rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE'],
		});
		const r = await v.put(kind.id, leiter.id, { beziehung: 'VATER' }, chef.cookie);
		expect(r.status).toBe(200);
		// Und loesen: ohne das Recht 404 und die Zeile bleibt.
		expect((await v.loesche(kind.id, leiter.id)).status).toBe(404);
		expect(await v.zeilen(kind.id)).toHaveLength(1);
		expect((await v.loesche(kind.id, leiter.id, chef.cookie)).status).toBe(204);
	});

	it('DELETE loest; zweites DELETE: 204', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const erw = await v.erwachsener();
		await v.put(kind.id, erw.id, { beziehung: 'MUTTER' });
		expect((await v.loesche(kind.id, erw.id)).status).toBe(204);
		expect(await v.zeilen(kind.id)).toHaveLength(0);
		expect((await v.loesche(kind.id, erw.id)).status).toBe(204);
	});

	it('DELETE mit falscher Art oder Grabstein: 404', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const erw = await v.erwachsener();
		expect((await v.loesche(erw.id, kind.id)).status).toBe(404);
		await prisma.person.update({ where: { id: erw.id }, data: { entferntAm: new Date() } });
		expect((await v.loesche(kind.id, erw.id)).status).toBe(404);
	});

	/** Kind mit Zugang, dessen einzige Einwilligung die Mutter erteilt hat. */
	async function kindMitEinwilligung(v: Awaited<ReturnType<typeof neuerVerein>>) {
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const mutter = await v.erwachsener('Mutter');
		await v.put(kind.personId, mutter.id, { beziehung: 'MUTTER' });
		await prisma.einwilligung.create({
			data: {
				vereinId: v.verein.id,
				jungfischerId: kind.personId,
				erteiltVon: mutter.id,
				art: 'DSGVO_ART8',
				textVersion: '1',
			},
		});
		return { kind, mutter };
	}
	const hatZugang = async (kindId: string) => ({
		erlaubt: (await prisma.person.findUniqueOrThrow({ where: { id: kindId } })).zugangErlaubt,
		zugaenge: await prisma.zugang.count({ where: { personId: kindId } }),
	});

	it('Familie loesen ohne verbleibende gueltige Einwilligung entzieht den Zugang des Kindes', async () => {
		const v = await neuerVerein();
		const { kind, mutter } = await kindMitEinwilligung(v);
		expect((await v.loesche(kind.personId, mutter.id)).status).toBe(204);
		expect(await hatZugang(kind.personId)).toEqual({ erlaubt: false, zugaenge: 0 });
	});

	it('Familie loesen mit anderem einwilligenden Erziehungsberechtigten laesst den Zugang', async () => {
		const v = await neuerVerein();
		const { kind, mutter } = await kindMitEinwilligung(v);
		const vater = await v.erwachsener('Vater');
		await v.put(kind.personId, vater.id, { beziehung: 'VATER' });
		await prisma.einwilligung.create({
			data: {
				vereinId: v.verein.id,
				jungfischerId: kind.personId,
				erteiltVon: vater.id,
				art: 'DSGVO_ART8',
				textVersion: '1',
			},
		});
		expect((await v.loesche(kind.personId, mutter.id)).status).toBe(204);
		expect(await hatZugang(kind.personId)).toEqual({ erlaubt: true, zugaenge: 1 });
	});

	it('Wechsel erziehungsberechtigt true auf false entzieht den Zugang; false auf true oder gleichbleibend nicht', async () => {
		const v = await neuerVerein();
		const { kind, mutter } = await kindMitEinwilligung(v);
		// Gleichbleibend und true: nichts geschieht.
		expect((await v.put(kind.personId, mutter.id, { beziehung: 'MUTTER', erziehungsberechtigt: true })).status).toBe(
			200,
		);
		expect(await hatZugang(kind.personId)).toEqual({ erlaubt: true, zugaenge: 1 });
		expect((await v.put(kind.personId, mutter.id, { beziehung: 'MUTTER', erziehungsberechtigt: false })).status).toBe(
			200,
		);
		expect(await hatZugang(kind.personId)).toEqual({ erlaubt: false, zugaenge: 0 });
	});

	it('volljaehriges Kind: Familie loesen und Wechsel auf nicht erziehungsberechtigt nehmen den Zugang nicht', async () => {
		const v = await neuerVerein();
		const { kind, mutter } = await kindMitEinwilligung(v);
		await prisma.person.update({ where: { id: kind.personId }, data: { geburtsdatum: new Date('2000-01-01') } });
		expect((await v.put(kind.personId, mutter.id, { beziehung: 'MUTTER', erziehungsberechtigt: false })).status).toBe(
			200,
		);
		expect(await hatZugang(kind.personId)).toEqual({ erlaubt: true, zugaenge: 1 });
		expect((await sende(server.url, `/${v.verein.slug}/api/v1/ich`, { cookie: kind.cookie })).status).toBe(200);
		expect((await v.loesche(kind.personId, mutter.id)).status).toBe(204);
		expect(await hatZugang(kind.personId)).toEqual({ erlaubt: true, zugaenge: 1 });
		expect((await sende(server.url, `/${v.verein.slug}/api/v1/ich`, { cookie: kind.cookie })).status).toBe(200);
	});

	it('ohne MITGLIEDER: 404, nichts geschrieben', async () => {
		const v = await neuerVerein();
		const kind = await v.kind();
		const erw = await v.erwachsener();
		const betreuer = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', rechte: ['ANTWORTEN_DETAIL'] });
		expect((await v.put(kind.id, erw.id, { beziehung: 'MUTTER' }, betreuer.cookie)).status).toBe(404);
		await v.put(kind.id, erw.id, { beziehung: 'MUTTER' });
		expect((await v.loesche(kind.id, erw.id, betreuer.cookie)).status).toBe(404);
		expect(await v.zeilen(kind.id)).toHaveLength(1);
	});
});
