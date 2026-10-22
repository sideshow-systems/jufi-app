import { createPrismaClientFromEnv, vereinDb, type PrismaClient } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeVereinAn } from '../test-vereine.js';
import { raeumeDateienAuf } from './aufraeumen.js';
import { dateiSchluessel, VerzeichnisSpeicher } from './speicher.js';

const STUNDE_MS = 60 * 60 * 1000;
/**
 * Weit vor jeder Uhr der anderen Testdateien, wie bei threads/aufraeumen.spec.ts: Das Aufraeumen
 * liest die Loeschliste plattformweit, und Eintraege anderer Testdateien tragen die Wanduhr.
 * Nur was dieser Test ausdruecklich so alt anlegt, liegt vor der Grenze. Die Orphan-Pruefung
 * betrifft nur die eigene Wurzel, jeder Test hat ein eigenes Verzeichnis.
 */
const JETZT = new Date('2000-06-01T03:00:00.000Z');
const vor = (stunden: number) => new Date(JETZT.getTime() - stunden * STUNDE_MS);

describe('raeumeDateienAuf', () => {
	const prisma = createPrismaClientFromEnv();
	let wurzel: string;
	let speicher: VerzeichnisSpeicher;

	beforeEach(async () => {
		wurzel = await mkdtemp(join(tmpdir(), 'jufi-aufraeumen-'));
		speicher = new VerzeichnisSpeicher(wurzel);
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(wurzel, { recursive: true, force: true });
	});
	afterAll(() => prisma.$disconnect());

	/** Legt Bytes unter dem Schluessel ab und stellt ihre Aenderungszeit ein. */
	async function lege(schluessel: string, geaendertAm: Date): Promise<void> {
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, 'x');
		await speicher.uebernimm(temp, schluessel);
		await utimes(join(wurzel, schluessel), geaendertAm, geaendertAm);
	}
	async function gibtEs(schluessel: string): Promise<boolean> {
		const strom = await speicher.lies(schluessel);
		strom?.destroy();
		return strom !== null;
	}

	/**
	 * Der Aufraeumer liest alle Datei-Zeilen der Datenbank, die Testdatenbank teilen sich aber alle
	 * Testdateien: Deren Zeilen haben in dieser Wurzel keine Bytes und liessen "fehlend" schwanken.
	 * Darum sieht der Aufraeumer hier nur die Zeilen des Vereins des Tests.
	 */
	function nur(vereinId: string): PrismaClient {
		return new Proxy(prisma, {
			get(ziel, name) {
				if (name === 'datei') {
					return {
						findMany: (args: { where?: object } = {}) =>
							ziel.datei.findMany({ ...args, where: { ...args.where, vereinId } } as never),
					};
				}
				return (ziel as never)[name];
			},
		});
	}

	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `aufraeumen-d-${randomUUID().slice(0, 8)}` });
		const person = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER' });
		const db = vereinDb(prisma, verein.id);
		const kategorie = await db.dokumentKategorie.findFirstOrThrow({ orderBy: { position: 'asc' } });
		const dateiMitZeile = async () => {
			const dokument = await db.dokument.create({
				data: { kategorieId: kategorie.id, titel: 'Titel', angelegtAm: new Date() },
			});
			return db.datei.create({
				data: {
					art: 'DATEI',
					dokumentId: dokument.id,
					name: 'x.pdf',
					typ: 'application/pdf',
					groesse: 1,
					sha256: 'x',
					vonId: person.personId,
					hochgeladenAm: new Date(),
				},
			});
		};
		return { verein, db, dateiMitZeile };
	}

	it('loescht Eintraege der Loeschliste erst nach 24 Stunden, samt Zeile', async () => {
		const s = await szenario();
		const jung = dateiSchluessel(s.verein.id, randomUUID());
		const alt = dateiSchluessel(s.verein.id, randomUUID());
		await lege(jung, vor(1));
		await lege(alt, vor(1));
		await prisma.dateiLoeschung.createMany({
			data: [
				{ schluessel: jung, vereinId: s.verein.id, geloeschtAm: vor(23) },
				{ schluessel: alt, vereinId: s.verein.id, geloeschtAm: vor(25) },
			],
		});

		const bilanz = await raeumeDateienAuf(nur(s.verein.id), speicher, JETZT);

		expect(bilanz.geloescht).toBe(1);
		expect(await gibtEs(jung)).toBe(true);
		expect(await gibtEs(alt)).toBe(false);
		const rest = await prisma.dateiLoeschung.findMany({ where: { vereinId: s.verein.id } });
		expect(rest.map((z) => z.schluessel)).toEqual([jung]);
	});

	it('ein Eintrag ohne Bytes ist kein Fehler und verschwindet', async () => {
		const s = await szenario();
		const schluessel = dateiSchluessel(s.verein.id, randomUUID());
		await prisma.dateiLoeschung.create({ data: { schluessel, vereinId: s.verein.id, geloeschtAm: vor(30) } });
		expect((await raeumeDateienAuf(nur(s.verein.id), speicher, JETZT)).geloescht).toBe(1);
		expect(await prisma.dateiLoeschung.count({ where: { schluessel } })).toBe(0);
	});

	it('loescht Waisen erst, wenn sie aelter als 24 Stunden sind', async () => {
		const s = await szenario();
		const jung = dateiSchluessel(s.verein.id, randomUUID());
		const alt = dateiSchluessel(s.verein.id, randomUUID());
		const altVorschau = dateiSchluessel(s.verein.id, randomUUID(), true);
		await lege(jung, vor(23));
		await lege(alt, vor(25));
		await lege(altVorschau, vor(25));

		const bilanz = await raeumeDateienAuf(nur(s.verein.id), speicher, JETZT);

		expect(bilanz.waisen).toBe(2);
		expect(await gibtEs(jung)).toBe(true);
		expect(await gibtEs(alt)).toBe(false);
		expect(await gibtEs(altVorschau)).toBe(false);
	});

	it('laesst Bytes mit Zeile und die Vorschau eines Fotos mit Zeile stehen', async () => {
		const s = await szenario();
		const datei = await s.dateiMitZeile();
		const haupt = dateiSchluessel(s.verein.id, datei.id);
		const vorschau = dateiSchluessel(s.verein.id, datei.id, true);
		await lege(haupt, vor(100));
		await lege(vorschau, vor(100));

		const bilanz = await raeumeDateienAuf(nur(s.verein.id), speicher, JETZT);

		expect(bilanz.waisen).toBe(0);
		expect(bilanz.fehlend).toBe(0);
		expect(await gibtEs(haupt)).toBe(true);
		expect(await gibtEs(vorschau)).toBe(true);
	});

	it('laesst alte Bytes stehen, die noch auf der Loeschliste stehen und juenger als 24 Stunden sind', async () => {
		const s = await szenario();
		const schluessel = dateiSchluessel(s.verein.id, randomUUID());
		await lege(schluessel, vor(100));
		await prisma.dateiLoeschung.create({ data: { schluessel, vereinId: s.verein.id, geloeschtAm: vor(2) } });

		const bilanz = await raeumeDateienAuf(nur(s.verein.id), speicher, JETZT);

		expect(bilanz.waisen).toBe(0);
		expect(await gibtEs(schluessel)).toBe(true);
	});

	it('meldet eine Zeile ohne Bytes als fehlend und loescht nichts', async () => {
		const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const s = await szenario();
		const datei = await s.dateiMitZeile();

		const bilanz = await raeumeDateienAuf(nur(s.verein.id), speicher, JETZT);

		expect(bilanz.fehlend).toBe(1);
		expect(await prisma.datei.count({ where: { id: datei.id } })).toBe(1);
		const log = fehler.mock.calls.flat().join(' ');
		expect(log).toContain('1 Dateien ohne Bytes');
	});

	it('raeumt Temp-Dateien nach einer Stunde auf', async () => {
		const s = await szenario();
		const jung = await speicher.neueTempDatei();
		const alt = await speicher.neueTempDatei();
		await writeFile(jung, 'x');
		await writeFile(alt, 'x');
		await utimes(jung, vor(0.5), vor(0.5));
		await utimes(alt, vor(2), vor(2));

		const bilanz = await raeumeDateienAuf(nur(s.verein.id), speicher, JETZT);

		expect(bilanz.temp).toBe(1);
	});
});
