import { createPrismaClientFromEnv } from '@jufi/db';
import type { ThreadAnsicht, ThreadListe } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeThreadAn, ordneZu } from './test-threads.js';

// Feste Uhr der App und fester Zugangszeitpunkt: "neu" und "archiviert" sollen nicht von der Wanduhr abhaengen.
const JETZT = new Date('2026-10-22T10:00:00.000Z');
const ZUGANG = new Date('2026-10-10T10:00:00.000Z');

describe('GET /threads', () => {
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

	/** Ein Verein je Test mit Thomas (Jugendleiter), Sandra (Mutter von Lena) und Lena; alle Zugaenge von ZUGANG. */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `liste-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) =>
			legeMitgliedAn(prisma, verein, { jetzt: JETZT, ...e });
		const thomas = await mitglied({ art: 'ERWACHSENER', vorname: 'Thomas', rechte: ['THREADS_ERSTELLEN'] });
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Mutter' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Mutter' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		await prisma.zugang.updateMany({ where: { vereinId: verein.id }, data: { angelegtAm: ZUGANG } });

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const liste = async (cookie: string, abfrage = '') => {
			const r = await sende(server.url, api(`/threads${abfrage}`), { cookie });
			expect(r.status).toBe(200);
			return (await r.json()) as ThreadListe;
		};
		const zeile = async (cookie: string, threadId: string, abfrage = '') =>
			(await liste(cookie, abfrage)).threads.find((t) => t.id === threadId);
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const bowling = (titel = 'Bowling', erweiterung: Parameters<typeof legeThreadAn>[3] = {}) =>
			legeThreadAn(prisma, verein, JETZT, { titel, erstelltVonId: thomas.personId, ...erweiterung });
		return { verein, thomas, sandra, lena, api, liste, zeile, stand, bowling };
	}

	it('Sandra sieht Bowling, nicht den Austausch und nicht den Entwurf; Thomas sieht den Entwurf', async () => {
		const s = await szenario();
		const t = await s.bowling();
		const entwurf = await s.bowling('Geplant', { veroeffentlicht: false });

		const sandra = await s.liste(s.sandra.cookie);
		expect(sandra.threads.map((z) => z.titel)).toEqual(['Bowling']);
		expect(sandra.archiv).toBe(0);
		expect(sandra.threads[0]).toMatchObject({ id: t.threadId, segment: expect.stringMatching(/^.+-bowling$/) });

		const thomas = await s.liste(s.thomas.cookie);
		expect(thomas.threads.map((z) => z.titel).sort()).toEqual(['Bowling', 'Geplant', 'Jugendsprecher-Austausch']);
		expect(thomas.threads.find((z) => z.id === entwurf.threadId)?.entwurf).toBe(true);
		expect(thomas.threads.find((z) => z.id === t.threadId)?.entwurf).toBe(false);
	});

	it('ist ohne Anmeldung 401', async () => {
		const s = await szenario();
		expect((await sende(server.url, s.api('/threads'))).status).toBe(401);
	});

	describe('neu', () => {
		it('Antwort von Thomas macht Bowling neu, Gelesen macht es alt, Anpinnen aendert nichts, eine Aenderung ohne Urheber macht es wieder neu', async () => {
			const s = await szenario();
			const t = await s.bowling();
			// Thomas hat den Thread selbst angelegt, fuer Thomas ist er nie neu; Sandras Zugang liegt vor dem Thread.
			const nachricht = await sende(server.url, s.api(`/threads/${t.threadId}/verlauf`), {
				methode: 'POST',
				body: { text: 'Bringt Socken mit', clientId: 'thomas-1' },
				cookie: s.thomas.cookie,
			});
			expect(nachricht.status).toBe(201);
			expect((await s.zeile(s.sandra.cookie, t.threadId))?.neu).toBe(true);
			expect((await s.zeile(s.thomas.cookie, t.threadId))?.neu).toBe(false);

			const ansicht = (await (
				await sende(server.url, s.api(`/threads/${t.threadId}`), { cookie: s.sandra.cookie })
			).json()) as ThreadAnsicht;
			const gelesen = await sende(server.url, s.api(`/threads/${t.threadId}/gelesen`), {
				methode: 'PUT',
				body: { bereich: 'uebersicht', bis: ansicht.stand },
				cookie: s.sandra.cookie,
			});
			expect(gelesen.status).toBe(204);
			expect((await s.zeile(s.sandra.cookie, t.threadId))?.neu).toBe(false);

			const gepinnt = await sende(server.url, s.api(`/threads/${t.threadId}/angepinnt`), {
				methode: 'PUT',
				body: { angepinnt: true },
				cookie: s.thomas.cookie,
			});
			expect(gepinnt.status).toBe(200);
			expect(await s.zeile(s.sandra.cookie, t.threadId)).toMatchObject({ angepinnt: true, neu: false });

			// Direkt angelegt, ohne Urheber (Systemeintrag): fremd, also neu.
			const { aenderungsstand } = await prisma.verein.update({
				where: { id: s.verein.id },
				data: { aenderungsstand: { increment: 1 } },
				select: { aenderungsstand: true },
			});
			await prisma.aenderung.create({
				data: {
					vereinId: s.verein.id,
					stand: aenderungsstand,
					threadId: t.threadId,
					art: 'THREAD',
					objektId: t.threadId,
					urheberId: null,
					angelegtAm: JETZT,
				},
			});
			expect((await s.zeile(s.sandra.cookie, t.threadId))?.neu).toBe(true);
		});

		it('ein Thread vor dem Zugang ist ohne Gelesen-Zeile nicht neu', async () => {
			const s = await szenario();
			const alt = await legeThreadAn(prisma, s.verein, new Date('2026-10-01T10:00:00Z'), {
				titel: 'Alt',
				erstelltVonId: s.thomas.personId,
			});
			expect((await s.zeile(s.sandra.cookie, alt.threadId))?.neu).toBe(false);
		});

		it('Anfragen an die Liste aendern weder Stand noch Gelesen-Staende', async () => {
			const s = await szenario();
			await s.bowling();
			const vorher = await s.stand();
			await s.liste(s.sandra.cookie);
			await s.liste(s.sandra.cookie, '?archiv=1&suche=bow');
			expect(await s.stand()).toBe(vorher);
			expect(await prisma.gelesenStand.count({ where: { vereinId: s.verein.id } })).toBe(0);
		});
	});

	describe('Archiv', () => {
		it('ein Thread mit Termin vor acht Tagen fehlt ohne archiv=1 und steht mit archiv=1 als archiviert, nie neu, in der Liste', async () => {
			const s = await szenario();
			const t = await s.bowling('Ausflug', {
				module: [
					{
						typ: 'TERMIN',
						termin: {
							startDatum: '2026-10-14',
							endDatum: null,
							beginn: '10:00',
							ende: null,
							ort: null,
							treffpunkt: null,
						},
					},
				],
			});

			const zu = await s.liste(s.sandra.cookie);
			expect(zu.threads).toEqual([]);
			expect(zu.archiv).toBe(1);

			const auf = await s.liste(s.sandra.cookie, '?archiv=1');
			expect(auf.archiv).toBe(1);
			expect(auf.threads).toHaveLength(1);
			expect(auf.threads[0]).toMatchObject({ id: t.threadId, archiviert: true, neu: false });
		});

		it('archiv ist nur mit dem Wert 1 gesetzt', async () => {
			const s = await szenario();
			await s.bowling('Ausflug', {
				module: [
					{
						typ: 'TERMIN',
						termin: {
							startDatum: '2026-10-14',
							endDatum: null,
							beginn: '10:00',
							ende: null,
							ort: null,
							treffpunkt: null,
						},
					},
				],
			});
			for (const abfrage of ['?archiv=0', '?archiv=true', '?archiv=']) {
				expect((await s.liste(s.sandra.cookie, abfrage)).threads).toEqual([]);
			}
		});
	});

	describe('Suche', () => {
		it('100% findet "100% Spass", nicht "1000 Spass"', async () => {
			const s = await szenario();
			const treffer = await s.bowling('100% Spaß');
			await s.bowling('1000 Spaß');
			const r = await s.liste(s.sandra.cookie, `?suche=${encodeURIComponent('100%')}`);
			expect(r.threads.map((z) => z.id)).toEqual([treffer.threadId]);
		});

		it('findet ohne Beachtung der Gross- und Kleinschreibung und trimmt den Rand', async () => {
			const s = await szenario();
			const t = await s.bowling('Übernachten im Zelt');
			const r = await s.liste(s.sandra.cookie, `?suche=${encodeURIComponent('  ÜBERNACHTEN ')}`);
			expect(r.threads.map((z) => z.id)).toEqual([t.threadId]);
		});

		it('nur Leerraum ist keine Suche', async () => {
			const s = await szenario();
			await s.bowling();
			expect((await s.liste(s.sandra.cookie, `?suche=${encodeURIComponent('   ')}`)).threads).toHaveLength(1);
		});

		it('Sandra findet den Austausch auch ueber die Suche nicht', async () => {
			const s = await szenario();
			await s.bowling();
			const r = await s.liste(s.sandra.cookie, '?suche=Jugendsprecher&archiv=1');
			expect(r).toEqual({ threads: [], archiv: 0 });
			// Thomas findet ihn, die Suche ist also nicht nur leer.
			expect((await s.liste(s.thomas.cookie, '?suche=Jugendsprecher')).threads).toHaveLength(1);
		});

		it('100 Zeichen gehen, 101 sind 400 mit dem Feld suche', async () => {
			const s = await szenario();
			const hole = (suche: string) => sende(server.url, s.api(`/threads?suche=${suche}`), { cookie: s.sandra.cookie });
			expect((await hole('a'.repeat(100))).status).toBe(200);
			const r = await hole('a'.repeat(101));
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'suche' });
		});

		it('ein wiederholter Parameter ist 400, kein Absturz', async () => {
			const s = await szenario();
			const r = await sende(server.url, s.api('/threads?suche=a&suche=b'), { cookie: s.sandra.cookie });
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'suche' });
		});

		it('zaehlt in "archiv" nur archivierte Threads, die zur Suche passen', async () => {
			const s = await szenario();
			const termin = {
				typ: 'TERMIN' as const,
				termin: { startDatum: '2026-10-14', endDatum: null, beginn: '10:00', ende: null, ort: null, treffpunkt: null },
			};
			await s.bowling('Ausflug', { module: [termin] });
			await s.bowling('Wanderung', { module: [termin] });
			expect((await s.liste(s.sandra.cookie, '?suche=ausflug')).archiv).toBe(1);
			expect((await s.liste(s.sandra.cookie)).archiv).toBe(2);
		});
	});

	it('ordnet nach letzter Aktivitaet, neueste zuerst', async () => {
		const s = await szenario();
		const a = await s.bowling('A');
		const b = await s.bowling('B');
		await prisma.thread.update({
			where: { id: a.threadId },
			data: { letzteAktivitaetAm: new Date('2026-10-20T10:00:00Z') },
		});
		await prisma.thread.update({
			where: { id: b.threadId },
			data: { letzteAktivitaetAm: new Date('2026-10-21T10:00:00Z') },
		});
		expect((await s.liste(s.sandra.cookie)).threads.map((z) => z.titel)).toEqual(['B', 'A']);
	});
});
