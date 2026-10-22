import type { TerminDaten } from '../module/termin/termin.js';
import type { Beziehung } from '../personen.js';
import type { PersonSicht, Zuordnung } from '../rechte.js';

// Literal-Unions statt der Prisma-Enums: libs/domain haengt nicht an @jufi/db. Die Werte
// sind die der gleichnamigen Enums im Schema, damit Prisma-Zeilen ohne Umwandlung passen.
export type ThreadArt = 'NORMAL' | 'JUGENDSPRECHER_AUSTAUSCH';
export type ThreadModus = 'AUSHANG' | 'KOMMENTARE' | 'CHAT';
export type Rollenfilter = 'JUNGFISCHER_FAMILIE' | 'NUR_FAMILIE' | 'NUR_JUGENDLEITER' | 'JUGENDLEITER_JUGENDSPRECHER';
export type ArchivModus = 'AUTOMATISCH' | 'ARCHIVIERT' | 'AKTIV_HALTEN';
export type AntwortEinheit = 'JUNGFISCHER' | 'ERWACHSENER' | 'PERSON';
export type ErgebnisSicht = 'ALLE' | 'SUMME' | 'JUGENDLEITER';
export type AenderungArt = 'THREAD' | 'MODUL' | 'ANTWORT' | 'VERLAUF' | 'SICHTBARKEIT' | 'GELOESCHT' | 'LISTE';

// Eine Person samt dem, was die Threadregeln ueber die Rechte hinaus brauchen: Namen
// (fuer Absender und "eingetragen von") und das Merkmal Jugendsprecher.
export interface ThreadPerson extends PersonSicht {
	vorname: string;
	nachname: string;
	jugendsprecher: boolean;
}

// Eine Zuordnung mit ihrem Beziehungswort, damit "Mutter von Max" ohne zweite Abfrage
// entstehen kann.
export interface Bezug extends Zuordnung {
	beziehung: Beziehung;
	beziehungFreitext: string | null;
}

// Alles, was die Regeln ueber den Verein wissen muessen. Die Regeln bekommen es als
// Wert statt es zu laden, damit sie reine Funktionen bleiben und ohne Datenbank
// testbar sind.
export interface Umfeld {
	// Nur nicht entfernte Personen (wie ladeUmfeld): wer hier fehlt, ist fuer jede Regel
	// "ehemaliges Mitglied".
	personen: ReadonlyMap<string, ThreadPerson>;
	zuordnungen: readonly Bezug[];
	// personId -> Untergruppen-IDs
	untergruppenVon: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ThreadKopf {
	id: string;
	art: ThreadArt;
	titel: string;
	modus: ThreadModus;
	rollenfilter: Rollenfilter;
	alleUntergruppen: boolean;
	untergruppenIds: readonly string[];
	angepinnt: boolean;
	archivModus: ArchivModus;
	veroeffentlichtAm: Date | null;
	erstelltVonId: string | null;
}

export interface UmfrageOptionDaten {
	id: string;
	schluessel: string;
	text: string;
}

export interface AntwortDaten {
	fuerId: string;
	vonId: string;
	optionIds: readonly string[];
	abgegebenAm: Date;
}

export interface UmfrageDaten {
	modulId: string;
	frage: string;
	einheit: AntwortEinheit;
	mehrfach: boolean;
	teilnahme: boolean;
	vielleicht: boolean;
	frist: Date | null;
	ergebnisse: ErgebnisSicht;
	optionen: readonly UmfrageOptionDaten[];
	antworten: readonly AntwortDaten[];
}

// Was Gefragte, Antwortzeilen und Antwortrecht von einem Antwort-Modul brauchen. Umfrage
// und Helferliste teilen es, damit "wer ist gefragt" und "bis wann" nur eine Regel haben.
export interface AntwortRegel {
	einheit: AntwortEinheit;
	frist: Date | null;
}

export interface HelferEintragDaten {
	fuerId: string;
	vonId: string;
	notiz: string | null;
	eingetragenAm: Date;
}

export interface HelferPositionDaten {
	id: string;
	schluessel: string;
	text: string;
	anzahl: number;
	/** Nach eingetragenAm aufsteigend: die Reihenfolge der Anmeldung. */
	eintraege: readonly HelferEintragDaten[];
}

export interface HelferDaten extends AntwortRegel {
	modulId: string;
	/**
	 * Der Modultitel, wie bei der Umfrage die Frage: Die Antworten-Uebersicht bekommt nur
	 * ThreadDaten und muss die Liste trotzdem benennen. Verworfen: ihr zusaetzlich die Module
	 * zu geben, denn dann suchte sie den Titel ueber die Modul-ID in einer zweiten Liste.
	 */
	titel: string | null;
	/** In der Reihenfolge, die der Ersteller gewaehlt hat. */
	positionen: readonly HelferPositionDaten[];
}

export interface ThreadDaten {
	kopf: ThreadKopf;
	termine: readonly TerminDaten[];
	umfragen: readonly UmfrageDaten[];
	helfer: readonly HelferDaten[];
}
