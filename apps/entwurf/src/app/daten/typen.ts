/**
 * Datentypen des Entwurfs. Sie bilden das Datenmodell der Rahmen-Spezifikation
 * nur so weit ab, wie der Entwurf es braucht; das echte Schema entsteht erst in
 * Teilprojekt 2. Zeitpunkte sind lokale ISO-Zeichenketten ohne Zone
 * ("2026-10-17T14:00"), weil der Entwurf nur im Browser der Testperson lebt
 * und dort jede Angabe ohnehin Ortszeit meint.
 */
export type Id = string;

export type Recht =
	| 'mitglieder'
	| 'threadsErstellen'
	| 'alleThreads'
	| 'dokumente'
	| 'antwortenDetail'
	| 'rechteVerwalten'
	| 'einstellungen';

export interface Person {
	id: Id;
	vorname: string;
	nachname: string;
	art: 'jungfischer' | 'erwachsener';
	alter?: number;
	hatZugang: boolean;
	fotoEinwilligung?: boolean;
	rechte: Recht[];
}

export interface Elternschaft {
	elternteil: Id;
	kind: Id;
}

export interface Untergruppe {
	id: Id;
	name: string;
	mitglieder: Id[];
}

export type Rollenfilter = 'jungfischerUndEltern' | 'nurEltern' | 'nurJugendleiter';

export interface Zielgruppe {
	untergruppen: 'alle' | Id[];
	rollen: Rollenfilter;
}

export type Modus = 'aushang' | 'kommentare' | 'chat';
export type Einheit = 'jungfischer' | 'erwachsener' | 'person';

export interface Antwort {
	fuer: Id;
	von: Id;
	optionen: Id[];
	zeit: string;
}

export interface InfoModul {
	id: Id;
	typ: 'info';
	titel?: string;
	text: string;
}

export interface TerminModul {
	id: Id;
	typ: 'termin';
	titel?: string;
	/** Startdatum JJJJ-MM-TT. Zeiten sind optional (Spec 2026-10-12, 3.1): ganztaegig und mehrtaegig. */
	von: string;
	/** Letzter Tag, nur bei mehrtaegigen Terminen; gleich von zaehlt als eintaegig. */
	bis?: string;
	/** HH:MM, Berliner Wandzeit. */
	beginnZeit?: string;
	endeZeit?: string;
	ort: string;
	treffpunkt?: string;
}

export interface UmfrageModul {
	id: Id;
	typ: 'umfrage';
	frage: string;
	mehrfach: boolean;
	optionen: { id: Id; text: string }[];
	einheit: Einheit;
	frist?: string;
	ergebnisse: 'alle' | 'summe' | 'jugendleiter';
	teilnahme: boolean;
	antworten: Antwort[];
}

export interface HelferPlatz {
	id: Id;
	text: string;
	anzahl: number;
	eintraege: { fuer: Id; von: Id }[];
}

export interface HelferModul {
	id: Id;
	typ: 'helfer';
	titel: string;
	einheit: Einheit;
	frist?: string;
	plaetze: HelferPlatz[];
}

export interface Auto {
	id: Id;
	fahrer: Id;
	richtung: 'hin' | 'rueck';
	plaetze: number;
	abfahrt: string;
	ort: string;
	mitfahrer: Id[];
}

export interface FahrModul {
	id: Id;
	typ: 'fahrt';
	autos: Auto[];
}

export type KostenStatus = 'offen' | 'gemeldet' | 'bezahlt';

export interface KostenModul {
	id: Id;
	typ: 'kosten';
	titel: string;
	betragCent: number;
	hinweis: string;
	iban?: string;
	paypal?: string;
	status: Record<Id, Exclude<KostenStatus, 'offen'>>;
}

export interface DateienModul {
	id: Id;
	typ: 'dateien';
	dateien: { id: Id; name: string; groesse: string }[];
}

export interface FotosModul {
	id: Id;
	typ: 'fotos';
	fotos: { id: Id; bild: string; von: Id }[];
}

export type Modul =
	InfoModul | TerminModul | UmfrageModul | HelferModul | FahrModul | KostenModul | DateienModul | FotosModul;

export interface VerlaufEintrag {
	id: Id;
	art: 'nachricht' | 'system';
	von?: Id;
	text: string;
	zeit: string;
}

export interface Thread {
	id: Id;
	nr: number;
	titel: string;
	zielgruppe: Zielgruppe;
	modus: Modus;
	angepinnt: boolean;
	/** Nur die manuelle Archivierung; die automatische berechnet istArchiviert. */
	archiviert: boolean;
	veroeffentlicht: boolean;
	erstelltVon: Id;
	module: Modul[];
	verlauf: VerlaufEintrag[];
	letzteAktivitaet: string;
	/** Wer zuletzt etwas getan hat; fehlt bei den Beispieldaten (dort war es immer jemand anderes). */
	letzteAktivitaetVon?: Id;
}

export interface Dokument {
	id: Id;
	kategorie: 'Ordnungen' | 'Merkblätter' | 'Formulare';
	name: string;
	groesse: string;
}

export interface Verein {
	name: string;
	slug: string;
	farbe: string;
	logo: string;
}

export interface Datenstand {
	version: 2;
	bezugstag: string;
	verein: Verein;
	personen: Person[];
	elternschaften: Elternschaft[];
	untergruppen: Untergruppe[];
	threads: Thread[];
	dokumente: Dokument[];
	letzterBesuch: Record<Id, string>;
}
