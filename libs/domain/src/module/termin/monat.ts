import { tagPlus } from '../../zeit.js';
import { letzterTag, type TerminEintrag } from './termin.js';

export const MONATSNAMEN: readonly string[] = [
	'Januar',
	'Februar',
	'März',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Dezember',
];

const MONAT = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 'JJJJ-MM' als Zahlen; alles andere, auch ein ganzes Datum, ist null. */
export function monatAus(text: string): { jahr: number; monat: number } | null {
	const treffer = MONAT.exec(text);
	return treffer ? { jahr: Number(treffer[1]), monat: Number(treffer[2]) } : null;
}

function zwei(n: number): string {
	return String(n).padStart(2, '0');
}

/**
 * Immer 6 x 7 Felder, Montag zuerst, Tage ausserhalb des Monats null. Sechs
 * Wochen auch dort, wo vier oder fuenf reichen: Verworfen — so viele Wochen wie
 * noetig, dann spraenge die Liste unter dem Raster beim Blaettern um eine
 * Zeile. Der Wochentag kommt aus Date.UTC, verworfen ist new Date(jahr, monat,
 * 1) wie im Entwurf: Das rechnete in der Zeitzone des Prozesses, und die Tage
 * danach laufen ueber tagPlus ohne Zeitumstellung.
 */
export function monatsRaster(jahr: number, monat: number): (string | null)[] {
	const erster = `${jahr}-${zwei(monat)}-01`;
	// getUTCDay zaehlt ab Sonntag (0); Montag soll 0 sein.
	const versatz = (new Date(Date.UTC(jahr, monat - 1, 1)).getUTCDay() + 6) % 7;
	const praefix = `${jahr}-${zwei(monat)}`;
	const felder: (string | null)[] = [];
	for (let i = 0; i < 42; i++) {
		const tag = tagPlus(erster, i - versatz);
		felder.push(tag.startsWith(praefix) ? tag : null);
	}
	return felder;
}

/**
 * Jeder Tag jedes Termins, der in diesem Monat liegt, auch bei einem Termin
 * ueber die Monatsgrenze. Verworfen: je Termin vom Start bis zum Ende zaehlen —
 * ein versehentlich auf Jahre gesetztes Enddatum kostete dann Zeit fuer Tage,
 * die das Raster gar nicht zeigt.
 */
export function markierteTage(eintraege: readonly TerminEintrag[], jahr: number, monat: number): Set<string> {
	const tage = monatsRaster(jahr, monat).filter((tag): tag is string => tag !== null);
	const markiert = new Set<string>();
	for (const e of eintraege) {
		const letzter = letzterTag(e.termin);
		for (const tag of tage) {
			if (tag >= e.termin.startDatum && tag <= letzter) markiert.add(tag);
		}
	}
	return markiert;
}

export function nachbarMonat(jahr: number, monat: number, schritt: -1 | 1): { jahr: number; monat: number } {
	const neu = monat + schritt;
	if (neu < 1) return { jahr: jahr - 1, monat: 12 };
	if (neu > 12) return { jahr: jahr + 1, monat: 1 };
	return { jahr, monat: neu };
}
