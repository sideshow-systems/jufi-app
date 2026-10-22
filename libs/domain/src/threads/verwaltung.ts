import { KEINE_MEDIEN, type MedienZahl } from '../dateien/medien.js';
import { fahrtAnsicht, type FahrtModulAnsicht, type FahrtSperre } from '../module/fahrt/fahrt.js';
import type { HelferSperre } from '../module/helfer/helfer.js';
import type { TerminDaten } from '../module/termin/termin.js';
import { naechsteTermine, terminZeit } from '../module/termin/termin.js';
import { hatRecht } from '../rechte.js';
import type { ThreadEntwurf } from './entwurf.js';
import { ROLLENFILTER_TEXT } from './entwurf.js';
import { istArchiviert } from './archiv.js';
import type { ModulDaten } from './ansicht.js';
import { gefragte } from './antworten.js';
import { EHEMALIGES_MITGLIED, kurzname } from './namen.js';
import { threadSegment } from './pfad.js';
import { darfBearbeiten } from './rechte.js';
import { siehtThread } from './sichtbarkeit.js';
import type { HelferDaten, ThreadArt, ThreadDaten, ThreadKopf, ThreadPerson, Umfeld } from './typen.js';
import type { UmfrageSperre } from './vergleich.js';

// Die Namen der gewaehlten Untergruppen, die es noch gibt. Eine geloeschte Untergruppe
// bleibt in untergruppenIds nicht stehen (die Datenbank loescht die Verknuepfung), aber
// der Entwurf eines Clients kann eine alte ID tragen; unbekannte IDs zaehlen nicht.
function gewaehlteNamen(
	k: Pick<ThreadKopf, 'alleUntergruppen' | 'untergruppenIds'>,
	namen: ReadonlyMap<string, string>,
): string[] {
	if (k.alleUntergruppen) return [];
	return k.untergruppenIds
		.flatMap((id) => {
			const name = namen.get(id);
			return name === undefined ? [] : [name];
		})
		.sort((a, b) => a.localeCompare(b, 'de'));
}

// Spec 3.1, die Zielgruppe als Zeile der Verwaltungsliste: "Alle · Jungfischer + Familie".
// Eine Auswahl ohne verbliebene Untergruppe heisst "Keine Zielgruppe mehr" und nennt den
// Rollenfilter nicht: er hilft dem Leser nicht, solange niemand angesprochen wird.
export function zielgruppeText(
	k: Pick<ThreadKopf, 'rollenfilter' | 'alleUntergruppen' | 'untergruppenIds'>,
	namen: ReadonlyMap<string, string>,
): string {
	if (k.alleUntergruppen) return `Alle · ${ROLLENFILTER_TEXT[k.rollenfilter]}`;
	const gewaehlt = gewaehlteNamen(k, namen);
	if (gewaehlt.length === 0) return 'Keine Zielgruppe mehr';
	return `${gewaehlt.join(', ')} · ${ROLLENFILTER_TEXT[k.rollenfilter]}`;
}

export interface VerwaltungThread {
	id: string;
	segment: string;
	titel: string;
	art: ThreadArt;
	entwurf: boolean;
	archiviert: boolean;
	angepinnt: boolean;
	zielgruppe: string;
	keineZielgruppe: boolean;
	/** Anzeigetext des naechsten Termins (terminZeit), null ohne bevorstehenden. */
	naechsterTermin: string | null;
	darfBearbeiten: boolean;
	/** Ob die Person die Antworten-Uebersicht sehen darf (siehtAntworten); sonst waere der Link dorthin eine 404-Seite. */
	darfAntwortenSehen: boolean;
	/**
	 * Ob der Thread etwas hat, das die Antworten-Uebersicht zeigt: eine Umfrage, eine Helferliste
	 * (Plan-Entscheidung 13) oder eine Fahrgemeinschaft. Verworfen: hatUmfrage zu behalten und die
	 * Helferliste mitzumeinen, denn der Name luege dann bei jedem Thread mit Liste und ohne Umfrage.
	 */
	hatAntwortModul: boolean;
}

export interface VerwaltungListe {
	threads: VerwaltungThread[];
	untergruppen: { id: string; name: string }[];
	darfErstellen: boolean;
}

