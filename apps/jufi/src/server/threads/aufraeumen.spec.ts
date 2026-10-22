import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { DateiSpeicher } from '../dateien/speicher.js';
import { legeVereinAn } from '../test-vereine.js';
import { AENDERUNG_AUFBEWAHRUNG_MS, raeumeAenderungenAuf, starteAufraeumen } from './aufraeumen.js';

const TAG_MS = 24 * 60 * 60 * 1000;
/**
 * Weit vor jeder Uhr der anderen Testdateien: Das Aufraeumen loescht plattformweit, und mit der
 * gemeinsamen Test-Uhr verschwaenden Aenderungen, die parallel laufende Dateien gerade lesen
 * (sie werden mit angelegtAm = jetzt der Datenbank geschrieben). Vor dieser Grenze liegen nur
 * die Zeilen, die dieser Test ausdruecklich so alt anlegt. Muster: mail/arbeiter.spec.ts.
 */
const JETZT = new Date('2000-06-01T03:00:00.000Z');

describe('raeumeAenderungenAuf', () => {
	const prisma = createPrismaClientFromEnv();

	afterAll(() => prisma.$disconnect());

	async function aenderung(vereinId: string, alterTage: number) {
		const zeile = await prisma.aenderung.create({
			data: {
				vereinId,
				stand: 1,
				art: 'THREAD',
				objektId: randomUUID(),
				angelegtAm: new Date(JETZT.getTime() - alterTage * TAG_MS),
			},
		});
		return zeile.id;
	}

	async function vorhanden(ids: string[]) {
		const zeilen = await prisma.aenderung.findMany({ where: { id: { in: ids } }, select: { id: true } });
		return zeilen.map((z) => z.id).sort();
	}

	it('bewahrt 90 Tage auf', () => {
		expect(AENDERUNG_AUFBEWAHRUNG_MS).toBe(90 * TAG_MS);
	});

	it('loescht Zeilen aelter als 90 Tage und behaelt juengere', async () => {
		const verein = await legeVereinAn(prisma, { slug: `aufraeumen-${randomUUID().slice(0, 8)}` });
		const alt = await aenderung(verein.id, 91);
		const jung = await aenderung(verein.id, 89);

		expect(await raeumeAenderungenAuf(prisma, JETZT)).toBe(1);
		expect(await vorhanden([alt, jung])).toEqual([jung]);
	});

	it('raeumt in allen Vereinen auf', async () => {
		const a = await legeVereinAn(prisma, { slug: `aufraeumen-${randomUUID().slice(0, 8)}` });
		const b = await legeVereinAn(prisma, { slug: `aufraeumen-${randomUUID().slice(0, 8)}` });
		const altA = await aenderung(a.id, 120);
		const altB = await aenderung(b.id, 91);
		const jungB = await aenderung(b.id, 1);

		expect(await raeumeAenderungenAuf(prisma, JETZT)).toBe(2);
		expect(await vorhanden([altA, altB, jungB])).toEqual([jungB]);
	});
});

