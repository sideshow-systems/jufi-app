import { erzeugeBeispieldaten, P } from './beispieldaten';
import type { Datenstand, Id } from './typen';
import { bezugstagHeute } from './zeit';

/**
 * Speicherung des Entwurfs in localStorage (Spec TP1 5.6).
 *
 * Steigt die Zahl im Schluessel, beginnt jeder Stand neu — das ist gewollt:
 * ein alter Stand passt nach einer Aenderung der Beispieldaten nicht mehr zu
 * den Aufgaben. Alles, was beim Lesen nicht passt, fuehrt zu frischen
 * Beispieldaten statt zu einer weissen Seite.
 */
export const SCHLUESSEL = 'jufi-entwurf:v2';

export interface Ablage {
	lesen(schluessel: string): string | null;
	schreiben(schluessel: string, wert: string): void;
}

export interface Gespeichert {
	stand: Datenstand;
	/** Gehoert dem Testmodus; der Store reicht es nur durch. */
	testmodus: unknown;
	ich: Id;
}

/** Ablage im Speicher: Rueckfall fuer den privaten Modus und fuer Tests. */
export function speicherAblage(start: Record<string, string> = {}): Ablage {
	const werte = new Map(Object.entries(start));
	return {
		lesen: (k) => werte.get(k) ?? null,
		schreiben: (k, v) => void werte.set(k, v),
	};
}

/**
 * localStorage, wo es geht. Safari im privaten Modus und gesperrte
 * Website-Daten werfen schon beim Zugriff; dann laeuft der Entwurf im Speicher
 * weiter und verliert den Stand beim Neuladen (Spec TP1 5.6).
 */
export function browserAblage(): Ablage {
	try {
		const ls = globalThis.localStorage;
		// Nur lesend pruefen: ein Schreibversuch scheitert auch an vollem Speicher,
		// und dann bliebe ein gespeicherter Stand ungelesen. Fehlschlaege beim
		// Schreiben faengt speichern() ab.
		ls.getItem(SCHLUESSEL);
		return {
			lesen: (k) => {
				try {
					return ls.getItem(k);
				} catch {
					return null;
				}
			},
			schreiben: (k, v) => ls.setItem(k, v),
		};
	} catch {
		return speicherAblage();
	}
}

function istStand(s: unknown): s is Datenstand {
	if (!s || typeof s !== 'object') return false;
	const d = s as Partial<Datenstand>;
	return (
		d.version === 2 &&
		typeof d.bezugstag === 'string' &&
		!!d.verein &&
		Array.isArray(d.personen) &&
		Array.isArray(d.elternschaften) &&
		Array.isArray(d.untergruppen) &&
		Array.isArray(d.threads) &&
		Array.isArray(d.dokumente) &&
		!!d.letzterBesuch
	);
}

export function frisch(echt: Date): Gespeichert {
	return { stand: erzeugeBeispieldaten(bezugstagHeute(echt)), testmodus: null, ich: P.sandra };
}

export function laden(ablage: Ablage, echt: Date): Gespeichert {
	try {
		const roh = ablage.lesen(SCHLUESSEL);
		if (!roh) return frisch(echt);
		const g = JSON.parse(roh) as Partial<Gespeichert>;
		if (!istStand(g.stand)) return frisch(echt);
		const ich = typeof g.ich === 'string' && g.stand.personen.some((p) => p.id === g.ich) ? g.ich : P.sandra;
		return { stand: g.stand, testmodus: g.testmodus ?? null, ich };
	} catch {
		return frisch(echt);
	}
}

export function speichern(ablage: Ablage, g: Gespeichert): void {
	try {
		ablage.schreiben(SCHLUESSEL, JSON.stringify(g));
	} catch {
		// Voll oder gesperrt: der Entwurf laeuft im Speicher weiter.
	}
}