export interface ThreadBearbeitung {
	id: string;
	segment: string;
	art: ThreadArt;
	/** Bearbeitungsstand; PUT schickt ihn zurueck, ein anderer Wert ergibt 409 VERALTET. */
	version: number;
	veroeffentlicht: boolean;
	angepinnt: boolean;
	archiviert: boolean;
	darfLoeschen: boolean;
	darfArchivieren: boolean;
	entwurf: ThreadEntwurf;
	/** Je Umfrage-Modul-ID, was Antworten festlegen (umfrageSperre). */
	sperren: Record<string, UmfrageSperre>;
	/** Je Helfer-Modul-ID, was Eintraege festlegen (helferSperre). */
	helferSperren: Record<string, HelferSperre>;
	/** Was Autos und Mitfahrten der Fahrgemeinschaft festlegen (fahrtSperre); null ohne Fahrgemeinschaft. */
	fahrtSperre: FahrtSperre | null;
	/**
	 * Was am Thread an Fotos und Dateien haengt, gesamt und je Modul-ID: Der Editor fragt damit
	 * vor dem Entfernen eines Moduls oder dem Loeschen des Threads zurück (Plan-Entscheidung 11).
	 */
	medien: { gesamt: MedienZahl; module: Record<string, MedienZahl> };
	untergruppen: { id: string; name: string }[];
}

// Was an den Datei- und Foto-Modulen eines Threads haengt, gesamt und je Modul-ID (nur Module dieser
// beiden Typen, auch leere). "Personen" sind die verschiedenen Hochladenden der Fotos: Die Rueckfrage
// im Editor nennt sie bei Fotos ("23 Fotos von 5 Personen"), bei Dateien nicht (medienZahlText).
// Gesamt zaehlt jede Person einmal, auch wenn sie in zwei Modulen hochgeladen hat.
export function medienZahlen(module: readonly ModulDaten[]): ThreadBearbeitung['medien'] {
	const gesamt = { ...KEINE_MEDIEN };
	const alle = new Set<string>();
	const je: Record<string, MedienZahl> = {};
	for (const m of module) {
		if (m.typ === 'DATEIEN') {
			je[m.id] = { ...KEINE_MEDIEN, dateien: m.dateien.length };
			gesamt.dateien += m.dateien.length;
		} else if (m.typ === 'FOTOS') {
			const von = new Set(m.fotos.map((f) => f.vonId));
			je[m.id] = { ...KEINE_MEDIEN, fotos: m.fotos.length, personen: von.size };
			gesamt.fotos += m.fotos.length;
			for (const id of von) alle.add(id);
		}
	}
	gesamt.personen = alle.size;
	return { gesamt, module: je };
}

// Wer die Antworten-Uebersicht eines Threads sieht: wer ihn bearbeiten darf (dann auch Nachtragen)
// oder "Antworten im Detail" hat. Eine Funktion fuer Server und Liste: Die Liste zeigt den Link
// nur, wenn die Uebersicht auch kommt, und rechnet die Regel nicht im Browser nach.
export function siehtAntworten(ich: ThreadPerson, kopf: ThreadKopf): boolean {
	return darfBearbeiten(ich, kopf) || hatRecht(ich, 'ANTWORTEN_DETAIL');
}

// Der naechste Termin eines Threads als Anzeigetext, fuer Verwaltung und Thread-Liste
// gemeinsam: beide muessen dasselbe nennen, sonst zeigte die Liste "Sa 24.10." und die
// Verwaltung desselben Threads einen anderen Tag. Aus naechsteTermine und nicht aus dem
// fruehesten Datum: ein laufendes Zeltlager bleibt der naechste, ein vergangener Termin nie.
export function naechsterTerminText(kopf: ThreadKopf, termine: readonly TerminDaten[], jetzt: Date): string | null {
	const eintraege = termine.map((termin) => ({ threadId: kopf.id, titel: kopf.titel, termin }));
	const naechster = naechsteTermine(eintraege, jetzt, 1)[0];
	return naechster ? terminZeit(naechster.termin) : null;
}

