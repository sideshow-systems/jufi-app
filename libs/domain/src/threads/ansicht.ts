import type { TerminDaten } from '../module/termin/termin.js';
import { antwortZeilen, auswertung, darfAntworten, type Auswertung } from './antworten.js';
import { istArchiviert } from './archiv.js';
import { eingetragenVon } from './namen.js';
import { darfArchivieren, darfBearbeiten, schreibSperre, type SchreibSperre } from './rechte.js';
import { siehtThread } from './sichtbarkeit.js';
import { ungeleseneNachrichten, type NachrichtenEingabe } from './start.js';
import type {
	AntwortEinheit,
	Rollenfilter,
	ThreadArt,
	ThreadDaten,
	ThreadKopf,
	ThreadModus,
	ThreadPerson,
	Umfeld,
	UmfrageDaten,
} from './typen.js';

// Spec 3.1. Die Module eines Threads in der Reihenfolge, die der Ersteller gewaehlt hat;
// der Typ haelt je Modul genau die Daten, die seine Karte braucht.
export type ModulDaten =
	| { typ: 'INFO'; id: string; titel: string | null; text: string }
	| { typ: 'TERMIN'; id: string; titel: string | null; termin: TerminDaten }
	| { typ: 'UMFRAGE'; id: string; titel: string | null; umfrage: UmfrageDaten };

// Archivregel und Schreibsperre brauchen die Termine, die Zeilen die Umfragen; beide
// liegen sonst nur verstreut in den Modulen.
export function threadDatenAus(kopf: ThreadKopf, module: readonly ModulDaten[]): ThreadDaten {
	return {
		kopf,
		termine: module.flatMap((m) => (m.typ === 'TERMIN' ? [m.termin] : [])),
		umfragen: module.flatMap((m) => (m.typ === 'UMFRAGE' ? [m.umfrage] : [])),
	};
}

export interface ZeilenAnsicht {
	fuerId: string;
	vorname: string;
	selbst: boolean;
	optionIds: string[];
	eingetragenVon: string | null;
	darfAntworten: boolean;
}

export interface UmfrageAnsicht {
	typ: 'UMFRAGE';
	id: string;
	titel: string | null;
	frage: string;
	einheit: AntwortEinheit;
	mehrfach: boolean;
	teilnahme: boolean;
	// ISO-Zeitpunkt (Zeiten reisen als ISO). Verworfen: den fertigen Text ("bis Do 18:00")
	// mitzuschicken, weil er bei offener Seite veralten wuerde; der Client rechnet ihn mit
	// fristText und der aktuellen Uhrzeit selbst, die Zeitzone bleibt dank der Domaene Berlin.
	frist: string | null;
	fristAbgelaufen: boolean;
	optionen: { id: string; schluessel: string; text: string }[];
	zeilen: ZeilenAnsicht[];
	ergebnis: Auswertung | null;
}

export type ModulAnsicht = Exclude<ModulDaten, { typ: 'UMFRAGE' }> | UmfrageAnsicht;

export interface ThreadAnsicht {
	id: string;
	titel: string;
	art: ThreadArt;
	modus: ThreadModus;
	rollenfilter: Rollenfilter;
	angepinnt: boolean;
	entwurf: boolean;
	archiviert: boolean;
	stand: number;
	schreibSperre: SchreibSperre | null;
	// Die Oberflaeche zeigt "Bearbeiten" und "Archivieren" nur, wenn die Regel es erlaubt;
	// verworfen: das Recht im Client aus Rechten und Ersteller herzuleiten, weil dort
	// der Austausch und der fremde Thread eines Jugendleiters leicht vergessen wuerden.
	darfBearbeiten: boolean;
	darfArchivieren: boolean;
	/** eintraege zaehlt die Nachrichten (geloeschte eingeschlossen), keine Systemeintraege; der Name stammt aus der Wire-Form. */
	verlauf: { eintraege: number; ungelesen: number };
	module: ModulAnsicht[];
}

export interface AnsichtEingabe {
	ich: ThreadPerson;
	kopf: ThreadKopf;
	module: readonly ModulDaten[];
	umfeld: Umfeld;
	stand: number;
	/** Anzahl der Nachrichten, auch geloeschter; Systemeintraege zaehlen nicht (siehe lesen.ts). */
	verlaufEintraege: number;
	nachrichten: NachrichtenEingabe['nachrichten'];
	zugangSeit: Date;
	verlaufGelesenBis: number | null;
	jetzt: Date;
}

