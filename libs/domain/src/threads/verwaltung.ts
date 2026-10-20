import { naechsteTermine, terminZeit } from '../module/termin/termin.js';
import { hatRecht } from '../rechte.js';
import type { ThreadEntwurf } from './entwurf.js';
import { ROLLENFILTER_TEXT } from './entwurf.js';
import { istArchiviert } from './archiv.js';
import { gefragte } from './antworten.js';
import { EHEMALIGES_MITGLIED, kurzname } from './namen.js';
import { threadSegment } from './pfad.js';
import { darfBearbeiten } from './rechte.js';
import { siehtThread } from './sichtbarkeit.js';
import type { ThreadArt, ThreadDaten, ThreadKopf, ThreadPerson, Umfeld } from './typen.js';
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
	hatUmfrage: boolean;
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
	untergruppen: { id: string; name: string }[];
}

// Eine Zeile der Liste als reine Funktion, damit der Server nur noch laedt und nichts
// herleitet. Der naechste Termin kommt aus naechsteTermine und nicht aus dem fruehesten
// Datum: ein laufendes Zeltlager bleibt der naechste, ein vergangener Termin nie.
export function verwaltungThread(
	ich: ThreadPerson,
	daten: ThreadDaten,
	namen: ReadonlyMap<string, string>,
	jetzt: Date,
): VerwaltungThread {
	const { kopf, termine, umfragen } = daten;
	const eintraege = termine.map((termin) => ({ threadId: kopf.id, titel: kopf.titel, termin }));
	const naechster = naechsteTermine(eintraege, jetzt, 1)[0];
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
		naechsterTermin: naechster ? terminZeit(naechster.termin) : null,
		darfBearbeiten: darfBearbeiten(ich, kopf),
		hatUmfrage: umfragen.length > 0,
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

export interface AntwortenUebersicht {
	threadId: string;
	segment: string;
	titel: string;
	darfNachtragen: boolean;
	umfragen: UmfrageUebersicht[];
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
	const { kopf, umfragen } = daten;
	if (!siehtThread(ich, kopf, umfeld)) return null;
	const nachtragen = darfBearbeiten(ich, kopf);
	if (!nachtragen && !hatRecht(ich, 'ANTWORTEN_DETAIL')) return null;

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
	};
}
