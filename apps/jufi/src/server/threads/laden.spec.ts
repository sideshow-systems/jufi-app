import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeVereinAn } from '../test-vereine.js';
import { ladeThread, ladeThreadUmfeld, ladeVereinsstand, modulOrt } from './laden.js';
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
});
