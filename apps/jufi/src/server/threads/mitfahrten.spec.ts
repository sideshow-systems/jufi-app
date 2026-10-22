import { createPrismaClientFromEnv, mitAenderung, sperreVereinszeile, vereinDb } from '@jufi/db';
import type { FahrtModulAnsicht, Richtung, ThreadAnsicht } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sammleEreignisse } from '../echtzeit/test-bus.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { ThreadAbbruch, Wiederholung } from './fehler.js';
import { Fensterzaehler } from './fenster.js';
import { loescheMitfahrt, schreibeMitfahrt } from './mitfahrten.js';
import { bieteAutoTest, legeThreadAn, ordneZu, setzeEinTest, type TestModul } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };
const AUTO_VOLL = { fehler: 'In diesem Auto ist kein Platz mehr frei.', code: 'VOLL' };
const NICHT_DABEI = { fehler: 'Mitfahren kann nur, wer zugesagt hat.', code: 'NICHT_DABEI' };

interface Antwort {
	modul: FahrtModulAnsicht;
	stand: number;
}

type FahrtTestModul = Extract<TestModul, { typ: 'FAHRT' }>;

describe('Kinder in Autos einsetzen und herausnehmen', () => {
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
	 * Ein Verein je Test. Thomas Keller legt die Threads an (darf sie bearbeiten, ist die Leitung),
	 * Sandra ist die Mutter von Lena und Max, Hans der Grossvater von Max, Peter der Vater von Mia
	 * und Tim, Jonas ein Kind ohne Familie.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `mitfahrt-${randomUUID().slice(0, 8)}` });
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
		const mia = await mitglied({ art: 'JUNGFISCHER', vorname: 'Mia', nachname: 'Sommer' });
		const tim = await mitglied({ art: 'JUNGFISCHER', vorname: 'Tim', nachname: 'Sommer' });
		const jonas = await mitglied({ art: 'JUNGFISCHER', vorname: 'Jonas', nachname: 'Keller' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		await ordneZu(prisma, verein, sandra.personId, max.personId);
		await ordneZu(prisma, verein, hans.personId, max.personId, 'GROSSVATER');
		await ordneZu(prisma, verein, peter.personId, mia.personId, 'VATER');
		await ordneZu(prisma, verein, peter.personId, tim.personId, 'VATER');

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		/** Ein Thread mit genau einer Fahrgemeinschaft, ohne Angaben mit beiden Richtungen und ohne Umfrage (alle Kinder gelten als dabei). */
		const fahrt = async (modul: Omit<FahrtTestModul, 'typ'> = {}, daten: Parameters<typeof legeThreadAn>[3] = {}) => {
			const t = await legeThreadAn(prisma, verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: thomas.personId,
				module: [{ typ: 'FAHRT', ...modul }],
				...daten,
			});
			return { threadId: t.threadId, modulId: t.modulIds[0] as string };
		};
		/** Fahrgemeinschaft mit Teilnahme-Umfrage: Lena und Mia sind dabei, Max vielleicht, alle anderen ohne Antwort. */
		const zusagen = async (modul: Omit<FahrtTestModul, 'typ'> = {}, daten: Parameters<typeof legeThreadAn>[3] = {}) => {
			const t = await legeThreadAn(prisma, verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: thomas.personId,
				module: [
					{ typ: 'FAHRT', ...modul },
					{ typ: 'UMFRAGE', teilnahme: true },
				],
				...daten,
			});
			const umfrageId = t.modulIds[1] as string;
			const antworte = (kindId: string, schluessel: 'dabei' | 'vielleicht' | 'abgesagt', vonId: string) =>
				db.umfrageAntwort.create({
					data: {
						umfrageId,
						fuerId: kindId,
						vonId,
						abgegebenAm: JETZT,
						clientId: randomUUID(),
						optionen: { create: [{ optionId: t.optionIds[schluessel] as string }] },
					},
				});
			await antworte(lena.personId, 'dabei', sandra.personId);
			await antworte(mia.personId, 'dabei', peter.personId);
			await antworte(max.personId, 'vielleicht', sandra.personId);
			/** Die Mutter sagt in der Umfrage ab: die Antwort wechselt von "Dabei" auf "Abgesagt". */
			const sageAb = async (kindId: string) => {
				const antwort = await prisma.umfrageAntwort.findFirstOrThrow({ where: { umfrageId, fuerId: kindId } });
				await prisma.umfrageAntwortOption.deleteMany({ where: { antwortId: antwort.id } });
				await prisma.umfrageAntwortOption.create({
					data: {
						vereinId: verein.id,
						umfrageId,
						antwortId: antwort.id,
						optionId: t.optionIds['abgesagt'] as string,
					},
				});
			};
			return { threadId: t.threadId, modulId: t.modulIds[0] as string, sageAb };
		};
		const setze = (modulId: string, richtung: string, kindId: string, body: unknown, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/fahrten/${modulId}/${richtung}/${kindId}`), { methode: 'PUT', body, cookie });
		const nimmHeraus = (modulId: string, richtung: string, kindId: string, cookie: string, ziel = server) =>
			sende(ziel.url, api(`/fahrten/${modulId}/${richtung}/${kindId}`), { methode: 'DELETE', cookie });
		/** Ein Einsetzen, das gelingen muss. */
		const gib = async (modulId: string, richtung: string, kindId: string, autoId: string | null, cookie: string) => {
			const r = await setze(modulId, richtung, kindId, { autoId, clientId: randomUUID() }, cookie);
			expect(r.status).toBe(200);
			return (await r.json()) as Antwort;
		};
		const auto = (modulId: string, fahrerId: string, richtung: Richtung = 'HIN', plaetze = 3) =>
			bieteAutoTest(db, modulId, fahrerId, richtung, plaetze);
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		const mitfahrten = () =>
			prisma.mitfahrt.findMany({ where: { vereinId: verein.id }, orderBy: [{ eingetragenAm: 'asc' }] });
		const aenderungen = () =>
			prisma.aenderung.findMany({ where: { vereinId: verein.id, art: 'ANTWORT' }, orderBy: [{ stand: 'asc' }] });
		const richtungIn = (modul: FahrtModulAnsicht, richtung: Richtung) =>
			modul.richtungen.find((r) => r.richtung === richtung);
		/** Die Fahrgemeinschaft eines Threads, wie die Person sie beim Oeffnen sieht. */
		const lies = async (threadId: string, cookie: string) => {
			const r = await sende(server.url, api(`/threads/${threadId}`), { cookie });
			expect(r.status).toBe(200);
			const modul = ((await r.json()) as ThreadAnsicht).module.find((m) => m.typ === 'FAHRT');
			return modul as FahrtModulAnsicht;
		};
		return {
			verein,
			db,
			thomas,
			sandra,
			hans,
			peter,
			lena,
			max,
			mia,
			tim,
			jonas,
			api,
			fahrt,
			zusagen,
			setze,
			nimmHeraus,
			gib,
			auto,
			stand,
			mitfahrten,
			aenderungen,
			richtungIn,
			lies,
			ereignisse: () => ereignisse.fuer(verein.id),
		};
	}

	describe('PUT /fahrten/:modulId/:richtung/:kindId', () => {
		it('Sandra setzt Lena in ihr Auto: 200, Lena fuhr mit, frei sinkt, Aenderung ANTWORT, ein Ereignis', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			const vorher = await s.stand();

			const r = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'lena-1' }, s.sandra.cookie);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Antwort;
			expect(stand).toBe(vorher + 1);
			expect(await s.stand()).toBe(stand);
			const karte = s.richtungIn(modul, 'HIN')?.autos[0];
			expect(karte).toMatchObject({ id: autoId, plaetze: 3, frei: 2 });
			expect(karte?.mitfahrer.map((k) => k.kindId)).toEqual([s.lena.personId]);
			expect(s.richtungIn(modul, 'HIN')?.brauchtMitfahrt.map((k) => k.kindId)).toEqual([s.mia.personId]);
			expect(await s.mitfahrten()).toEqual([
				expect.objectContaining({
					modulId: f.modulId,
					richtung: 'HIN',
					kindId: s.lena.personId,
					autoId,
					vonId: s.sandra.personId,
					eingetragenAm: JETZT,
					clientId: 'lena-1',
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

		it('Rueckfahrt: :richtung rueck setzt in die Rueckrichtung, die Hinfahrt bleibt leer', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const hin = await s.auto(f.modulId, s.sandra.personId, 'HIN');
			const rueck = await s.auto(f.modulId, s.sandra.personId, 'RUECK');

			const { modul } = await s.gib(f.modulId, 'rueck', s.lena.personId, rueck, s.sandra.cookie);

			expect(s.richtungIn(modul, 'HIN')?.autos.find((a) => a.id === hin)?.mitfahrer).toEqual([]);
			expect(s.richtungIn(modul, 'RUECK')?.autos[0]?.mitfahrer.map((k) => k.kindId)).toEqual([s.lena.personId]);
			expect(await s.mitfahrten()).toEqual([expect.objectContaining({ richtung: 'RUECK', autoId: rueck })]);
		});

		describe('Wiederholung', () => {
			it('dieselbe clientId noch einmal: 200 mit derselben Ansicht, eine Zeile, kein zweiter Stand, kein zweites Ereignis', async () => {
				const s = await szenario();
				const f = await s.zusagen();
				const autoId = await s.auto(f.modulId, s.sandra.personId);
				const vorher = await s.stand();
				const body = { autoId, clientId: 'doppelt-1' };

				const erste = await s.setze(f.modulId, 'hin', s.lena.personId, body, s.sandra.cookie);
				const zweite = await s.setze(f.modulId, 'hin', s.lena.personId, body, s.sandra.cookie);

				expect([erste.status, zweite.status]).toEqual([200, 200]);
				expect(await zweite.json()).toEqual(await erste.json());
				expect(await s.mitfahrten()).toHaveLength(1);
				expect(await s.stand()).toBe(vorher + 1);
				expect(await s.aenderungen()).toHaveLength(1);
				expect(s.ereignisse()).toHaveLength(1);
			});

			it('die clientId einer anderen Mitfahrt: 409 CLIENT_ID_VERGEBEN, nichts geaendert', async () => {
				const s = await szenario();
				const f = await s.zusagen();
				const autoId = await s.auto(f.modulId, s.sandra.personId);
				const andere = await s.auto(f.modulId, s.peter.personId);
				expect(
					(await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'vergeben-1' }, s.sandra.cookie))
						.status,
				).toBe(200);
				const vorher = { stand: await s.stand(), zeilen: await s.mitfahrten() };

				const antworten = [
					// Anderes Kind.
					await s.setze(f.modulId, 'hin', s.mia.personId, { autoId, clientId: 'vergeben-1' }, s.peter.cookie),
					// Dasselbe Kind, anderes Auto.
					await s.setze(f.modulId, 'hin', s.lena.personId, { autoId: andere, clientId: 'vergeben-1' }, s.sandra.cookie),
					// Dasselbe Kind, kommt selbst.
					await s.setze(f.modulId, 'hin', s.lena.personId, { autoId: null, clientId: 'vergeben-1' }, s.sandra.cookie),
					// Dasselbe Kind und Auto, andere Richtung.
					await s.setze(f.modulId, 'rueck', s.lena.personId, { autoId: null, clientId: 'vergeben-1' }, s.sandra.cookie),
				];

				for (const r of antworten) {
					expect(r.status).toBe(409);
					expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', code: 'CLIENT_ID_VERGEBEN' });
				}
				expect(await s.stand()).toBe(vorher.stand);
				expect(await s.mitfahrten()).toEqual(vorher.zeilen);
			});

			it('dieselbe clientId bleibt eine Wiederholung, auch im inzwischen archivierten Thread', async () => {
				const s = await szenario();
				const f = await s.zusagen();
				const autoId = await s.auto(f.modulId, s.sandra.personId);
				const body = { autoId, clientId: 'archiv-1' };
				expect((await s.setze(f.modulId, 'hin', s.lena.personId, body, s.sandra.cookie)).status).toBe(200);
				await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'ARCHIVIERT' } });
				const vorher = await s.stand();

				const r = await s.setze(f.modulId, 'hin', s.lena.personId, body, s.sandra.cookie);

				expect(r.status).toBe(200);
				expect(await s.stand()).toBe(vorher);
			});
		});

		it('Lena noch einmal ins selbe Auto mit neuer clientId: 200 ohne Schreiben, die Zeile bleibt unveraendert', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await s.gib(f.modulId, 'hin', s.lena.personId, autoId, s.sandra.cookie);
			const vorher = { stand: await s.stand(), zeilen: await s.mitfahrten() };

			const r = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'neu-1' }, s.sandra.cookie);

			expect(r.status).toBe(200);
			expect(((await r.json()) as Antwort).stand).toBe(vorher.stand);
			expect(await s.stand()).toBe(vorher.stand);
			expect(await s.mitfahrten()).toEqual(vorher.zeilen);
			expect(s.ereignisse()).toHaveLength(1);
		});

		it('Lena im vollen Auto noch einmal: 200 statt VOLL, sie sitzt ja schon darin', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId, 'HIN', 1);
			await s.gib(f.modulId, 'hin', s.lena.personId, autoId, s.sandra.cookie);

			const r = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'voll-1' }, s.sandra.cookie);

			expect(r.status).toBe(200);
		});

		it('Lena auf kommt selbst: 200, sie steht unter Kommt selbst, im Auto ist wieder alles frei', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await s.gib(f.modulId, 'hin', s.lena.personId, autoId, s.sandra.cookie);
			const vorher = await s.stand();

			const r = await s.setze(
				f.modulId,
				'hin',
				s.lena.personId,
				{ autoId: null, clientId: 'selbst-1' },
				s.sandra.cookie,
			);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Antwort;
			expect(stand).toBe(vorher + 1);
			expect(s.richtungIn(modul, 'HIN')?.kommtSelbst.map((k) => k.kindId)).toEqual([s.lena.personId]);
			expect(s.richtungIn(modul, 'HIN')?.autos[0]).toMatchObject({ frei: 3, mitfahrer: [] });
			expect(s.richtungIn(modul, 'HIN')?.brauchtMitfahrt.map((k) => k.kindId)).toEqual([s.mia.personId]);
			// Ein Upsert: eine Zeile, mit den neuen Werten.
			expect(await s.mitfahrten()).toEqual([
				expect.objectContaining({
					kindId: s.lena.personId,
					autoId: null,
					clientId: 'selbst-1',
					eingetragenAm: JETZT,
				}),
			]);
		});

		it('Lena zuerst auf kommt selbst, dann in ein Auto: die Zeile wechselt, die Reihenfolge ist die des Einsteigens', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await s.gib(f.modulId, 'hin', s.lena.personId, null, s.sandra.cookie);

			const { modul } = await s.gib(f.modulId, 'hin', s.lena.personId, autoId, s.sandra.cookie);

			expect(s.richtungIn(modul, 'HIN')?.kommtSelbst).toEqual([]);
			expect(s.richtungIn(modul, 'HIN')?.autos[0]?.mitfahrer.map((k) => k.kindId)).toEqual([s.lena.personId]);
			expect(await s.mitfahrten()).toHaveLength(1);
		});

		it('Lena von Sandras Auto in das von Peter: 200, sie sitzt nur noch dort, die Platzzahlen stimmen', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const sandras = await s.auto(f.modulId, s.sandra.personId);
			const peters = await s.auto(f.modulId, s.peter.personId, 'HIN', 2);
			await s.gib(f.modulId, 'hin', s.lena.personId, sandras, s.sandra.cookie);

			const { modul } = await s.gib(f.modulId, 'hin', s.lena.personId, peters, s.sandra.cookie);

			const autos = s.richtungIn(modul, 'HIN')?.autos;
			expect(autos?.find((a) => a.id === sandras)).toMatchObject({ frei: 3, mitfahrer: [] });
			expect(autos?.find((a) => a.id === peters)).toMatchObject({ frei: 1 });
			expect(await s.mitfahrten()).toEqual([expect.objectContaining({ autoId: peters, vonId: s.sandra.personId })]);
		});

		it('ein volles Auto: 409 VOLL, nichts geaendert', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId, 'HIN', 1);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.tim.personId, autoId, s.peter.personId);
			const vorher = { stand: await s.stand(), zeilen: await s.mitfahrten() };

			const r = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'zuviel-1' }, s.sandra.cookie);

			expect(r.status).toBe(409);
			expect(await r.json()).toEqual(AUTO_VOLL);
			expect(await s.stand()).toBe(vorher.stand);
			expect(await s.mitfahrten()).toEqual(vorher.zeilen);
			expect(s.ereignisse()).toEqual([]);
		});

		/**
		 * Die Barriere ist die Vereinssperre selbst, wie in helfer.spec.ts: Der Test haelt sie,
		 * beide Anfragen bestehen die Vorpruefung (2 von 3) und warten dann in mitAenderung. Erst
		 * wenn beide dort stehen, gibt der Test die Sperre frei. Ohne Barriere kaeme die zweite erst
		 * nach dem Commit der ersten an und scheiterte schon in der Vorpruefung.
		 */
		it('letzter Platz, zwei Familien gleichzeitig: genau eine 200 und eine 409 VOLL, danach 3 Mitfahrer', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.thomas.personId, 'HIN', 3);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.tim.personId, autoId, s.peter.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.jonas.personId, autoId, s.thomas.personId);
			const vorher = await s.stand();

			const antworten = await mitGehaltenerSperre(s.verein.id, 2, () =>
				Promise.all([
					s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'letzter-lena' }, s.sandra.cookie),
					s.setze(f.modulId, 'hin', s.mia.personId, { autoId, clientId: 'letzter-mia' }, s.peter.cookie),
				]),
			);

			expect(antworten.map((r) => r.status).sort()).toEqual([200, 409]);
			expect(await antworten.find((r) => r.status === 409)?.json()).toEqual(AUTO_VOLL);
			const angenommen = (await antworten.find((r) => r.status === 200)?.json()) as Antwort;
			expect(s.richtungIn(angenommen.modul, 'HIN')?.autos[0]).toMatchObject({ plaetze: 3, frei: 0 });
			expect(await prisma.mitfahrt.count({ where: { autoId } })).toBe(3);
			expect(await s.stand()).toBe(vorher + 1);
		});

		it('dasselbe Kind zweimal gleichzeitig mit verschiedenen clientIds: eine Zeile, ein Stand', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			const vorher = await s.stand();

			const antworten = await mitGehaltenerSperre(s.verein.id, 2, () =>
				Promise.all([
					s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'zwei-a' }, s.sandra.cookie),
					s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'zwei-b' }, s.thomas.cookie),
				]),
			);

			expect(antworten.map((r) => r.status)).toEqual([200, 200]);
			expect(await s.mitfahrten()).toHaveLength(1);
			// Die zweite findet unter der Sperre das Kind schon im Auto: keine zweite Aenderung.
			expect(await s.stand()).toBe(vorher + 1);
		});

		describe('nicht dabei', () => {
			it('Max (vielleicht): 409 NICHT_DABEI, auch durch Thomas und auch fuer kommt selbst', async () => {
				const s = await szenario();
				const f = await s.zusagen();
				const autoId = await s.auto(f.modulId, s.sandra.personId);
				const vorher = await s.stand();

				const antworten = [
					await s.setze(f.modulId, 'hin', s.max.personId, { autoId, clientId: 'max-1' }, s.sandra.cookie),
					await s.setze(f.modulId, 'hin', s.max.personId, { autoId, clientId: 'max-2' }, s.thomas.cookie),
					await s.setze(f.modulId, 'hin', s.max.personId, { autoId: null, clientId: 'max-3' }, s.sandra.cookie),
					await s.setze(f.modulId, 'hin', s.max.personId, { autoId: null, clientId: 'max-4' }, s.thomas.cookie),
					// Tim hat gar nicht geantwortet.
					await s.setze(f.modulId, 'hin', s.tim.personId, { autoId, clientId: 'tim-1' }, s.peter.cookie),
				];

				for (const r of antworten) {
					expect(r.status).toBe(409);
					expect(await r.json()).toEqual(NICHT_DABEI);
				}
				expect(await s.mitfahrten()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('Absage nach dem Einsteigen: Lena bleibt mit nichtMehrDabei, Umsetzen ist 409, Herausnehmen durch die Mutter 200', async () => {
				const s = await szenario();
				const f = await s.zusagen();
				const autoId = await s.auto(f.modulId, s.sandra.personId);
				await s.gib(f.modulId, 'hin', s.lena.personId, autoId, s.sandra.cookie);
				await f.sageAb(s.lena.personId);

				const modul = await s.lies(f.threadId, s.sandra.cookie);
				expect(s.richtungIn(modul, 'HIN')?.autos[0]?.mitfahrer).toEqual([
					expect.objectContaining({ kindId: s.lena.personId, nichtMehrDabei: true, darfHerausnehmen: true }),
				]);
				const vorher = await s.stand();
				const umsetzen = await s.setze(
					f.modulId,
					'hin',
					s.lena.personId,
					{ autoId: null, clientId: 'ab-1' },
					s.sandra.cookie,
				);
				expect(umsetzen.status).toBe(409);
				expect(await umsetzen.json()).toEqual(NICHT_DABEI);
				expect(await s.stand()).toBe(vorher);
				expect(await s.mitfahrten()).toEqual([expect.objectContaining({ autoId })]);

				const heraus = await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.sandra.cookie);

				expect(heraus.status).toBe(200);
				expect(await s.mitfahrten()).toEqual([]);
				expect(s.richtungIn(((await heraus.json()) as Antwort).modul, 'HIN')?.autos[0]).toMatchObject({ frei: 3 });
			});
		});

		it('Thomas (Leitung) setzt Mia in Sandras Auto: 200, Sandras naechster GET zeigt Mia', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);

			const r = await s.setze(f.modulId, 'hin', s.mia.personId, { autoId, clientId: 'mia-1' }, s.thomas.cookie);

			expect(r.status).toBe(200);
			expect(await s.mitfahrten()).toEqual([
				expect.objectContaining({ kindId: s.mia.personId, vonId: s.thomas.personId }),
			]);
			const modul = await s.lies(f.threadId, s.sandra.cookie);
			expect(s.richtungIn(modul, 'HIN')?.autos[0]?.mitfahrer.map((k) => k.kindId)).toEqual([s.mia.personId]);
		});

		it('Lena setzt sich selbst ein, auch mit eigener Sitzung: 200', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);

			const r = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'selbst-lena' }, s.lena.cookie);

			expect(r.status).toBe(200);
			expect(await s.mitfahrten()).toEqual([
				expect.objectContaining({ kindId: s.lena.personId, vonId: s.lena.personId, autoId }),
			]);
		});

		describe('Ablehnungen', () => {
			it('fremdes Kind, Kind der anderen Familie, Erwachsener, unbekannt, Umfrage-Modul, unsichtbarer Thread: dieselbe 404', async () => {
				const s = await szenario();
				const f = await s.zusagen();
				const nurLeiter = await s.fahrt({}, { rollenfilter: 'NUR_JUGENDLEITER' });
				const autoId = await s.auto(f.modulId, s.sandra.personId);
				const nurLeiterAuto = await s.auto(nurLeiter.modulId, s.thomas.personId);
				const umfrage = await legeThreadAn(prisma, s.verein, JETZT, {
					erstelltVonId: s.thomas.personId,
					module: [{ typ: 'UMFRAGE' }],
				});
				const vorher = await s.stand();

				const faelle: [string, string, string | null, string][] = [
					[f.modulId, s.mia.personId, autoId, s.sandra.cookie],
					[f.modulId, s.sandra.personId, autoId, s.sandra.cookie],
					[f.modulId, 'gibt-es-nicht', autoId, s.sandra.cookie],
					[umfrage.modulIds[0] as string, s.lena.personId, null, s.sandra.cookie],
					[nurLeiter.modulId, s.lena.personId, nurLeiterAuto, s.sandra.cookie],
					['gibt-es-nicht', s.lena.personId, autoId, s.sandra.cookie],
				];
				const texte: string[] = [];
				for (const [modulId, kindId, auto, cookie] of faelle) {
					const r = await s.setze(modulId, 'hin', kindId, { autoId: auto, clientId: randomUUID() }, cookie);
					expect(r.status).toBe(404);
					texte.push(JSON.stringify(await r.json()));
				}

				expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
				expect(new Set(texte).size).toBe(1);
				expect(await s.mitfahrten()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('Auto der anderen Richtung, eines anderen Moduls oder unbekannt: 404, auch bei :richtung quer', async () => {
				const s = await szenario();
				const f = await s.zusagen();
				const anderer = await s.zusagen();
				const hinAuto = await s.auto(f.modulId, s.sandra.personId, 'HIN');
				const fremdesAuto = await s.auto(anderer.modulId, s.sandra.personId, 'HIN');
				const vorher = await s.stand();

				const faelle: [string, string, string][] = [
					[f.modulId, 'rueck', hinAuto],
					[f.modulId, 'hin', fremdesAuto],
					[f.modulId, 'hin', 'gibt-es-nicht'],
					[f.modulId, 'quer', hinAuto],
					[f.modulId, 'HIN', hinAuto],
					[f.modulId, 'Hin', hinAuto],
				];
				for (const [modulId, richtung, autoId] of faelle) {
					const r = await s.setze(
						modulId,
						richtung,
						s.lena.personId,
						{ autoId, clientId: randomUUID() },
						s.sandra.cookie,
					);
					expect(r.status).toBe(404);
					expect(await r.json()).toEqual(NICHT_GEFUNDEN);
				}
				expect(await s.mitfahrten()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('Richtung nicht eingeschaltet: 404 fuer Auto und fuer kommt selbst, DELETE ebenso', async () => {
				const s = await szenario();
				const f = await s.zusagen({ rueck: false });
				const vorher = await s.stand();

				const selbst = await s.setze(
					f.modulId,
					'rueck',
					s.lena.personId,
					{ autoId: null, clientId: 'r-1' },
					s.sandra.cookie,
				);
				const heraus = await s.nimmHeraus(f.modulId, 'rueck', s.lena.personId, s.sandra.cookie);

				for (const r of [selbst, heraus]) {
					expect(r.status).toBe(404);
					expect(await r.json()).toEqual(NICHT_GEFUNDEN);
				}
				expect(await s.stand()).toBe(vorher);
			});

			it('Entwurf: 409 ENTWURF fuer Thomas, 404 fuer Sandra, die ihn nicht sieht', async () => {
				const s = await szenario();
				const f = await s.zusagen({}, { veroeffentlicht: false });
				const autoId = await s.auto(f.modulId, s.thomas.personId);
				const vorher = await s.stand();

				const leiter = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'e-1' }, s.thomas.cookie);
				const mutter = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'e-2' }, s.sandra.cookie);

				expect(leiter.status).toBe(409);
				expect(await leiter.json()).toEqual({ fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' });
				expect(mutter.status).toBe(404);
				expect(await mutter.json()).toEqual(NICHT_GEFUNDEN);
				expect(await s.mitfahrten()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('archiviert: Sandra bekommt 409 ARCHIVIERT, Thomas setzt ein (200)', async () => {
				const s = await szenario();
				const f = await s.zusagen({}, { archivModus: 'ARCHIVIERT' });
				const autoId = await s.auto(f.modulId, s.sandra.personId);

				const mutter = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'a-1' }, s.sandra.cookie);
				const leiter = await s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: 'a-2' }, s.thomas.cookie);

				expect(mutter.status).toBe(409);
				expect(await mutter.json()).toEqual({ fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' });
				expect(leiter.status).toBe(200);
				expect(await s.mitfahrten()).toHaveLength(1);
			});
		});

		describe('400', () => {
			it.each<[string, unknown, string]>([
				['autoId als Zahl', { autoId: 42, clientId: 'c-1' }, 'autoId'],
				['autoId fehlt', { clientId: 'c-1' }, 'autoId'],
				['autoId leer', { autoId: '', clientId: 'c-1' }, 'autoId'],
				['ohne clientId', { autoId: null }, 'clientId'],
				['clientId mit Leerzeichen', { autoId: null, clientId: 'a b' }, 'clientId'],
				['ohne Koerper', undefined, 'autoId'],
			])('%s: 400 mit feld, ohne Zeile und ohne Stand', async (_name, body, feld) => {
				const s = await szenario();
				const f = await s.zusagen();
				const vorher = await s.stand();

				const r = await s.setze(f.modulId, 'hin', s.lena.personId, body, s.sandra.cookie);

				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: 'Ungültige Anfrage', feld });
				expect(await s.mitfahrten()).toEqual([]);
				expect(await s.stand()).toBe(vorher);
			});

			it('die 400 steht vor der 404: auch eine unbekannte Fahrgemeinschaft meldet den Feldfehler', async () => {
				const s = await szenario();
				const r = await s.setze(
					'gibt-es-nicht',
					'hin',
					s.lena.personId,
					{ autoId: 42, clientId: 'c-1' },
					s.sandra.cookie,
				);
				expect(r.status).toBe(400);
			});
		});
	});

	describe('DELETE /fahrten/:modulId/:richtung/:kindId', () => {
		it('die Fahrerin nimmt ein fremdes Kind aus ihrem Auto: 200, frei steigt, eine Aenderung ANTWORT, ein Ereignis', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.mia.personId, autoId, s.peter.personId);
			const vorher = await s.stand();

			const r = await s.nimmHeraus(f.modulId, 'hin', s.mia.personId, s.sandra.cookie);

			expect(r.status).toBe(200);
			const { modul, stand } = (await r.json()) as Antwort;
			expect(stand).toBe(vorher + 1);
			expect(s.richtungIn(modul, 'HIN')?.autos[0]).toMatchObject({ frei: 3, mitfahrer: [] });
			expect(s.richtungIn(modul, 'HIN')?.brauchtMitfahrt.map((k) => k.kindId)).toEqual(
				expect.arrayContaining([s.mia.personId]),
			);
			expect(await s.mitfahrten()).toEqual([]);
			expect(await prisma.aenderung.findMany({ where: { vereinId: s.verein.id, stand } })).toEqual([
				expect.objectContaining({
					threadId: f.threadId,
					art: 'ANTWORT',
					objektId: f.modulId,
					urheberId: s.sandra.personId,
				}),
			]);
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

		it('die Eltern nehmen ihr Kind aus einem fremden Auto, Lena sich selbst, Thomas jedes Kind', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.thomas.personId);
			for (const [kind, cookie] of [
				[s.mia, s.peter.cookie],
				[s.lena, s.lena.cookie],
				[s.lena, s.thomas.cookie],
			] as const) {
				await setzeEinTest(s.db, f.modulId, 'HIN', kind.personId, autoId, s.thomas.personId);
				expect((await s.nimmHeraus(f.modulId, 'hin', kind.personId, cookie)).status).toBe(200);
			}
			expect(await s.mitfahrten()).toEqual([]);
		});

		it('kommt selbst herausnehmen: die Mutter 200, eine fremde Person 404, ohne dass die Zeile verschwindet', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, null, s.sandra.personId);

			const fremd = await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.peter.cookie);
			expect(fremd.status).toBe(404);
			expect(await s.mitfahrten()).toHaveLength(1);

			const mutter = await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.sandra.cookie);
			expect(mutter.status).toBe(200);
			expect(await s.mitfahrten()).toEqual([]);
		});

		it('eine andere Person (nicht Fahrerin, nicht Familie): 404, die Mitfahrt bleibt', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.mia.personId, autoId, s.peter.personId);
			const vorher = await s.stand();

			const r = await s.nimmHeraus(f.modulId, 'hin', s.mia.personId, s.hans.cookie);

			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			expect(await s.mitfahrten()).toHaveLength(1);
			expect(await s.stand()).toBe(vorher);
			expect(s.ereignisse()).toEqual([]);
		});

		it('ein zweites DELETE der Eltern: 200 mit der Ansicht und dem Vereinsstand, keine Aenderung, kein Ereignis', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.mia.personId, autoId, s.peter.personId);
			expect((await s.nimmHeraus(f.modulId, 'hin', s.mia.personId, s.peter.cookie)).status).toBe(200);
			const vorher = await s.stand();
			const ereignisse = s.ereignisse().length;

			const zweite = await s.nimmHeraus(f.modulId, 'hin', s.mia.personId, s.peter.cookie);

			expect(zweite.status).toBe(200);
			expect(((await zweite.json()) as Antwort).stand).toBe(vorher);
			expect(await s.stand()).toBe(vorher);
			expect(await s.aenderungen()).toHaveLength(1);
			expect(s.ereignisse()).toHaveLength(ereignisse);
		});

		// Ohne Zeile weiss der Server nicht mehr, wer fuhr: Die Fahrerin hat fuer ein fremdes Kind kein
		// Recht, das ueber die Mitfahrt hinausreicht. Der Client behandelt die 404 wie bei der Helferliste.
		it('ein zweites DELETE der Fahrerin fuer ein fremdes Kind: 404, nichts geschrieben', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.mia.personId, autoId, s.peter.personId);
			expect((await s.nimmHeraus(f.modulId, 'hin', s.mia.personId, s.sandra.cookie)).status).toBe(200);
			const vorher = await s.stand();

			const zweite = await s.nimmHeraus(f.modulId, 'hin', s.mia.personId, s.sandra.cookie);

			expect(zweite.status).toBe(404);
			expect(await s.stand()).toBe(vorher);
		});

		it('ohne Mitfahrt ist das DELETE fuer die Mutter eines nicht betrachteten Kindes 200, fuer Fremde 404', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const vorher = await s.stand();

			// Max ist nur vielleicht dabei: Herausnehmen geht immer, auch ohne Zusage.
			expect((await s.nimmHeraus(f.modulId, 'hin', s.max.personId, s.sandra.cookie)).status).toBe(200);
			expect((await s.nimmHeraus(f.modulId, 'hin', s.max.personId, s.thomas.cookie)).status).toBe(200);
			expect((await s.nimmHeraus(f.modulId, 'hin', s.max.personId, s.peter.cookie)).status).toBe(404);
			expect(await s.stand()).toBe(vorher);
		});

		describe('Ablehnungen', () => {
			it('unbekannte Fahrgemeinschaft, Umfrage-Modul, :richtung quer, Richtung aus und fremdes Kind: dieselbe 404', async () => {
				const s = await szenario();
				const f = await s.zusagen({ rueck: false });
				const umfrage = await legeThreadAn(prisma, s.verein, JETZT, {
					erstelltVonId: s.thomas.personId,
					module: [{ typ: 'UMFRAGE' }],
				});

				const faelle: [string, string, string][] = [
					['gibt-es-nicht', 'hin', s.lena.personId],
					[umfrage.modulIds[0] as string, 'hin', s.lena.personId],
					[f.modulId, 'quer', s.lena.personId],
					[f.modulId, 'rueck', s.lena.personId],
					[f.modulId, 'hin', 'gibt-es-nicht'],
					[f.modulId, 'hin', s.mia.personId],
				];
				for (const [modulId, richtung, kindId] of faelle) {
					const r = await s.nimmHeraus(modulId, richtung, kindId, s.sandra.cookie);
					expect(r.status).toBe(404);
					expect(await r.json()).toEqual(NICHT_GEFUNDEN);
				}
			});

			it('Entwurf: 409 ENTWURF fuer Thomas, mit und ohne Mitfahrt; Sandra sieht den Thread nicht (404)', async () => {
				const s = await szenario();
				const f = await s.zusagen({}, { veroeffentlicht: false });
				const autoId = await s.auto(f.modulId, s.thomas.personId);
				await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.thomas.personId);
				const vorher = await s.stand();

				const mit = await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.thomas.cookie);
				const ohne = await s.nimmHeraus(f.modulId, 'hin', s.mia.personId, s.thomas.cookie);
				const mutter = await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.sandra.cookie);

				for (const r of [mit, ohne]) {
					expect(r.status).toBe(409);
					expect(await r.json()).toEqual({ fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' });
				}
				expect(mutter.status).toBe(404);
				expect(await s.mitfahrten()).toHaveLength(1);
				expect(await s.stand()).toBe(vorher);
			});

			it('archiviert: die Mutter bekommt 409 ARCHIVIERT, Thomas nimmt heraus (200)', async () => {
				const s = await szenario();
				const f = await s.zusagen({}, { archivModus: 'ARCHIVIERT' });
				const autoId = await s.auto(f.modulId, s.sandra.personId);
				await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.sandra.personId);

				const mutter = await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.sandra.cookie);
				expect(mutter.status).toBe(409);
				expect(await mutter.json()).toEqual({ fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' });
				expect(await s.mitfahrten()).toHaveLength(1);

				expect((await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.thomas.cookie)).status).toBe(200);
				expect(await s.mitfahrten()).toEqual([]);
			});
		});
	});

	/**
	 * Die Arbeit der Routen unter der Sperre, direkt aufgerufen, nachdem der Test die Fahrgemeinschaft
	 * oder den Thread in der Datenbank geaendert hat (der Editor, die Mutter in der Umfrage oder
	 * eine andere Familie zwischen Pruefung und Schreiben), wie in helfer.spec.ts.
	 */
	describe('unter der Sperre', () => {
		type Szenario = Awaited<ReturnType<typeof szenario>>;
		type Fahrt = Awaited<ReturnType<Szenario['zusagen']>>;

		function schreibeDirekt(
			s: Szenario,
			f: Fahrt,
			kindId: string,
			autoId: string | null,
			clientId: string = randomUUID(),
			personId = s.sandra.personId,
			richtung: Richtung = 'HIN',
		) {
			return vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, () =>
					schreibeMitfahrt(tx, {
						personId,
						threadId: f.threadId,
						modulId: f.modulId,
						richtung,
						kindId,
						autoId,
						clientId,
						zeit: JETZT,
					}),
				),
			);
		}

		function loescheDirekt(s: Szenario, f: Fahrt, kindId: string, personId = s.sandra.personId) {
			return vereinDb(prisma, s.verein.id).$transaction((tx) =>
				mitAenderung(tx, s.verein.id, personId, JETZT, () =>
					loescheMitfahrt(tx, {
						personId,
						threadId: f.threadId,
						modulId: f.modulId,
						richtung: 'HIN',
						kindId,
						zeit: JETZT,
					}),
				),
			);
		}

		/** Erwartet den Abbruch, und dass weder eine neue Zeile noch ein Stand uebrig bleibt. */
		async function erwarteAbbruch(s: Szenario, arbeit: Promise<unknown>, status: number, antwort: object) {
			const vorher = { stand: await s.stand(), zeilen: await s.mitfahrten() };
			const fehler = await arbeit.catch((e: unknown) => e);
			expect(fehler).toBeInstanceOf(ThreadAbbruch);
			expect(fehler).toMatchObject({ status, antwort: expect.objectContaining(antwort) });
			expect(await s.mitfahrten()).toEqual(vorher.zeilen);
			expect(await s.stand()).toBe(vorher.stand);
		}

		it('Einsetzen: ohne Aenderung dazwischen schreibt es die Zeile mit der Aenderung ANTWORT', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);

			const { aenderungen } = await schreibeDirekt(s, f, s.lena.personId, autoId);

			expect(await s.mitfahrten()).toHaveLength(1);
			expect(aenderungen).toEqual([{ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId }]);
		});

		it('Einsetzen: Auto inzwischen voll: 409 VOLL', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId, 'HIN', 1);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.tim.personId, autoId, s.peter.personId);
			await erwarteAbbruch(s, schreibeDirekt(s, f, s.lena.personId, autoId), 409, AUTO_VOLL);
		});

		it('Einsetzen: Auto inzwischen zurueckgezogen: 404 statt eines Fremdschluesselfehlers', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await prisma.auto.delete({ where: { id: autoId } });
			await erwarteAbbruch(s, schreibeDirekt(s, f, s.lena.personId, autoId), 404, NICHT_GEFUNDEN);
		});

		it('Einsetzen: Richtung oder Fahrgemeinschaft inzwischen entfernt: 404', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			await prisma.fahrtModul.update({ where: { id: f.modulId }, data: { rueck: false } });
			await erwarteAbbruch(
				s,
				schreibeDirekt(s, f, s.lena.personId, null, randomUUID(), s.sandra.personId, 'RUECK'),
				404,
				NICHT_GEFUNDEN,
			);
			await prisma.threadModul.delete({ where: { id: f.modulId } });
			await erwarteAbbruch(s, schreibeDirekt(s, f, s.lena.personId, null), 404, NICHT_GEFUNDEN);
		});

		it('Einsetzen: Kind inzwischen abgesagt: 409 NICHT_DABEI', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			await f.sageAb(s.lena.personId);
			await erwarteAbbruch(s, schreibeDirekt(s, f, s.lena.personId, null), 409, NICHT_DABEI);
		});

		it('Einsetzen: inzwischen archiviert 409 ARCHIVIERT, inzwischen Entwurf 409 ENTWURF fuer die Leitung', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'ARCHIVIERT' } });
			await erwarteAbbruch(s, schreibeDirekt(s, f, s.lena.personId, null), 409, { code: 'ARCHIVIERT' });
			await prisma.thread.update({
				where: { id: f.threadId },
				data: { archivModus: 'AUTOMATISCH', veroeffentlichtAm: null },
			});
			await erwarteAbbruch(s, schreibeDirekt(s, f, s.lena.personId, null, randomUUID(), s.thomas.personId), 409, {
				code: 'ENTWURF',
			});
		});

		it('Einsetzen: dasselbe Kind inzwischen im selben Auto ist eine Wiederholung ohne Stand', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, autoId, s.thomas.personId);
			const vorher = await s.stand();

			const fehler = await schreibeDirekt(s, f, s.lena.personId, autoId).catch((e: unknown) => e);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});

		it('Einsetzen: dieselbe clientId nach der Mitfahrt ist eine Wiederholung, auch im inzwischen archivierten Thread', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const autoId = await s.auto(f.modulId, s.sandra.personId);
			await schreibeDirekt(s, f, s.lena.personId, autoId, 'wieder-1');
			await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'ARCHIVIERT' } });
			const vorher = await s.stand();

			const fehler = await schreibeDirekt(s, f, s.lena.personId, autoId, 'wieder-1').catch((e: unknown) => e);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});

		it('Herausnehmen: ohne Aenderung dazwischen loescht es die Zeile', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, null, s.sandra.personId);

			const { aenderungen } = await loescheDirekt(s, f, s.lena.personId);

			expect(await s.mitfahrten()).toEqual([]);
			expect(aenderungen).toEqual([{ threadId: f.threadId, art: 'ANTWORT', objektId: f.modulId }]);
		});

		it('Herausnehmen: Mitfahrt inzwischen weg ist eine Wiederholung ohne Stand', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			const vorher = await s.stand();

			const fehler = await loescheDirekt(s, f, s.lena.personId).catch((e: unknown) => e);

			expect(fehler).toBeInstanceOf(Wiederholung);
			expect(await s.stand()).toBe(vorher);
		});

		it('Herausnehmen: inzwischen archiviert 409 ARCHIVIERT, eine fremde Person 404', async () => {
			const s = await szenario();
			const f = await s.zusagen();
			await setzeEinTest(s.db, f.modulId, 'HIN', s.lena.personId, null, s.sandra.personId);
			await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'ARCHIVIERT' } });
			await erwarteAbbruch(s, loescheDirekt(s, f, s.lena.personId), 409, { code: 'ARCHIVIERT' });
			await prisma.thread.update({ where: { id: f.threadId }, data: { archivModus: 'AUTOMATISCH' } });
			await erwarteAbbruch(s, loescheDirekt(s, f, s.lena.personId, s.hans.personId), 404, NICHT_GEFUNDEN);
		});
	});

	it('mehr als zwei Anfragen im engen Fenster: die dritte ist 429, auch ein DELETE zaehlt', async () => {
		const s = await szenario();
		const f = await s.zusagen();
		const autoId = await s.auto(f.modulId, s.sandra.personId);
		const setze = (n: number) =>
			s.setze(f.modulId, 'hin', s.lena.personId, { autoId, clientId: `fenster-${n}` }, s.sandra.cookie, eng);

		expect((await setze(1)).status).toBe(200);
		expect((await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.sandra.cookie, eng)).status).toBe(200);
		const dritte = await setze(3);

		expect(dritte.status).toBe(429);
		expect(await dritte.json()).toEqual({ fehler: 'Zu viele Versuche', wartenSekunden: 60 });
		expect((await s.nimmHeraus(f.modulId, 'hin', s.lena.personId, s.sandra.cookie, eng)).status).toBe(429);
		// Das Fenster zaehlt je Person: Peter setzt weiter ein.
		const peter = await s.setze(
			f.modulId,
			'hin',
			s.mia.personId,
			{ autoId, clientId: 'fenster-4' },
			s.peter.cookie,
			eng,
		);
		expect(peter.status).toBe(200);
	});

	it('ohne Sitzung 401', async () => {
		const s = await szenario();
		const f = await s.zusagen();
		const pfad = s.api(`/fahrten/${f.modulId}/hin/${s.lena.personId}`);
		expect((await sende(server.url, pfad, { methode: 'PUT', body: { autoId: null, clientId: 'ohne-1' } })).status).toBe(
			401,
		);
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