describe('starteAufraeumen', () => {
	/** Ein Client, dessen deleteMany erst auf Zuruf fertig wird; mehr braucht das Aufraeumen nicht. */
	function haengenderClient() {
		const freigaben: Array<() => void> = [];
		const deleteMany = vi.fn(
			(_: unknown) => new Promise<{ count: number }>((fertig) => freigaben.push(() => fertig({ count: 0 }))),
		);
		const prisma = { aenderung: { deleteMany } } as unknown as PrismaClient;
		return { prisma, deleteMany, freigaben };
	}

	it('laeuft sofort mit der Grenze jetzt minus 90 Tage', async () => {
		const c = haengenderClient();
		const a = starteAufraeumen({ prisma: c.prisma, jetzt: () => JETZT });
		expect(c.deleteMany).toHaveBeenCalledTimes(1);
		expect(c.deleteMany).toHaveBeenCalledWith({
			where: { angelegtAm: { lt: new Date(JETZT.getTime() - 90 * TAG_MS) } },
		});
		c.freigaben.forEach((f) => f());
		await a.stoppe();
	});

	it('laeuft im Takt erneut und nach stoppe nicht mehr', async () => {
		vi.useFakeTimers();
		try {
			const c = haengenderClient();
			c.deleteMany.mockResolvedValue({ count: 0 });
			const a = starteAufraeumen({ prisma: c.prisma, jetzt: () => JETZT, intervallMs: 1_000 });
			await vi.advanceTimersByTimeAsync(2_000);
			expect(c.deleteMany).toHaveBeenCalledTimes(3);
			await a.stoppe();
			await vi.advanceTimersByTimeAsync(5_000);
			expect(c.deleteMany).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it('stoppe wartet auf einen laufenden Durchlauf', async () => {
		const c = haengenderClient();
		const a = starteAufraeumen({ prisma: c.prisma, jetzt: () => JETZT });
		let gestoppt = false;
		const stopp = a.stoppe().then(() => (gestoppt = true));
		await new Promise((r) => setTimeout(r, 50));
		expect(gestoppt).toBe(false);
		c.freigaben.forEach((f) => f());
		await stopp;
		expect(gestoppt).toBe(true);
	});

	it('ein gescheiterter Durchlauf loggt nur den Namen des Fehlers', async () => {
		const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const c = haengenderClient();
			c.deleteMany.mockRejectedValue(
				Object.assign(new Error('geheime Verbindungszeile'), { name: 'Verbindungsfehler' }),
			);
			const a = starteAufraeumen({ prisma: c.prisma, jetzt: () => JETZT });
			await a.stoppe();
			expect(fehler).toHaveBeenCalledTimes(1);
			expect(fehler.mock.calls.flat().join(' ')).toContain('Verbindungsfehler');
			expect(fehler.mock.calls.flat().join(' ')).not.toContain('geheime');
		} finally {
			fehler.mockRestore();
		}
	});

	describe('mit Dateispeicher', () => {
		/** Kein Zugriff auf Postgres noetig: jede Tabelle, die der Dateien-Aufraeumer liest, ist leer. */
		function leererClient() {
			const deleteMany = vi.fn(async (_: unknown) => ({ count: 0 }));
			const dateiLoeschung = { findMany: vi.fn(async () => []), delete: vi.fn(), deleteMany };
			const datei = { findMany: vi.fn(async () => []) };
			const prisma = { aenderung: { deleteMany }, dateiLoeschung, datei } as unknown as PrismaClient;
			return { prisma, dateiLoeschung, datei };
		}
		function leererSpeicher() {
			const raeumeTempAuf = vi.fn(async (_: Date) => 0);
			async function* liste() {
				// leer
			}
			const speicher = { liste, raeumeTempAuf, loesche: vi.fn() } as unknown as DateiSpeicher;
			return { speicher, raeumeTempAuf };
		}

		it('ruft im ersten Durchlauf zusaetzlich die Dateien auf', async () => {
			const c = leererClient();
			const s = leererSpeicher();
			const a = starteAufraeumen({ prisma: c.prisma, jetzt: () => JETZT, speicher: s.speicher });
			await a.stoppe();
			expect(c.dateiLoeschung.findMany).toHaveBeenCalledTimes(1);
			expect(s.raeumeTempAuf).toHaveBeenCalledWith(new Date(JETZT.getTime() - 60 * 60 * 1000));
		});

		it('ohne Speicher bleiben die Dateien unberuehrt', async () => {
			const c = leererClient();
			const a = starteAufraeumen({ prisma: c.prisma, jetzt: () => JETZT });
			await a.stoppe();
			expect(c.dateiLoeschung.findMany).not.toHaveBeenCalled();
		});

		it('scheitern die Dateien, laufen die Aenderungen trotzdem und nur der Name wird geloggt', async () => {
			const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			try {
				const c = leererClient();
				c.dateiLoeschung.findMany.mockRejectedValue(
					Object.assign(new Error('geheime Verbindungszeile'), { name: 'Verbindungsfehler' }),
				);
				const s = leererSpeicher();
				const a = starteAufraeumen({ prisma: c.prisma, jetzt: () => JETZT, speicher: s.speicher });
				await a.stoppe();
				expect(fehler.mock.calls.flat().join(' ')).toContain('Verbindungsfehler');
				expect(fehler.mock.calls.flat().join(' ')).not.toContain('geheime');
			} finally {
				fehler.mockRestore();
			}
		});
	});
});
