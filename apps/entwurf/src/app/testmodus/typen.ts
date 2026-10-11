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

export interface Ergebnis {
	aufgabeId: string;
	ausgang: 'geschafft' | 'nichtWeiter' | 'uebersprungen';
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
