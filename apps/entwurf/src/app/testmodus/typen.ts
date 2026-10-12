import type { Testereignis } from '../daten/ereignisse';
import type { Datenstand } from '../daten/typen';

/** Die drei Testpersonen des Einstiegs (Spec TP1 5.1). */
export type PersonKey = 'sandra' | 'lena' | 'thomas';

/** Erkennbar am Datenstand oder an einem Testereignis. */
export interface Handlung {
	art: 'handlung';
	text: string;
	erfuellt: (s: Datenstand, ereignisse: Testereignis[]) => boolean;
}

/**
 * "Finde heraus …": die Antwort kann schon auf dem Dashboard stehen, also
 * waehlt die Testperson aus drei Antworten (Spec TP1 5.3).
 */
export interface Suche {
	art: 'suche';
	text: string;
	antworten: (s: Datenstand) => { richtig: string; falsch: [string, string] };
}

export type Aufgabe = (Handlung | Suche) & { id: string; kurz: string };

/**
 * Obergrenze der gemessenen Dauer. Gemessen wird Wanduhrzeit: ein ueber Nacht
 * offener Tab ergaebe sonst Stunden. Verworfen: nur sichtbare Zeit zaehlen —
 * braucht Sichtbarkeits-Ereignisse im Dienst und bringt fuer die Auswertung
 * nichts, denn wer laenger als eine halbe Stunde braucht, kam ohnehin nicht weiter.
 */
export const MAX_DAUER_SEK = 30 * 60;

export interface Ergebnis {
	aufgabeId: string;
	/** schonErledigt: beim Anzeigen schon erfuellt, ohne Bewertung (Testperson hat es vorher nebenbei getan). */
	ausgang: 'geschafft' | 'nichtWeiter' | 'uebersprungen' | 'schonErledigt';
	dauerSek: number;
	smiley?: 'gut' | 'mittel' | 'schlecht';
	notiz?: string;
	fehlversuche: number;
}

export interface SeitenNotiz {
	pfad: string;
	text: string;
}

export interface TestmodusStand {
	person: PersonKey | null;
	mitAufgaben: boolean;
	index: Record<PersonKey, number>;
	ergebnisse: Record<PersonKey, Ergebnis[]>;
	ereignisse: Testereignis[];
	seitenNotizen: SeitenNotiz[];
	wunsch?: string;
	gestartetUm?: string;
	/** Echtzeit (ms), seit der die aktuelle Aufgabe angezeigt wird. */
	aufgabeSeit?: number;
	/** Falsche Antworten auf die aktuelle Suchaufgabe. */
	fehlversuche?: number;
}
