import { createPrismaClientFromEnv } from '@jufi/db';
import { RECHTE_VORLAGEN } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

describe('Rechte vergeben', () => {
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

	/** Eigener Verein je Test: die Leitung zaehlt, also darf kein anderer Test hineinreichen. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `rechte-${randomUUID().slice(0, 8)}` });
		const inhaber = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
		const verwalter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['MITGLIEDER'] });
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const setze = (personId: string, rechte: unknown, cookie = inhaber.cookie) =>
			sende(server.url, api(`/personen/${personId}/rechte`), { methode: 'PUT', body: { rechte }, cookie });
		const rechteVon = async (personId: string) =>
			[...(await prisma.person.findUniqueOrThrow({ where: { id: personId } })).rechte].sort();
		return { verein, inhaber, verwalter, setze, rechteVon };
	}

	it('Leitung vergibt die Vorlage Jugendleiter', async () => {
		const v = await neuerVerein();
		const ziel = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		const r = await v.setze(ziel.personId, [...RECHTE_VORLAGEN.JUGENDLEITER]);
		expect(r.status).toBe(200);
		expect(((await r.json()) as { rechte: string[] }).rechte.sort()).toEqual([...RECHTE_VORLAGEN.JUGENDLEITER].sort());
		expect(await v.rechteVon(ziel.personId)).toEqual([...RECHTE_VORLAGEN.JUGENDLEITER].sort());
	});

	it('Duplikate werden zusammengefasst', async () => {
		const v = await neuerVerein();
		const ziel = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		const r = await v.setze(ziel.personId, ['DOKUMENTE', 'DOKUMENTE', 'MITGLIEDER']);
		expect(r.status).toBe(200);
		expect(await v.rechteVon(ziel.personId)).toEqual(['DOKUMENTE', 'MITGLIEDER']);
	});

	it('Verwalter ohne JUGENDLEITER_RECHTE: 404, Rechte unveraendert, auch beim Selbstversuch', async () => {
		const v = await neuerVerein();
		const ziel = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		expect((await v.setze(ziel.personId, ['DOKUMENTE'], v.verwalter.cookie)).status).toBe(404);
		expect(await v.rechteVon(ziel.personId)).toEqual([]);
		const selbst = await v.setze(v.verwalter.personId, ['MITGLIEDER', 'JUGENDLEITER_RECHTE'], v.verwalter.cookie);
		expect(selbst.status).toBe(404);
		expect(await v.rechteVon(v.verwalter.personId)).toEqual(['MITGLIEDER']);
	});

	it('einziger Inhaber gibt JUGENDLEITER_RECHTE ab: 409 LETZTE_LEITUNG', async () => {
		const v = await neuerVerein();
		const r = await v.setze(v.inhaber.personId, ['MITGLIEDER']);
		expect(r.status).toBe(409);
		expect(((await r.json()) as { code: string }).code).toBe('LETZTE_LEITUNG');
		expect(await v.rechteVon(v.inhaber.personId)).toEqual(['JUGENDLEITER_RECHTE']);
	});

	it('Inhaber entzieht sich selbst, wenn ein zweiter da ist: 200', async () => {
		const v = await neuerVerein();
		await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
		const r = await v.setze(v.inhaber.personId, []);
		expect(r.status).toBe(200);
		expect(await v.rechteVon(v.inhaber.personId)).toEqual([]);
	});

	it('zwei Inhaber entziehen sich gleichzeitig: genau einmal 200, einmal 409, einer behaelt das Recht', async () => {
		// Mehrere Durchlaeufe, damit das Rennen real ist: ohne die Sperre sehen beide Anfragen den
		// jeweils anderen noch als Leitung und beide kommen durch.
		for (let i = 0; i < 8; i++) {
			const v = await neuerVerein();
			const zweiter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', rechte: ['JUGENDLEITER_RECHTE'] });
			const [a, b] = await Promise.all([
				v.setze(v.inhaber.personId, [], v.inhaber.cookie),
				v.setze(zweiter.personId, [], zweiter.cookie),
			]);
			expect([a.status, b.status].sort()).toEqual([200, 409]);
			const mitRecht = [await v.rechteVon(v.inhaber.personId), await v.rechteVon(zweiter.personId)].filter((r) =>
				r.includes('JUGENDLEITER_RECHTE'),
			);
			expect(mitRecht).toHaveLength(1);
		}
	});

	it('Jungfischer als Ziel: 404', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		expect((await v.setze(kind.personId, ['DOKUMENTE'])).status).toBe(404);
		expect(await v.rechteVon(kind.personId)).toEqual([]);
	});

	it('entfernte Person als Ziel: 404', async () => {
		const v = await neuerVerein();
		const ziel = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await prisma.person.update({ where: { id: ziel.personId }, data: { entferntAm: new Date() } });
		expect((await v.setze(ziel.personId, ['DOKUMENTE'])).status).toBe(404);
		expect(await v.rechteVon(ziel.personId)).toEqual([]);
	});

	it('unbekanntes Recht oder keine Liste: 400', async () => {
		const v = await neuerVerein();
		const ziel = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		for (const rechte of [['GOTT'], 'MITGLIEDER', undefined, [1]]) {
			expect((await v.setze(ziel.personId, rechte)).status).toBe(400);
		}
		expect(await v.rechteVon(ziel.personId)).toEqual([]);
	});
});