/**
 * Die Umfrage so, wie die Person sie sieht: ihre Antwortzeilen mit Antwort und
 * Antwortrecht, dazu das Ergebnis, soweit es ihr zusteht. Das Antwortrecht kommt je
 * Zeile aus darfAntworten, damit Fristende, Entwurf und Nachtragen durch Jugendleiter
 * an einer Stelle entschieden werden. "Frist abgelaufen" gilt fuer alle gleich, auch
 * fuer Jugendleiter, die weiter nachtragen duerfen: die Karte soll das Datum nennen,
 * nicht den Einzelfall.
 */
export function umfrageAnsicht(
	ich: ThreadPerson,
	modul: Extract<ModulDaten, { typ: 'UMFRAGE' }>,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	jetzt: Date,
): UmfrageAnsicht {
	const u = modul.umfrage;
	const antwortVon = new Map(u.antworten.map((a) => [a.fuerId, a]));
	const zeilen = antwortZeilen(ich, u, kopf, umfeld).map((z): ZeilenAnsicht => {
		const antwort = antwortVon.get(z.fuerId);
		return {
			fuerId: z.fuerId,
			vorname: z.vorname,
			selbst: z.selbst,
			optionIds: antwort ? [...antwort.optionIds] : [],
			eingetragenVon: antwort ? eingetragenVon(antwort.vonId, z.fuerId, ich.id, umfeld) : null,
			darfAntworten: darfAntworten(ich, z.fuerId, u, kopf, umfeld, jetzt) === 'ERLAUBT',
		};
	});
	return {
		typ: 'UMFRAGE',
		id: modul.id,
		titel: modul.titel,
		frage: u.frage,
		einheit: u.einheit,
		mehrfach: u.mehrfach,
		teilnahme: u.teilnahme,
		frist: u.frist ? u.frist.toISOString() : null,
		fristAbgelaufen: u.frist !== null && jetzt.getTime() >= u.frist.getTime(),
		optionen: u.optionen.map((o) => ({ id: o.id, schluessel: o.schluessel, text: o.text })),
		zeilen,
		ergebnis: auswertung(ich, u, kopf, umfeld),
	};
}

/**
 * Alles, was die Oberflaeche eines Threads braucht, als reine Funktion: Zeilen,
 * Antwortrechte, Ergebnisse, Schreibsperre und Zaehler entscheiden sich hier und
 * nirgends sonst. Verworfen: die Typen im Client nachzuschreiben, weil beide Seiten bei
 * einer Antwort dieser Groesse auseinanderliefen. null heisst, die Person sieht den
 * Thread nicht; der Server macht daraus dieselbe 404 wie fuer einen unbekannten.
 */
export function threadAnsicht(e: AnsichtEingabe): ThreadAnsicht | null {
	if (!siehtThread(e.ich, e.kopf, e.umfeld)) return null;
	const { termine } = threadDatenAus(e.kopf, e.module);
	return {
		id: e.kopf.id,
		titel: e.kopf.titel,
		art: e.kopf.art,
		modus: e.kopf.modus,
		rollenfilter: e.kopf.rollenfilter,
		angepinnt: e.kopf.angepinnt,
		entwurf: !e.kopf.veroeffentlichtAm,
		archiviert: istArchiviert(e.kopf, termine, e.jetzt),
		stand: e.stand,
		schreibSperre: schreibSperre(e.ich, e.kopf, e.umfeld, termine, e.jetzt),
		darfBearbeiten: darfBearbeiten(e.ich, e.kopf),
		darfArchivieren: darfArchivieren(e.ich, e.kopf),
		verlauf: {
			eintraege: e.verlaufEintraege,
			ungelesen: ungeleseneNachrichten({
				personId: e.ich.id,
				zugangSeit: e.zugangSeit,
				verlaufGelesenBis: e.verlaufGelesenBis,
				nachrichten: e.nachrichten,
			}),
		},
		module: e.module.map((m) => (m.typ === 'UMFRAGE' ? umfrageAnsicht(e.ich, m, e.kopf, e.umfeld, e.jetzt) : m)),
	};
}
