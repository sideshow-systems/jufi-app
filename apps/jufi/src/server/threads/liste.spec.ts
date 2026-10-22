import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import type { StartAnsicht, TerminZeile, ThreadAnsicht, ThreadListe } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeThreadAn, ordneZu, trageEinTest } from './test-threads.js';

// Feste Uhr der App und fester Zugangszeitpunkt: "neu" und "archiviert" sollen nicht von der Wanduhr abhaengen.
const JETZT = new Date('2026-10-22T10:00:00.000Z');
const ZUGANG = new Date('2026-10-10T10:00:00.000Z');
/** Frist einer Helferliste, die noch laeuft: morgen um dieselbe Zeit. */
const MORGEN = new Date('2026-10-23T10:00:00.000Z');

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

	it('zeigt einen Thread mit Helferliste, ohne dass Eintraege oder Notizen in die Liste geraten', async () => {
		const s = await szenario();
		const t = await s.bowling('Sommerfest', {
			module: [{ typ: 'HELFER', frist: MORGEN, positionen: [{ text: 'Kuchen', anzahl: 4 }] }],
		});
		await trageEinTest(
			vereinDb(prisma, s.verein.id),
			t.positionIds['kuchen'] as string,
			s.sandra.personId,
			s.sandra.personId,
			'Marmorkuchen',
		);
		const sandra = await s.liste(s.sandra.cookie);
		expect(sandra.threads.map((z) => z.id)).toEqual([t.threadId]);
		expect(JSON.stringify(sandra)).not.toContain('Marmorkuchen');
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

		it('die Antwort einer anderen Familie macht Bowling fuer Sandra nur neu, wenn sie Ergebnisse sieht', async () => {
			const s = await szenario();
			const peter = await legeMitgliedAn(prisma, s.verein, { jetzt: JETZT, art: 'ERWACHSENER', vorname: 'Peter' });
			const paul = await legeMitgliedAn(prisma, s.verein, { jetzt: JETZT, art: 'JUNGFISCHER', vorname: 'Paul' });
			await ordneZu(prisma, s.verein, peter.personId, paul.personId);

			const nachAntwort = async (ergebnisse: 'JUGENDLEITER' | 'ALLE') => {
				const t = await s.bowling(`Bowling ${ergebnisse}`, {
					module: [{ typ: 'UMFRAGE', teilnahme: true, ergebnisse }],
				});
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

				const antwort = await sende(server.url, s.api(`/umfragen/${t.modulIds[0]}/antworten/${paul.personId}`), {
					methode: 'PUT',
					body: { optionIds: [t.optionIds['dabei']], clientId: randomUUID() },
					cookie: peter.cookie,
				});
				expect(antwort.status).toBe(200);
				return {
					sandra: (await s.zeile(s.sandra.cookie, t.threadId))?.neu,
					thomas: (await s.zeile(s.thomas.cookie, t.threadId))?.neu,
				};
			};

			expect(await nachAntwort('JUGENDLEITER')).toEqual({ sandra: false, thomas: true });
			expect(await nachAntwort('ALLE')).toEqual({ sandra: true, thomas: true });
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

		it('findet einen Thread ueber den Namen einer Datei in seinem Datei-Modul', async () => {
			const s = await szenario();
			const treffer = await s.bowling('Zeltlager', {
				module: [{ typ: 'DATEIEN', dateien: [{ name: 'Packliste-Sommer.pdf' }] }],
			});
			await s.bowling('Bowling');
			const r = await s.liste(s.sandra.cookie, `?suche=${encodeURIComponent('packliste')}`);
			expect(r.threads.map((z) => z.id)).toEqual([treffer.threadId]);
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
	const termin = (startDatum: string, beginn: string | null = '16:00') => ({
		typ: 'TERMIN' as const,
		termin: { startDatum, endDatum: null, beginn, ende: null, ort: null, treffpunkt: null },
	});

	describe('GET /start', () => {
		const start = async (s: Awaited<ReturnType<typeof szenario>>, cookie: string) => {
			const r = await sende(server.url, s.api('/start'), { cookie });
			expect(r.status).toBe(200);
			return (await r.json()) as StartAnsicht;
		};

		it('Sandra sieht Bowling in allen drei Bloecken, den Jugendleiter-Thread nirgends', async () => {
			const s = await szenario();
			const t = await s.bowling('Bowling', {
				module: [{ typ: 'UMFRAGE', teilnahme: true, einheit: 'PERSON' }, termin('2026-10-26')],
			});
			// Gleiches Muster, aber nur fuer Jugendleiter: Umfrage und Termin duerfen Sandra nicht erreichen.
			await s.bowling('Leiterrunde', {
				rollenfilter: 'NUR_JUGENDLEITER',
				module: [{ typ: 'UMFRAGE', teilnahme: true, einheit: 'PERSON' }, termin('2026-10-25')],
			});

			const sandra = await start(s, s.sandra.cookie);
			expect(sandra.brauchtAntwort).toHaveLength(2);
			expect(new Set(sandra.brauchtAntwort.map((p) => p.vorname))).toEqual(new Set([null, 'Lena']));
			expect(sandra.brauchtAntwort.every((p) => p.threadId === t.threadId)).toBe(true);
			expect(sandra.alsNaechstes.map((z) => z.titel)).toEqual(['Bowling']);
			expect(sandra.neu).toEqual([
				{
					threadId: t.threadId,
					segment: expect.stringMatching(/^.+-bowling$/),
					titel: 'Bowling',
					angabe: 'Neuer Thread',
				},
			]);
			expect(JSON.stringify(sandra)).not.toContain('Leiterrunde');
		});

		it('Thomas sieht seinen Entwurf nirgends', async () => {
			const s = await szenario();
			await s.bowling('Geplant', {
				veroeffentlicht: false,
				module: [{ typ: 'UMFRAGE', teilnahme: true, einheit: 'PERSON' }, termin('2026-10-26')],
			});
			const thomas = await start(s, s.thomas.cookie);
			expect(thomas.brauchtAntwort).toEqual([]);
			expect(thomas.alsNaechstes).toEqual([]);
			// Neu ist hoechstens der Austausch (ohne Ersteller angelegt, also fremd), nie der Entwurf.
			expect(thomas.neu.map((n) => n.titel)).toEqual(['Jugendsprecher-Austausch']);
		});

		it('ein archivierter Thread steht weder unter Als Naechstes noch unter Braucht deine Antwort', async () => {
			const s = await szenario();
			await s.bowling('Vorbei', {
				archivModus: 'ARCHIVIERT',
				module: [{ typ: 'UMFRAGE', teilnahme: true, einheit: 'PERSON' }, termin('2026-10-26')],
			});
			expect(await start(s, s.sandra.cookie)).toEqual({ brauchtAntwort: [], alsNaechstes: [], neu: [] });
		});

		it('Braucht deine Antwort stimmt weiter, obwohl die Liste ohne Antworten laedt und nur aktive Threads nachlaedt', async () => {
			const s = await szenario();
			const umfrage = [{ typ: 'UMFRAGE' as const, teilnahme: true, einheit: 'PERSON' as const }];
			// Archiviert mit offener Umfrage: kommt nicht vor.
			await s.bowling('Vorbei', { archivModus: 'ARCHIVIERT', module: umfrage });
			// Aktiv und fuer beide beantwortet: kommt nicht vor.
			const fertig = await s.bowling('Fertig', { module: umfrage });
			// Aktiv, nur fuer Sandra beantwortet: Lena fehlt noch.
			const offen = await s.bowling('Offen', { module: umfrage });
			const antworte = (t: typeof fertig, fuerId: string) =>
				vereinDb(prisma, s.verein.id).umfrageAntwort.create({
					data: {
						umfrageId: t.modulIds[0],
						fuerId,
						vonId: s.sandra.personId,
						abgegebenAm: JETZT,
						clientId: randomUUID(),
						optionen: { create: [{ optionId: t.optionIds['dabei'] }] },
					},
				});
			await antworte(fertig, s.sandra.personId);
			await antworte(fertig, s.lena.personId);
			await antworte(offen, s.sandra.personId);

			const sandra = await start(s, s.sandra.cookie);

			expect(sandra.brauchtAntwort).toHaveLength(1);
			expect(sandra.brauchtAntwort[0]).toMatchObject({ threadId: offen.threadId, vorname: 'Lena' });
		});

		it('Braucht deine Antwort nennt Sandra fuer eine Helferliste mit Frist morgen, solange sie sich nicht eingetragen hat', async () => {
			const s = await szenario();
			const helfer = {
				typ: 'HELFER' as const,
				einheit: 'ERWACHSENER' as const,
				frist: MORGEN,
				positionen: [{ text: 'Kuchen', anzahl: 4 }],
			};
			const offen = await s.bowling('Sommerfest', { module: [helfer] });
			const erledigt = await s.bowling('Herbstfest', { module: [helfer] });
			await trageEinTest(
				vereinDb(prisma, s.verein.id),
				erledigt.positionIds['kuchen'] as string,
				s.sandra.personId,
				s.sandra.personId,
			);

			const sandra = await start(s, s.sandra.cookie);
			expect(sandra.brauchtAntwort).toEqual([
				expect.objectContaining({
					threadId: offen.threadId,
					titel: 'Sommerfest',
					modulId: offen.modulIds[0],
					fuerId: s.sandra.personId,
					vorname: null,
					frist: MORGEN.toISOString(),
				}),
			]);
		});

		it('ist ohne Anmeldung 401 und schreibt nichts', async () => {
			const s = await szenario();
			await s.bowling();
			expect((await sende(server.url, s.api('/start'))).status).toBe(401);
			const vorher = await s.stand();
			await start(s, s.sandra.cookie);
			expect(await s.stand()).toBe(vorher);
			expect(await prisma.gelesenStand.count({ where: { vereinId: s.verein.id } })).toBe(0);
		});
	});

	describe('GET /termine', () => {
		const termine = async (s: Awaited<ReturnType<typeof szenario>>, cookie: string, monat: string) => {
			const r = await sende(server.url, s.api(`/termine?monat=${monat}`), { cookie });
			expect(r.status).toBe(200);
			return ((await r.json()) as { termine: TerminZeile[] }).termine;
		};

		it('zeigt Bowling und einen archivierten Thread, aber keinen Entwurf und keinen unsichtbaren Thread', async () => {
			const s = await szenario();
			const bowling = await s.bowling('Bowling', { module: [termin('2026-10-26')] });
			// Termin vor acht Tagen: archiviert, steht aber im Kalender seines Monats.
			const archiv = await s.bowling('Ausflug', { module: [termin('2026-10-14')] });
			await s.bowling('Geplant', { veroeffentlicht: false, module: [termin('2026-10-27')] });
			await s.bowling('Leiterrunde', { rollenfilter: 'NUR_JUGENDLEITER', module: [termin('2026-10-28')] });

			const sandra = await termine(s, s.sandra.cookie, '2026-10');
			expect(sandra.map((z) => z.threadId)).toEqual([archiv.threadId, bowling.threadId]);
			expect(sandra[1]).toMatchObject({
				segment: expect.stringMatching(/^.+-bowling$/),
				titel: 'Bowling',
				termin: { startDatum: '2026-10-26', beginn: '16:00' },
			});
			// Auch Thomas sieht seinen Entwurf im Kalender nicht, die Leiterrunde aber schon.
			expect((await termine(s, s.thomas.cookie, '2026-10')).map((z) => z.titel)).toEqual([
				'Ausflug',
				'Bowling',
				'Leiterrunde',
			]);
		});

		it('ein Termin ueber die Monatsgrenze steht in beiden Monaten, in einem anderen Monat ist die Liste leer', async () => {
			const s = await szenario();
			const t = await s.bowling('Zeltlager', {
				module: [{ ...termin('2026-10-30'), termin: { ...termin('2026-10-30').termin, endDatum: '2026-11-02' } }],
			});
			expect((await termine(s, s.sandra.cookie, '2026-10')).map((z) => z.threadId)).toEqual([t.threadId]);
			expect((await termine(s, s.sandra.cookie, '2026-11')).map((z) => z.threadId)).toEqual([t.threadId]);
			expect(await termine(s, s.sandra.cookie, '2026-09')).toEqual([]);
		});

		it.each(['2026-13', '2026-1', '', '2026-10-01', 'a'])('monat=%j ist 400 mit dem Feld monat', async (monat) => {
			const s = await szenario();
			const r = await sende(server.url, s.api(`/termine?monat=${monat}`), { cookie: s.sandra.cookie });
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'monat' });
		});

		it('ohne monat und mit wiederholtem monat ist 400', async () => {
			const s = await szenario();
			for (const abfrage of ['', '?monat=2026-10&monat=2026-11']) {
				const r = await sende(server.url, s.api(`/termine${abfrage}`), { cookie: s.sandra.cookie });
				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'monat' });
			}
		});

		it('ist ohne Anmeldung 401', async () => {
			const s = await szenario();
			expect((await sende(server.url, s.api('/termine?monat=2026-10'))).status).toBe(401);
		});
	});
});
