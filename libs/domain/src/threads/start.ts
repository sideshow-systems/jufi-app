import { naechsteTermine, type TerminDaten, type TerminEintrag } from '../module/termin/termin.js';
import { antwortZeilen, ergebnisAnsicht } from './antworten.js';
import { threadDatenAus } from './ansicht.js';
import { istArchiviert } from './archiv.js';
import type { ListenThread } from './liste.js';
import { threadSegment } from './pfad.js';
import { siehtThread } from './sichtbarkeit.js';
import type { AenderungArt, HelferDaten, ThreadDaten, ThreadKopf, ThreadModus, ThreadPerson, Umfeld } from './typen.js';

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
// Helferlisten nach Plan-Entscheidung 8 in helferOffen.
export function brauchtAntwort(
	person: ThreadPerson,
	threads: readonly ThreadDaten[],
	umfeld: Umfeld,
	jetzt: Date,
): OffenerPunkt[] {
	const punkte: OffenerPunkt[] = [];
	for (const { kopf, termine, umfragen, helfer } of threads) {
		if (!kopf.veroeffentlichtAm || istArchiviert(kopf, termine, jetzt)) continue;
		for (const liste of helfer) {
			for (const zeile of helferOffen(person, liste, kopf, umfeld, jetzt)) {
				punkte.push({
					threadId: kopf.id,
					titel: kopf.titel,
					modulId: liste.modulId,
					fuerId: zeile.fuerId,
					vorname: zeile.selbst ? null : zeile.vorname,
					frist: liste.frist,
				});
			}
		}
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

// Plan-Entscheidung 8: Eine Helferliste fragt nur, solange ihre Frist läuft und noch ein
// Platz frei ist; offen ist eine Zeile ohne einen einzigen Eintrag im ganzen Modul (wer
// Kuchen bringt, muss nicht auch noch fahren). Verworfen: auch ohne Frist zu mahnen, weil
// Familien, die nicht helfen können, sonst ohne Ende auf der Startseite stünden.
function helferOffen(person: ThreadPerson, liste: HelferDaten, kopf: ThreadKopf, umfeld: Umfeld, jetzt: Date) {
	if (!liste.frist || jetzt.getTime() >= liste.frist.getTime()) return [];
	if (!liste.positionen.some((p) => p.eintraege.length < p.anzahl)) return [];
	const eingetragen = new Set(liste.positionen.flatMap((p) => p.eintraege.map((e) => e.fuerId)));
	return antwortZeilen(person, liste, kopf, umfeld).filter((z) => !eingetragen.has(z.fuerId));
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
	/** Ob die Person im Thread Antworten anderer sieht (siehtErgebnisse). */
	antwortenSichtbar: boolean;
}

// Spec 3.9: Eine fremde Antwort ist nur dann etwas Neues, wenn die Person
// Ergebnisse sieht. Bei "Ergebnisse: nur Jugendleiter" sieht eine Familie nach dem Öffnen
// nichts Geändertes; der Punkt zeigte auf nichts und leuchtete mit jeder weiteren Antwort
// wieder auf. Entschieden wird über ergebnisAnsicht, damit "sieht Ergebnisse" hier und in
// der Auswertung dasselbe heißt.
// Verworfen: je Antwort genau zu prüfen, ob die Person deren Umfrage auswerten darf —
// dafür fehlt NeuAenderung der Weg von objektId zur Umfrage (Etappe 5). Kosten: Die
// Antwort des anderen Elternteils für das eigene Kind in einer Nur-Jugendleiter-Umfrage
// macht den Thread nicht neu, und sieht die Person Ergebnisse in einer anderen Umfrage
// des Threads, zählt auch eine Antwort in der verborgenen.
// Plan-Entscheidung 7: Einträge einer Helferliste sieht jeder Leser (Spec 5.2 kennt keine
// Ergebnis-Einstellung), also ist ein Thread mit Helferliste für alle außer Entfernten
// sichtbar beantwortet. Die Kosten wie oben: Auch eine Umfrage-Antwort mit
// "nur Jugendleiter" macht ihn dann für die Familie neu.
export function siehtErgebnisse(
	ich: ThreadPerson,
	kopf: ThreadKopf,
	daten: Pick<ThreadDaten, 'umfragen' | 'helfer'>,
): boolean {
	if (daten.helfer.length > 0 && !ich.entferntAm) return true;
	return daten.umfragen.some((u) => ergebnisAnsicht(ich, u, kopf) !== 'NICHTS');
}

// Die Eingabe für istNeu aus einem geladenen Thread. Liste und Startseite bauen sie hier,
// damit beide dieselben Felder (auch antwortenSichtbar) gleich belegen.
export function neuEingabeFuer(
	ich: ThreadPerson,
	t: Pick<ListenThread, 'kopf' | 'gelesenBis' | 'aenderungen'>,
	daten: Pick<ThreadDaten, 'umfragen' | 'helfer'>,
	zugangSeit: Date,
): NeuEingabe {
	return {
		personId: ich.id,
		zugangSeit,
		gelesenBis: t.gelesenBis,
		erstelltVonId: t.kopf.erstelltVonId,
		veroeffentlichtAm: t.kopf.veroeffentlichtAm,
		aenderungen: t.aenderungen,
		antwortenSichtbar: siehtErgebnisse(ich, t.kopf, daten),
	};
}

// Die Auswahl, die "neu" ausmacht: fremd, nicht LISTE, keine ANTWORT ohne sichtbare
// Ergebnisse, über dem Stand (ohne Stand: ab dem Zugang). Eigene Funktion, weil die
// Startseite aus denselben Änderungen ihre Kurzangabe bildet ("Neue Antworten") und sonst
// eine zweite Auslegung von "fremd" entstünde.
// LISTE (Anpinnen, Archivieren) ändert nichts am Inhalt: Wer einen Thread anpinnt, hat
// ihn für die anderen nicht neu geschrieben. Verworfen: die Art erst in der Abfrage des
// Servers auszufiltern — die Regel gehört hierher und ist so ohne Datenbank prüfbar.
function fremdeNeueAenderungen(e: NeuEingabe): NeuAenderung[] {
	const fremd = e.aenderungen.filter(
		(a) => a.urheberId !== e.personId && a.art !== 'LISTE' && (a.art !== 'ANTWORT' || e.antwortenSichtbar),
	);
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
	return istNeuerThread(e) || fremdeNeueAenderungen(e).length > 0;
}

// Der Teil von istNeu, der keine Änderung braucht: die Veröffentlichung selbst. Eigene
// Funktion, weil die Startseite "Neuer Thread" an genau dieser Bedingung festmacht und
// sonst Kennzeichen und Angabe auseinanderliefen.
function istNeuerThread(e: NeuEingabe): boolean {
	if (e.gelesenBis !== null || e.veroeffentlichtAm === null) return false;
	return e.veroeffentlichtAm.getTime() >= e.zugangSeit.getTime() && e.erstelltVonId !== e.personId;
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

export interface StartThread extends ListenThread {
	verlaufGelesenBis: number | null;
	nachrichten: NachrichtenEingabe['nachrichten'];
}

export interface OffenerPunktAnsicht {
	threadId: string;
	segment: string;
	titel: string;
	modulId: string;
	fuerId: string;
	vorname: string | null;
	/** ISO-Zeitpunkt, null ohne Frist. */
	frist: string | null;
}

export interface NeuEintrag {
	threadId: string;
	segment: string;
	titel: string;
	angabe: string;
}

export interface TerminZeile {
	threadId: string;
	segment: string;
	titel: string;
	termin: TerminDaten;
}

export interface StartAnsicht {
	brauchtAntwort: OffenerPunktAnsicht[];
	alsNaechstes: TerminZeile[];
	neu: NeuEintrag[];
}

export const ALS_NAECHSTES = 3;
export const NEU_HOECHSTENS = 5;

// Letzte Aktivität absteigend, dann ID. Kein localeCompare: Die Reihenfolge darf nicht von
// der Sprache des Prozesses abhängen. Hier und nicht in liste.ts, weil liste.ts schon
// start.ts einliest; umgekehrt entstünde ein Kreis.
export function nachAktivitaet(
	a: Pick<ListenThread, 'kopf' | 'letzteAktivitaetAm'>,
	b: Pick<ListenThread, 'kopf' | 'letzteAktivitaetAm'>,
): number {
	return (
		b.letzteAktivitaetAm.getTime() - a.letzteAktivitaetAm.getTime() ||
		(a.kopf.id < b.kopf.id ? -1 : a.kopf.id > b.kopf.id ? 1 : 0)
	);
}

// Spec 3.9 und 3.13, Plan-Entscheidungen 5 und 6: Alle drei Blöcke kennen nur
// veröffentlichte, sichtbare und nicht archivierte Threads. Ein Entwurf zeigt Geplantes,
// die Startseite aber, was stattfindet; im Archiv kann nur noch nachgetragen werden, also
// weder gefragt noch angekündigt noch als neu gemeldet wird. Die Sichtbarkeit prüft diese
// Funktion selbst (siehtThread) und überlässt sie nicht der Abfrage des Servers.
// Verworfen: für "Als Nächstes" Entwürfe der Jugendleiter mitzuzeigen — sie hätten dann
// einen anderen Kalender als die Familien, die ihre Termine ansagen.
export function startAnsicht(e: {
	ich: ThreadPerson;
	threads: readonly StartThread[];
	umfeld: Umfeld;
	zugangSeit: Date;
	jetzt: Date;
}): StartAnsicht {
	const aktiv = e.threads
		.filter((t) => t.kopf.veroeffentlichtAm !== null && siehtThread(e.ich, t.kopf, e.umfeld))
		.map((t) => ({ t, daten: threadDatenAus(t.kopf, t.module) }))
		.filter(({ t, daten }) => !istArchiviert(t.kopf, daten.termine, e.jetzt));

	const brauchtAntwortPunkte = brauchtAntwort(
		e.ich,
		aktiv.map(({ daten }) => daten),
		e.umfeld,
		e.jetzt,
	).map((p): OffenerPunktAnsicht => ({
		threadId: p.threadId,
		segment: threadSegment(p.threadId, p.titel),
		titel: p.titel,
		modulId: p.modulId,
		fuerId: p.fuerId,
		vorname: p.vorname,
		frist: p.frist?.toISOString() ?? null,
	}));

	const termine: TerminEintrag[] = aktiv.flatMap(({ t, daten }) =>
		daten.termine.map((termin) => ({ threadId: t.kopf.id, titel: t.kopf.titel, termin })),
	);
	const alsNaechstes = naechsteTermine(termine, e.jetzt, ALS_NAECHSTES).map((n): TerminZeile => ({
		threadId: n.threadId,
		segment: threadSegment(n.threadId, n.titel),
		titel: n.titel,
		termin: n.termin,
	}));

	const neu: NeuEintrag[] = [];
	for (const { t, daten } of aktiv.sort((a, b) => nachAktivitaet(a.t, b.t))) {
		const eingabe = neuEingabeFuer(e.ich, t, daten, e.zugangSeit);
		if (!istNeu(eingabe)) continue;
		neu.push({
			threadId: t.kopf.id,
			segment: threadSegment(t.kopf.id, t.kopf.titel),
			titel: t.kopf.titel,
			angabe: neuKurzangabe(t.kopf.modus, {
				neuerThread: istNeuerThread(eingabe),
				nachrichten: ungeleseneNachrichten({
					personId: e.ich.id,
					zugangSeit: e.zugangSeit,
					verlaufGelesenBis: t.verlaufGelesenBis,
					nachrichten: t.nachrichten,
				}),
				antworten: fremdeNeueAenderungen(eingabe).some((a) => a.art === 'ANTWORT'),
			}),
		});
		if (neu.length === NEU_HOECHSTENS) break;
	}

	return { brauchtAntwort: brauchtAntwortPunkte, alsNaechstes, neu };
}
