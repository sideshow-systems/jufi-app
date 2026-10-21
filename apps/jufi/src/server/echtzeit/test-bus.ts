import type { PrismaClient } from '@jufi/db';
import { expect } from 'vitest';
import { Bus, type BusEreignis } from './bus.js';

// Nur fuer Tests: ein Bus, dessen Ereignisse sich nachlesen lassen. Ein Test-Verein hat
// je Test eine eigene ID, darum sortiert `fuer` die Ereignisse nach Verein, statt dass jeder
// Test den Sammler leeren muesste.

export interface Sammler {
	bus: Bus;
	fuer(vereinId: string): BusEreignis[];
}

export function sammleEreignisse(): Sammler {
	const bus = new Bus();
	const alle: BusEreignis[] = [];
	bus.abonniere((e) => alle.push(e));
	return { bus, fuer: (vereinId) => alle.filter((e) => e.vereinId === vereinId) };
}

/**
 * Prueft, was eine Umfeld-Route (TP2) nach einer angenommenen Anfrage hinterlaesst: genau
 * ein Stand mit je einer Aenderung SICHTBARKEIT ohne Thread je Objekt, und ein Ereignis auf
 * dem Bus mit demselben Stand. Der Test haelt je Verein nur eine solche Anfrage; wer mehrere
 * stellt, muss vorher einen eigenen Verein nehmen. Liefert den Stand.
 */
export async function erwarteUmfeldAenderung(
	prisma: PrismaClient,
	sammler: Sammler,
	vereinId: string,
	objektIds: readonly string[],
): Promise<number> {
	const erwartet = [...objektIds].sort();
	const zeilen = await prisma.aenderung.findMany({ where: { vereinId }, orderBy: [{ objektId: 'asc' }] });
	expect(zeilen.map((z) => [z.threadId, z.art, z.objektId])).toEqual(
		erwartet.map((objektId) => [null, 'SICHTBARKEIT', objektId]),
	);
	const stand = zeilen[0]?.stand ?? 0;
	expect(new Set(zeilen.map((z) => z.stand))).toEqual(new Set([stand]));
	const ereignisse = sammler.fuer(vereinId);
	expect(ereignisse).toHaveLength(1);
	const [e] = ereignisse;
	expect(e).toMatchObject({ typ: 'aenderung', vereinId, stand, eintraege: [] });
	expect(
		(e as Extract<BusEreignis, { typ: 'aenderung' }>).aenderungen.map((a) => [a.threadId, a.art, a.objektId]),
	).toEqual(expect.arrayContaining(erwartet.map((objektId) => [null, 'SICHTBARKEIT', objektId])));
	expect((e as Extract<BusEreignis, { typ: 'aenderung' }>).aenderungen).toHaveLength(erwartet.length);
	return stand;
}

/** Eine abgelehnte oder wirkungslose Anfrage laesst weder eine Aenderung noch ein Ereignis zurueck. */
export async function erwarteNichts(prisma: PrismaClient, sammler: Sammler, vereinId: string): Promise<void> {
	expect(await prisma.aenderung.count({ where: { vereinId } })).toBe(0);
	expect(sammler.fuer(vereinId)).toEqual([]);
	expect((await prisma.verein.findUniqueOrThrow({ where: { id: vereinId } })).aenderungsstand).toBe(0);
}
