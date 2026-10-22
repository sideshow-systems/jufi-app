import { createPrismaClientFromEnv, mitAenderung, sperreVereinszeile, vereinDb } from '@jufi/db';
import type { HelferModulAnsicht, ThreadAnsicht } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sammleEreignisse } from '../echtzeit/test-bus.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { ThreadAbbruch, Wiederholung } from './fehler.js';
import { Fensterzaehler } from './fenster.js';
import { loescheEintrag, schreibeEintrag } from './helfer.js';
import { legeThreadAn, ordneZu, trageEinTest, type TestModul } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');
/** Donnerstag, 22.10.2026, 18:00 in Berlin (Sommerzeit). */
const FRIST = new Date('2026-10-22T16:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };
const VOLL = { fehler: 'Hier sind schon alle Plätze vergeben.', code: 'VOLL' };

interface Eingetragen {
	modul: HelferModulAnsicht;
	stand: number;
}

type HelferModul = Extract<TestModul, { typ: 'HELFER' }>;

describe('Eintragen und Austragen in der Helferliste', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	// Eigene App mit einem Fenster von zwei Anfragen, wie in antworten.spec.ts.
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
	 * Ein Verein je Test, dieselben Personen wie in antworten.spec.ts: Thomas Keller legt die
	 * Threads an (darf sie bearbeiten und also nachtragen), Sandra ist die Mutter von Lena und
	 * Max, Hans der Grossvater von Max, Peter der Vater von Tim, Jonas ein Kind ohne Familie.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `helfer-${randomUUID().slice(0, 8)}` });
		const db = vereinDb(prisma, verein.id);
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
		/**
		 * Ein Thread mit genau einer Helferliste; ohne Angaben pro Erwachsenem mit Frist am Abend,
		 * "Kuchen" mit zwei und "Fahrer" mit vier Plaetzen.
		 */
		const liste = async (
			modul: Partial<Omit<HelferModul, 'typ'>> = {},
			daten: Parameters<typeof legeThreadAn>[3] = {},
		) => {
			const t = await legeThreadAn(prisma, verein, JETZT, {
				titel: 'Fischerfest',
				erstelltVonId: thomas.personId,
				module: [
					{
						typ: 'HELFER',
						frist: FRIST,
						positionen: [
							{ text: 'Kuchen', anzahl: 2 },
							{ text: 'Fahrer', anzahl: 4 },
						],
						...modul,
					},
				],
				...daten,
			});
			return {
				threadId: t.threadId,
				modulId: t.modulIds[0] as string,
				kuchen: t.positionIds['kuchen'] as string,
				fahrer: t.positionIds['fahrer'] as string,
			};
		};
		const trage = (positionId: string, fuerId: string, body: unknown, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/helfer/${positionId}/eintraege/${fuerId}`), { methode: 'PUT', body, cookie });
		const trageAus = (positionId: string, fuerId: string, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/helfer/${positionId}/eintraege/${fuerId}`), { methode: 'DELETE', cookie });
		/** Ein Eintrag, der gelingen muss. */
		const gib = async (positionId: string, fuerId: string, cookie: string, notiz: string | null = null) => {
			const r = await trage(positionId, fuerId, { notiz, clientId: randomUUID() }, cookie);
			expect(r.status).toBe(200);
			return (await r.json()) as Eingetragen;
		};
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const zeilen = () =>
			prisma.helferEintrag.findMany({ where: { vereinId: verein.id }, orderBy: [{ eingetragenAm: 'asc' }] });
		const position = (modul: HelferModulAnsicht, id: string) => modul.positionen.find((p) => p.id === id);
		return {
			verein,
			db,
			thomas,
			sandra,
			hans,
			peter,
			lena,
			max,
			tim,
			jonas,
			api,
			liste,
			trage,
			trageAus,
			gib,
			stand,
			zeilen,
			position,
			ereignisse: () => ereignisse.fuer(verein.id),
		};
	}

	describe('PUT /helfer/:positionId/eintraege/:fuerId', () => {
		it('Sandra traegt sich mit Notiz ein: 200, belegt 1, eine Zeile, eine Aenderung ANTWORT mit der Modul-ID, ein Ereignis', async () => {
			const s = await szenario();
			const l = await s.liste();
			const vorher = await s.stand();

			const r = await s.trage(
				l.kuchen,
				s.sandra.personId,
				{ notiz: '  Marmorkuchen ', clientId: 'sandra-1' },
				s.sandra.cookie,
			);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Eingetragen;
			expect(stand).toBe(vorher + 1);
			expect(await s.stand()).toBe(stand);
			expect(modul).toMatchObject({ typ: 'HELFER', id: l.modulId, fristAbgelaufen: false });
			expect(s.position(modul, l.kuchen)).toMatchObject({
				text: 'Kuchen',
				anzahl: 2,
				belegt: 1,
				eintraege: [{ fuerId: s.sandra.personId, notiz: 'Marmorkuchen', eingetragenVon: null }],
			});
			expect(s.position(modul, l.fahrer)).toMatchObject({ belegt: 0, eintraege: [] });
			expect(await s.zeilen()).toEqual([
				expect.objectContaining({
					positionId: l.kuchen,
					fuerId: s.sandra.personId,
					vonId: s.sandra.personId,
					notiz: 'Marmorkuchen',
					eingetragenAm: JETZT,
					clientId: 'sandra-1',
				}),
			]);
			expect(await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } })).toEqual([
				expect.objectContaining({
					threadId: l.threadId,
					art: 'ANTWORT',
					objektId: l.modulId,
					urheberId: s.sandra.personId,
				}),
			]);
			expect((await prisma.thread.findUniqueOrThrow({ where: { id: l.threadId } })).letzteAktivitaetStand).toBe(stand);
			expect(s.ereignisse()).toEqual([
				{
					typ: 'aenderung',
					vereinId: s.verein.id,
					stand,
					aenderungen: [{ threadId: l.threadId, art: 'ANTWORT', objektId: l.modulId }],
					eintraege: [],
				},
			]);
		});

		it('ohne Notiz: 200, die Zeile hat notiz null', async () => {
			const s = await szenario();
			const l = await s.liste();

			const r = await s.trage(l.fahrer, s.peter.personId, { clientId: 'peter-1' }, s.peter.cookie);

			expect(r.status).toBe(200);
			expect((await s.zeilen())[0]).toMatchObject({ fuerId: s.peter.personId, notiz: null });
		});

		it('Sandra aendert ihre Notiz in einer vollen Position: 200, belegt bleibt 2, eingetragenAm bleibt', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.hans.personId, s.hans.personId);
			await trageEinTest(s.db, l.kuchen, s.sandra.personId, s.sandra.personId, 'Marmorkuchen');
			const alt = (await s.zeilen()).find((z) => z.fuerId === s.sandra.personId);

			const r = await s.trage(
				l.kuchen,
				s.sandra.personId,
				{ notiz: 'Apfelkuchen', clientId: 'notiz-neu' },
				s.sandra.cookie,
			);

			expect(r.status).toBe(200);
			const { modul } = (await r.json()) as Eingetragen;
			expect(s.position(modul, l.kuchen)?.belegt).toBe(2);
			const zeilen = await s.zeilen();
			expect(zeilen).toHaveLength(2);
			expect(zeilen.find((z) => z.fuerId === s.sandra.personId)).toMatchObject({
				id: alt?.id,
				notiz: 'Apfelkuchen',
				clientId: 'notiz-neu',
				eingetragenAm: alt?.eingetragenAm,
			});
		});

		it('Thomas traegt Sandra ein: die Zeile nennt ihn als vonId', async () => {
			const s = await szenario();
			const l = await s.liste();

			await s.gib(l.fahrer, s.sandra.personId, s.thomas.cookie, 'Bus');

			expect((await s.zeilen())[0]).toMatchObject({
				fuerId: s.sandra.personId,
				vonId: s.thomas.personId,
				notiz: 'Bus',
			});
		});

		it('volle Position, neue Person: 409 VOLL, nichts geschrieben, kein Stand, kein Ereignis', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.hans.personId, s.hans.personId);
			await trageEinTest(s.db, l.kuchen, s.peter.personId, s.peter.personId);
			const vorher = { stand: await s.stand(), zeilen: await s.zeilen() };

			const r = await s.trage(l.kuchen, s.sandra.personId, { clientId: 'zu-viel' }, s.sandra.cookie);

			expect(r.status).toBe(409);
			expect(await r.json()).toEqual(VOLL);
			expect(await s.zeilen()).toEqual(vorher.zeilen);
			expect(await s.stand()).toBe(vorher.stand);
			expect(s.ereignisse()).toEqual([]);
		});

		/**
		 * Die Barriere ist die Vereinssperre selbst: Der Test haelt sie, beide Anfragen bestehen
		 * die Vorpruefung (3 von 4) und warten dann in mitAenderung. Erst wenn beide dort stehen,
		 * gibt der Test die Sperre frei. Ohne Barriere koennte die zweite erst nach dem Commit der
		 * ersten ankommen und schon in der Vorpruefung scheitern; dann bewiese der Test die zweite
		 * Pruefung nicht. Verworfen: ein Testhaken in deps wie dateiSpeicher in dokumente.spec.ts --
		 * die Helferliste hat zwischen Vorpruefung und Sperre keine Abhaengigkeit, an der er saesse,
		 * und Produktionscode nur fuer den Test (antworten.spec.ts).
		 */
		it('letzter Platz, zwei gleichzeitig: genau eine 200 und eine 409 VOLL, danach 4/4', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.fahrer, s.hans.personId, s.hans.personId);
			await trageEinTest(s.db, l.fahrer, s.thomas.personId, s.thomas.personId);
			await trageEinTest(s.db, l.fahrer, s.max.personId, s.hans.personId);
			const vorher = await s.stand();

			const antworten = await mitGehaltenerSperre(s.verein.id, 2, () =>
				Promise.all([
					s.trage(l.fahrer, s.sandra.personId, { clientId: 'letzter-sandra' }, s.sandra.cookie),
					s.trage(l.fahrer, s.peter.personId, { clientId: 'letzter-peter' }, s.peter.cookie),
				]),
			);

			expect(antworten.map((r) => r.status).sort()).toEqual([200, 409]);
			const abgelehnt = antworten.find((r) => r.status === 409);
			expect(await abgelehnt?.json()).toEqual(VOLL);
			const angenommen = (await antworten.find((r) => r.status === 200)?.json()) as Eingetragen;
			expect(s.position(angenommen.modul, l.fahrer)).toMatchObject({ anzahl: 4, belegt: 4 });
			expect(await prisma.helferEintrag.count({ where: { positionId: l.fahrer } })).toBe(4);
			expect(await s.stand()).toBe(vorher + 1);
		});

		describe('400', () => {
			it.each<[string, unknown, string]>([
				['Notiz mit 81 Zeichen', { notiz: 'x'.repeat(81), clientId: 'c-1' }, 'notiz'],
				['Notiz als Zahl', { notiz: 5, clientId: 'c-1' }, 'notiz'],
				['Notiz mit Richtungsumkehr', { notiz: 'Kuchen‮', clientId: 'c-1' }, 'notiz'],
				['ohne clientId', { notiz: 'Kuchen' }, 'clientId'],
				['clientId mit Leerzeichen', { notiz: 'Kuchen', clientId: 'a b' }, 'clientId'],
			])('%s: 400 mit feld, ohne Zeile und ohne Stand', async (_name, body, feld) => {
				const s = await szenario();
				const l = await s.liste();
				const vorher = await s.stand();

				const r = await s.trage(l.kuchen, s.sandra.personId, body, s.sandra.cookie);

				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld });
				expect(await s.zeilen()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('80 Zeichen, auch als Emojis, gehen durch', async () => {
				const s = await szenario();
				const l = await s.liste();

				await s.gib(l.kuchen, s.sandra.personId, s.sandra.cookie, '🎂'.repeat(80));

				expect((await s.zeilen())[0]?.notiz).toBe('🎂'.repeat(80));
			});
		});

		it('Kind bei pro Erwachsenem, fremde Person, unsichtbarer Thread, Umfrage-Modul oder unbekannt: dieselbe 404', async () => {
			const s = await szenario();
			const l = await s.liste();
			const nurLeiter = await s.liste({}, { rollenfilter: 'NUR_JUGENDLEITER' });
			const umfrage = await legeThreadAn(prisma, s.verein, JETZT, {
				erstelltVonId: s.thomas.personId,
				module: [{ typ: 'UMFRAGE', einheit: 'ERWACHSENER' }],
			});
			const vorher = await s.stand();

			const faelle: [string, string][] = [
				// Pro Erwachsenem: Max ist nicht gefragt, obwohl er Sandras Kind ist.
				[l.kuchen, s.max.personId],
				// Peter ist gefragt, aber nicht Sandras Sache.
				[l.kuchen, s.peter.personId],
				[l.kuchen, 'gibt-es-nicht'],
				[nurLeiter.kuchen, s.sandra.personId],
				[umfrage.modulIds[0] as string, s.sandra.personId],
				['gibt-es-nicht', s.sandra.personId],
			];
			const texte: string[] = [];
			for (const [positionId, fuerId] of faelle) {
				const r = await s.trage(positionId, fuerId, { clientId: randomUUID() }, s.sandra.cookie);
				expect(r.status).toBe(404);
				texte.push(await r.text());
			}
			expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
			expect(new Set(texte).size).toBe(1);
			expect(await s.zeilen()).toEqual([]);
			expect(await s.stand()).toBe(vorher);
		});

		it('Entwurf: 409 ENTWURF fuer Thomas, 404 fuer Sandra, die ihn nicht sieht; nie ein Stand', async () => {
			const s = await szenario();
			const l = await s.liste({}, { veroeffentlicht: false });
			const vorher = await s.stand();

			const leiter = await s.trage(l.kuchen, s.sandra.personId, { clientId: 'e-1' }, s.thomas.cookie);
			const mutter = await s.trage(l.kuchen, s.sandra.personId, { clientId: 'e-2' }, s.sandra.cookie);

			expect(leiter.status).toBe(409);
			expect(await leiter.json()).toEqual({ fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' });
			expect(mutter.status).toBe(404);
			expect(await mutter.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.zeilen()).toEqual([]);
			expect(await s.stand()).toBe(vorher);
		});

		describe('Wiederholung', () => {
			it('dieselbe clientId noch einmal: 200 mit derselben Ansicht, eine Zeile, kein zweiter Stand, kein zweites Ereignis', async () => {
				const s = await szenario();
				const l = await s.liste();
				const vorher = await s.stand();
				const body = { notiz: 'Marmorkuchen', clientId: 'doppelt-1' };

				const erste = await s.trage(l.kuchen, s.sandra.personId, body, s.sandra.cookie);
				const zweite = await s.trage(l.kuchen, s.sandra.personId, body, s.sandra.cookie);

				expect([erste.status, zweite.status]).toEqual([200, 200]);
				expect(await zweite.json()).toEqual(await erste.json());
				expect(await s.zeilen()).toHaveLength(1);
				expect(await s.stand()).toBe(vorher + 1);
				expect(await prisma.aenderung.count({ where: { vereinId: s.verein.id, art: 'ANTWORT' } })).toBe(1);
				expect(s.ereignisse()).toHaveLength(1);
			});

			it('vor der Frist gespeichert, nach der Frist wiederholt: 200 statt 410, kein neuer Stand', async () => {
				const s = await szenario();
				const l = await s.liste();
				const body = { notiz: 'Marmorkuchen', clientId: 'outbox-1' };
				try {
					uhr = new Date(FRIST.getTime() - 1000);
					expect((await s.trage(l.kuchen, s.sandra.personId, body, s.sandra.cookie, gestellt)).status).toBe(200);
					const vorher = await s.stand();

					uhr = FRIST;
					const zweite = await s.trage(l.kuchen, s.sandra.personId, body, s.sandra.cookie, gestellt);
					const neu = await s.trage(
						l.fahrer,
						s.sandra.personId,
						{ ...body, clientId: 'outbox-2' },
						s.sandra.cookie,
						gestellt,
					);

					expect(zweite.status).toBe(200);
					const wiederholt = (await zweite.json()) as Eingetragen;
					expect(wiederholt.stand).toBe(vorher);
					expect(wiederholt.modul.fristAbgelaufen).toBe(true);
					expect(s.position(wiederholt.modul, l.kuchen)?.belegt).toBe(1);
					// Ein neuer Eintrag ist nach der Frist weiterhin zu spaet.
					expect(neu.status).toBe(410);
					expect(await s.zeilen()).toHaveLength(1);
					expect(await s.stand()).toBe(vorher);
				} finally {
					uhr = JETZT;
				}
			});

			it('die clientId eines anderen Eintrags: 409 CLIENT_ID_VERGEBEN, nichts geaendert', async () => {
				const s = await szenario();
				const l = await s.liste();
				const body = { clientId: 'vergeben-1' };
				expect((await s.trage(l.kuchen, s.sandra.personId, body, s.sandra.cookie)).status).toBe(200);
				const vorher = { stand: await s.stand(), zeilen: await s.zeilen() };

				const antworten = [
					// Andere Person, eigene Zeile.
					await s.trage(l.kuchen, s.hans.personId, body, s.hans.cookie),
					// Andere Person (die Leitung), dieselbe Zeile.
					await s.trage(l.kuchen, s.sandra.personId, body, s.thomas.cookie),
					// Dieselbe Person und Zeile, andere Position.
					await s.trage(l.fahrer, s.sandra.personId, body, s.sandra.cookie),
				];

				for (const r of antworten) {
					expect(r.status).toBe(409);
					expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', code: 'CLIENT_ID_VERGEBEN' });
				}
				expect(await s.stand()).toBe(vorher.stand);
				expect(await s.zeilen()).toEqual(vorher.zeilen);
			});
		});
	});

	describe('Frist und Archiv', () => {
		it('in der Fristsekunde: Sandra traegt sich weder ein noch aus (410), Thomas traegt fuer sie nach', async () => {
			const s = await szenario();
			const l = await s.liste({ frist: JETZT });
			await trageEinTest(s.db, l.kuchen, s.sandra.personId, s.sandra.personId, 'Marmorkuchen');
			const vorher = await s.stand();

			const ein = await s.trage(l.fahrer, s.sandra.personId, { clientId: 'frist-1' }, s.sandra.cookie);
			const aus = await s.trageAus(l.kuchen, s.sandra.personId, s.sandra.cookie);

			for (const r of [ein, aus]) {
				expect(r.status).toBe(410);
				expect(await r.json()).toEqual({ fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' });
			}
			expect(await s.stand()).toBe(vorher);
			expect(await s.zeilen()).toHaveLength(1);

			const { modul } = await s.gib(l.fahrer, s.sandra.personId, s.thomas.cookie, 'Bus');
			expect(modul.fristAbgelaufen).toBe(true);
			const r = await sende(server.url, s.api(`/threads/${l.threadId}`), { cookie: s.sandra.cookie });
			expect(r.status).toBe(200);
			const beiSandra = ((await r.json()) as ThreadAnsicht).module.find(
				(m): m is HelferModulAnsicht => m.typ === 'HELFER',
			);
			expect(beiSandra && s.position(beiSandra, l.fahrer)?.eintraege).toEqual([
				expect.objectContaining({
					fuerId: s.sandra.personId,
					notiz: 'Bus',
					eingetragenVon: 'eingetragen von Thomas K.',
				}),
			]);
		});

		it('archiviert: Sandra bekommt beim Ein- und Austragen 409 ARCHIVIERT, Thomas 200', async () => {
			const s = await szenario();
			const l = await s.liste({}, { archivModus: 'ARCHIVIERT' });
			await trageEinTest(s.db, l.kuchen, s.sandra.personId, s.sandra.personId);
			const vorher = await s.stand();

			const ein = await s.trage(l.fahrer, s.sandra.personId, { clientId: 'archiv-1' }, s.sandra.cookie);
			const aus = await s.trageAus(l.kuchen, s.sandra.personId, s.sandra.cookie);

			for (const r of [ein, aus]) {
				expect(r.status).toBe(409);
				expect(await r.json()).toEqual({ fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' });
			}
			expect(await s.stand()).toBe(vorher);

			await s.gib(l.fahrer, s.sandra.personId, s.thomas.cookie);
			expect((await s.trageAus(l.kuchen, s.sandra.personId, s.thomas.cookie)).status).toBe(200);
			expect((await s.zeilen()).map((z) => z.positionId)).toEqual([l.fahrer]);
		});
	});

	describe('DELETE /helfer/:positionId/eintraege/:fuerId', () => {
		it('Sandra traegt sich aus: 200, belegt sinkt, eine Aenderung ANTWORT, ein Ereignis', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.hans.personId, s.hans.personId);
			await trageEinTest(s.db, l.kuchen, s.sandra.personId, s.sandra.personId);
			const vorher = await s.stand();

			const r = await s.trageAus(l.kuchen, s.sandra.personId, s.sandra.cookie);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Eingetragen;
			expect(stand).toBe(vorher + 1);
			expect(s.position(modul, l.kuchen)).toMatchObject({ belegt: 1, eintraege: [{ fuerId: s.hans.personId }] });
			expect((await s.zeilen()).map((z) => z.fuerId)).toEqual([s.hans.personId]);
			expect(await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } })).toEqual([
				expect.objectContaining({
					threadId: l.threadId,
					art: 'ANTWORT',
					objektId: l.modulId,
					urheberId: s.sandra.personId,
				}),
			]);
			expect(s.ereignisse()).toEqual([
				{
					typ: 'aenderung',
					vereinId: s.verein.id,
					stand,
					aenderungen: [{ threadId: l.threadId, art: 'ANTWORT', objektId: l.modulId }],
					eintraege: [],
				},
			]);
		});

		it('Sandra traegt Max aus, den Hans eingetragen hat (pro Person)', async () => {
			const s = await szenario();
			const l = await s.liste({ einheit: 'PERSON' });
			await trageEinTest(s.db, l.kuchen, s.max.personId, s.hans.personId);

			expect((await s.trageAus(l.kuchen, s.max.personId, s.sandra.cookie)).status).toBe(200);

			expect(await s.zeilen()).toEqual([]);
		});

		it('ein zweites DELETE: 200 mit der Ansicht und dem Vereinsstand, keine Aenderung, kein Ereignis', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.sandra.personId, s.sandra.personId);
			expect((await s.trageAus(l.kuchen, s.sandra.personId, s.sandra.cookie)).status).toBe(200);
			const vorher = await s.stand();

			const r = await s.trageAus(l.kuchen, s.sandra.personId, s.sandra.cookie);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Eingetragen;
			expect(stand).toBe(vorher);
			expect(s.position(modul, l.kuchen)?.belegt).toBe(0);
			expect(await s.stand()).toBe(vorher);
			expect(await prisma.aenderung.count({ where: { vereinId: s.verein.id, art: 'ANTWORT' } })).toBe(1);
			expect(s.ereignisse()).toHaveLength(1);
		});

		it('Sandra traegt Peter aus: 404, der Eintrag bleibt', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.peter.personId, s.peter.personId);
			const vorher = { stand: await s.stand(), zeilen: await s.zeilen() };

			const r = await s.trageAus(l.kuchen, s.peter.personId, s.sandra.cookie);

			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.zeilen()).toEqual(vorher.zeilen);
			expect(await s.stand()).toBe(vorher.stand);
		});

		it('Peter ist entfernt: Sandra bekommt 404, Thomas traegt ihn aus (Entscheidung 2)', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.peter.personId, s.peter.personId);
			await prisma.person.update({ where: { id: s.peter.personId }, data: { entferntAm: JETZT } });

			expect((await s.trageAus(l.kuchen, s.peter.personId, s.sandra.cookie)).status).toBe(404);
			expect(await s.zeilen()).toHaveLength(1);

			const r = await s.trageAus(l.kuchen, s.peter.personId, s.thomas.cookie);

			expect(r.status).toBe(200);
			expect(s.position(((await r.json()) as Eingetragen).modul, l.kuchen)?.belegt).toBe(0);
			expect(await s.zeilen()).toEqual([]);
		});

		it('unbekannte Position, Umfrage-Modul oder unsichtbarer Thread: 404', async () => {
			const s = await szenario();
			const nurLeiter = await s.liste({}, { rollenfilter: 'NUR_JUGENDLEITER' });
			const umfrage = await legeThreadAn(prisma, s.verein, JETZT, {
				erstelltVonId: s.thomas.personId,
				module: [{ typ: 'UMFRAGE', einheit: 'ERWACHSENER' }],
			});

			for (const positionId of [nurLeiter.kuchen, umfrage.modulIds[0] as string, 'gibt-es-nicht']) {
				const r = await s.trageAus(positionId, s.sandra.personId, s.sandra.cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
		});

		it('ohne Eintrag im Entwurf: 409 ENTWURF fuer Thomas, statt eines stillen 200', async () => {
			const s = await szenario();
			const l = await s.liste({}, { veroeffentlicht: false });

			const r = await s.trageAus(l.kuchen, s.sandra.personId, s.thomas.cookie);

			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({ fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' });
		});
	});

	/**
	 * Die Arbeit der Routen unter der Sperre, direkt aufgerufen, nachdem der Test die Liste oder
	 * den Thread in der Datenbank geaendert hat (der Editor oder eine andere Familie zwischen
	 * Pruefung und Schreiben), wie in antworten.spec.ts.
	 */
	describe('unter der Sperre', () => {
		type Szenario = Awaited<ReturnType<typeof szenario>>;
		type Liste = Awaited<ReturnType<Szenario['liste']>>;

		function schreibeDirekt(
			s: Szenario,
			l: Liste,
			positionId: string,
			fuerId: string,
			clientId: string = randomUUID(),
			personId = s.sandra.personId,
		) {
			return vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, () =>
					schreibeEintrag(tx, {
						personId,
						threadId: l.threadId,
						positionId,
						fuerId,
						notiz: null,
						clientId,
						zeit: JETZT,
					}),
				),
			);
		}

		function loescheDirekt(s: Szenario, l: Liste, positionId: string, fuerId: string, personId = s.sandra.personId) {
			return vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, () =>
					loescheEintrag(tx, { personId, threadId: l.threadId, positionId, fuerId, zeit: JETZT }),
				),
			);
		}

		/** Erwartet den Abbruch, und dass weder ein neuer Eintrag noch ein Stand uebrig bleibt. */
		async function erwarteAbbruch(s: Szenario, arbeit: Promise<unknown>, status: number, antwort: object) {
			const vorher = { stand: await s.stand(), zeilen: await s.zeilen() };
			const fehler = await arbeit.catch((e: unknown) => e);
			expect(fehler).toBeInstanceOf(ThreadAbbruch);
			expect(fehler).toMatchObject({ status, antwort: expect.objectContaining(antwort) });
			expect(await s.zeilen()).toEqual(vorher.zeilen);
			expect(await s.stand()).toBe(vorher.stand);
		}

		it('ohne Aenderung dazwischen schreibt sie den Eintrag mit der Aenderung ANTWORT', async () => {
			const s = await szenario();
			const l = await s.liste();

			const { aenderungen } = await schreibeDirekt(s, l, l.kuchen, s.sandra.personId);

			expect(await s.zeilen()).toHaveLength(1);
			expect(aenderungen).toEqual([{ threadId: l.threadId, art: 'ANTWORT', objektId: l.modulId }]);
		});

		it('Position inzwischen voll: 409 VOLL', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.hans.personId, s.hans.personId);
			await trageEinTest(s.db, l.kuchen, s.peter.personId, s.peter.personId);
			await erwarteAbbruch(s, schreibeDirekt(s, l, l.kuchen, s.sandra.personId), 409, VOLL);
		});

		it('Position inzwischen entfernt: 404 statt eines Fremdschluesselfehlers', async () => {
			const s = await szenario();
			const l = await s.liste();
			await prisma.helferPosition.delete({ where: { id: l.kuchen } });
			await erwarteAbbruch(s, schreibeDirekt(s, l, l.kuchen, s.sandra.personId), 404, NICHT_GEFUNDEN);
		});

		it('Frist inzwischen abgelaufen: 410, Thomas traegt weiter nach', async () => {
			const s = await szenario();
			const l = await s.liste();
			await prisma.helferModul.update({ where: { id: l.modulId }, data: { frist: new Date(JETZT.getTime() - 1000) } });
			await erwarteAbbruch(s, schreibeDirekt(s, l, l.kuchen, s.sandra.personId), 410, {
				code: 'FRIST_ABGELAUFEN',
			});

			await schreibeDirekt(s, l, l.kuchen, s.sandra.personId, randomUUID(), s.thomas.personId);
			expect(await s.zeilen()).toHaveLength(1);
		});

		it('inzwischen archiviert: 409 ARCHIVIERT', async () => {
			const s = await szenario();
			const l = await s.liste();
			await prisma.thread.update({ where: { id: l.threadId }, data: { archivModus: 'ARCHIVIERT' } });
			await erwarteAbbruch(s, schreibeDirekt(s, l, l.kuchen, s.sandra.personId), 409, { code: 'ARCHIVIERT' });
		});

		it('dieselbe clientId nach der Frist bleibt eine Wiederholung, keine 410', async () => {
			const s = await szenario();
			const l = await s.liste();
			await schreibeDirekt(s, l, l.kuchen, s.sandra.personId, 'wieder-1');
			await prisma.helferModul.update({ where: { id: l.modulId }, data: { frist: new Date(JETZT.getTime() - 1000) } });
			const vorher = await s.stand();

			const fehler = await schreibeDirekt(s, l, l.kuchen, s.sandra.personId, 'wieder-1').catch((e: unknown) => e);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});

		it('Austragen: ohne Aenderung dazwischen loescht sie den Eintrag', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.sandra.personId, s.sandra.personId);

			const { aenderungen } = await loescheDirekt(s, l, l.kuchen, s.sandra.personId);

			expect(await s.zeilen()).toEqual([]);
			expect(aenderungen).toEqual([{ threadId: l.threadId, art: 'ANTWORT', objektId: l.modulId }]);
		});

		it('Austragen: Eintrag inzwischen weg ist eine Wiederholung ohne Stand', async () => {
			const s = await szenario();
			const l = await s.liste();
			const vorher = await s.stand();

			const fehler = await loescheDirekt(s, l, l.kuchen, s.sandra.personId).catch((e: unknown) => e);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});

		it('Austragen: Frist inzwischen abgelaufen: 410, der Eintrag bleibt', async () => {
			const s = await szenario();
			const l = await s.liste();
			await trageEinTest(s.db, l.kuchen, s.sandra.personId, s.sandra.personId);
			await prisma.helferModul.update({ where: { id: l.modulId }, data: { frist: new Date(JETZT.getTime() - 1000) } });
			await erwarteAbbruch(s, loescheDirekt(s, l, l.kuchen, s.sandra.personId), 410, { code: 'FRIST_ABGELAUFEN' });
		});
	});

	it('mehr als zwei Anfragen im engen Fenster: die dritte ist 429, auch ein DELETE zaehlt', async () => {
		const s = await szenario();
		const l = await s.liste();
		const trage = (n: number, cookie = s.sandra.cookie, fuerId = s.sandra.personId) =>
			s.trage(l.kuchen, fuerId, { clientId: `fenster-${n}` }, cookie, eng);

		expect((await trage(1)).status).toBe(200);
		expect((await s.trageAus(l.kuchen, s.sandra.personId, s.sandra.cookie, eng)).status).toBe(200);
		const dritte = await trage(3);

		expect(dritte.status).toBe(429);
		expect(await dritte.json()).toEqual({ fehler: 'Zu viele Versuche', wartenSekunden: 60 });
		expect((await s.trageAus(l.kuchen, s.sandra.personId, s.sandra.cookie, eng)).status).toBe(429);
		// Das Fenster zaehlt je Person: Hans traegt sich weiter ein.
		expect((await trage(4, s.hans.cookie, s.hans.personId)).status).toBe(200);
	});

	it('ohne Sitzung 401', async () => {
		const s = await szenario();
		const l = await s.liste();
		const pfad = s.api(`/helfer/${l.kuchen}/eintraege/${s.sandra.personId}`);
		expect((await sende(server.url, pfad, { methode: 'PUT', body: { clientId: 'ohne-1' } })).status).toBe(401);
		expect((await sende(server.url, pfad, { methode: 'DELETE' })).status).toBe(401);
	});

	/**
	 * Haelt die Vereinssperre, waehrend `los` Anfragen startet, und gibt sie erst frei, wenn
	 * `anzahl` Verbindungen auf sie warten. Gewartet wird auch ueber eine Kette: Postgres stellt
	 * den zweiten Wartenden hinter den ersten, pg_blocking_pids nennt dann den ersten.
	 */
	async function mitGehaltenerSperre<T>(vereinId: string, anzahl: number, los: () => Promise<T>): Promise<T> {
		let meldePid!: (pid: number) => void;
		let gebeFrei!: () => void;
		const pid = new Promise<number>((ok) => (meldePid = ok));
		const frei = new Promise<void>((ok) => (gebeFrei = ok));
		const halter = prisma.$transaction(
			async (tx) => {
				await sperreVereinszeile(tx, vereinId);
				const [zeile] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
				meldePid(zeile?.pid as number);
				await frei;
			},
			{ timeout: 20_000 },
		);
		try {
			const halterPid = await pid;
			const ergebnis = los();
			const bis = Date.now() + 10_000;
			for (;;) {
				const zeilen = await prisma.$queryRaw<{ pid: number; von: number[] }[]>`
					SELECT pid, pg_blocking_pids(pid) AS von FROM pg_stat_activity
					WHERE cardinality(pg_blocking_pids(pid)) > 0`;
				const kette = new Set([halterPid]);
				for (let neu = true; neu;) {
					neu = false;
					for (const z of zeilen) {
						if (!kette.has(z.pid) && z.von.some((v) => kette.has(v))) {
							kette.add(z.pid);
							neu = true;
						}
					}
				}
				if (kette.size - 1 >= anzahl) break;
				if (Date.now() > bis) throw new Error(`Nur ${kette.size - 1} von ${anzahl} Anfragen warten auf die Sperre`);
				await new Promise((ok) => setTimeout(ok, 20));
			}
			gebeFrei();
			await halter;
			return await ergebnis;
		} finally {
			gebeFrei();
			await halter.catch(() => undefined);
		}
	}
});