// Eine Zeile der Liste als reine Funktion, damit der Server nur noch laedt und nichts
// herleitet.
export function verwaltungThread(
	ich: ThreadPerson,
	daten: ThreadDaten,
	namen: ReadonlyMap<string, string>,
	jetzt: Date,
): VerwaltungThread {
	const { kopf, termine, umfragen, helfer, fahrt } = daten;
	return {
		id: kopf.id,
		segment: threadSegment(kopf.id, kopf.titel),
		titel: kopf.titel,
		art: kopf.art,
		entwurf: kopf.veroeffentlichtAm === null,
		archiviert: istArchiviert(kopf, termine, jetzt),
		angepinnt: kopf.angepinnt,
		zielgruppe: zielgruppeText(kopf, namen),
		keineZielgruppe: !kopf.alleUntergruppen && gewaehlteNamen(kopf, namen).length === 0,
		naechsterTermin: naechsterTerminText(kopf, termine, jetzt),
		darfBearbeiten: darfBearbeiten(ich, kopf),
		darfAntwortenSehen: siehtAntworten(ich, kopf),
		hatAntwortModul: umfragen.length > 0 || helfer.length > 0 || fahrt !== null,
	};
}

export interface UebersichtZeile {
	fuerId: string;
	name: string;
	optionIds: string[];
	/** Kurzname der eintragenden Person; null, wenn die Person selbst geantwortet hat oder noch nichts vorliegt. */
	eingetragenVon: string | null;
}

export interface UmfrageUebersicht {
	modulId: string;
	frage: string;
	frist: string | null;
	fristAbgelaufen: boolean;
	mehrfach: boolean;
	teilnahme: boolean;
	optionen: { id: string; schluessel: string; text: string }[];
	zeilen: UebersichtZeile[];
	offen: number;
}

export interface HelferUebersicht {
	modulId: string;
	titel: string | null;
	frist: string | null;
	fristAbgelaufen: boolean;
	positionen: {
		id: string;
		text: string;
		anzahl: number;
		belegt: number;
		/** Namen wie in UebersichtZeile: Kurznamen, eingetragenVon nur, wenn jemand anderes eingetragen hat. */
		eintraege: { fuerId: string; name: string; notiz: string | null; eingetragenVon: string | null }[];
	}[];
	/** Wer jetzt gefragt ist, nach Vorname: die Liste, aus der die Leitung nachtraegt. */
	gefragte: { fuerId: string; name: string }[];
	/** Gefragte ohne einen einzigen Eintrag in diesem Modul. */
	ohneEintrag: number;
}

export interface AntwortenUebersicht {
	threadId: string;
	segment: string;
	titel: string;
	darfNachtragen: boolean;
	umfragen: UmfrageUebersicht[];
	helfer: HelferUebersicht[];
	/**
	 * Die Fahrgemeinschaft mit der Ansicht der anfragenden Person (Plan-Entscheidung 17): Die
	 * Leitung braucht dieselben Bedienelemente wie auf der Thread-Seite, vor allem "Umsetzen".
	 * Verworfen: eine eigene Tabelle, die jede Regel ein zweites Mal rechnete.
	 */
	fahrt: FahrtModulAnsicht | null;
}

// Anders als bei den Umfragen stehen hier auch Eintraege von Personen, die nicht mehr gefragt
// sind (ehemaliges Mitglied, aus der Zielgruppe gefallen): Sie belegen ihren Platz, und die
// Leitung muss sehen, wer ihn belegt (Plan-Entscheidung 1). "Ohne Eintrag" zaehlt dagegen nur
// Gefragte, denn nur ihnen fehlt etwas.
function helferUebersicht(
	h: HelferDaten,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	name: (id: string) => string,
	jetzt: Date,
): HelferUebersicht {
	const gefragt = gefragte(h, kopf, umfeld);
	const eingetragen = new Set(h.positionen.flatMap((p) => p.eintraege.map((e) => e.fuerId)));
	return {
		modulId: h.modulId,
		titel: h.titel,
		frist: h.frist ? h.frist.toISOString() : null,
		fristAbgelaufen: h.frist !== null && jetzt.getTime() >= h.frist.getTime(),
		positionen: h.positionen.map((p) => ({
			id: p.id,
			text: p.text,
			anzahl: p.anzahl,
			belegt: p.eintraege.length,
			eintraege: p.eintraege.map((e) => ({
				fuerId: e.fuerId,
				name: name(e.fuerId),
				notiz: e.notiz,
				eingetragenVon: e.vonId !== e.fuerId ? name(e.vonId) : null,
			})),
		})),
		gefragte: gefragt.map((p) => ({ fuerId: p.id, name: kurzname(p) })),
		ohneEintrag: gefragt.filter((p) => !eingetragen.has(p.id)).length,
	};
}

