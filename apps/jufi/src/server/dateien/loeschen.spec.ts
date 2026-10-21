import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeThreadAn } from '../threads/test-threads.js';
import { legeVereinAn } from '../test-vereine.js';
import { loescheDateien } from './loeschen.js';
import { dateiSchluessel } from './speicher.js';

describe('loescheDateien', () => {
	const prisma = createPrismaClientFromEnv();
	afterAll(() => prisma.$disconnect());

	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `loeschen-${randomUUID().slice(0, 8)}` });
		const person = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER' });
		const db = vereinDb(prisma, verein.id);
		const kategorie = await db.dokumentKategorie.findFirstOrThrow({ orderBy: { position: 'asc' } });
		const { modulIds } = await legeThreadAn(prisma, verein, new Date(), {
			titel: 'Thread mit Foto',
			module: [{ typ: 'INFO', text: 'Info' }],
		});
		const lege = async (art: 'FOTO' | 'DATEI') => {
			const dokument =
				art === 'DATEI'
					? await db.dokument.create({
							data: { kategorieId: kategorie.id, titel: 'Titel', angelegtAm: new Date() },
						})
					: null;
			return db.datei.create({
				data: {
					art,
					dokumentId: dokument?.id,
					modulId: dokument ? undefined : modulIds[0],
					name: 'x.bin',
					typ: 'application/pdf',
					groesse: 1,
					sha256: 'x',
					vonId: person.personId,
					hochgeladenAm: new Date(),
				},
			});
		};
		return { verein, db, lege };
	}

	it('loescht die Zeilen und merkt Schluessel vor, bei Fotos auch die Vorschau', async () => {
		const s = await szenario();
		const datei = await s.lege('DATEI');
		const foto = await s.lege('FOTO');
		const jetzt = new Date('2026-10-22T10:00:00.000Z');

		await s.db.$transaction((tx) =>
			loescheDateien(
				tx,
				s.verein.id,
				[
					{ id: datei.id, art: datei.art },
					{ id: foto.id, art: foto.art },
				],
				jetzt,
			),
		);

		expect(await prisma.datei.count({ where: { id: { in: [datei.id, foto.id] } } })).toBe(0);
		const liste = await prisma.dateiLoeschung.findMany({ where: { vereinId: s.verein.id } });
		expect(liste.map((z) => z.schluessel).sort()).toEqual(
			[
				dateiSchluessel(s.verein.id, datei.id),
				dateiSchluessel(s.verein.id, foto.id),
				dateiSchluessel(s.verein.id, foto.id, true),
			].sort(),
		);
		expect(liste.every((z) => z.geloeschtAm.getTime() === jetzt.getTime())).toBe(true);
	});

	it('mit leerer Liste passiert nichts', async () => {
		const s = await szenario();
		await s.db.$transaction((tx) => loescheDateien(tx, s.verein.id, [], new Date()));
		expect(await prisma.dateiLoeschung.count({ where: { vereinId: s.verein.id } })).toBe(0);
	});
});
