import { istArchiviert } from './archiv.js';
import { antwortZeilen } from './antworten.js';
import type { AenderungArt, ThreadDaten, ThreadModus, ThreadPerson, Umfeld } from './typen.js';

export interface OffenerPunkt {
	threadId: string;
	titel: string;
	modulId: string;
	fuerId: string;
	// null ist die eigene Zeile ("Bowling noch offen"), sonst der Vorname des Kindes
	// ("Lena: Bowling noch offen"). Kein Rollenwort (FAM 1.6).
	vorname: string | null;
	frist: Date | null;
}

// Ohne Frist zuletzt: was nicht drängt, steht unter dem, was bald zu Ende ist.
function nachFrist(a: Date | null, b: Date | null): number {
	if (a && b) return a.getTime() - b.getTime();
	if (a) return -1;
	if (b) return 1;
	return 0;
}

// Spec 3.13. Die Sichtbarkeit steckt schon in antwortZeilen (kein Blick auf den Thread,
// keine Zeilen), Entwurf, Archiv und Frist werden hier geprüft. Ein Entwurf bleibt auch
// dem Jugendleiter erspart: gefragt wird erst, wenn es etwas zu beantworten gibt.
// Fristende ist "jetzt >= frist" (Plan-Entscheidung 8), wie in darfAntworten: sonst
// stünde eine Zeile als offen da, die niemand mehr beantworten kann.
// Eine Antwort ohne Option zählt als keine Antwort (wie in auswertung): die Zeile bleibt
// offen. Verworfen: jede vorhandene Antwortzeile als erledigt zu lesen, weil eine
// verirrte leere Zeile die Person sonst still aus der Liste nähme.
// Eine Antwort gilt je Antwortzeile (fuerId): die von Tim ändert für Sandra nichts.
export function brauchtAntwort(
	person: ThreadPerson,
	threads: readonly ThreadDaten[],
	umfeld: Umfeld,
	jetzt: Date,
): OffenerPunkt[] {
	const punkte: OffenerPunkt[] = [];
	for (const { kopf, termine, umfragen } of threads) {
		if (!kopf.veroeffentlichtAm || istArchiviert(kopf, termine, jetzt)) continue;
		for (const umfrage of umfragen) {
			if (umfrage.frist && jetzt.getTime() >= umfrage.frist.getTime()) continue;
			const beantwortet = new Set(umfrage.antworten.filter((a) => a.optionIds.length > 0).map((a) => a.fuerId));
			for (const zeile of antwortZeilen(person, umfrage, kopf, umfeld)) {
				if (beantwortet.has(zeile.fuerId)) continue;
				punkte.push({
					threadId: kopf.id,
					titel: kopf.titel,
					modulId: umfrage.modulId,
					fuerId: zeile.fuerId,
					vorname: zeile.selbst ? null : zeile.vorname,
					frist: umfrage.frist,
				});
			}
		}
	}
	// Die eigene Zeile (vorname null) sortiert vor den Kindern; Modul und Person am Ende
	// halten die Reihenfolge von der Ladereihenfolge unabhängig.
	return punkte.sort(
		(a, b) =>
			nachFrist(a.frist, b.frist) ||
			a.titel.localeCompare(b.titel, 'de') ||
			(a.vorname ?? '').localeCompare(b.vorname ?? '', 'de') ||
			a.threadId.localeCompare(b.threadId) ||
			a.modulId.localeCompare(b.modulId) ||
			a.fuerId.localeCompare(b.fuerId),
	);
}

export interface NeuAenderung {
	stand: number;
	art: AenderungArt;
	urheberId: string | null;
	angelegtAm: Date;
}

export interface NeuEingabe {
	personId: string;
	zugangSeit: Date;
	gelesenBis: number | null;
	erstelltVonId: string | null;
	veroeffentlichtAm: Date | null;
	aenderungen: readonly NeuAenderung[];
}

// Die Auswahl, die "neu" ausmacht: fremd, nicht LISTE, über dem Stand (ohne Stand: ab dem
// Zugang). Eigene Funktion, weil die Startseite aus denselben Änderungen ihre Kurzangabe
// bildet ("Neue Antworten") und sonst eine zweite Auslegung von "fremd" entstünde.
// LISTE (Anpinnen, Archivieren) ändert nichts am Inhalt: Wer einen Thread anpinnt, hat
// ihn für die anderen nicht neu geschrieben. Verworfen: die Art erst in der Abfrage des
// Servers auszufiltern — die Regel gehört hierher und ist so ohne Datenbank prüfbar.
function fremdeNeueAenderungen(e: NeuEingabe): NeuAenderung[] {
	const fremd = e.aenderungen.filter((a) => a.urheberId !== e.personId && a.art !== 'LISTE');
	if (e.gelesenBis !== null) {
		const gelesen = e.gelesenBis;
		return fremd.filter((a) => a.stand > gelesen);
	}
	const seit = e.zugangSeit.getTime();
	return fremd.filter((a) => a.angelegtAm.getTime() >= seit);
}

