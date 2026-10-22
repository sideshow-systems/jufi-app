import { createPrismaClientFromEnv, mitAenderung, vereinDb } from '@jufi/db';
import { GRENZEN, type FahrtModulAnsicht, type Richtung } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sammleEreignisse } from '../echtzeit/test-bus.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { aendereAuto, loescheAuto, schreibeAuto } from './autos.js';
import { ThreadAbbruch, Wiederholung } from './fehler.js';
import { Fensterzaehler } from './fenster.js';
import { bieteAutoTest, legeThreadAn, ordneZu, setzeEinTest, type TestModul } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

interface Antwort {
	modul: FahrtModulAnsicht;
	stand: number;
}

type FahrtTestModul = Extract<TestModul, { typ: 'FAHRT' }>;

/** Das Formular eines Autos, wie der Client es schickt; `plaetze` 3, Treffpunkt Vereinsheim. */
const AUTO = { plaetze: 3, abfahrtTag: '2026-10-23', abfahrtZeit: '15:30', ort: 'Vereinsheim', notiz: null };

describe('Autos anbieten, aendern und zurueckziehen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	// Eigene App mit einem Fenster von zwei Anfragen, wie in helfer.spec.ts.
	let eng: TestServer;
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
	});

	afterAll(async () => {
		await server.schliessen();
		await eng.schliessen();
		await prisma.$disconnect();
	});

	/**
	 * Ein Verein je Test, dieselben Personen wie in helfer.spec.ts: Thomas Keller legt die Threads
	 * an (darf sie bearbeiten, ist die Leitung), Sandra ist die Mutter von Lena und Max, Hans der
	 * Grossvater von Max, Peter der Vater von Tim, Jonas ein Kind ohne Familie.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `autos-${randomUUID().slice(0, 8)}` });
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
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		await ordneZu(prisma, verein, sandra.personId, max.personId);
		await ordneZu(prisma, verein, hans.personId, max.personId, 'GROSSVATER');
		await ordneZu(prisma, verein, peter.personId, tim.personId, 'VATER');

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		/** Ein Thread mit genau einer Fahrgemeinschaft, ohne Angaben mit beiden Richtungen. */
		const fahrt = async (modul: Omit<FahrtTestModul, 'typ'> = {}, daten: Parameters<typeof legeThreadAn>[3] = {}) => {
			const t = await legeThreadAn(prisma, verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: thomas.personId,
				module: [{ typ: 'FAHRT', ...modul }],
				...daten,
			});
			return { threadId: t.threadId, modulId: t.modulIds[0] as string, modulIds: t.modulIds };
		};
		const biete = (modulId: string, body: unknown, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/fahrten/${modulId}/autos`), { methode: 'POST', body, cookie });
		const aendere = (autoId: string, body: unknown, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/autos/${autoId}`), { methode: 'PUT', body, cookie });
		const ziehZurueck = (autoId: string, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/autos/${autoId}`), { methode: 'DELETE', cookie });
		/** Ein Auto, das angeboten werden muss. */
		const gib = async (modulId: string, richtung: Richtung, cookie: string, felder: object = {}) => {
			const r = await biete(modulId, { ...AUTO, ...felder, richtung, clientId: randomUUID() }, cookie);
			expect(r.status).toBe(201);
			return (await r.json()) as Antwort;
		};
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const autos = () => prisma.auto.findMany({ where: { vereinId: verein.id }, orderBy: [{ angelegtAm: 'asc' }] });
		const mitfahrten = () =>
			prisma.mitfahrt.findMany({ where: { vereinId: verein.id }, orderBy: [{ eingetragenAm: 'asc' }] });
		const verlauf = () =>
			prisma.verlaufEintrag.findMany({ where: { vereinId: verein.id, art: 'SYSTEM' }, orderBy: [{ stand: 'asc' }] });
		const aenderungen = (art: 'ANTWORT' | 'VERLAUF') =>
			prisma.aenderung.findMany({ where: { vereinId: verein.id, art }, orderBy: [{ stand: 'asc' }] });
		const richtungIn = (modul: FahrtModulAnsicht, richtung: Richtung) =>
			modul.richtungen.find((r) => r.richtung === richtung);
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
			api,
			fahrt,
			biete,
			aendere,
			ziehZurueck,
			gib,
			stand,
			autos,
			mitfahrten,
			verlauf,
			aenderungen,
			richtungIn,
			ereignisse: () => ereignisse.fuer(verein.id),
		};
	}

	describe('POST /fahrten/:modulId/autos', () => {
		it('Sandra bietet hin an: 201, Karte mit frei 3, eine Zeile, Aenderung ANTWORT mit der Modul-ID, ein Ereignis', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const vorher = await s.stand();

			const r = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'sandra-1' }, s.sandra.cookie);

			expect(r.status).toBe(201);
			const { modul, stand } = (await r.json()) as Antwort;
			expect(stand).toBe(vorher + 1);
			expect(await s.stand()).toBe(stand);
			expect(modul).toMatchObject({ typ: 'FAHRT', id: f.modulId });
			expect(s.richtungIn(modul, 'HIN')?.autos).toEqual([
				expect.objectContaining({
					fahrerId: s.sandra.personId,
					eigenes: true,
					plaetze: 3,
					frei: 3,
					abfahrtTag: '2026-10-23',
					abfahrtZeit: '15:30',
					ort: 'Vereinsheim',
					notiz: null,
					mitfahrer: [],
				}),
			]);
			expect(s.richtungIn(modul, 'RUECK')?.autos).toEqual([]);
			expect(await s.autos()).toEqual([
				expect.objectContaining({
					modulId: f.modulId,
					fahrerId: s.sandra.personId,
					richtung: 'HIN',
					plaetze: 3,
					// @db.Date: UTC-Mitternacht, ohne Zeitzonenversatz.
					abfahrtTag: new Date('2026-10-23T00:00:00.000Z'),
					abfahrtZeit: '15:30',
					ort: 'Vereinsheim',
					notiz: null,
					angelegtAm: JETZT,
					clientId: 'sandra-1',
				}),
			]);
			expect(await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } })).toEqual([
				expect.objectContaining({
					threadId: f.threadId,
					art: 'ANTWORT',
					objektId: f.modulId,
					urheberId: s.sandra.personId,
				}),
			]);
			expect((await prisma.thread.findUniqueOrThrow({ where: { id: f.threadId } })).letzteAktivitaetStand).toBe(stand);
			expect(s.ereignisse()).toEqual([
				{
					typ: 'aenderung',
					vereinId: s.verein.id,
					stand,
					aenderungen: [{ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId }],
					eintraege: [],
				},
			]);
		});

		it('ohne Tag, Zeit, Ort und Notiz: 201, die Zeile hat dort null', async () => {
			const s = await szenario();
			const f = await s.fahrt();

			const r = await s.biete(f.modulId, { plaetze: 2, richtung: 'RUECK', clientId: 'leer-1' }, s.peter.cookie);

			expect(r.status).toBe(201);
			expect((await s.autos())[0]).toMatchObject({
				richtung: 'RUECK',
				abfahrtTag: null,
				abfahrtZeit: null,
				ort: null,
				notiz: null,
			});
		});

		describe('Wiederholung', () => {
			it('dieselbe clientId noch einmal: 200 mit derselben Ansicht, ein Auto, kein zweiter Stand, kein zweites Ereignis', async () => {
				const s = await szenario();
				const f = await s.fahrt();
				const vorher = await s.stand();
				const body = { ...AUTO, richtung: 'HIN', clientId: 'doppelt-1' };

				const erste = await s.biete(f.modulId, body, s.sandra.cookie);
				const zweite = await s.biete(f.modulId, body, s.sandra.cookie);

				expect([erste.status, zweite.status]).toEqual([201, 200]);
				expect(await zweite.json()).toEqual(await erste.json());
				expect(await s.autos()).toHaveLength(1);
				expect(await s.stand()).toBe(vorher + 1);
				expect(await s.aenderungen('ANTWORT')).toHaveLength(1);
				expect(s.ereignisse()).toHaveLength(1);
			});

			it('die clientId eines anderen Autos: 409 CLIENT_ID_VERGEBEN, nichts geaendert', async () => {
				const s = await szenario();
				const f = await s.fahrt();
				const anderes = await s.fahrt({}, { titel: 'Zweiter Thread' });
				const body = { ...AUTO, richtung: 'HIN', clientId: 'vergeben-1' };
				expect((await s.biete(f.modulId, body, s.sandra.cookie)).status).toBe(201);
				const vorher = { stand: await s.stand(), autos: await s.autos() };

				const antworten = [
					// Andere Person.
					await s.biete(f.modulId, body, s.peter.cookie),
					// Dieselbe Person, andere Richtung.
					await s.biete(f.modulId, { ...body, richtung: 'RUECK' }, s.sandra.cookie),
					// Dieselbe Person und Richtung, anderes Modul.
					await s.biete(anderes.modulId, body, s.sandra.cookie),
				];

				for (const r of antworten) {
					expect(r.status).toBe(409);
					expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', code: 'CLIENT_ID_VERGEBEN' });
				}
				expect(await s.stand()).toBe(vorher.stand);
				expect(await s.autos()).toEqual(vorher.autos);
			});
		});

		it('zweites Auto in derselben Richtung: 409 AUTO_SCHON_DA, in der Rueckrichtung 201', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			await s.gib(f.modulId, 'HIN', s.sandra.cookie);
			const vorher = await s.stand();

			const zweites = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'zwei-1' }, s.sandra.cookie);

			expect(zweites.status).toBe(409);
			expect(await zweites.json()).toEqual({
				fehler: 'Du bietest für diese Fahrt schon ein Auto an.',
				code: 'AUTO_SCHON_DA',
			});
			expect(await s.stand()).toBe(vorher);
			const rueck = await s.biete(f.modulId, { ...AUTO, richtung: 'RUECK', clientId: 'zwei-2' }, s.sandra.cookie);
			expect(rueck.status).toBe(201);
			expect(await s.autos()).toHaveLength(2);
		});

		it('das 31. Auto einer Richtung: 409 VOLL, die Rueckrichtung bleibt offen', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			for (let n = 0; n < GRENZEN.autosJeRichtung; n++) {
				const fahrer = await s.db.person.create({
					data: {
						art: 'ERWACHSENER',
						vorname: `Fahrer${n}`,
						nachname: 'Test',
						email: `fahrer-${n}-${randomUUID().slice(0, 8)}@example.test`,
					},
					select: { id: true },
				});
				await bieteAutoTest(s.db, f.modulId, fahrer.id, 'HIN', 2);
			}
			const vorher = await s.stand();

			const r = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'dreissig-1' }, s.sandra.cookie);

			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({ fehler: 'Für diese Fahrt gibt es schon 30 Autos.', code: 'VOLL' });
			expect(await s.autos()).toHaveLength(30);
			expect(await s.stand()).toBe(vorher);
			const rueck = await s.biete(f.modulId, { ...AUTO, richtung: 'RUECK', clientId: 'dreissig-2' }, s.sandra.cookie);
			expect(rueck.status).toBe(201);
		});

		describe('Ablehnungen', () => {
			it('Jungfischer, Richtung aus, Umfrage-Modul, unsichtbarer Thread, unbekannt: dieselbe 404', async () => {
				const s = await szenario();
				const f = await s.fahrt();
				const nurHin = await s.fahrt({ rueck: false });
				const nurLeiter = await s.fahrt({}, { rollenfilter: 'NUR_JUGENDLEITER' });
				const umfrage = await legeThreadAn(prisma, s.verein, JETZT, {
					erstelltVonId: s.thomas.personId,
					module: [{ typ: 'UMFRAGE' }],
				});
				const vorher = await s.stand();

				const faelle: [string, string, string][] = [
					[f.modulId, 'HIN', s.lena.cookie],
					[nurHin.modulId, 'RUECK', s.sandra.cookie],
					[umfrage.modulIds[0] as string, 'HIN', s.sandra.cookie],
					[nurLeiter.modulId, 'HIN', s.sandra.cookie],
					['gibt-es-nicht', 'HIN', s.sandra.cookie],
				];
				const texte: string[] = [];
				for (const [modulId, richtung, cookie] of faelle) {
					const r = await s.biete(modulId, { ...AUTO, richtung, clientId: randomUUID() }, cookie);
					expect(r.status).toBe(404);
					texte.push(await r.text());
				}
				expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
				expect(new Set(texte).size).toBe(1);
				expect(await s.autos()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('Entwurf: 409 ENTWURF fuer Thomas, 404 fuer Sandra, die ihn nicht sieht', async () => {
				const s = await szenario();
				const f = await s.fahrt({}, { veroeffentlicht: false });
				const vorher = await s.stand();

				const leiter = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'e-1' }, s.thomas.cookie);
				const mutter = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'e-2' }, s.sandra.cookie);

				expect(leiter.status).toBe(409);
				expect(await leiter.json()).toEqual({ fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' });
				expect(mutter.status).toBe(404);
				expect(await mutter.json()).toEqual(NICHT_GEFUNDEN);
				expect(await s.autos()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('archiviert: Sandra bekommt 409 ARCHIVIERT, Thomas bietet an (201)', async () => {
				const s = await szenario();
				const f = await s.fahrt({}, { archivModus: 'ARCHIVIERT' });
				const vorher = await s.stand();

				const mutter = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'a-1' }, s.sandra.cookie);

				expect(mutter.status).toBe(409);
				expect(await mutter.json()).toEqual({ fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' });
				expect(await s.stand()).toBe(vorher);
				const leiter = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'a-2' }, s.thomas.cookie);
				expect(leiter.status).toBe(201);
			});
		});

		describe('400', () => {
			it.each<[string, object, string]>([
				['9 Plaetze', { ...AUTO, plaetze: 9, richtung: 'HIN', clientId: 'c-1' }, 'plaetze'],
				['ohne Plaetze', { richtung: 'HIN', clientId: 'c-1' }, 'plaetze'],
				['Tag kein Datum', { ...AUTO, abfahrtTag: '2026-02-30', richtung: 'HIN', clientId: 'c-1' }, 'abfahrtTag'],
				['Zeit mit 25 Uhr', { ...AUTO, abfahrtZeit: '25:00', richtung: 'HIN', clientId: 'c-1' }, 'abfahrtZeit'],
				['Ort mit Richtungsumkehr', { ...AUTO, ort: 'Heim‮', richtung: 'HIN', clientId: 'c-1' }, 'ort'],
				['Notiz mit 201 Zeichen', { ...AUTO, notiz: 'x'.repeat(201), richtung: 'HIN', clientId: 'c-1' }, 'notiz'],
				['unbekannte Richtung', { ...AUTO, richtung: 'QUER', clientId: 'c-1' }, 'richtung'],
				['ohne Richtung', { ...AUTO, clientId: 'c-1' }, 'richtung'],
				['ohne clientId', { ...AUTO, richtung: 'HIN' }, 'clientId'],
				['clientId mit Leerzeichen', { ...AUTO, richtung: 'HIN', clientId: 'a b' }, 'clientId'],
			])('%s: 400 mit feld, ohne Zeile und ohne Stand', async (_name, body, feld) => {
				const s = await szenario();
				const f = await s.fahrt();
				const vorher = await s.stand();

				const r = await s.biete(f.modulId, body, s.sandra.cookie);

				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld });
				expect(await s.autos()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});
		});
	});

	describe('PUT /autos/:id', () => {
		it('Sandra setzt die Plaetze von 3 auf 2 bei einem Mitfahrer: 200, die Zeile und die Aenderung ANTWORT', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3, { abfahrtTag: '2026-10-23' });
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.sandra.personId);
			const vorher = await s.stand();

			const r = await s.aendere(
				autoId,
				{ plaetze: 2, abfahrtTag: '2026-10-24', abfahrtZeit: '16:00', ort: '  Bahnhof ', notiz: 'Kindersitz' },
				s.sandra.cookie,
			);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Antwort;
			expect(stand).toBe(vorher + 1);
			expect(s.richtungIn(modul, 'HIN')?.autos).toEqual([
				expect.objectContaining({
					id: autoId,
					plaetze: 2,
					frei: 1,
					abfahrtTag: '2026-10-24',
					abfahrtZeit: '16:00',
					ort: 'Bahnhof',
					notiz: 'Kindersitz',
				}),
			]);
			expect((await s.autos())[0]).toMatchObject({
				id: autoId,
				plaetze: 2,
				abfahrtTag: new Date('2026-10-24T00:00:00.000Z'),
				ort: 'Bahnhof',
			});
			expect(await s.mitfahrten()).toHaveLength(1);
			expect(await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } })).toEqual([
				expect.objectContaining({ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId }),
			]);
			expect(s.ereignisse()).toEqual([
				expect.objectContaining({
					stand,
					aenderungen: [{ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId }],
				}),
			]);
		});

		it('weniger Plaetze als Mitfahrer: 409 PLAETZE mit der Zahl, mit genau so vielen Plaetzen wie Mitfahrer 200', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.max.personId, autoId, s.sandra.personId);
			const vorher = { stand: await s.stand(), autos: await s.autos() };

			const r = await s.aendere(autoId, { ...AUTO, plaetze: 1 }, s.sandra.cookie);

			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({ fehler: 'Es fahren schon 2 Kinder mit.', code: 'PLAETZE' });
			expect(await s.autos()).toEqual(vorher.autos);
			expect(await s.stand()).toBe(vorher.stand);

			// So viele Plaetze wie Mitfahrer sind genug: Nur "unter" der Zahl der Kinder ist ein Fehler.
			const gleich = await s.aendere(autoId, { ...AUTO, plaetze: 2 }, s.sandra.cookie);
			expect(gleich.status).toBe(200);
		});

		it('unveraendert: 200 mit der Ansicht, ohne Schreiben, ohne Stand, ohne Ereignis', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3, {
				abfahrtTag: '2026-10-23',
				abfahrtZeit: '15:30',
				ort: 'Vereinsheim',
			});
			const vorher = { stand: await s.stand(), autos: await s.autos() };

			const r = await s.aendere(autoId, AUTO, s.sandra.cookie);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Antwort;
			expect(stand).toBe(vorher.stand);
			expect(s.richtungIn(modul, 'HIN')?.autos).toHaveLength(1);
			expect(await s.autos()).toEqual(vorher.autos);
			expect(await s.stand()).toBe(vorher.stand);
			expect(s.ereignisse()).toEqual([]);
		});

		it('andere Person und unbekanntes Auto: dieselbe 404, die Leitung darf (200)', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			const vorher = { stand: await s.stand(), autos: await s.autos() };

			const peter = await s.aendere(autoId, AUTO, s.peter.cookie);
			const kind = await s.aendere(autoId, AUTO, s.lena.cookie);
			const unbekannt = await s.aendere('gibt-es-nicht', AUTO, s.sandra.cookie);

			for (const r of [peter, kind, unbekannt]) {
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
			expect(await s.autos()).toEqual(vorher.autos);
			expect(await s.stand()).toBe(vorher.stand);
			const leitung = await s.aendere(autoId, { ...AUTO, plaetze: 4 }, s.thomas.cookie);
			expect(leitung.status).toBe(200);
			expect((await s.autos())[0]).toMatchObject({ plaetze: 4, fahrerId: s.sandra.personId });
		});

		it('400 vor allem anderen; archiviert 409 ARCHIVIERT fuer Sandra, 200 fuer Thomas', async () => {
			const s = await szenario();
			const f = await s.fahrt({}, { archivModus: 'ARCHIVIERT' });
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);

			const schlecht = await s.aendere(autoId, { ...AUTO, plaetze: 0 }, s.peter.cookie);
			expect(schlecht.status).toBe(400);
			expect(await schlecht.json()).toEqual({ fehler: 'Ungültige Anfrage', feld: 'plaetze' });

			const mutter = await s.aendere(autoId, { ...AUTO, plaetze: 2 }, s.sandra.cookie);
			expect(mutter.status).toBe(409);
			expect(await mutter.json()).toEqual({ fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' });
			expect((await s.aendere(autoId, { ...AUTO, plaetze: 2 }, s.thomas.cookie)).status).toBe(200);
		});
	});

	describe('DELETE /autos/:id', () => {
		it('Auto mit Lena und Max zurueckziehen: 200, Mitfahrten weg, beide unter Braucht noch Mitfahrt, ein Systemeintrag', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.max.personId, autoId, s.sandra.personId);
			// Die Rueckfahrt gehoert nicht zu diesem Auto und bleibt, wie sie ist.
			const rueckAuto = await bieteAutoTest(s.db, f.modulId, s.hans.personId, 'RUECK', 2);
			await setzeEinTest(s.db, f.modulId, 'RUECK', s.lena.personId, rueckAuto, s.hans.personId);
			const vorher = await s.stand();

			const r = await s.ziehZurueck(autoId, s.sandra.cookie);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Antwort;
			expect(stand).toBe(vorher + 1);
			const hin = s.richtungIn(modul, 'HIN');
			expect(hin?.autos).toEqual([]);
			expect(hin?.brauchtMitfahrt.map((k) => k.kindId)).toEqual(
				expect.arrayContaining([s.lena.personId, s.max.personId]),
			);
			expect((await s.autos()).map((a) => a.id)).toEqual([rueckAuto]);
			expect((await s.mitfahrten()).map((m) => m.richtung)).toEqual(['RUECK']);

			const eintraege = await s.verlauf();
			expect(eintraege).toEqual([
				expect.objectContaining({
					threadId: f.threadId,
					art: 'SYSTEM',
					systemArt: 'AUTO_ZURUECKGEZOGEN',
					autorId: s.sandra.personId,
					systemDaten: { fahrerId: s.sandra.personId, richtung: 'HIN', kindIds: [s.lena.personId, s.max.personId] },
					stand,
					angelegtAm: JETZT,
				}),
			]);
			expect(
				await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand }, orderBy: { art: 'asc' } }),
			).toEqual([
				expect.objectContaining({ art: 'ANTWORT', objektId: f.modulId, urheberId: s.sandra.personId }),
				expect.objectContaining({ art: 'VERLAUF', objektId: eintraege[0]?.id, urheberId: s.sandra.personId }),
			]);
			expect(s.ereignisse()).toEqual([
				expect.objectContaining({
					stand,
					aenderungen: [
						{ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId },
						{ threadId: f.threadId, art: 'VERLAUF', objektId: eintraege[0]?.id },
					],
				}),
			]);

			// Das zweite DELETE findet kein Auto mehr: 404 und kein zweiter Eintrag (Entscheidung 3).
			const nochmal = await s.ziehZurueck(autoId, s.sandra.cookie);
			expect(nochmal.status).toBe(404);
			expect(await nochmal.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.verlauf()).toHaveLength(1);
			expect(await s.stand()).toBe(stand);
		});

		it('Kinder in der Reihenfolge des Einsteigens, nicht der IDs', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.max.personId, autoId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.sandra.personId);

			expect((await s.ziehZurueck(autoId, s.sandra.cookie)).status).toBe(200);

			expect((await s.verlauf())[0]?.systemDaten).toMatchObject({ kindIds: [s.max.personId, s.lena.personId] });
		});

		it('ohne Kinder: 200, das Auto ist weg, kein Verlaufseintrag, nur die Aenderung ANTWORT', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);

			const r = await s.ziehZurueck(autoId, s.sandra.cookie);

			expect(r.status).toBe(200);
			expect(await s.autos()).toEqual([]);
			expect(await s.verlauf()).toEqual([]);
			expect(await s.aenderungen('VERLAUF')).toEqual([]);
			expect(await s.aenderungen('ANTWORT')).toHaveLength(1);
		});

		it('"kommt selbst" bleibt unberuehrt: es hing an keinem Auto', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.tim.personId, null, s.peter.personId);

			expect((await s.ziehZurueck(autoId, s.sandra.cookie)).status).toBe(200);

			expect(await s.mitfahrten()).toEqual([expect.objectContaining({ kindId: s.tim.personId, autoId: null })]);
			expect(await s.verlauf()).toEqual([]);
		});

		it('die Leitung zieht Sandras Auto zurueck (200), eine andere Person bekommt 404', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			const vorher = await s.stand();

			const peter = await s.ziehZurueck(autoId, s.peter.cookie);
			expect(peter.status).toBe(404);
			expect(await peter.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.autos()).toHaveLength(1);
			expect(await s.stand()).toBe(vorher);

			expect((await s.ziehZurueck(autoId, s.thomas.cookie)).status).toBe(200);
			expect(await s.autos()).toEqual([]);
		});

		it('archiviert: 409 ARCHIVIERT fuer Sandra, 200 fuer Thomas; unbekanntes Auto 404', async () => {
			const s = await szenario();
			const f = await s.fahrt({}, { archivModus: 'ARCHIVIERT' });
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);

			const mutter = await s.ziehZurueck(autoId, s.sandra.cookie);
			expect(mutter.status).toBe(409);
			expect(await mutter.json()).toEqual({ fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' });
			expect((await s.ziehZurueck('gibt-es-nicht', s.thomas.cookie)).status).toBe(404);
			expect((await s.ziehZurueck(autoId, s.thomas.cookie)).status).toBe(200);
		});
	});

	/**
	 * Die Arbeit der Routen unter der Sperre, direkt aufgerufen, nachdem der Test Thread oder
	 * Fahrgemeinschaft in der Datenbank geaendert hat (der Editor oder eine andere Familie zwischen
	 * Pruefung und Schreiben), wie in helfer.spec.ts.
	 */
	describe('unter der Sperre', () => {
		type Szenario = Awaited<ReturnType<typeof szenario>>;
		type Fahrt = Awaited<ReturnType<Szenario['fahrt']>>;

		const schreibeDirekt = (
			s: Szenario,
			f: Fahrt,
			richtung: Richtung,
			clientId: string = randomUUID(),
			personId = s.sandra.personId,
		) =>
			vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, () =>
					schreibeAuto(tx, {
						personId,
						threadId: f.threadId,
						modulId: f.modulId,
						richtung,
						auto: { plaetze: 2, abfahrtTag: null, abfahrtZeit: null, ort: null, notiz: null },
						clientId,
						zeit: JETZT,
					}),
				),
			);

		const aendereDirekt = (s: Szenario, f: Fahrt, autoId: string, plaetze: number, personId = s.sandra.personId) =>
			vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, () =>
					aendereAuto(tx, {
						personId,
						threadId: f.threadId,
						modulId: f.modulId,
						autoId,
						auto: { ...AUTO, plaetze },
						zeit: JETZT,
					}),
				),
			);

		const loescheDirekt = (s: Szenario, f: Fahrt, autoId: string, personId = s.sandra.personId) =>
			vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, (stand) =>
					loescheAuto(tx, { personId, threadId: f.threadId, modulId: f.modulId, autoId, stand, zeit: JETZT }),
				),
			);

		/** Erwartet den Abbruch, und dass weder neue Zeilen noch ein Stand uebrig bleiben. */
		async function erwarteAbbruch(s: Szenario, arbeit: Promise<unknown>, status: number, antwort: object) {
			const vorher = { stand: await s.stand(), autos: await s.autos(), mitfahrten: await s.mitfahrten() };
			const fehler = await arbeit.catch((e: unknown) => e);
			expect(fehler).toBeInstanceOf(ThreadAbbruch);
			expect(fehler).toMatchObject({ status, antwort: expect.objectContaining(antwort) });
			expect(await s.autos()).toEqual(vorher.autos);
			expect(await s.mitfahrten()).toEqual(vorher.mitfahrten);
			expect(await s.verlauf()).toEqual([]);
			expect(await s.stand()).toBe(vorher.stand);
		}

		it('Anbieten ohne Aenderung dazwischen schreibt das Auto mit der Aenderung ANTWORT', async () => {
			const s = await szenario();
			const f = await s.fahrt();

			const { aenderungen } = await schreibeDirekt(s, f, 'HIN');

			expect(await s.autos()).toHaveLength(1);
			expect(aenderungen).toEqual([{ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId }]);
		});

		it('Anbieten: Sandra hat inzwischen ein Auto (zweite Anfrage mit anderer clientId): 409 AUTO_SCHON_DA', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await erwarteAbbruch(s, schreibeDirekt(s, f, 'HIN'), 409, { code: 'AUTO_SCHON_DA' });
		});

		it('Anbieten: Richtung inzwischen abgeschaltet oder Modul entfernt: 404', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			await prisma.fahrtModul.update({ where: { id: f.modulId }, data: { rueck: false } });
			await erwarteAbbruch(s, schreibeDirekt(s, f, 'RUECK'), 404, NICHT_GEFUNDEN);
			await prisma.threadModul.delete({ where: { id: f.modulId } });
			await erwarteAbbruch(s, schreibeDirekt(s, f, 'HIN'), 404, NICHT_GEFUNDEN);
		});

		it('Anbieten: inzwischen archiviert 409 ARCHIVIERT, inzwischen Entwurf 409 ENTWURF fuer die Leitung', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'ARCHIVIERT' } });
			await erwarteAbbruch(s, schreibeDirekt(s, f, 'HIN'), 409, { code: 'ARCHIVIERT' });
			await prisma.thread.update({
				where: { id: f.threadId },
				data: { archivModus: 'AUTOMATISCH', veroeffentlichtAm: null },
			});
			await erwarteAbbruch(s, schreibeDirekt(s, f, 'HIN', randomUUID(), s.thomas.personId), 409, { code: 'ENTWURF' });
		});

		it('Anbieten: dieselbe clientId nach dem Auto ist eine Wiederholung, auch im inzwischen archivierten Thread', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			await schreibeDirekt(s, f, 'HIN', 'wieder-1');
			await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'ARCHIVIERT' } });
			const vorher = await s.stand();

			const fehler = await schreibeDirekt(s, f, 'HIN', 'wieder-1').catch((e: unknown) => e);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});

		it('Aendern: inzwischen mehr Mitfahrer als Plaetze: 409 PLAETZE; Auto inzwischen weg: 404', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.max.personId, autoId, s.sandra.personId);
			await erwarteAbbruch(s, aendereDirekt(s, f, autoId, 1), 409, {
				code: 'PLAETZE',
				fehler: 'Es fahren schon 2 Kinder mit.',
			});

			await prisma.mitfahrt.deleteMany({ where: { autoId } });
			await prisma.auto.delete({ where: { id: autoId } });
			await erwarteAbbruch(s, aendereDirekt(s, f, autoId, 2), 404, NICHT_GEFUNDEN);
		});

		it('Aendern: inzwischen nichts mehr zu aendern ist eine Wiederholung ohne Stand', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 2, {
				abfahrtTag: AUTO.abfahrtTag,
				abfahrtZeit: AUTO.abfahrtZeit,
				ort: AUTO.ort,
			});
			await prisma.auto.update({ where: { id: autoId }, data: { plaetze: 3 } });
			const vorher = await s.stand();

			const fehler = await aendereDirekt(s, f, autoId, 3).catch((e: unknown) => e);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});

		it('Zurueckziehen: Auto inzwischen weg ist 404, ohne Eintrag und ohne Stand', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await prisma.auto.delete({ where: { id: autoId } });
			await erwarteAbbruch(s, loescheDirekt(s, f, autoId), 404, NICHT_GEFUNDEN);
		});

		it('Zurueckziehen: inzwischen archiviert 409 ARCHIVIERT, das Auto und die Mitfahrt bleiben', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.sandra.personId);
			await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'ARCHIVIERT' } });
			await erwarteAbbruch(s, loescheDirekt(s, f, autoId), 409, { code: 'ARCHIVIERT' });
		});

		it('Zurueckziehen mit einem Kind: Singular im Eintrag, Fahrer und Kind als IDs', async () => {
			const s = await szenario();
			const f = await s.fahrt();
			const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'RUECK', 3);
			await setzeEinTest(s.db, f.modulId, 'RUECK', s.lena.personId, autoId, s.sandra.personId);

			const { aenderungen } = await loescheDirekt(s, f, autoId);

			const [eintrag] = await s.verlauf();
			expect(eintrag?.systemDaten).toEqual({
				fahrerId: s.sandra.personId,
				richtung: 'RUECK',
				kindIds: [s.lena.personId],
			});
			expect(aenderungen).toEqual([
				{ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId },
				{ threadId: f.threadId, art: 'VERLAUF', objektId: eintrag?.id },
			]);
		});
	});

	it('mehr als zwei Anfragen im engen Fenster: die dritte ist 429, auch DELETE und PUT zaehlen', async () => {
		const s = await szenario();
		const f = await s.fahrt();
		const erste = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'fenster-1' }, s.sandra.cookie, eng);
		expect(erste.status).toBe(201);
		const autoId = ((await erste.json()) as Antwort).modul.richtungen[0]?.autos[0]?.id as string;
		expect((await s.ziehZurueck(autoId, s.sandra.cookie, eng)).status).toBe(200);

		const dritte = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'fenster-3' }, s.sandra.cookie, eng);

		expect(dritte.status).toBe(429);
		expect(await dritte.json()).toEqual({ fehler: 'Zu viele Versuche', wartenSekunden: 60 });
		expect((await s.aendere(autoId, AUTO, s.sandra.cookie, eng)).status).toBe(429);
		expect((await s.ziehZurueck(autoId, s.sandra.cookie, eng)).status).toBe(429);
		// Das Fenster zaehlt je Person: Peter bietet weiter an.
		const peter = await s.biete(f.modulId, { ...AUTO, richtung: 'HIN', clientId: 'fenster-4' }, s.peter.cookie, eng);
		expect(peter.status).toBe(201);
	});

	it('ohne Sitzung 401', async () => {
		const s = await szenario();
		const f = await s.fahrt();
		const autoId = await bieteAutoTest(s.db, f.modulId, s.sandra.personId, 'HIN', 3);
		const bieteAn = await sende(server.url, s.api(`/fahrten/${f.modulId}/autos`), {
			methode: 'POST',
			body: { ...AUTO, richtung: 'HIN', clientId: 'ohne-1' },
		});
		expect(bieteAn.status).toBe(401);
		expect((await sende(server.url, s.api(`/autos/${autoId}`), { methode: 'PUT', body: AUTO })).status).toBe(401);
		expect((await sende(server.url, s.api(`/autos/${autoId}`), { methode: 'DELETE' })).status).toBe(401);
	});
});