// Spec 7.1: wer wie geantwortet hat, mit Namen. Nur wer "Antworten im Detail" hat oder den
// Thread bearbeiten darf, sieht das; alle anderen und wer den Thread nicht sieht bekommen
// null, der Server macht daraus dieselbe 404. Verworfen: die Ergebnissicht der Umfrage
// (ergebnisse: SUMME) zu beachten, weil diese Uebersicht fuer die Jugendleiter da ist und
// die Namen sonst genau dort fehlten, wo sie nachtragen muessen.
// Die Zeilen sind alle Gefragten, nicht die Antwortenden: so steht "offen" neben dem Namen,
// und eine Antwort einer entfernten oder nicht mehr gefragten Person erscheint nirgends.
// Namen sind Kurznamen, auch bei "eingetragen von", statt der Beziehung (eingetragenVon in
// namen.ts): "eingetragen von Mutter Sandra" passt in die Sicht der Familie, nicht in eine
// Tabelle der Jugendleiter, die beide Spalten nebeneinander liest.
export function antwortenUebersicht(
	ich: ThreadPerson,
	daten: ThreadDaten,
	umfeld: Umfeld,
	jetzt: Date,
): AntwortenUebersicht | null {
	const { kopf, umfragen, helfer } = daten;
	if (!siehtThread(ich, kopf, umfeld)) return null;
	if (!siehtAntworten(ich, kopf)) return null;
	// Nachtragen nur im veroeffentlichten Thread: Im Entwurf verweigert der Server jede Antwort
	// (darfAntworten: ENTWURF), ein "Eintragen" endete also immer im Fehler. Verworfen: den
	// Knopf zu zeigen und den Fehler zu melden, denn ein Knopf, der nie gelingt, ist keiner.
	const nachtragen = darfBearbeiten(ich, kopf) && kopf.veroeffentlichtAm !== null;

	const name = (id: string) => {
		const p = umfeld.personen.get(id);
		return p ? kurzname(p) : EHEMALIGES_MITGLIED;
	};
	return {
		threadId: kopf.id,
		segment: threadSegment(kopf.id, kopf.titel),
		titel: kopf.titel,
		darfNachtragen: nachtragen,
		umfragen: umfragen.map((u): UmfrageUebersicht => {
			const antwortVon = new Map(u.antworten.map((a) => [a.fuerId, a]));
			const zeilen = gefragte(u, kopf, umfeld).map((p): UebersichtZeile => {
				const a = antwortVon.get(p.id);
				return {
					fuerId: p.id,
					name: kurzname(p),
					optionIds: a ? [...a.optionIds] : [],
					eingetragenVon: a && a.vonId !== p.id ? name(a.vonId) : null,
				};
			});
			return {
				modulId: u.modulId,
				frage: u.frage,
				frist: u.frist ? u.frist.toISOString() : null,
				fristAbgelaufen: u.frist !== null && jetzt.getTime() >= u.frist.getTime(),
				mehrfach: u.mehrfach,
				teilnahme: u.teilnahme,
				optionen: u.optionen.map((o) => ({ id: o.id, schluessel: o.schluessel, text: o.text })),
				zeilen,
				offen: zeilen.filter((z) => z.optionIds.length === 0).length,
			};
		}),
		helfer: helfer.map((h) => helferUebersicht(h, kopf, umfeld, name, jetzt)),
		fahrt: daten.fahrt
			? fahrtAnsicht(
					ich,
					{ typ: 'FAHRT', id: daten.fahrt.modulId, titel: daten.fahrt.titel, fahrt: daten.fahrt },
					daten,
					umfeld,
					jetzt,
				)
			: null,
	};
}