// Spec 3.9. Nur fremde Aktivität macht einen Thread neu (Erkenntnis aus dem Entwurf):
// wer selbst schreibt, soll seinen Thread danach nicht als "neu" wiederfinden. Eine
// Änderung ohne Urheber (Systemeintrag) ist fremd.
// Ohne Gelesen-Stand gibt es keinen Zähler zum Vergleichen, also trennt der Zeitpunkt
// des Zugangs: Was vor dem Einrichten des Zugangs geschah, kannte die Person nie und
// kann für sie nicht "neu seit dem letzten Besuch" sein; der Thread-Ersteller hat seinen
// Thread selbst veröffentlicht. Verworfen: ohne Stand alles als neu zu zählen, weil eine
// frisch eingeladene Familie sonst die ganze Vereinsgeschichte als neu vorfände.
// Mit Gelesen-Stand zählt die Veröffentlichung nicht eigens: sie ist selbst eine
// Änderung mit eigenem Stand.
// Entwürfe werden hier nicht gefiltert: Aufrufer übergeben nur Threads, die die Person
// sieht, und einen Entwurf sehen nur Jugendleiter, für die fremde Aktivität daran
// berechtigt neu ist.
export function istNeu(e: NeuEingabe): boolean {
	if (e.gelesenBis === null) {
		const seit = e.zugangSeit.getTime();
		const veroeffentlicht =
			e.veroeffentlichtAm !== null && e.veroeffentlichtAm.getTime() >= seit && e.erstelltVonId !== e.personId;
		if (veroeffentlicht) return true;
	}
	return fremdeNeueAenderungen(e).length > 0;
}

export interface NachrichtenEingabe {
	personId: string;
	zugangSeit: Date;
	verlaufGelesenBis: number | null;
	nachrichten: readonly {
		art: 'NACHRICHT' | 'SYSTEM';
		stand: number;
		autorId: string | null;
		angelegtAm: Date;
		geloeschtAm: Date | null;
	}[];
}

// Spec 3.9, Zähler am Reiter "Verlauf": fremde, nicht gelöschte Nachrichten über dem
// Stand. Ohne Stand zählen die ab dem Zugang, aus demselben Grund wie in istNeu.
// Systemeinträge zählen nicht, auch ohne Autor nicht als "fremd": Ein verschobener
// Termin in einem AUSHANG würde sonst "1 neuer Kommentar" zeigen, wo niemand
// kommentieren kann. Verworfen: Systemeinträge mitzählen, weil sie ohne Autor "fremd"
// sind — der Zähler soll ungelesene Beiträge anderer nennen, nicht jede Zeile im Verlauf.
export function ungeleseneNachrichten(e: NachrichtenEingabe): number {
	const seit = e.zugangSeit.getTime();
	return e.nachrichten.filter(
		(n) =>
			n.art === 'NACHRICHT' &&
			n.autorId !== e.personId &&
			n.geloeschtAm === null &&
			(e.verlaufGelesenBis !== null ? n.stand > e.verlaufGelesenBis : n.angelegtAm.getTime() >= seit),
	).length;
}

// Spec 3.9, "Neu seit deinem letzten Besuch". Die Reihenfolge ist Teil der Regel: ein
// neuer Thread nennt nur sich ("Neuer Thread"), nicht noch die Kommentare darin;
// Nachrichten gehen vor Antworten, weil sie gelesen werden wollen. Was dann noch bleibt,
// ist eine Änderung am Aushang (Titel, Info, Termin). Im Chat heißen Nachrichten
// Nachrichten, sonst Kommentare.
export function neuKurzangabe(
	modus: ThreadModus,
	e: { neuerThread: boolean; nachrichten: number; antworten: boolean },
): string {
	if (e.neuerThread) return 'Neuer Thread';
	if (e.nachrichten > 0) {
		const chat = modus === 'CHAT';
		if (e.nachrichten === 1) return chat ? '1 neue Nachricht' : '1 neuer Kommentar';
		return `${e.nachrichten} ${chat ? 'neue Nachrichten' : 'neue Kommentare'}`;
	}
	if (e.antworten) return 'Neue Antworten';
	return 'Aushang geändert';
}
