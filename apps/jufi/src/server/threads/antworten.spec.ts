import { createPrismaClientFromEnv, mitAenderung, vereinDb } from '@jufi/db';
import type { ThreadAnsicht, UmfrageAnsicht } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sammleEreignisse } from '../echtzeit/test-bus.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { ThreadAbbruch, Wiederholung } from './fehler.js';
import { Fensterzaehler } from './fenster.js';
import { schreibeAntwort } from './antworten.js';
import { legeThreadAn, ordneZu, type TestModul } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');
/** Donnerstag, 22.10.2026, 18:00 in Berlin (Sommerzeit). */
const FRIST = new Date('2026-10-22T16:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

interface Geantwortet {
	modul: UmfrageAnsicht;
	stand: number;
}

type UmfrageModul = Extract<TestModul, { typ: 'UMFRAGE' }>;

describe('PUT /umfragen/:modulId/antworten/:fuerId', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	// Eigene App mit einem Fenster von zwei Antworten, wie in verlauf.spec.ts.
	let eng: TestServer;
	// Eigene App mit verstellbarer Uhr, fuer die Wiederholung ueber die Frist hinweg.
	let uhr = JETZT;
	let gestellt: TestServer;
	const ereignisse = sammleEreignisse();

	beforeAll(async () => {
		const deps = {
			prisma,
			version: { version: '1.2.3', commit: 'abc' },
			umgebung: TEST_UMGEBUNG,
			jetzt: () => JETZT,
			bus: ereignisse.bus,
		};
		server = await starteTestServer(createApp(deps));
		eng = await starteTestServer(
			createApp({ ...deps, antwortenFenster: new Fensterzaehler(2, 60_000, () => JETZT.getTime()) }),
		);
		gestellt = await starteTestServer(createApp({ ...deps, jetzt: () => uhr }));
	});

	afterAll(async () => {
		await server.schliessen();
		await eng.schliessen();
		await gestellt.schliessen();
		await prisma.$disconnect();
	});

	/**
	 * Ein Verein je Test: Thomas Keller legt die Threads an (darf sie bearbeiten und also
	 * nachtragen), Sandra ist die Mutter von Lena und Max, Hans der Grossvater von Max,
	 * Peter der Vater von Tim. Jonas hat hier keine Familie; fuer Sandra ist er ein fremdes Kind.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `antworten-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) =>
			legeMitgliedAn(prisma, verein, { jetzt: JETZT, ...e });
		const thomas = await mitglied({
			art: 'ERWACHSENER',
			vorname: 'Thomas',
			nachname: 'Keller',
			rechte: ['THREADS_ERSTELLEN'],
		});
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Maier' });
		const hans = await mitglied({ art: 'ERWACHSENER', vorname: 'Hans', nachname: 'Maier' });
		const peter = await mitglied({ art: 'ERWACHSENER', vorname: 'Peter', nachname: 'Sommer' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Maier' });
		const max = await mitglied({ art: 'JUNGFISCHER', vorname: 'Max', nachname: 'Maier' });
		const tim = await mitglied({ art: 'JUNGFISCHER', vorname: 'Tim', nachname: 'Sommer' });
		const jonas = await mitglied({ art: 'JUNGFISCHER', vorname: 'Jonas', nachname: 'Keller' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		await ordneZu(prisma, verein, sandra.personId, max.personId);
		await ordneZu(prisma, verein, hans.personId, max.personId, 'GROSSVATER');
		await ordneZu(prisma, verein, peter.personId, tim.personId, 'VATER');

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		/** Ein Thread mit genau einer Umfrage; ohne Angaben "Kommst du mit?" pro Jungfischer mit Frist am Abend. */
		const umfrage = async (modul: Omit<UmfrageModul, 'typ'> = {}, daten: Parameters<typeof legeThreadAn>[3] = {}) => {
			const t = await legeThreadAn(prisma, verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: thomas.personId,
				module: [{ typ: 'UMFRAGE', teilnahme: true, frist: FRIST, ...modul }],
				...daten,
			});
			return { threadId: t.threadId, modulId: t.modulIds[0] as string, o: t.optionIds };
		};
		const antworte = (modulId: string, fuerId: string, body: unknown, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/umfragen/${modulId}/antworten/${fuerId}`), { methode: 'PUT', body, cookie });
		/** Eine Antwort, die gelingen muss. */
		const gib = async (modulId: string, fuerId: string, optionIds: string[], cookie: string) => {
			const r = await antworte(modulId, fuerId, { optionIds, clientId: randomUUID() }, cookie);
			expect(r.status).toBe(200);
			return (await r.json()) as Geantwortet;
		};
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const zeilen = () =>
			prisma.umfrageAntwort.findMany({
				where: { vereinId: verein.id },
				include: { optionen: { select: { optionId: true } } },
			});
		return {
			verein,
			thomas,
			sandra,
			hans,
			peter,
			lena,
			max,
			tim,
			jonas,
			api,
			umfrage,
			antworte,
			gib,
			stand,
			zeilen,
			ereignisse: () => ereignisse.fuer(verein.id),
		};
	}

	it('Sandra antwortet fuer Max: 200 mit Zeile und Stand, eine Antwortzeile, eine Aenderung ANTWORT', async () => {
		const s = await szenario();
		const u = await s.umfrage();
		const vorher = await s.stand();

		const r = await s.antworte(
			u.modulId,
			s.max.personId,
			{ optionIds: [u.o['dabei']], clientId: 'sandra-max-1' },
			s.sandra.cookie,
		);

		expect(r.status).toBe(200);
		const { modul, stand } = (await r.json()) as Geantwortet;
		expect(stand).toBe(vorher + 1);
		expect(await s.stand()).toBe(stand);
		expect(modul).toMatchObject({ typ: 'UMFRAGE', id: u.modulId, fristAbgelaufen: false });
		expect(modul.zeilen).toEqual([
			expect.objectContaining({ fuerId: s.lena.personId, optionIds: [], eingetragenVon: null }),
			{
				fuerId: s.max.personId,
				vorname: 'Max',
				selbst: false,
				optionIds: [u.o['dabei']],
				eingetragenVon: 'von dir eingetragen',
				darfAntworten: true,
			},
		]);
		const [zeile, ...rest] = await s.zeilen();
		expect(rest).toEqual([]);
		expect(zeile).toMatchObject({
			umfrageId: u.modulId,
			fuerId: s.max.personId,
			vonId: s.sandra.personId,
			abgegebenAm: JETZT,
			clientId: 'sandra-max-1',
			optionen: [{ optionId: u.o['dabei'] }],
		});
		expect(await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } })).toEqual([
			expect.objectContaining({
				threadId: u.threadId,
				art: 'ANTWORT',
				objektId: zeile?.id,
				urheberId: s.sandra.personId,
			}),
		]);
		expect((await prisma.thread.findUniqueOrThrow({ where: { id: u.threadId } })).letzteAktivitaetStand).toBe(stand);
	});

	it('Lena aendert die Antwort, die Sandra fuer sie gab: eine Zeile, Optionen ersetzt, vonId Lena', async () => {
		const s = await szenario();
		const u = await s.umfrage();
		await s.gib(u.modulId, s.lena.personId, [u.o['dabei'] as string], s.sandra.cookie);

		const { modul } = await s.gib(u.modulId, s.lena.personId, [u.o['abgesagt'] as string], s.lena.cookie);

		expect(modul.zeilen).toEqual([
			expect.objectContaining({
				fuerId: s.lena.personId,
				selbst: true,
				optionIds: [u.o['abgesagt']],
				eingetragenVon: null,
			}),
		]);
		const alle = await s.zeilen();
		expect(alle).toHaveLength(1);
		expect(alle[0]).toMatchObject({ vonId: s.lena.personId, optionen: [{ optionId: u.o['abgesagt'] }] });
	});

	it('nicht gefragt, unsichtbar, kein Umfrage-Modul oder unbekannt: dieselbe 404, nichts geschrieben', async () => {
		const s = await szenario();
		const u = await s.umfrage();
		const info = await legeThreadAn(prisma, s.verein, JETZT, {
			erstelltVonId: s.thomas.personId,
			module: [{ typ: 'INFO', text: 'Treffpunkt am Vereinsheim' }],
		});
		const nurLeiter = await s.umfrage({ einheit: 'ERWACHSENER' }, { rollenfilter: 'NUR_JUGENDLEITER' });
		const vorher = await s.stand();

		const faelle: [string, string][] = [
			// Jonas ist gefragt, aber nicht Sandras Kind.
			[u.modulId, s.jonas.personId],
			// Pro Jungfischer: Sandra selbst ist nicht gefragt.
			[u.modulId, s.sandra.personId],
			[u.modulId, 'gibt-es-nicht'],
			[info.modulIds[0] as string, s.max.personId],
			[nurLeiter.modulId, s.sandra.personId],
			['gibt-es-nicht', s.max.personId],
		];
		const texte: string[] = [];
		for (const [modulId, fuerId] of faelle) {
			const r = await s.antworte(
				modulId,
				fuerId,
				{ optionIds: [u.o['dabei']], clientId: randomUUID() },
				s.sandra.cookie,
			);
			expect(r.status).toBe(404);
			texte.push(await r.text());
		}
		expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
		expect(new Set(texte).size).toBe(1);
		expect(await s.zeilen()).toEqual([]);
		expect(await s.stand()).toBe(vorher);
	});

	it('um 18:00:00 bekommt Sandra 410 FRIST_ABGELAUFEN, eine Millisekunde davor 200', async () => {
		const s = await szenario();
		const abgelaufen = await s.umfrage({ frist: JETZT });
		const knapp = await s.umfrage({ frist: new Date(JETZT.getTime() + 1) });
		const vorher = await s.stand();

		const r = await s.antworte(
			abgelaufen.modulId,
			s.max.personId,
			{ optionIds: [abgelaufen.o['dabei']], clientId: 'zu-spaet' },
			s.sandra.cookie,
		);

		expect(r.status).toBe(410);
		expect(await r.json()).toEqual({ fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' });
		expect(await s.stand()).toBe(vorher);
		expect(await s.zeilen()).toEqual([]);
		await s.gib(knapp.modulId, s.max.personId, [knapp.o['dabei'] as string], s.sandra.cookie);
	});

	it('Thomas traegt nach der Frist fuer Tim nach: 200, Peter liest "eingetragen von Thomas K."', async () => {
		const s = await szenario();
		const u = await s.umfrage({ frist: new Date(JETZT.getTime() - 3_600_000) });

		const { modul } = await s.gib(u.modulId, s.tim.personId, [u.o['dabei'] as string], s.thomas.cookie);

		expect(modul.fristAbgelaufen).toBe(true);
		const r = await sende(server.url, s.api(`/threads/${u.threadId}`), { cookie: s.peter.cookie });
		expect(r.status).toBe(200);
		const ansicht = (await r.json()) as ThreadAnsicht;
		const beiPeter = ansicht.module.find((m): m is UmfrageAnsicht => m.typ === 'UMFRAGE');
		expect(beiPeter?.zeilen).toEqual([
			expect.objectContaining({
				fuerId: s.tim.personId,
				optionIds: [u.o['dabei']],
				eingetragenVon: 'eingetragen von Thomas K.',
				darfAntworten: false,
			}),
		]);
	});

	it('Entwurf: 409 ENTWURF fuer Thomas, 404 fuer Sandra, die ihn nicht sieht; nie ein Stand', async () => {
		const s = await szenario();
		const u = await s.umfrage({}, { veroeffentlicht: false });
		const vorher = await s.stand();

		const leiter = await s.antworte(
			u.modulId,
			s.tim.personId,
			{ optionIds: [u.o['dabei']], clientId: 'e-1' },
			s.thomas.cookie,
		);
		const mutter = await s.antworte(
			u.modulId,
			s.max.personId,
			{ optionIds: [u.o['dabei']], clientId: 'e-2' },
			s.sandra.cookie,
		);

		expect(leiter.status).toBe(409);
		expect(await leiter.json()).toEqual({ fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' });
		expect(mutter.status).toBe(404);
		expect(await mutter.json()).toEqual(NICHT_GEFUNDEN);
		expect(await s.zeilen()).toEqual([]);
		expect(await s.stand()).toBe(vorher);
	});

	describe('Optionen', () => {
		type Fall = (o: Record<string, string>, fremd: Record<string, string>) => unknown;
		it.each<[string, Fall, string]>([
			['leer', () => ({ optionIds: [], clientId: 'c-1' }), 'optionen'],
			['fehlt', () => ({ clientId: 'c-1' }), 'optionen'],
			['keine Liste', (o) => ({ optionIds: o['dabei'], clientId: 'c-1' }), 'optionen'],
			['Zahl in der Liste', () => ({ optionIds: [5], clientId: 'c-1' }), 'optionen'],
			['Option einer anderen Umfrage', (_o, fremd) => ({ optionIds: [fremd['ja']], clientId: 'c-1' }), 'optionen'],
			['doppelte ID', (o) => ({ optionIds: [o['dabei'], o['dabei']], clientId: 'c-1' }), 'optionen'],
			['zwei bei mehrfach false', (o) => ({ optionIds: [o['dabei'], o['abgesagt']], clientId: 'c-1' }), 'optionen'],
			[
				'Vielleicht einer anderen Umfrage bei abgeschaltetem Vielleicht',
				(_o, fremd) => ({ optionIds: [fremd['vielleicht']], clientId: 'c-1' }),
				'optionen',
			],
			['der Schluessel statt der ID', () => ({ optionIds: ['vielleicht'], clientId: 'c-1' }), 'optionen'],
			[
				'21 Eintraege',
				(o) => ({ optionIds: [o['dabei'], ...Array.from({ length: 20 }, (_, i) => `x-${i}`)], clientId: 'c-1' }),
				'optionen',
			],
			['clientId fehlt', (o) => ({ optionIds: [o['dabei']] }), 'clientId'],
			['clientId mit Leerzeichen', (o) => ({ optionIds: [o['dabei']], clientId: 'a b' }), 'clientId'],
		])('%s: 400 mit feld, ohne Zeile und ohne Stand', async (_name, fall, feld) => {
			const s = await szenario();
			const u = await s.umfrage({ vielleicht: false });
			// Eine zweite Umfrage mit Vielleicht und eine freie mit Ja/Nein: ihre IDs gibt es, nur nicht hier.
			const anderer = await legeThreadAn(prisma, s.verein, JETZT, {
				erstelltVonId: s.thomas.personId,
				module: [{ typ: 'UMFRAGE', teilnahme: true }, { typ: 'UMFRAGE' }],
			});
			const vorher = await s.stand();

			const r = await s.antworte(u.modulId, s.max.personId, fall(u.o, anderer.optionIds), s.sandra.cookie);

			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld });
			expect(await s.zeilen()).toEqual([]);
			expect(await s.stand()).toBe(vorher);
		});

		it('zwei Optionen bei mehrfach true: 200, in der Reihenfolge der Umfrage', async () => {
			const s = await szenario();
			const u = await s.umfrage({ teilnahme: false, mehrfach: true, optionen: ['Pizza', 'Kuchen', 'Salat'] });

			const { modul } = await s.gib(
				u.modulId,
				s.max.personId,
				[u.o['salat'] as string, u.o['pizza'] as string],
				s.sandra.cookie,
			);

			expect(modul.zeilen.find((z) => z.fuerId === s.max.personId)?.optionIds).toEqual([u.o['pizza'], u.o['salat']]);
			expect((await s.zeilen())[0]?.optionen).toHaveLength(2);
		});
	});

	describe('Wiederholung', () => {
		it('dieselbe clientId zweimal nacheinander: zweimal 200 mit derselben Antwort, eine Zeile, ein Stand', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			const vorher = await s.stand();
			const body = { optionIds: [u.o['dabei']], clientId: 'doppelt-1' };

			const erste = await s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie);
			const zweite = await s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie);

			expect([erste.status, zweite.status]).toEqual([200, 200]);
			expect(await zweite.json()).toEqual(await erste.json());
			expect(await s.zeilen()).toHaveLength(1);
			expect(await s.stand()).toBe(vorher + 1);
		});

		it('dieselbe clientId zweimal gleichzeitig: zweimal 200, eine Zeile, ein Stand', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			const vorher = await s.stand();
			const body = { optionIds: [u.o['dabei']], clientId: 'gleichzeitig-1' };

			const antworten = await Promise.all(
				[1, 2].map(() => s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie)),
			);

			expect(antworten.map((r) => r.status)).toEqual([200, 200]);
			const [a, b] = (await Promise.all(antworten.map((r) => r.json()))) as Geantwortet[];
			expect(a).toEqual(b);
			expect(await s.zeilen()).toHaveLength(1);
			expect(await s.stand()).toBe(vorher + 1);
		});

		it('um 17:59:59 gespeichert, nach der Frist wiederholt: 200 statt 410, eine Zeile, kein neuer Stand', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			const body = { optionIds: [u.o['dabei']], clientId: 'outbox-1' };
			try {
				uhr = new Date(FRIST.getTime() - 1000);
				const erste = await s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie, gestellt);
				expect(erste.status).toBe(200);
				const vorher = await s.stand();

				uhr = FRIST;
				const zweite = await s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie, gestellt);
				const neu = await s.antworte(
					u.modulId,
					s.max.personId,
					{ ...body, clientId: 'outbox-2' },
					s.sandra.cookie,
					gestellt,
				);

				expect(zweite.status).toBe(200);
				const wiederholt = (await zweite.json()) as Geantwortet;
				expect(wiederholt.stand).toBe(vorher);
				expect(wiederholt.modul.fristAbgelaufen).toBe(true);
				expect(wiederholt.modul.zeilen.find((z) => z.fuerId === s.max.personId)?.optionIds).toEqual([u.o['dabei']]);
				// Eine neue Antwort ist nach der Frist weiterhin zu spaet.
				expect(neu.status).toBe(410);
				expect(await s.zeilen()).toHaveLength(1);
				expect(await s.stand()).toBe(vorher);
			} finally {
				uhr = JETZT;
			}
		});

		it('die clientId einer anderen Antwortzeile: 409 CLIENT_ID_VERGEBEN, nichts geaendert', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			const zweite = await s.umfrage({ frage: 'Bleibst du zum Essen?' });
			const body = { optionIds: [u.o['dabei']], clientId: 'vergeben-1' };
			expect((await s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie)).status).toBe(200);
			const vorher = { stand: await s.stand(), zeilen: await s.zeilen() };

			const antworten = [
				// Andere Person, dieselbe Zeile.
				await s.antworte(u.modulId, s.max.personId, body, s.hans.cookie),
				// Dieselbe Person, andere Zeile.
				await s.antworte(u.modulId, s.lena.personId, body, s.sandra.cookie),
				// Dieselbe Person und Zeile, andere Umfrage.
				await s.antworte(zweite.modulId, s.max.personId, { ...body, optionIds: [zweite.o['dabei']] }, s.sandra.cookie),
			];

			for (const r of antworten) {
				expect(r.status).toBe(409);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', code: 'CLIENT_ID_VERGEBEN' });
			}
			expect(await s.stand()).toBe(vorher.stand);
			expect(await s.zeilen()).toEqual(vorher.zeilen);
		});
	});

	it('Sandra und Hans antworten gleichzeitig fuer Max: beide 200, eine Zeile, zwei aufeinanderfolgende Staende', async () => {
		const s = await szenario();
		const u = await s.umfrage();
		const vorher = await s.stand();

		const antworten = await Promise.all([
			s.antworte(u.modulId, s.max.personId, { optionIds: [u.o['dabei']], clientId: 'sandra-x' }, s.sandra.cookie),
			s.antworte(u.modulId, s.max.personId, { optionIds: [u.o['abgesagt']], clientId: 'hans-x' }, s.hans.cookie),
		]);

		expect(antworten.map((r) => r.status)).toEqual([200, 200]);
		const staende = ((await Promise.all(antworten.map((r) => r.json()))) as Geantwortet[]).map((a) => a.stand);
		expect(staende.sort((a, b) => a - b)).toEqual([vorher + 1, vorher + 2]);
		const zeilen = await s.zeilen();
		expect(zeilen).toHaveLength(1);
		expect(zeilen[0]?.optionen).toHaveLength(1);
		expect(await s.stand()).toBe(vorher + 2);
	});

	/**
	 * Die Arbeit der Route unter der Sperre, direkt aufgerufen, nachdem der Test die Umfrage
	 * oder den Thread in der Datenbank geaendert hat (der Editor zwischen Pruefung und
	 * Schreiben). Verworfen: ein Testhaken in deps -- Produktionscode nur fuer den Test.
	 */
	describe('Ereignisse auf dem Bus', () => {
		it('eine Antwort meldet genau ein Ereignis mit ANTWORT und ohne Verlaufseintraege', async () => {
			const s = await szenario();
			const u = await s.umfrage();

			const { stand } = await s.gib(u.modulId, s.max.personId, [u.o['dabei']], s.sandra.cookie);

			const geschrieben = await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } });
			expect(s.ereignisse()).toEqual([
				{
					typ: 'aenderung',
					vereinId: s.verein.id,
					stand,
					aenderungen: geschrieben.map((a) => ({ threadId: a.threadId, art: a.art, objektId: a.objektId })),
					eintraege: [],
				},
			]);
			expect(s.ereignisse()[0]).toMatchObject({ aenderungen: [{ threadId: u.threadId, art: 'ANTWORT' }] });
		});

		it('die Wiederholung (200) meldet nichts', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			const body = { optionIds: [u.o['dabei']], clientId: 'bus-doppelt-1' };
			expect((await s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie)).status).toBe(200);

			expect((await s.antworte(u.modulId, s.max.personId, body, s.sandra.cookie)).status).toBe(200);

			expect(s.ereignisse()).toHaveLength(1);
		});

		it('400, 404, 409 und 410 melden nichts', async () => {
			const s = await szenario();
			const u = await s.umfrage({ frist: new Date(JETZT.getTime() - 1000) });
			const offen = await s.umfrage();
			const body = (optionIds: string[], clientId: string) => ({ optionIds, clientId });

			const antworten = [
				await s.antworte(u.modulId, s.max.personId, body([u.o['dabei']], 'bus-frist'), s.sandra.cookie),
				await s.antworte(offen.modulId, s.max.personId, body([], 'bus-leer'), s.sandra.cookie),
				await s.antworte(offen.modulId, s.jonas.personId, body([offen.o['dabei']], 'bus-fremd'), s.sandra.cookie),
			];

			expect(antworten.map((r) => r.status)).toEqual([410, 400, 404]);
			expect(s.ereignisse()).toEqual([]);
		});
	});

	describe('schreibeAntwort unter der Sperre', () => {
		type Szenario = Awaited<ReturnType<typeof szenario>>;

		function schreibeDirekt(
			s: Szenario,
			u: { threadId: string; modulId: string },
			fuerId: string,
			optionIds: string[],
			clientId: string = randomUUID(),
			personId = s.sandra.personId,
		) {
			return vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, (stand) =>
					schreibeAntwort(
						tx,
						{ personId, threadId: u.threadId, modulId: u.modulId, fuerId, optionIds, clientId, zeit: JETZT },
						stand,
					),
				),
			);
		}

		/** Erwartet den Abbruch, und dass weder Antwort noch Stand uebrig bleiben. */
		async function erwarteAbbruch(
			s: Szenario,
			u: { threadId: string; modulId: string; o: Record<string, string> },
			fuerId: string,
			status: number,
			antwort: object,
			optionIds = [u.o['dabei'] as string],
		) {
			const vorher = await s.stand();
			const fehler = await schreibeDirekt(s, u, fuerId, optionIds).catch((e: unknown) => e);
			expect(fehler).toBeInstanceOf(ThreadAbbruch);
			expect(fehler).toMatchObject({ status, antwort: expect.objectContaining(antwort) });
			expect(await s.zeilen()).toHaveLength(0);
			expect(await s.stand()).toBe(vorher);
		}

		it('ohne Aenderung dazwischen schreibt sie die Antwort mit dem Stand der Transaktion', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			const vorher = await s.stand();

			const { stand, aenderungen } = await schreibeDirekt(s, u, s.max.personId, [u.o['dabei'] as string]);

			expect(stand).toBe(vorher + 1);
			const zeilen = await s.zeilen();
			expect(zeilen).toHaveLength(1);
			expect(aenderungen).toEqual([{ threadId: u.threadId, art: 'ANTWORT', objektId: zeilen[0]?.id }]);
		});

		it('Frist inzwischen abgelaufen: 410 FRIST_ABGELAUFEN, nichts geschrieben, kein Stand', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.umfrageModul.update({ where: { id: u.modulId }, data: { frist: new Date(JETZT.getTime() - 1000) } });
			await erwarteAbbruch(s, u, s.max.personId, 410, { code: 'FRIST_ABGELAUFEN' });
		});

		it('Thomas darf nach der Frist weiter nachtragen: die Wiederpruefung ist dieselbe Regel', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.umfrageModul.update({ where: { id: u.modulId }, data: { frist: new Date(JETZT.getTime() - 1000) } });

			await schreibeDirekt(s, u, s.max.personId, [u.o['dabei'] as string], randomUUID(), s.thomas.personId);

			expect(await s.zeilen()).toHaveLength(1);
		});

		it('Thread inzwischen ein Entwurf: fuer Sandra 404, fuer Thomas 409 ENTWURF', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.thread.update({ where: { id: u.threadId }, data: { veroeffentlichtAm: null } });

			await erwarteAbbruch(s, u, s.max.personId, 404, { fehler: 'nicht gefunden' });
			const fehler = await schreibeDirekt(
				s,
				u,
				s.max.personId,
				[u.o['dabei'] as string],
				randomUUID(),
				s.thomas.personId,
			).catch((e: unknown) => e);
			expect(fehler).toMatchObject({ status: 409, antwort: expect.objectContaining({ code: 'ENTWURF' }) });
			expect(await s.zeilen()).toHaveLength(0);
		});

		it('Einheit inzwischen "Pro Erwachsenem": Max ist nicht mehr gefragt, 404', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.umfrageModul.update({ where: { id: u.modulId }, data: { einheit: 'ERWACHSENER' } });
			await erwarteAbbruch(s, u, s.max.personId, 404, { fehler: 'nicht gefunden' });
		});

		it('Zielgruppe inzwischen nur Jugendleiter: Sandra sieht den Thread nicht mehr, 404', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.thread.update({ where: { id: u.threadId }, data: { rollenfilter: 'NUR_JUGENDLEITER' } });
			await erwarteAbbruch(s, u, s.max.personId, 404, { fehler: 'nicht gefunden' });
		});

		it('Zuordnung inzwischen geloest: Sandra ist nicht mehr fuer Max zustaendig, 404', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.bezugsperson.deleteMany({
				where: { erwachsenerId: s.sandra.personId, jungfischerId: s.max.personId },
			});
			await erwarteAbbruch(s, u, s.max.personId, 404, { fehler: 'nicht gefunden' });
		});

		it('Option inzwischen entfernt: 400 optionen statt eines Fremdschluesselfehlers', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.umfrageOption.delete({ where: { id: u.o['vielleicht'] as string } });
			await erwarteAbbruch(s, u, s.max.personId, 400, { feld: 'optionen' }, [u.o['vielleicht'] as string]);
		});

		it('Umfrage inzwischen geloescht: 404', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await prisma.threadModul.delete({ where: { id: u.modulId } });
			await erwarteAbbruch(s, u, s.max.personId, 404, { fehler: 'nicht gefunden' });
		});

		it('dieselbe clientId nach der Frist bleibt eine Wiederholung, keine 410 (Spec 4.2)', async () => {
			const s = await szenario();
			const u = await s.umfrage();
			await schreibeDirekt(s, u, s.max.personId, [u.o['dabei'] as string], 'wieder-1');
			await prisma.umfrageModul.update({ where: { id: u.modulId }, data: { frist: new Date(JETZT.getTime() - 1000) } });
			const vorher = await s.stand();

			const fehler = await schreibeDirekt(s, u, s.max.personId, [u.o['dabei'] as string], 'wieder-1').catch(
				(e: unknown) => e,
			);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});
	});

	it('mehr als zwei Antworten im engen Fenster: die dritte ist 429 mit wartenSekunden', async () => {
		const s = await szenario();
		const u = await s.umfrage();
		const gib = (n: number, cookie = s.sandra.cookie) =>
			s.antworte(u.modulId, s.max.personId, { optionIds: [u.o['dabei']], clientId: `fenster-${n}` }, cookie, eng);

		expect((await gib(1)).status).toBe(200);
		expect((await gib(2)).status).toBe(200);
		const dritte = await gib(3);

		expect(dritte.status).toBe(429);
		expect(await dritte.json()).toEqual({ fehler: 'Zu viele Versuche', wartenSekunden: 60 });
		// Das Fenster zaehlt je Person: Hans antwortet weiter.
		expect((await gib(4, s.hans.cookie)).status).toBe(200);
	});

	it('ohne Sitzung 401', async () => {
		const s = await szenario();
		const u = await s.umfrage();
		const r = await sende(server.url, s.api(`/umfragen/${u.modulId}/antworten/${s.max.personId}`), {
			methode: 'PUT',
			body: { optionIds: [u.o['dabei']], clientId: 'ohne-1' },
		});
		expect(r.status).toBe(401);
	});
});
