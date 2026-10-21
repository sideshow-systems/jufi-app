import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeVereinAn } from '../test-vereine.js';
import {
	ladeKoepfe,
	ladeNeuKandidaten,
	ladeThread,
	ladeThreads,
	ladeThreadUmfeld,
	ladeVereinsstand,
	modulOrt,
} from './laden.js';
import { legeThreadAn, ordneZu, steckeInUntergruppe } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00Z');

describe('Threads laden', () => {
	const prisma = createPrismaClientFromEnv();

	afterAll(async () => {
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test: Die Datenbank teilen sich alle Testdateien, die Zeilen bleiben so zaehlbar. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `laden-${randomUUID().slice(0, 8)}` });
		return { verein, db: vereinDb(prisma, verein.id) };
	}

	it('liefert den Kopf mit Untergruppen und die Module nach Position, mit Optionen nach Position und Antworten', async () => {
		const { verein, db } = await neuerVerein();
		const lena = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', vorname: 'Lena' });
		const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
		const gross = await steckeInUntergruppe(prisma, verein, lena.personId, 'Gross');
		const klein = await steckeInUntergruppe(prisma, verein, sandra.personId, 'Klein');

		const frist = new Date('2026-10-29T16:00:00Z');
		const { threadId, modulIds, optionIds } = await legeThreadAn(prisma, verein, JETZT, {
			titel: 'Bowling',
			modus: 'CHAT',
			rollenfilter: 'NUR_FAMILIE',
			untergruppenIds: [klein, gross],
			erstelltVonId: sandra.personId,
			archivModus: 'AKTIV_HALTEN',
			module: [
				{ typ: 'INFO', text: 'Bringt Socken mit.' },
				{
					typ: 'TERMIN',
					termin: {
						startDatum: '2026-11-07',
						endDatum: '2026-11-08',
						beginn: '17:00',
						ende: '12:00',
						ort: 'Bowlingbahn',
						treffpunkt: null,
					},
				},
				{ typ: 'UMFRAGE', teilnahme: true, vielleicht: true, frist, ergebnisse: 'SUMME', einheit: 'PERSON' },
			],
		});
		// Positionen von Hand durcheinander: Die Reihenfolge der Module folgt (position, id), nicht dem Anlegen.
		await db.threadModul.update({ where: { id: modulIds[0] }, data: { position: 5 } });
		await db.threadModul.update({ where: { id: modulIds[2] }, data: { position: 1 } });
		await db.umfrageOption.update({ where: { id: optionIds['dabei'] }, data: { position: 7 } });
		await db.umfrageAntwort.create({
			data: {
				umfrageId: modulIds[2],
				fuerId: lena.personId,
				vonId: sandra.personId,
				abgegebenAm: new Date('2026-10-22T09:00:00Z'),
				clientId: randomUUID(),
				optionen: { create: [{ optionId: optionIds['dabei'] }, { optionId: optionIds['abgesagt'] }] },
			},
		});

		const geladen = await ladeThread(db, threadId);

		expect(geladen?.kopf).toEqual({
			id: threadId,
			art: 'NORMAL',
			titel: 'Bowling',
			modus: 'CHAT',
			rollenfilter: 'NUR_FAMILIE',
			alleUntergruppen: false,
			untergruppenIds: [gross, klein].sort(),
			angepinnt: false,
			archivModus: 'AKTIV_HALTEN',
			veroeffentlichtAm: JETZT,
			erstelltVonId: sandra.personId,
		});
		// Position 0 (Termin), 1 (Umfrage), 5 (Info).
		expect(geladen?.module.map((m) => m.id)).toEqual([modulIds[1], modulIds[2], modulIds[0]]);
		expect(geladen?.module[0]).toEqual({
			typ: 'TERMIN',
			id: modulIds[1],
			titel: null,
			termin: {
				modulId: modulIds[1],
				startDatum: '2026-11-07',
				endDatum: '2026-11-08',
				beginn: '17:00',
				ende: '12:00',
				ort: 'Bowlingbahn',
				treffpunkt: null,
			},
		});
		expect(geladen?.module[2]).toEqual({ typ: 'INFO', id: modulIds[0], titel: null, text: 'Bringt Socken mit.' });
		const umfrage = geladen?.module[1];
		if (umfrage?.typ !== 'UMFRAGE') throw new Error('Umfrage erwartet');
		// vielleicht (1) und abgesagt (2) stehen vor dabei, das auf Position 7 gerueckt wurde.
		expect(umfrage.umfrage.optionen.map((o) => o.schluessel)).toEqual(['vielleicht', 'abgesagt', 'dabei']);
		expect(umfrage.umfrage).toMatchObject({
			modulId: modulIds[2],
			einheit: 'PERSON',
			teilnahme: true,
			vielleicht: true,
			mehrfach: false,
			frist,
			ergebnisse: 'SUMME',
		});
		expect(umfrage.umfrage.antworten).toEqual([
			{
				fuerId: lena.personId,
				vonId: sandra.personId,
				// In der Reihenfolge der Optionen: abgesagt (Position 2) vor dabei (Position 7).
				optionIds: [optionIds['abgesagt'], optionIds['dabei']],
				abgegebenAm: new Date('2026-10-22T09:00:00Z'),
			},
		]);
	});

	it('ladeThreads ohne Antworten laesst die Antworten leer, behaelt aber Optionen und Ergebnisse', async () => {
		const { verein, db } = await neuerVerein();
		const lena = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', vorname: 'Lena' });
		const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
		const { threadId, modulIds, optionIds } = await legeThreadAn(prisma, verein, JETZT, {
			erstelltVonId: sandra.personId,
			module: [{ typ: 'UMFRAGE', teilnahme: true, ergebnisse: 'SUMME', einheit: 'PERSON' }],
		});
		for (const fuerId of [lena.personId, sandra.personId]) {
			await db.umfrageAntwort.create({
				data: {
					umfrageId: modulIds[0],
					fuerId,
					vonId: sandra.personId,
					abgegebenAm: JETZT,
					clientId: randomUUID(),
					optionen: { create: [{ optionId: optionIds['dabei'] }] },
				},
			});
		}

		const ohne = (await ladeThreads(db, { threadIds: [threadId], mitAntworten: false }))[0];
		const mit = (await ladeThreads(db, { threadIds: [threadId] }))[0];

		const umfrageOhne = ohne?.module[0];
		const umfrageMit = mit?.module[0];
		if (umfrageOhne?.typ !== 'UMFRAGE' || umfrageMit?.typ !== 'UMFRAGE') throw new Error('Umfrage erwartet');
		expect(umfrageOhne.umfrage.antworten).toEqual([]);
		expect(umfrageOhne.umfrage.ergebnisse).toBe('SUMME');
		expect(umfrageOhne.umfrage.optionen).toEqual(umfrageMit.umfrage.optionen);
		expect(umfrageOhne.umfrage.optionen.length).toBeGreaterThan(0);
		expect(umfrageMit.umfrage.antworten).toHaveLength(2);
		expect(ohne?.kopf).toEqual(mit?.kopf);
	});

	it('ordnet jeder Umfrage genau ihre Antworten zu, auch bei mehreren Threads in einer Abfrage', async () => {
		const { verein, db } = await neuerVerein();
		const lena = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', vorname: 'Lena' });
		const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
		const eins = await legeThreadAn(prisma, verein, JETZT, {
			erstelltVonId: sandra.personId,
			module: [{ typ: 'UMFRAGE', teilnahme: true, einheit: 'PERSON' }],
		});
		const zwei = await legeThreadAn(prisma, verein, JETZT, {
			erstelltVonId: sandra.personId,
			module: [{ typ: 'UMFRAGE', teilnahme: true, einheit: 'PERSON' }],
		});
		const antworte = (t: typeof eins, fuerId: string, schluessel: string) =>
			db.umfrageAntwort.create({
				data: {
					umfrageId: t.modulIds[0],
					fuerId,
					vonId: sandra.personId,
					abgegebenAm: JETZT,
					clientId: randomUUID(),
					optionen: { create: [{ optionId: t.optionIds[schluessel] }] },
				},
			});
		await antworte(eins, lena.personId, 'dabei');
		await antworte(zwei, sandra.personId, 'abgesagt');

		const geladen = await ladeThreads(db, { threadIds: [eins.threadId, zwei.threadId] });

		const antwortenVon = (threadId: string) => {
			const modul = geladen.find((t) => t.kopf.id === threadId)?.module[0];
			if (modul?.typ !== 'UMFRAGE') throw new Error('Umfrage erwartet');
			return modul.umfrage.antworten;
		};
		expect(antwortenVon(eins.threadId)).toEqual([
			{ fuerId: lena.personId, vonId: sandra.personId, optionIds: [eins.optionIds['dabei']], abgegebenAm: JETZT },
		]);
		expect(antwortenVon(zwei.threadId)).toEqual([
			{ fuerId: sandra.personId, vonId: sandra.personId, optionIds: [zwei.optionIds['abgesagt']], abgegebenAm: JETZT },
		]);
	});

	it('ladeKoepfe liefert den Kopf wie ladeThread, mit sortierten Untergruppen, und laesst unbekannte IDs weg', async () => {
		const { verein, db } = await neuerVerein();
		const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
		const gross = await steckeInUntergruppe(prisma, verein, sandra.personId, 'Gross');
		const klein = await steckeInUntergruppe(prisma, verein, sandra.personId, 'Klein');
		const a = await legeThreadAn(prisma, verein, JETZT, {
			titel: 'Bowling',
			erstelltVonId: sandra.personId,
			untergruppenIds: [klein, gross],
			module: [{ typ: 'INFO', text: 'Socken' }],
		});

		const koepfe = await ladeKoepfe(db, [a.threadId, 'unbekannt']);

		expect([...koepfe.keys()]).toEqual([a.threadId]);
		expect(koepfe.get(a.threadId)).toEqual((await ladeThread(db, a.threadId))?.kopf);
		expect(koepfe.get(a.threadId)?.untergruppenIds).toEqual([gross, klein].sort());
	});

	it('ladeKoepfe liefert fuer eine leere Liste eine leere Map und sieht keinen fremden Verein', async () => {
		const eigener = await neuerVerein();
		const fremder = await neuerVerein();
		const { threadId } = await legeThreadAn(prisma, fremder.verein, JETZT, {});

		expect((await ladeKoepfe(eigener.db, [])).size).toBe(0);
		expect((await ladeKoepfe(eigener.db, [threadId])).size).toBe(0);
	});

	it('nimmt die Module in der Reihenfolge der IDs, wenn Positionen gleich sind', async () => {
		const { verein, db } = await neuerVerein();
		const { threadId, modulIds } = await legeThreadAn(prisma, verein, JETZT, {
			module: [
				{ typ: 'INFO', text: 'a' },
				{ typ: 'INFO', text: 'b' },
			],
		});
		await db.threadModul.updateMany({ where: { threadId }, data: { position: 0 } });

		const geladen = await ladeThread(db, threadId);

		expect(geladen?.module.map((m) => m.id)).toEqual([...modulIds].sort());
	});

	it('laedt ein INFO-Modul als INFO, auch wenn von Hand eine Terminzeile daran haengt', async () => {
		const { verein, db } = await neuerVerein();
		const { threadId, modulIds } = await legeThreadAn(prisma, verein, JETZT, {
			module: [{ typ: 'INFO', text: 'Nur Text' }],
		});
		await db.terminModul.create({ data: { id: modulIds[0], startDatum: new Date('2026-11-07') } });

		const geladen = await ladeThread(db, threadId);

		expect(geladen?.module).toEqual([{ typ: 'INFO', id: modulIds[0], titel: null, text: 'Nur Text' }]);
	});

	it('ueberspringt ein Modul, dessen Untertabelle fehlt', async () => {
		const { verein, db } = await neuerVerein();
		const { threadId, modulIds } = await legeThreadAn(prisma, verein, JETZT, {
			module: [
				{ typ: 'INFO', text: 'bleibt' },
				{ typ: 'INFO', text: 'verliert die Zeile' },
			],
		});
		await db.infoModul.delete({ where: { id: modulIds[1] } });

		const geladen = await ladeThread(db, threadId);

		expect(geladen?.module.map((m) => m.id)).toEqual([modulIds[0]]);
	});

	it('liefert null fuer einen Thread und ein Modul aus einem fremden Verein', async () => {
		const eigener = await neuerVerein();
		const fremder = await neuerVerein();
		const { threadId, modulIds } = await legeThreadAn(prisma, fremder.verein, JETZT, {
			module: [{ typ: 'INFO', text: 'geheim' }],
		});

		expect(await ladeThread(eigener.db, threadId)).toBeNull();
		expect(await modulOrt(eigener.db, modulIds[0])).toBeNull();
		expect(await ladeThread(fremder.db, threadId)).not.toBeNull();
		expect(await modulOrt(fremder.db, modulIds[0])).toEqual({ threadId, typ: 'INFO' });
	});

	it('liefert null fuer einen unbekannten Thread', async () => {
		const { db } = await neuerVerein();
		expect(await ladeThread(db, 'gibt-es-nicht')).toBeNull();
		expect(await modulOrt(db, 'gibt-es-nicht')).toBeNull();
	});

	it('findet den Austausch eines neuen Vereins ohne Module', async () => {
		const { verein, db } = await neuerVerein();
		const austausch = await prisma.thread.findFirstOrThrow({ where: { vereinId: verein.id } });

		const geladen = await ladeThread(db, austausch.id);

		expect(geladen?.kopf).toMatchObject({ art: 'JUGENDSPRECHER_AUSTAUSCH', erstelltVonId: null, angepinnt: true });
		expect(geladen?.module).toEqual([]);
	});

	it('ladeThreadUmfeld enthaelt Untergruppen-Mitgliedschaften, aber keine Entfernten', async () => {
		const { verein, db } = await neuerVerein();
		const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
		const lena = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', vorname: 'Lena' });
		const mia = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', vorname: 'Mia' });
		await ordneZu(prisma, verein, sandra.personId, lena.personId);
		await ordneZu(prisma, verein, sandra.personId, mia.personId);
		const gruppe = await steckeInUntergruppe(prisma, verein, lena.personId, 'Gross');
		await steckeInUntergruppe(prisma, verein, mia.personId, 'Gross');
		await prisma.person.update({ where: { id: mia.personId }, data: { entferntAm: JETZT } });

		const umfeld = await ladeThreadUmfeld(db);

		expect([...umfeld.personen.keys()].sort()).toEqual([sandra.personId, lena.personId].sort());
		expect(umfeld.untergruppenVon.get(lena.personId)).toEqual(new Set([gruppe]));
		expect(umfeld.untergruppenVon.has(mia.personId)).toBe(false);
		expect(umfeld.zuordnungen.map((z) => z.jungfischerId)).toEqual([lena.personId]);
		expect(umfeld.personen.get(lena.personId)).toMatchObject({ vorname: 'Lena', jugendsprecher: false });
	});

	it('ladeVereinsstand liefert den Aenderungsstand des Vereins', async () => {
		const { verein, db } = await neuerVerein();
		expect(await ladeVereinsstand(db, verein.id)).toBe(0);

		await legeThreadAn(prisma, verein, JETZT);

		expect(await ladeVereinsstand(db, verein.id)).toBe(1);
		const { aenderungsstand } = await prisma.verein.findUniqueOrThrow({ where: { id: verein.id } });
		expect(aenderungsstand).toBe(1);
	});

	it('liefert die letzte Aktivitaet des Threads', async () => {
		const { verein, db } = await neuerVerein();
		const { threadId } = await legeThreadAn(prisma, verein, JETZT);
		await db.thread.update({ where: { id: threadId }, data: { letzteAktivitaetAm: new Date('2026-10-25T08:00:00Z') } });

		expect((await ladeThread(db, threadId))?.letzteAktivitaetAm).toEqual(new Date('2026-10-25T08:00:00Z'));
	});

	describe('ladeNeuKandidaten', () => {
		const ZUGANG = new Date('2026-10-10T10:00:00Z');
		const VOR_ZUGANG = new Date('2026-10-10T09:59:59Z');

		async function aenderung(
			vereinId: string,
			threadId: string,
			stand: number,
			urheberId: string | null,
			angelegtAm: Date,
			art: 'THREAD' | 'LISTE' = 'THREAD',
		) {
			await prisma.aenderung.create({
				data: { vereinId, stand, threadId, art, objektId: threadId, urheberId, angelegtAm },
			});
		}

		it('liefert mit Gelesen-Zeile nur Aenderungen ueber dem Stand, eigene und urheberlose mit', async () => {
			const { verein, db } = await neuerVerein();
			const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
			const thomas = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Thomas' });
			const { threadId } = await legeThreadAn(prisma, verein, JETZT, { erstelltVonId: thomas.personId });
			await prisma.gelesenStand.create({
				data: {
					vereinId: verein.id,
					personId: sandra.personId,
					threadId,
					gelesenBis: 10,
					verlaufGelesenBis: 4,
					gelesenAm: JETZT,
				},
			});
			// Ueber dem Stand zaehlt auch, was vor dem Zugang geschah: mit Zeile entscheidet nur der Stand.
			await aenderung(verein.id, threadId, 10, thomas.personId, JETZT);
			await aenderung(verein.id, threadId, 11, thomas.personId, VOR_ZUGANG);
			await aenderung(verein.id, threadId, 12, sandra.personId, JETZT);
			await aenderung(verein.id, threadId, 13, null, JETZT);
			await aenderung(verein.id, threadId, 14, thomas.personId, JETZT, 'LISTE');

			const k = (await ladeNeuKandidaten(db, sandra.personId, ZUGANG, [threadId], false)).get(threadId);

			expect(k?.gelesenBis).toBe(10);
			expect(k?.verlaufGelesenBis).toBe(4);
			expect(k?.aenderungen.map((a) => a.stand).sort((x, y) => x - y)).toEqual([11, 12, 13, 14]);
			expect(k?.aenderungen.find((a) => a.stand === 13)).toEqual({
				stand: 13,
				art: 'THREAD',
				urheberId: null,
				angelegtAm: JETZT,
			});
			expect(k?.nachrichten).toEqual([]);
		});

		it('liefert ohne Gelesen-Zeile nur Aenderungen ab dem Zugang, den Zugang selbst eingeschlossen', async () => {
			const { verein, db } = await neuerVerein();
			const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
			const thomas = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Thomas' });
			const { threadId } = await legeThreadAn(prisma, verein, JETZT, { erstelltVonId: thomas.personId });
			await aenderung(verein.id, threadId, 20, thomas.personId, VOR_ZUGANG);
			await aenderung(verein.id, threadId, 21, thomas.personId, ZUGANG);
			await aenderung(verein.id, threadId, 22, sandra.personId, JETZT);
			await aenderung(verein.id, threadId, 23, null, JETZT);

			const k = (await ladeNeuKandidaten(db, sandra.personId, ZUGANG, [threadId], false)).get(threadId);

			expect(k?.gelesenBis).toBeNull();
			expect(k?.verlaufGelesenBis).toBeNull();
			// Die Aenderung des Anlegens (angelegtAm = JETZT) kommt aus legeThreadAn dazu.
			const staende = k?.aenderungen.map((a) => a.stand) ?? [];
			expect(staende).toEqual(expect.arrayContaining([21, 22, 23]));
			expect(staende).not.toContain(20);
		});

		it('trennt die Threads, auch mit unterschiedlichen Staenden, und kennt fremde Gelesen-Staende nicht', async () => {
			const { verein, db } = await neuerVerein();
			const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
			const hans = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Hans' });
			const thomas = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Thomas' });
			const a = await legeThreadAn(prisma, verein, JETZT, { erstelltVonId: thomas.personId });
			const b = await legeThreadAn(prisma, verein, JETZT, { erstelltVonId: thomas.personId });
			await prisma.gelesenStand.create({
				data: {
					vereinId: verein.id,
					personId: sandra.personId,
					threadId: a.threadId,
					gelesenBis: 50,
					verlaufGelesenBis: 50,
					gelesenAm: JETZT,
				},
			});
			await prisma.gelesenStand.create({
				data: {
					vereinId: verein.id,
					personId: hans.personId,
					threadId: b.threadId,
					gelesenBis: 99,
					verlaufGelesenBis: 99,
					gelesenAm: JETZT,
				},
			});
			await aenderung(verein.id, a.threadId, 40, thomas.personId, JETZT);
			await aenderung(verein.id, a.threadId, 60, thomas.personId, JETZT);
			await aenderung(verein.id, b.threadId, 60, thomas.personId, JETZT);

			const m = await ladeNeuKandidaten(db, sandra.personId, ZUGANG, [a.threadId, b.threadId], false);

			expect([...m.keys()].sort()).toEqual([a.threadId, b.threadId].sort());
			expect(m.get(a.threadId)?.aenderungen.map((x) => x.stand)).toEqual([60]);
			// Hans' Zeile an b gehoert nicht zu Sandra: b hat fuer sie keinen Stand.
			expect(m.get(b.threadId)?.gelesenBis).toBeNull();
			expect(m.get(b.threadId)?.aenderungen.map((x) => x.stand)).toContain(60);
		});

		it('laedt Nachrichten nur mit mitNachrichten, nach verlaufGelesenBis beziehungsweise ab dem Zugang, ohne Systemeintraege', async () => {
			const { verein, db } = await neuerVerein();
			const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
			const thomas = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Thomas' });
			const mitZeile = await legeThreadAn(prisma, verein, JETZT, { erstelltVonId: thomas.personId });
			const ohneZeile = await legeThreadAn(prisma, verein, JETZT, { erstelltVonId: thomas.personId });
			await prisma.gelesenStand.create({
				data: {
					vereinId: verein.id,
					personId: sandra.personId,
					threadId: mitZeile.threadId,
					gelesenBis: 0,
					verlaufGelesenBis: 5,
					gelesenAm: JETZT,
				},
			});
			const nachricht = (
				threadId: string,
				stand: number,
				angelegtAm: Date,
				art: 'NACHRICHT' | 'SYSTEM' = 'NACHRICHT',
			) =>
				prisma.verlaufEintrag.create({
					data: {
						vereinId: verein.id,
						threadId,
						art,
						autorId: thomas.personId,
						text: art === 'NACHRICHT' ? 'Hallo' : null,
						systemArt: art === 'SYSTEM' ? 'VEROEFFENTLICHT' : null,
						stand,
						angelegtAm,
					},
				});
			await nachricht(mitZeile.threadId, 5, JETZT);
			await nachricht(mitZeile.threadId, 6, VOR_ZUGANG);
			await nachricht(mitZeile.threadId, 7, JETZT, 'SYSTEM');
			await nachricht(ohneZeile.threadId, 3, VOR_ZUGANG);
			await nachricht(ohneZeile.threadId, 4, ZUGANG);

			const ohne = await ladeNeuKandidaten(db, sandra.personId, ZUGANG, [mitZeile.threadId, ohneZeile.threadId], false);
			expect(ohne.get(mitZeile.threadId)?.nachrichten).toEqual([]);

			const mit = await ladeNeuKandidaten(db, sandra.personId, ZUGANG, [mitZeile.threadId, ohneZeile.threadId], true);
			expect(mit.get(mitZeile.threadId)?.nachrichten.map((n) => n.stand)).toEqual([6]);
			expect(mit.get(ohneZeile.threadId)?.nachrichten.map((n) => n.stand)).toEqual([4]);
			expect(mit.get(ohneZeile.threadId)?.nachrichten[0]).toEqual({
				art: 'NACHRICHT',
				stand: 4,
				autorId: thomas.personId,
				angelegtAm: ZUGANG,
				geloeschtAm: null,
			});
		});

		it('liefert fuer keine Threads eine leere Map ohne Abfrage', async () => {
			const { verein, db } = await neuerVerein();
			const sandra = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
			expect((await ladeNeuKandidaten(db, sandra.personId, ZUGANG, [], true)).size).toBe(0);
		});

		it('sieht nichts aus einem fremden Verein', async () => {
			const eins = await neuerVerein();
			const zwei = await neuerVerein();
			const sandra = await legeMitgliedAn(prisma, eins.verein, { art: 'ERWACHSENER', vorname: 'Sandra' });
			const thomas = await legeMitgliedAn(prisma, zwei.verein, { art: 'ERWACHSENER', vorname: 'Thomas' });
			const { threadId } = await legeThreadAn(prisma, zwei.verein, JETZT, { erstelltVonId: thomas.personId });

			const k = (await ladeNeuKandidaten(eins.db, sandra.personId, ZUGANG, [threadId], true)).get(threadId);

			expect(k?.aenderungen).toEqual([]);
			expect(k?.nachrichten).toEqual([]);
		});
	});
});
