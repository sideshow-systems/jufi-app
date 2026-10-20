import { createPrismaClientFromEnv } from '@jufi/db';
import type { VerlaufAnsicht } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { Fensterzaehler } from './fenster.js';
import { legeThreadAn, ordneZu } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

interface Seite {
	eintraege: VerlaufAnsicht[];
	weitere: boolean;
}

interface Geschrieben {
	eintrag: VerlaufAnsicht;
	stand: number;
}

describe('Verlauf lesen, schreiben und loeschen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	// Eigene App mit einem Fenster von zwei Nachrichten: so prueft der Test das Rate-Limit,
	// ohne 31 Nachrichten zu schreiben, und die anderen Tests stossen nie an die Grenze.
	let eng: TestServer;

	beforeAll(async () => {
		const deps = { prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, jetzt: () => JETZT };
		server = await starteTestServer(createApp(deps));
		eng = await starteTestServer(
			createApp({ ...deps, nachrichtenFenster: new Fensterzaehler(2, 60_000, () => JETZT.getTime()) }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await eng.schliessen();
		await prisma.$disconnect();
	});

	/**
	 * Ein Verein je Test: Thomas legt die Threads an (darf sie also bearbeiten), Sandra ist
	 * die Mutter von Lena, Hans der Grossvater von Lena. Sandra und Hans sehen damit jeden
	 * Thread fuer "Jungfischer und Familie", duerfen aber nur ihre eigenen Nachrichten loeschen.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `verlauf-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) =>
			legeMitgliedAn(prisma, verein, { jetzt: JETZT, ...e });
		const thomas = await mitglied({ art: 'ERWACHSENER', vorname: 'Thomas', rechte: ['THREADS_ERSTELLEN'] });
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Mutter' });
		const hans = await mitglied({ art: 'ERWACHSENER', vorname: 'Hans', nachname: 'Opa' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Mutter' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		await ordneZu(prisma, verein, hans.personId, lena.personId, 'GROSSVATER');

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const thread = (daten: Parameters<typeof legeThreadAn>[3] = {}) =>
			legeThreadAn(prisma, verein, JETZT, { titel: 'Bowling', erstelltVonId: thomas.personId, ...daten });
		const lies = (threadId: string, cookie: string, vor?: string) =>
			sende(server.url, api(`/threads/${threadId}/verlauf${vor === undefined ? '' : `?vor=${vor}`}`), { cookie });
		const seite = async (threadId: string, cookie: string, vor?: string) => {
			const r = await lies(threadId, cookie, vor);
			expect(r.status).toBe(200);
			return (await r.json()) as Seite;
		};
		const schreibe = (threadId: string, body: unknown, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/threads/${threadId}/verlauf`), { methode: 'POST', body, cookie });
		/** Schreibt eine Nachricht, die gelingen muss, und liefert die Antwort. */
		const nachricht = async (threadId: string, cookie: string, text = 'Hallo zusammen') => {
			const r = await schreibe(threadId, { text, clientId: randomUUID() }, cookie);
			expect(r.status).toBe(201);
			return (await r.json()) as Geschrieben;
		};
		const loesche = (eintragId: string, cookie: string) =>
			sende(server.url, api(`/verlauf/${eintragId}`), { methode: 'DELETE', cookie });
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const zeilen = (threadId: string) => prisma.verlaufEintrag.count({ where: { threadId } });
		return {
			verein,
			thomas,
			sandra,
			hans,
			lena,
			api,
			thread,
			lies,
			seite,
			schreibe,
			nachricht,
			loesche,
			stand,
			zeilen,
		};
	}

	describe('GET /threads/:id/verlauf', () => {
		it('120 Eintraege ergeben Seiten zu 50, 50 und 20, lueckenlos und ohne Doppelte, auch bei gleichem Stand', async () => {
			const s = await szenario();
			const t = await s.thread();
			// Je drei Eintraege teilen sich einen Stand: die Seitengrenze faellt so mitten in eine Gruppe.
			const angelegt = await prisma.verlaufEintrag.createManyAndReturn({
				data: Array.from({ length: 120 }, (_, i) => ({
					vereinId: s.verein.id,
					threadId: t.threadId,
					art: 'NACHRICHT' as const,
					autorId: s.thomas.personId,
					text: `Nachricht ${i}`,
					stand: 1000 + Math.floor(i / 3),
					angelegtAm: JETZT,
				})),
				select: { id: true },
			});

			const erste = await s.seite(t.threadId, s.sandra.cookie);
			const zweite = await s.seite(t.threadId, s.sandra.cookie, erste.eintraege.at(-1)?.id);
			const dritte = await s.seite(t.threadId, s.sandra.cookie, zweite.eintraege.at(-1)?.id);

			expect([erste, zweite, dritte].map((p) => [p.eintraege.length, p.weitere])).toEqual([
				[50, true],
				[50, true],
				[20, false],
			]);
			const alle = [...erste.eintraege, ...zweite.eintraege, ...dritte.eintraege];
			expect(new Set(alle.map((e) => e.id)).size).toBe(120);
			expect(alle.map((e) => e.id).sort()).toEqual(angelegt.map((e) => e.id).sort());
			// Neueste zuerst: der Stand faellt nie.
			const staende = alle.map((e) => e.stand);
			expect(staende).toEqual([...staende].sort((a, b) => b - a));
			expect(alle[0]).toMatchObject({
				art: 'NACHRICHT',
				stand: 1039,
				eigen: false,
				absender: 'Thomas M. (Jugendleiter)',
			});
		});

		it('genau 50 Eintraege sind eine Seite ohne weitere', async () => {
			const s = await szenario();
			const t = await s.thread();
			await prisma.verlaufEintrag.createMany({
				data: Array.from({ length: 50 }, (_, i) => ({
					vereinId: s.verein.id,
					threadId: t.threadId,
					art: 'NACHRICHT' as const,
					autorId: s.thomas.personId,
					text: `Nachricht ${i}`,
					stand: 1000 + i,
				})),
			});

			const erste = await s.seite(t.threadId, s.sandra.cookie);

			expect([erste.eintraege.length, erste.weitere]).toEqual([50, false]);
		});

		it('vor aus einem anderen Thread, unbekannt oder leer ist 404', async () => {
			const s = await szenario();
			const t = await s.thread();
			const anderer = await s.thread({ titel: 'Zeltlager' });
			const dort = await s.nachricht(anderer.threadId, s.sandra.cookie);

			for (const vor of [dort.eintrag.id, 'gibt-es-nicht', '']) {
				const r = await s.lies(t.threadId, s.sandra.cookie, vor);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
		});

		it('ein unsichtbarer oder unbekannter Thread ist dieselbe 404', async () => {
			const s = await szenario();
			const nurLeiter = await s.thread({ rollenfilter: 'NUR_JUGENDLEITER' });
			await s.nachricht(nurLeiter.threadId, s.thomas.cookie);
			const austausch = await prisma.thread.findFirstOrThrow({
				where: { vereinId: s.verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' },
			});

			const texte: string[] = [];
			for (const id of [nurLeiter.threadId, austausch.id, 'gibt-es-nicht']) {
				const r = await s.lies(id, s.sandra.cookie);
				expect(r.status).toBe(404);
				texte.push(await r.text());
			}
			expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
			expect(new Set(texte).size).toBe(1);
		});

		it('ohne Sitzung 401', async () => {
			const s = await szenario();
			const t = await s.thread();
			const r = await sende(server.url, s.api(`/threads/${t.threadId}/verlauf`));
			expect(r.status).toBe(401);
		});
	});

	describe('POST /threads/:id/verlauf', () => {
		it('Sandra schreibt: 201, ohne Leerraum an den Enden, eigener Stand, eine Aenderung VERLAUF, Aktivitaet', async () => {
			const s = await szenario();
			const t = await s.thread();
			const vorher = await s.stand();

			const r = await s.schreibe(
				t.threadId,
				{ text: '  Wo ist der Treffpunkt?  ', clientId: 'sandra-1' },
				s.sandra.cookie,
			);

			expect(r.status).toBe(201);
			const { eintrag, stand } = (await r.json()) as Geschrieben;
			expect(stand).toBe(vorher + 1);
			expect(await s.stand()).toBe(stand);
			expect(eintrag).toEqual({
				id: expect.any(String),
				art: 'NACHRICHT',
				text: 'Wo ist der Treffpunkt?',
				absender: 'Sandra M. (Mutter von Lena)',
				eigen: true,
				angelegtAm: JETZT.toISOString(),
				stand,
				geloescht: null,
				darfLoeschen: true,
			});
			const zeile = await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: eintrag.id } });
			expect(zeile).toMatchObject({
				threadId: t.threadId,
				autorId: s.sandra.personId,
				text: 'Wo ist der Treffpunkt?',
				stand,
				clientId: 'sandra-1',
				angelegtAm: JETZT,
			});
			const aenderungen = await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } });
			expect(aenderungen).toEqual([
				expect.objectContaining({
					threadId: t.threadId,
					art: 'VERLAUF',
					objektId: eintrag.id,
					urheberId: s.sandra.personId,
				}),
			]);
			const kopf = await prisma.thread.findUniqueOrThrow({ where: { id: t.threadId } });
			expect(kopf.letzteAktivitaetStand).toBe(stand);
			expect(kopf.letzteAktivitaetAm).toEqual(JETZT);

			// Hans liest dieselbe Nachricht als fremde.
			const beiHans = await s.seite(t.threadId, s.hans.cookie);
			expect(beiHans.eintraege).toEqual([{ ...eintrag, eigen: false, darfLoeschen: false }]);
		});

		it.each([
			['leer', { text: '', clientId: 'c-1' }, 'text'],
			['nur Leerraum', { text: '   \n\t ', clientId: 'c-1' }, 'text'],
			['2001 Zeichen', { text: 'a'.repeat(2001), clientId: 'c-1' }, 'text'],
			['2001 Zeichen mit Leerraum drumherum', { text: ` ${'a'.repeat(2001)} `, clientId: 'c-1' }, 'text'],
			['text als Zahl', { text: 5, clientId: 'c-1' }, 'text'],
			['text fehlt', { clientId: 'c-1' }, 'text'],
			['clientId fehlt', { text: 'Hallo' }, 'clientId'],
			['clientId mit Leerzeichen', { text: 'Hallo', clientId: 'a b' }, 'clientId'],
			['clientId zu lang', { text: 'Hallo', clientId: 'a'.repeat(101) }, 'clientId'],
			['clientId leer', { text: 'Hallo', clientId: '' }, 'clientId'],
		])('%s: 400 mit feld, ohne Zeile und ohne Stand', async (_name, body, feld) => {
			const s = await szenario();
			const t = await s.thread();
			const vorher = await s.stand();

			const r = await s.schreibe(t.threadId, body, s.sandra.cookie);

			expect(r.status).toBe(400);
			expect(await r.json()).toMatchObject({ feld });
			expect(await s.zeilen(t.threadId)).toBe(0);
			expect(await s.stand()).toBe(vorher);
		});

		it('2000 Emoji (je ein Code-Point, zwei UTF-16-Einheiten) sind erlaubt', async () => {
			const s = await szenario();
			const t = await s.thread();
			const text = '🎣'.repeat(2000);

			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie, text);

			expect(eintrag.text).toBe(text);
			expect((await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: eintrag.id } })).text).toBe(text);
		});

		it('Entwurf 409 ENTWURF, Nur Aushang 409 NUR_AUSHANG, archiviert 409 ARCHIVIERT, Austausch 404 -- nie ein Stand', async () => {
			const s = await szenario();
			const entwurf = await s.thread({ veroeffentlicht: false });
			const aushang = await s.thread({ modus: 'AUSHANG' });
			const archiviert = await s.thread({ archivModus: 'ARCHIVIERT' });
			const austausch = await prisma.thread.findFirstOrThrow({
				where: { vereinId: s.verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' },
			});
			const vorher = await s.stand();
			const body = { text: 'Hallo', clientId: 'sperre-1' };

			const faelle: [string, string, number, object][] = [
				[entwurf.threadId, s.thomas.cookie, 409, { code: 'ENTWURF' }],
				[aushang.threadId, s.sandra.cookie, 409, { code: 'NUR_AUSHANG' }],
				[archiviert.threadId, s.sandra.cookie, 409, { code: 'ARCHIVIERT' }],
				[austausch.id, s.sandra.cookie, 404, NICHT_GEFUNDEN],
				['gibt-es-nicht', s.sandra.cookie, 404, NICHT_GEFUNDEN],
			];
			for (const [threadId, cookie, status, antwort] of faelle) {
				const r = await s.schreibe(threadId, body, cookie);
				expect(r.status).toBe(status);
				expect(await r.json()).toMatchObject(antwort);
			}
			expect(await s.stand()).toBe(vorher);
			expect(await prisma.verlaufEintrag.count({ where: { vereinId: s.verein.id } })).toBe(0);
		});

		it('dieselbe clientId zweimal nacheinander: 201, dann 200 mit demselben Eintrag; eine Zeile, ein Stand', async () => {
			const s = await szenario();
			const t = await s.thread();
			const vorher = await s.stand();
			const body = { text: 'Ich bringe Kuchen mit', clientId: 'doppelt-1' };

			const erste = await s.schreibe(t.threadId, body, s.sandra.cookie);
			const zweite = await s.schreibe(t.threadId, body, s.sandra.cookie);

			expect([erste.status, zweite.status]).toEqual([201, 200]);
			const a = (await erste.json()) as Geschrieben;
			expect(await zweite.json()).toEqual(a);
			expect(await s.zeilen(t.threadId)).toBe(1);
			expect(await s.stand()).toBe(vorher + 1);
		});

		it('dieselbe clientId zweimal gleichzeitig: ein 201 und ein 200, eine Zeile, ein Stand', async () => {
			const s = await szenario();
			const t = await s.thread();
			const vorher = await s.stand();
			const body = { text: 'Doppeltipp', clientId: 'gleichzeitig-1' };

			const antworten = await Promise.all([1, 2].map(() => s.schreibe(t.threadId, body, s.sandra.cookie)));

			expect(antworten.map((r) => r.status).sort()).toEqual([200, 201]);
			const [a, b] = (await Promise.all(antworten.map((r) => r.json()))) as Geschrieben[];
			expect(a).toEqual(b);
			expect(await s.zeilen(t.threadId)).toBe(1);
			expect(await s.stand()).toBe(vorher + 1);
		});

		it('die clientId einer fremden Nachricht oder eines anderen Threads: 409 CLIENT_ID_VERGEBEN ohne Text', async () => {
			const s = await szenario();
			const t = await s.thread();
			const anderer = await s.thread({ titel: 'Zeltlager' });
			const geheim = { text: 'Nur fuer Sandra', clientId: 'vergeben-1' };
			expect((await s.schreibe(t.threadId, geheim, s.sandra.cookie)).status).toBe(201);
			const vorher = await s.stand();

			const fremd = await s.schreibe(t.threadId, { text: 'Hallo', clientId: 'vergeben-1' }, s.hans.cookie);
			const woanders = await s.schreibe(anderer.threadId, geheim, s.sandra.cookie);

			for (const r of [fremd, woanders]) {
				expect(r.status).toBe(409);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', code: 'CLIENT_ID_VERGEBEN' });
			}
			expect(await s.stand()).toBe(vorher);
			expect(await prisma.verlaufEintrag.count({ where: { vereinId: s.verein.id } })).toBe(1);
		});

		it('mehr als zwei Nachrichten im engen Fenster: die dritte ist 429 mit wartenSekunden', async () => {
			const s = await szenario();
			const t = await s.thread();
			const sende3 = (n: number) =>
				s.schreibe(t.threadId, { text: `Nachricht ${n}`, clientId: `fenster-${n}` }, s.sandra.cookie, eng);

			expect((await sende3(1)).status).toBe(201);
			expect((await sende3(2)).status).toBe(201);
			const dritte = await sende3(3);

			expect(dritte.status).toBe(429);
			expect(await dritte.json()).toEqual({ fehler: 'Zu viele Versuche', wartenSekunden: 60 });
			expect(await s.zeilen(t.threadId)).toBe(2);
			// Das Fenster zaehlt je Person: Hans schreibt weiter.
			const hans = await s.schreibe(t.threadId, { text: 'Ich auch', clientId: 'fenster-h' }, s.hans.cookie, eng);
			expect(hans.status).toBe(201);
		});

		it('ohne Sitzung 401', async () => {
			const s = await szenario();
			const t = await s.thread();
			const r = await sende(server.url, s.api(`/threads/${t.threadId}/verlauf`), {
				methode: 'POST',
				body: { text: 'Hallo', clientId: 'ohne-1' },
			});
			expect(r.status).toBe(401);
		});
	});

	describe('DELETE /verlauf/:eintragId', () => {
		it('Sandra loescht ihre Nachricht: 204, Text weg, Loescherin gesetzt, Aenderung VERLAUF', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);
			const vorher = await s.stand();

			const r = await s.loesche(eintrag.id, s.sandra.cookie);

			expect(r.status).toBe(204);
			const stand = await s.stand();
			expect(stand).toBe(vorher + 1);
			expect(await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: eintrag.id } })).toMatchObject({
				text: null,
				geloeschtAm: JETZT,
				geloeschtVonId: s.sandra.personId,
				// Der Stand der Nachricht bleibt: sie steht weiter an ihrer Stelle im Verlauf.
				stand: eintrag.stand,
			});
			expect(await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } })).toEqual([
				expect.objectContaining({ threadId: t.threadId, art: 'VERLAUF', objektId: eintrag.id }),
			]);
			expect((await prisma.thread.findUniqueOrThrow({ where: { id: t.threadId } })).letzteAktivitaetStand).toBe(stand);
			const [gelesen] = (await s.seite(t.threadId, s.hans.cookie)).eintraege;
			expect(gelesen).toMatchObject({ id: eintrag.id, text: null, geloescht: 'SELBST', darfLoeschen: false });
		});

		it('ein zweites Loeschen ist 204 ohne neuen Stand', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);
			expect((await s.loesche(eintrag.id, s.sandra.cookie)).status).toBe(204);
			const vorher = await s.stand();

			expect((await s.loesche(eintrag.id, s.sandra.cookie)).status).toBe(204);

			expect(await s.stand()).toBe(vorher);
		});

		it('zweimal gleichzeitig geloescht: beide 204, genau ein Stand', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);
			const vorher = await s.stand();

			const antworten = await Promise.all([1, 2].map(() => s.loesche(eintrag.id, s.sandra.cookie)));

			expect(antworten.map((r) => r.status)).toEqual([204, 204]);
			expect(await s.stand()).toBe(vorher + 1);
		});

		it('Thomas darf den Thread bearbeiten und loescht Sandras Nachricht: beim Lesen MODERATION', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);

			expect((await s.loesche(eintrag.id, s.thomas.cookie)).status).toBe(204);

			expect(await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: eintrag.id } })).toMatchObject({
				text: null,
				geloeschtVonId: s.thomas.personId,
			});
			const [gelesen] = (await s.seite(t.threadId, s.sandra.cookie)).eintraege;
			expect(gelesen).toMatchObject({ id: eintrag.id, text: null, geloescht: 'MODERATION', eigen: true });
		});

		it('Hans loescht Sandras Nachricht: 404, alles bleibt', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);
			const vorher = await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: eintrag.id } });
			const stand = await s.stand();

			const r = await s.loesche(eintrag.id, s.hans.cookie);

			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			expect(await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: eintrag.id } })).toEqual(vorher);
			expect(await s.stand()).toBe(stand);
		});

		it('auch eine schon geloeschte fremde Nachricht bleibt fuer Hans 404', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);
			await s.loesche(eintrag.id, s.sandra.cookie);

			const r = await s.loesche(eintrag.id, s.hans.cookie);

			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
		});

		it('ein Systemeintrag ist auch fuer Thomas 404', async () => {
			const s = await szenario();
			const t = await s.thread();
			const system = await prisma.verlaufEintrag.create({
				data: {
					vereinId: s.verein.id,
					threadId: t.threadId,
					art: 'SYSTEM',
					autorId: s.thomas.personId,
					systemArt: 'VEROEFFENTLICHT',
					systemDaten: {},
					stand: await s.stand(),
				},
			});
			const stand = await s.stand();

			const r = await s.loesche(system.id, s.thomas.cookie);

			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			expect((await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: system.id } })).geloeschtAm).toBeNull();
			expect(await s.stand()).toBe(stand);
		});

		it('unbekannter Eintrag und Eintrag in einem unsichtbaren Thread sind dieselbe 404', async () => {
			const s = await szenario();
			const nurLeiter = await s.thread({ rollenfilter: 'NUR_JUGENDLEITER' });
			const { eintrag } = await s.nachricht(nurLeiter.threadId, s.thomas.cookie);

			const texte: string[] = [];
			for (const id of [eintrag.id, 'gibt-es-nicht']) {
				const r = await s.loesche(id, s.sandra.cookie);
				expect(r.status).toBe(404);
				texte.push(await r.text());
			}
			expect(new Set(texte).size).toBe(1);
		});

		it('Sandra loescht ihre Nachricht im archivierten Thread: 204', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);
			await prisma.thread.update({ where: { id: t.threadId }, data: { archivModus: 'ARCHIVIERT' } });

			expect((await s.loesche(eintrag.id, s.sandra.cookie)).status).toBe(204);
			expect((await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: eintrag.id } })).text).toBeNull();
		});

		it('ohne Sitzung 401', async () => {
			const s = await szenario();
			const t = await s.thread();
			const { eintrag } = await s.nachricht(t.threadId, s.sandra.cookie);
			const r = await sende(server.url, s.api(`/verlauf/${eintrag.id}`), { methode: 'DELETE' });
			expect(r.status).toBe(401);
		});
	});
});
