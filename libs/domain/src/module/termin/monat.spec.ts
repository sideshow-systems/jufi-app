import { describe, expect, it } from 'vitest';
import { MONATSNAMEN, markierteTage, monatAus, monatsRaster, nachbarMonat } from './monat.js';
import type { TerminEintrag } from './termin.js';

function eintrag(startDatum: string, endDatum: string | null = null): TerminEintrag {
	return {
		threadId: 't1',
		titel: 'Termin',
		termin: { modulId: 'm1', startDatum, endDatum, beginn: null, ende: null, ort: null, treffpunkt: null },
	};
}

describe('monatAus', () => {
	it('liest JJJJ-MM', () => {
		expect(monatAus('2026-10')).toEqual({ jahr: 2026, monat: 10 });
	});

	it.each(['2026-13', '2026-1', '2026-00', '', '2026-10-01'])('lehnt %j ab', (text) => {
		expect(monatAus(text)).toBeNull();
	});
});

describe('monatsRaster', () => {
	it('beginnt am Montag und fuellt mit null auf 42 Felder', () => {
		const raster = monatsRaster(2027, 2);
		expect(raster).toHaveLength(42);
		expect(raster[0]).toBe('2027-02-01');
		expect(raster[27]).toBe('2027-02-28');
		expect(raster[28]).toBeNull();
	});

	it('setzt einen Sonntag als Monatserster in die siebte Spalte', () => {
		const raster = monatsRaster(2026, 3);
		expect(raster.slice(0, 6)).toEqual([null, null, null, null, null, null]);
		expect(raster[6]).toBe('2026-03-01');
	});

	it('enthaelt den Tag der Zeitumstellung genau einmal', () => {
		expect(monatsRaster(2026, 3).filter((tag) => tag === '2026-03-29')).toHaveLength(1);
		expect(monatsRaster(2026, 10).filter((tag) => tag === '2026-10-25')).toHaveLength(1);
	});

	it('zeigt alle Tage des Monats in Reihenfolge', () => {
		const tage = monatsRaster(2024, 2).filter((tag) => tag !== null);
		expect(tage).toHaveLength(29);
		expect(tage[28]).toBe('2024-02-29');
	});
});

describe('markierteTage', () => {
	it('markiert beide Monate eines Termins ueber die Monatsgrenze', () => {
		const termine = [eintrag('2026-10-30', '2026-11-02')];
		expect(markierteTage(termine, 2026, 10)).toEqual(new Set(['2026-10-30', '2026-10-31']));
		expect(markierteTage(termine, 2026, 11)).toEqual(new Set(['2026-11-01', '2026-11-02']));
	});

	it('markiert bei einem eintaegigen Termin nur seinen Tag', () => {
		expect(markierteTage([eintrag('2026-10-24')], 2026, 10)).toEqual(new Set(['2026-10-24']));
	});

	it('markiert nichts in einem Monat ohne Termin', () => {
		expect(markierteTage([eintrag('2026-10-24')], 2026, 9).size).toBe(0);
	});
});

describe('nachbarMonat', () => {
	it('springt ueber den Jahreswechsel', () => {
		expect(nachbarMonat(2026, 12, 1)).toEqual({ jahr: 2027, monat: 1 });
		expect(nachbarMonat(2027, 1, -1)).toEqual({ jahr: 2026, monat: 12 });
	});

	it('bleibt im Jahr', () => {
		expect(nachbarMonat(2026, 10, 1)).toEqual({ jahr: 2026, monat: 11 });
	});
});

describe('MONATSNAMEN', () => {
	it('hat zwoelf Namen', () => {
		expect(MONATSNAMEN).toHaveLength(12);
		expect(MONATSNAMEN[0]).toBe('Januar');
		expect(MONATSNAMEN[11]).toBe('Dezember');
	});
});
