import { createPrismaClientFromEnv, mitAenderung, vereinDb } from '@jufi/db';
import type { SyncAntwort } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeThreadAn, ordneZu } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');

describe('GET /sync', () => {
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

	/** Ein Verein je Test mit Thomas (Jugendleiter mit Rechtevergabe), Sandra (Mutter von Lena) und Lena. */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `sync-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) =>
			legeMitgliedAn(prisma, verein, { jetzt: JETZT, ...e });
		const thomas = await mitglied({
			art: 'ERWACHSENER',
			vorname: 'Thomas',
			rechte: ['THREADS_ERSTELLEN', 'JUGENDLEITER_RECHTE'],
		});
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Mutter' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Mutter' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const sync = (cookie: string | undefined, abfrage = '') => sende(server.url, api(`/sync${abfrage}`), { cookie });
		const antwort = async (cookie: string, abfrage = '') => {
			const r = await sync(cookie, abfrage);
			expect(r.status).toBe(200);
			return (await r.json()) as SyncAntwort;
		};
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const bowling = () => legeThreadAn(prisma, verein, JETZT, { titel: 'Bowling', erstelltVonId: thomas.personId });
		const nachricht = async (threadId: string) => {
			const r = await sende(server.url, api(`/threads/${threadId}/verlauf`), {
				methode: 'POST',
				body: { text: 'Bringt Socken mit', clientId: randomUUID() },
				cookie: thomas.cookie,
			});
			expect(r.status).toBe(201);
			return stand();
		};
		return { verein, thomas, sandra, lena, api, sync, antwort, stand, bowling, nachricht };
	}

	it('ohne seit ist die Antwort vollstaendig und traegt den Vereinsstand', async () => {
		const s = await szenario();
		await s.bowling();
		expect(await s.antwort(s.sandra.cookie)).toEqual({
			stand: await s.stand(),
			geaendert: [],
			unsichtbar: [],
			vollstaendig: true,
		});
	});

	it('meldet einen Thread erst, wenn nach seit etwas an ihm geschehen ist', async () => {
		const s = await szenario();
		const t = await s.bowling();
		const nachErster = await s.nachricht(t.threadId);

		expect(await s.antwort(s.sandra.cookie, `?seit=${nachErster}`)).toEqual({
			stand: nachErster,
			geaendert: [],
			unsichtbar: [],
			vollstaendig: false,
		});

		const nachZweiter = await s.nachricht(t.threadId);
		expect(await s.antwort(s.sandra.cookie, `?seit=${nachErster}`)).toEqual({
			stand: nachZweiter,
			geaendert: [t.threadId],
			unsichtbar: [],
			vollstaendig: false,
		});
	});

	it('ein Thread, den Sandra nicht mehr sieht, steht unter unsichtbar, ein geloeschter auch', async () => {
		const s = await szenario();
		const umgestellt = await s.bowling();
		const geloescht = await s.bowling();
		const vorher = await s.stand();
		const db = vereinDb(prisma, s.verein.id);
		await db.$transaction((tx) =>
			mitAenderung(tx, s.verein.id, s.thomas.personId, JETZT, async () => {
				await tx.thread.update({ where: { id: umgestellt.threadId }, data: { rollenfilter: 'NUR_JUGENDLEITER' } });
				return {
					ergebnis: null,
					aenderungen: [{ threadId: umgestellt.threadId, art: 'SICHTBARKEIT' as const, objektId: umgestellt.threadId }],
				};
			}),
		);
		await db.$transaction((tx) =>
			mitAenderung(tx, s.verein.id, s.thomas.personId, JETZT, async () => {
				await tx.thread.delete({ where: { id: geloescht.threadId } });
				return {
					ergebnis: null,
					aenderungen: [{ threadId: geloescht.threadId, art: 'GELOESCHT' as const, objektId: geloescht.threadId }],
				};
			}),
		);

		const sandra = await s.antwort(s.sandra.cookie, `?seit=${vorher}`);
		expect(sandra).toMatchObject({ geaendert: [], vollstaendig: false });
		expect([...sandra.unsichtbar].sort()).toEqual([umgestellt.threadId, geloescht.threadId].sort());
		// Thomas sieht den umgestellten Thread weiter; nur der geloeschte ist fuer ihn weg.
		expect(await s.antwort(s.thomas.cookie, `?seit=${vorher}`)).toMatchObject({
			geaendert: [umgestellt.threadId],
			unsichtbar: [geloescht.threadId],
		});
	});

	it('nach einer Rechteaenderung (Aenderung ohne Thread) ist die Antwort vollstaendig', async () => {
		const s = await szenario();
		await s.bowling();
		const vorher = await s.stand();
		const r = await sende(server.url, s.api(`/personen/${s.sandra.personId}/rechte`), {
			methode: 'PUT',
			body: { rechte: ['DOKUMENTE'] },
			cookie: s.thomas.cookie,
		});
		expect(r.status).toBe(200);

		expect(await s.antwort(s.sandra.cookie, `?seit=${vorher}`)).toEqual({
			stand: await s.stand(),
			geaendert: [],
			unsichtbar: [],
			vollstaendig: true,
		});
	});

	describe('Luecken im Verlauf', () => {
		it('ein seit hinter dem Stand ist vollstaendig (Datenbank aus einer Sicherung)', async () => {
			const s = await szenario();
			await s.bowling();
			const stand = await s.stand();
			expect(await s.antwort(s.sandra.cookie, `?seit=${stand + 1}`)).toMatchObject({ stand, vollstaendig: true });
			expect(await s.antwort(s.sandra.cookie, `?seit=${stand}`)).toMatchObject({ stand, vollstaendig: false });
		});

		it('aufgeraeumte Zeilen: seit vor dem Aufraeumen ist vollstaendig, seit gleich Stand nicht', async () => {
			const s = await szenario();
			const t = await s.bowling();
			for (let i = 0; i < 4; i++) await s.nachricht(t.threadId);
			const stand = await s.stand();
			expect(stand).toBeGreaterThanOrEqual(5);
			await prisma.aenderung.deleteMany({ where: { vereinId: s.verein.id } });

			expect(await s.antwort(s.sandra.cookie, `?seit=${stand - 2}`)).toMatchObject({ vollstaendig: true });
			expect(await s.antwort(s.sandra.cookie, `?seit=${stand}`)).toMatchObject({ vollstaendig: false });
		});
	});

	it('ein ungueltiges seit ist 400 mit dem Feld', async () => {
		const s = await szenario();
		for (const abfrage of [
			'?seit=abc',
			'?seit=-1',
			'?seit=1.5',
			'?seit=',
			'?seit=1e3',
			'?seit=1&seit=2',
			'?seit=99999999999999999999',
		]) {
			const r = await s.sync(s.sandra.cookie, abfrage);
			expect(r.status, abfrage).toBe(400);
			expect(await r.json(), abfrage).toMatchObject({ feld: 'seit' });
		}
	});

	it('ist ohne Anmeldung 401', async () => {
		const s = await szenario();
		expect((await s.sync(undefined, '?seit=0')).status).toBe(401);
	});

	it('Anfragen an den Sync aendern weder Stand noch Zeilen', async () => {
		const s = await szenario();
		const t = await s.bowling();
		await s.nachricht(t.threadId);
		const vorher = {
			stand: await s.stand(),
			zeilen: await prisma.aenderung.count({ where: { vereinId: s.verein.id } }),
		};
		await s.antwort(s.sandra.cookie);
		await s.antwort(s.sandra.cookie, '?seit=0');
		expect({
			stand: await s.stand(),
			zeilen: await prisma.aenderung.count({ where: { vereinId: s.verein.id } }),
		}).toEqual(vorher);
	});
});
