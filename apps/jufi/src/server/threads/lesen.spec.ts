import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import type { FahrtModulAnsicht, ThreadAnsicht, ZeilenAnsicht } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { bieteAutoTest, legeThreadAn, machJugendsprecher, ordneZu, setzeEinTest } from './test-threads.js';

const TAG_MS = 24 * 60 * 60 * 1000;
// Feste Uhr der App und fester Zugangszeitpunkt: Was "vor dem Zugang" und "danach" heisst,
// soll nicht von der Wanduhr abhaengen.
const JETZT = new Date('2026-10-22T10:00:00.000Z');
const ZUGANG = new Date('2026-10-10T10:00:00.000Z');
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

const ANSICHT_SCHLUESSEL = [
	'angepinnt',
	'archiviert',
	'art',
	'darfArchivieren',
	'darfBearbeiten',
	'entwurf',
	'id',
	'module',
	'modus',
	'rollenfilter',
	'schreibSperre',
	'stand',
	'titel',
	'verlauf',
];

describe('Thread lesen und Gelesen-Stand', () => {
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

	/**
	 * Ein Verein je Test mit Sandra (Mutter von Lena und Max), Hans (Grossvater von Max), den
	 * beiden Kindern und einem Jugendleiter, der die Threads anlegt. Alle Zugaenge stammen
	 * von ZUGANG, damit "Nachricht vor dem Zugang" in den Tests eine feste Bedeutung hat.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `lesen-${randomUUID().slice(0, 8)}` });
		const mitglied = (e: Parameters<typeof legeMitgliedAn>[2]) =>
			legeMitgliedAn(prisma, verein, { jetzt: JETZT, ...e });
		const leiter = await mitglied({ art: 'ERWACHSENER', vorname: 'Thomas', rechte: ['THREADS_ERSTELLEN'] });
		const sandra = await mitglied({ art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Mutter' });
		const hans = await mitglied({ art: 'ERWACHSENER', vorname: 'Hans', nachname: 'Opa' });
		const lena = await mitglied({ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Mutter' });
		const max = await mitglied({ art: 'JUNGFISCHER', vorname: 'Max', nachname: 'Mutter' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		await ordneZu(prisma, verein, sandra.personId, max.personId);
		await ordneZu(prisma, verein, hans.personId, max.personId, 'GROSSVATER');
		await prisma.zugang.updateMany({ where: { vereinId: verein.id }, data: { angelegtAm: ZUGANG } });

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const hole = (threadId: string, cookie?: string) => sende(server.url, api(`/threads/${threadId}`), { cookie });
		const holeAnsicht = async (threadId: string, cookie: string) => {
			const r = await hole(threadId, cookie);
			expect(r.status).toBe(200);
			return (await r.json()) as ThreadAnsicht;
		};
		const gelesen = (threadId: string, body: unknown, cookie?: string) =>
			sende(server.url, api(`/threads/${threadId}/gelesen`), { methode: 'PUT', body, cookie });
		const stand = async () =>
			(await prisma.verein.findUniqueOrThrow({ where: { id: verein.id }, select: { aenderungsstand: true } }))
				.aenderungsstand;
		/** Eine Nachricht mit dem naechsten Stand, so wie die Route sie schreiben wird. */
		const schreibe = async (threadId: string, autorId: string, angelegtAm: Date) => {
			const { aenderungsstand } = await prisma.verein.update({
				where: { id: verein.id },
				data: { aenderungsstand: { increment: 1 } },
				select: { aenderungsstand: true },
			});
			await prisma.verlaufEintrag.create({
				data: {
					vereinId: verein.id,
					threadId,
					art: 'NACHRICHT',
					autorId,
					text: 'Hallo zusammen',
					stand: aenderungsstand,
					angelegtAm,
				},
			});
			return aenderungsstand;
		};
		const gelesenStand = (personId: string, threadId: string) =>
			prisma.gelesenStand.findUnique({ where: { personId_threadId: { personId, threadId } } });
		const bowling = async () =>
			legeThreadAn(prisma, verein, JETZT, {
				titel: 'Bowling',
				erstelltVonId: leiter.personId,
				module: [{ typ: 'UMFRAGE', teilnahme: true, vielleicht: true }],
			});
		return {
			verein,
			leiter,
			sandra,
			hans,
			lena,
			max,
			api,
			hole,
			holeAnsicht,
			gelesen,
			stand,
			schreibe,
			gelesenStand,
			bowling,
		};
	}

	describe('GET /threads/:id', () => {
		it('zeigt die Fahrgemeinschaft mit Auto, Mitfahrer und dem Kind, das noch eine Mitfahrt braucht', async () => {
			const s = await szenario();
			const db = vereinDb(prisma, s.verein.id);
			const t = await legeThreadAn(prisma, s.verein, JETZT, {
				titel: 'Zeltlager',
				erstelltVonId: s.leiter.personId,
				module: [{ typ: 'FAHRT' }],
			});
			const modulId = t.modulIds[0] as string;
			const auto = await bieteAutoTest(db, modulId, s.hans.personId, 'HIN', 3, { ort: 'Vereinsheim' });
			await setzeEinTest(db, modulId, 'HIN', s.max.personId, auto, s.hans.personId);

			const ansicht = await s.holeAnsicht(t.threadId, s.sandra.cookie);
			const modul = ansicht.module[0] as FahrtModulAnsicht;
			expect(modul.typ).toBe('FAHRT');
			const [hin, rueck] = modul.richtungen;
			expect(hin?.autos).toHaveLength(1);
			expect(hin?.autos[0]).toMatchObject({
				id: auto,
				fahrerId: s.hans.personId,
				ort: 'Vereinsheim',
				plaetze: 3,
				frei: 2,
			});
			expect(hin?.autos[0]?.mitfahrer.map((k) => k.kindId)).toEqual([s.max.personId]);
			expect(hin?.brauchtMitfahrt.map((k) => k.kindId)).toEqual([s.lena.personId]);
			// Die Rueckrichtung rechnet getrennt: Dort braucht noch jeder eine Mitfahrt.
			expect(rueck?.autos).toEqual([]);
			expect(rueck?.brauchtMitfahrt.map((k) => k.kindId).sort()).toEqual([s.lena.personId, s.max.personId].sort());
		});

		it("Sandra sieht Bowling mit genau den Feldern der Ansicht und zwei Zeilen; Hans' Antwort traegt seinen Namen", async () => {
			const s = await szenario();
			const t = await s.bowling();
			await vereinDb(prisma, s.verein.id).umfrageAntwort.create({
				data: {
					umfrageId: t.modulIds[0] as string,
					fuerId: s.max.personId,
					vonId: s.hans.personId,
					abgegebenAm: JETZT,
					clientId: randomUUID(),
					optionen: { create: [{ optionId: t.optionIds['dabei'] as string }] },
				},
			});

			const r = await s.hole(t.threadId, s.sandra.cookie);

			expect(r.status).toBe(200);
			const ansicht = (await r.json()) as ThreadAnsicht;
			expect(Object.keys(ansicht).sort()).toEqual(ANSICHT_SCHLUESSEL);
			expect(ansicht.id).toBe(t.threadId);
			expect(ansicht.titel).toBe('Bowling');
			const umfrage = ansicht.module[0] as { zeilen: ZeilenAnsicht[] };
			expect(umfrage.zeilen.map((z) => z.vorname).sort()).toEqual(['Lena', 'Max']);
			const fuerMax = umfrage.zeilen.find((z) => z.fuerId === s.max.personId);
			expect(fuerMax?.optionIds).toEqual([t.optionIds['dabei']]);
			expect(fuerMax?.eingetragenVon).toBe('eingetragen von Großvater Hans');
			expect(umfrage.zeilen.find((z) => z.fuerId === s.lena.personId)?.eingetragenVon).toBeNull();
		});

		describe('Foto-Modul: Hinweis auf Kinder ohne Foto-Einwilligung', () => {
			const hinweisAn = async (s: Awaited<ReturnType<typeof szenario>>, threadId: string) => {
				const ansicht = await s.holeAnsicht(threadId, s.leiter.cookie);
				const modul = ansicht.module.find((m) => m.typ === 'FOTOS');
				return modul?.typ === 'FOTOS' ? modul.hinweis : undefined;
			};
			const willigtEin = (s: Awaited<ReturnType<typeof szenario>>, kind: string, von: string, widerrufen = false) =>
				prisma.einwilligung.create({
					data: {
						vereinId: s.verein.id,
						jungfischerId: kind,
						erteiltVon: von,
						art: 'FOTOS',
						textVersion: '1',
						widerrufenAm: widerrufen ? JETZT : null,
					},
				});
			const fotoThread = (s: Awaited<ReturnType<typeof szenario>>) =>
				legeThreadAn(prisma, s.verein, JETZT, {
					titel: 'Fotos',
					erstelltVonId: s.leiter.personId,
					module: [{ typ: 'FOTOS', hochladen: 'JUGENDLEITER' }],
				});

			it('der Jugendleiter erfaehrt, wessen Kinder nicht gezeigt werden duerfen; mit der Einwilligung der Mutter nicht mehr', async () => {
				const s = await szenario();
				const t = await fotoThread(s);
				expect(await hinweisAn(s, t.threadId)).toBe('Von Lena M. und Max M. dürfen keine Fotos gezeigt werden');

				await willigtEin(s, s.lena.personId, s.sandra.personId);
				await willigtEin(s, s.max.personId, s.sandra.personId);
				expect(await hinweisAn(s, t.threadId)).toBeNull();
			});

			it('eine widerrufene Foto-Einwilligung und die DSGVO-Einwilligung zaehlen nicht', async () => {
				const s = await szenario();
				const t = await fotoThread(s);
				await willigtEin(s, s.lena.personId, s.sandra.personId);
				await willigtEin(s, s.max.personId, s.sandra.personId, true);
				await prisma.einwilligung.create({
					data: {
						vereinId: s.verein.id,
						jungfischerId: s.max.personId,
						erteiltVon: s.sandra.personId,
						art: 'DSGVO_ART8',
						textVersion: '1',
					},
				});
				expect(await hinweisAn(s, t.threadId)).toBe('Von Max M. dürfen keine Fotos gezeigt werden');
			});

			it('am Tag nach dem 18. Geburtstag gilt die Einwilligung der Mutter nicht mehr, nur die eigene', async () => {
				const s = await szenario();
				const t = await fotoThread(s);
				await willigtEin(s, s.lena.personId, s.sandra.personId);
				await willigtEin(s, s.max.personId, s.sandra.personId);
				// JETZT ist der 22.10.2026: am 21.10.2008 geboren, ist Max seit gestern volljaehrig.
				await prisma.person.update({ where: { id: s.max.personId }, data: { geburtsdatum: new Date('2008-10-21') } });
				expect(await hinweisAn(s, t.threadId)).toBe('Von Max M. dürfen keine Fotos gezeigt werden');

				await willigtEin(s, s.max.personId, s.max.personId);
				expect(await hinweisAn(s, t.threadId)).toBeNull();
			});
		});

		it('unbekannt, Nur Jugendleiter, Entwurf und Austausch sind fuer Sandra dieselbe 404', async () => {
			const s = await szenario();
			const nurLeiter = await legeThreadAn(prisma, s.verein, JETZT, {
				rollenfilter: 'NUR_JUGENDLEITER',
				erstelltVonId: s.leiter.personId,
			});
			const entwurf = await legeThreadAn(prisma, s.verein, JETZT, {
				veroeffentlicht: false,
				erstelltVonId: s.leiter.personId,
			});
			const austausch = await prisma.thread.findFirstOrThrow({
				where: { vereinId: s.verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' },
			});

			const texte: string[] = [];
			for (const id of ['gibt-es-nicht', nurLeiter.threadId, entwurf.threadId, austausch.id]) {
				const r = await s.hole(id, s.sandra.cookie);
				expect(r.status).toBe(404);
				texte.push(await r.text());
			}
			expect(JSON.parse(texte[0] as string)).toEqual(NICHT_GEFUNDEN);
			// Byte-gleich: keine Antwort verraet, dass es den Thread gibt.
			expect(new Set(texte).size).toBe(1);
		});

		it('Lena als Jugendsprecherin liest den Austausch, Max ohne Merkmal bekommt 404', async () => {
			const s = await szenario();
			await machJugendsprecher(prisma, s.lena.personId);
			const austausch = await prisma.thread.findFirstOrThrow({
				where: { vereinId: s.verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' },
			});

			const lena = await s.hole(austausch.id, s.lena.cookie);
			expect(lena.status).toBe(200);
			expect(((await lena.json()) as ThreadAnsicht).art).toBe('JUGENDSPRECHER_AUSTAUSCH');
			const max = await s.hole(austausch.id, s.max.cookie);
			expect(max.status).toBe(404);
			expect(await max.json()).toEqual(NICHT_GEFUNDEN);
		});

		it('stand ist der Vereinsstand; verlauf zaehlt die Nachrichten und die fremden Nachrichten nach dem Gelesen-Stand', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const nachZugang = new Date(ZUGANG.getTime() + TAG_MS);
			const fremd1 = await s.schreibe(t.threadId, s.leiter.personId, nachZugang);
			// Die eigene Nachricht zaehlt nie als ungelesen, wohl aber als Nachricht.
			await s.schreibe(t.threadId, s.sandra.personId, nachZugang);

			const ohneZeile = await s.holeAnsicht(t.threadId, s.sandra.cookie);
			expect(ohneZeile.stand).toBe(await s.stand());
			expect(ohneZeile.verlauf).toEqual({ eintraege: 2, ungelesen: 1 });

			await prisma.gelesenStand.create({
				data: {
					vereinId: s.verein.id,
					personId: s.sandra.personId,
					threadId: t.threadId,
					gelesenBis: fremd1,
					verlaufGelesenBis: fremd1,
					gelesenAm: JETZT,
				},
			});
			expect((await s.holeAnsicht(t.threadId, s.sandra.cookie)).verlauf.ungelesen).toBe(0);

			await s.schreibe(t.threadId, s.leiter.personId, nachZugang);
			expect((await s.holeAnsicht(t.threadId, s.sandra.cookie)).verlauf).toEqual({ eintraege: 3, ungelesen: 1 });
		});

		it('verlauf.eintraege zaehlt nur Nachrichten, geloeschte eingeschlossen, keine Systemeintraege', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const nachZugang = new Date(ZUGANG.getTime() + TAG_MS);
			await s.schreibe(t.threadId, s.leiter.personId, nachZugang);
			await s.schreibe(t.threadId, s.leiter.personId, nachZugang);
			const erste = await prisma.verlaufEintrag.findFirstOrThrow({ where: { threadId: t.threadId } });
			await prisma.verlaufEintrag.update({
				where: { id: erste.id },
				data: { text: null, geloeschtAm: nachZugang, geloeschtVonId: s.leiter.personId },
			});
			// Das Veroeffentlichen schreibt ab Etappe 3 einen Systemeintrag: Zaehlte er mit, haette jeder
			// veroeffentlichte Aushang einen Verlauf.
			const { aenderungsstand } = await prisma.verein.update({
				where: { id: s.verein.id },
				data: { aenderungsstand: { increment: 1 } },
				select: { aenderungsstand: true },
			});
			await prisma.verlaufEintrag.create({
				data: {
					vereinId: s.verein.id,
					threadId: t.threadId,
					art: 'SYSTEM',
					systemArt: 'VEROEFFENTLICHT',
					stand: aenderungsstand,
					angelegtAm: nachZugang,
				},
			});

			expect((await s.holeAnsicht(t.threadId, s.sandra.cookie)).verlauf.eintraege).toBe(2);
		});

		it('ohne Sitzung 401', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const r = await s.hole(t.threadId);
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual({ fehler: 'nicht angemeldet' });
		});
	});

	describe('PUT /threads/:id/gelesen', () => {
		it('verlauf setzt beide Felder auf den Stand; danach ist nichts mehr ungelesen', async () => {
			const s = await szenario();
			const t = await s.bowling();
			await s.schreibe(t.threadId, s.leiter.personId, new Date(ZUGANG.getTime() + TAG_MS));
			const ansicht = await s.holeAnsicht(t.threadId, s.sandra.cookie);
			expect(ansicht.verlauf.ungelesen).toBe(1);

			const r = await s.gelesen(t.threadId, { bereich: 'verlauf', bis: ansicht.stand }, s.sandra.cookie);

			expect(r.status).toBe(204);
			const zeile = await s.gelesenStand(s.sandra.personId, t.threadId);
			expect(zeile).toMatchObject({ gelesenBis: ansicht.stand, verlaufGelesenBis: ansicht.stand, gelesenAm: JETZT });
			expect((await s.holeAnsicht(t.threadId, s.sandra.cookie)).verlauf.ungelesen).toBe(0);
		});

		it('ein kleineres bis aendert nichts, ein groesseres wird auf den Vereinsstand gekuerzt', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const stand = await s.stand();
			await s.gelesen(t.threadId, { bereich: 'verlauf', bis: stand }, s.sandra.cookie);

			expect((await s.gelesen(t.threadId, { bereich: 'verlauf', bis: 0 }, s.sandra.cookie)).status).toBe(204);
			expect((await s.gelesen(t.threadId, { bereich: 'uebersicht', bis: 0 }, s.sandra.cookie)).status).toBe(204);
			expect(await s.gelesenStand(s.sandra.personId, t.threadId)).toMatchObject({
				gelesenBis: stand,
				verlaufGelesenBis: stand,
			});

			// Kein Client darf etwas als gelesen melden, das es noch nicht gibt.
			const ueber = await s.bowling();
			expect((await s.gelesen(ueber.threadId, { bereich: 'verlauf', bis: stand + 1000 }, s.hans.cookie)).status).toBe(
				204,
			);
			const gekuerzt = await s.gelesenStand(s.hans.personId, ueber.threadId);
			expect(gekuerzt).toMatchObject({ gelesenBis: await s.stand(), verlaufGelesenBis: await s.stand() });
		});

		it('uebersicht legt die Zeile hinter dem letzten Eintrag vor dem Zugang an und fasst verlaufGelesenBis danach nie an', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const davor = await s.schreibe(t.threadId, s.leiter.personId, new Date(ZUGANG.getTime() - TAG_MS));
			await s.schreibe(t.threadId, s.leiter.personId, new Date(ZUGANG.getTime() + TAG_MS));
			// Ohne Zeile zaehlt die Zugangszeit: nur die Nachricht danach ist neu.
			expect((await s.holeAnsicht(t.threadId, s.sandra.cookie)).verlauf.ungelesen).toBe(1);

			expect(
				(await s.gelesen(t.threadId, { bereich: 'uebersicht', bis: await s.stand() }, s.sandra.cookie)).status,
			).toBe(204);

			const zeile = await s.gelesenStand(s.sandra.personId, t.threadId);
			expect(zeile?.gelesenBis).toBe(await s.stand());
			// Waere es 0, galte auch die Nachricht von vor dem Zugang als ungelesen.
			expect(zeile?.verlaufGelesenBis).toBe(davor);
			expect((await s.holeAnsicht(t.threadId, s.sandra.cookie)).verlauf.ungelesen).toBe(1);

			// Ein zweites uebersicht-Oeffnen mit hoeherem Stand hebt nur gelesenBis.
			const spaeter = await s.schreibe(t.threadId, s.leiter.personId, new Date(ZUGANG.getTime() + 2 * TAG_MS));
			await s.gelesen(t.threadId, { bereich: 'uebersicht', bis: spaeter }, s.sandra.cookie);
			expect(await s.gelesenStand(s.sandra.personId, t.threadId)).toMatchObject({
				gelesenBis: spaeter,
				verlaufGelesenBis: davor,
			});
			expect((await s.holeAnsicht(t.threadId, s.sandra.cookie)).verlauf.ungelesen).toBe(2);
		});

		it('uebersicht in einem Thread ohne Eintrag vor dem Zugang beginnt bei 0', async () => {
			const s = await szenario();
			const t = await s.bowling();

			await s.gelesen(t.threadId, { bereich: 'uebersicht', bis: await s.stand() }, s.sandra.cookie);

			expect((await s.gelesenStand(s.sandra.personId, t.threadId))?.verlaufGelesenBis).toBe(0);
		});

		it('zwei gleichzeitige erste Aufrufe legen genau eine Zeile an', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const stand = await s.stand();

			const antworten = await Promise.all(
				[1, 2, 3, 4].map(() => s.gelesen(t.threadId, { bereich: 'verlauf', bis: stand }, s.sandra.cookie)),
			);

			expect(antworten.map((r) => r.status)).toEqual([204, 204, 204, 204]);
			expect(await prisma.gelesenStand.count({ where: { threadId: t.threadId } })).toBe(1);
		});

		it('veraendert weder Aenderungsstand noch Aenderung noch letzteAktivitaetAm', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const lesen = async () => ({
				stand: await s.stand(),
				aenderungen: await prisma.aenderung.count({ where: { vereinId: s.verein.id } }),
				aktivitaet: (await prisma.thread.findUniqueOrThrow({ where: { id: t.threadId } })).letzteAktivitaetAm,
			});
			const vorher = await lesen();

			await s.gelesen(t.threadId, { bereich: 'uebersicht', bis: vorher.stand }, s.sandra.cookie);
			await s.gelesen(t.threadId, { bereich: 'verlauf', bis: vorher.stand }, s.sandra.cookie);

			expect(await lesen()).toEqual(vorher);
		});

		it.each([
			['unbekannter Bereich', { bereich: 'x', bis: 1 }],
			['negatives bis', { bereich: 'verlauf', bis: -1 }],
			['Bruchzahl', { bereich: 'verlauf', bis: 1.5 }],
			['bis als Text', { bereich: 'verlauf', bis: '1' }],
			['bis fehlt', { bereich: 'verlauf' }],
			['bereich fehlt', { bis: 1 }],
			['leerer Koerper', {}],
			['kein Objekt', 'verlauf'],
		])('%s: 400 ohne Zeile', async (_name, body) => {
			const s = await szenario();
			const t = await s.bowling();

			const r = await s.gelesen(t.threadId, body, s.sandra.cookie);

			expect(r.status).toBe(400);
			expect(await s.gelesenStand(s.sandra.personId, t.threadId)).toBeNull();
		});

		it('ein unsichtbarer oder unbekannter Thread ist 404 ohne Zeile', async () => {
			const s = await szenario();
			const nurLeiter = await legeThreadAn(prisma, s.verein, JETZT, {
				rollenfilter: 'NUR_JUGENDLEITER',
				erstelltVonId: s.leiter.personId,
			});
			const body = { bereich: 'verlauf', bis: 1 };

			for (const id of [nurLeiter.threadId, 'gibt-es-nicht']) {
				const r = await s.gelesen(id, body, s.sandra.cookie);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(NICHT_GEFUNDEN);
			}
			expect(await prisma.gelesenStand.count({ where: { vereinId: s.verein.id } })).toBe(0);
		});

		it('ohne Sitzung 401', async () => {
			const s = await szenario();
			const t = await s.bowling();
			const r = await s.gelesen(t.threadId, { bereich: 'verlauf', bis: 1 });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual({ fehler: 'nicht angemeldet' });
		});
	});
});
