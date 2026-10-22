import { undListe } from '../dateien/medien.js';
import { RICHTUNG_TEXT } from '../module/fahrt/fahrt.js';
import { terminFehler, terminZeit, type TerminDaten } from '../module/termin/termin.js';
import { fristZeitpunkt } from '../module/umfrage/umfrage.js';
import { istKalendertag } from '../zeit.js';
import { absenderName, EHEMALIGES_MITGLIED, kurzname } from './namen.js';
import { darfLoeschenNachricht } from './rechte.js';
import type { ThreadKopf, ThreadModus, ThreadPerson, Umfeld } from './typen.js';

export const MODUS_TEXT: Readonly<Record<ThreadModus, string>> = {
	AUSHANG: 'Nur Aushang',
	KOMMENTARE: 'Aushang + Kommentare',
	CHAT: 'Offener Chat',
};

export type SystemArt =
	'VEROEFFENTLICHT' | 'TERMIN_GEAENDERT' | 'FRIST_GEAENDERT' | 'MODUS_GEAENDERT' | 'AUTO_ZURUECKGEZOGEN';

function zeichenkette(wert: unknown): wert is string {
	return typeof wert === 'string';
}

function zeichenketteOderNull(wert: unknown): wert is string | null {
	return wert === null || typeof wert === 'string';
}

function istTag(wert: unknown): wert is string {
	return zeichenkette(wert) && istKalendertag(wert);
}

/**
 * Lesbar ist ein Termin, wenn jedes Feld die richtige Form hat und der Editor
 * ihn so angenommen haette. Die modulId ist fuer die Zeitangabe ohne Belang und
 * wird nicht verlangt: Der Satz soll auch dann stehen, wenn sie fehlt.
 */
function lesbarerTermin(wert: unknown): TerminDaten | null {
	if (typeof wert !== 'object' || wert === null) return null;
	const t = wert as Record<string, unknown>;
	if (!istTag(t['startDatum'])) return null;
	if (t['endDatum'] !== null && !istTag(t['endDatum'])) return null;
	if (!zeichenketteOderNull(t['beginn']) || !zeichenketteOderNull(t['ende'])) return null;
	const termin: TerminDaten = {
		modulId: '',
		startDatum: t['startDatum'],
		endDatum: t['endDatum'] as string | null,
		beginn: t['beginn'],
		ende: t['ende'],
		ort: null,
		treffpunkt: null,
	};
	return terminFehler(termin) === null ? termin : null;
}

/**
 * Satz im Verlauf eines Threads. Er entsteht beim Lesen aus Art und Daten, nicht
 * beim Schreiben: Die Zeile speichert nur die Tatsache, der Wortlaut laesst sich
 * so spaeter aendern. Verworfen: den fertigen Satz speichern, weil Namen und
 * Zeitangaben dann auf ewig so stehen blieben, wie sie waren.
 *
 * Die Daten kommen aus einer JSON-Spalte und werden feldweise geprueft; was sich
 * nicht lesen laesst, ergibt den allgemeinen Satz statt eines Fehlers, denn ein
 * kaputter Verlaufseintrag darf den Thread nicht unlesbar machen.
 *
 * Das Umfeld braucht nur AUTO_ZURUECKGEZOGEN: Der Eintrag speichert Fahrer und Kinder als IDs
 * (Plan-Entscheidung 4), die Namen entstehen hier. Verworfen: die Namen zu speichern, denn dann
 * stuende ein spaeter entferntes Kind weiter mit Namen im Verlauf.
 */
export function systemSatz(art: SystemArt, daten: unknown, handelnd: string, umfeld: Umfeld): string {
	const d = typeof daten === 'object' && daten !== null ? (daten as Record<string, unknown>) : {};
	switch (art) {
		case 'VEROEFFENTLICHT':
			return `${handelnd} hat den Thread veröffentlicht`;
		case 'TERMIN_GEAENDERT': {
			const termin = lesbarerTermin(d['termin']);
			if (termin) return `${handelnd} hat den Termin auf ${terminZeit(termin)} verschoben`;
			break;
		}
		case 'FRIST_GEAENDERT': {
			const frage = d['frage'];
			const frist = d['frist'];
			if (!zeichenkette(frage)) break;
			if (frist === null) return `${handelnd} hat die Frist für „${frage}“ aufgehoben`;
			if (zeichenkette(frist) && !Number.isNaN(new Date(frist).getTime())) {
				return `${handelnd} hat die Frist für „${frage}“ auf ${fristZeitpunkt(new Date(frist))} gesetzt`;
			}
			break;
		}
		case 'MODUS_GEAENDERT': {
			const modus = d['modus'];
			// Object.hasOwn: "toString" ist sonst ein Schluessel der Tabelle.
			if (zeichenkette(modus) && Object.hasOwn(MODUS_TEXT, modus)) {
				return `${handelnd} hat den Modus auf „${MODUS_TEXT[modus as ThreadModus]}“ gestellt`;
			}
			break;
		}
		case 'AUTO_ZURUECKGEZOGEN': {
			const { fahrerId, richtung, kindIds } = d;
			if (!zeichenkette(fahrerId) || (richtung !== 'HIN' && richtung !== 'RUECK')) break;
			// Ohne Kind gaebe es keinen Eintrag (Entscheidung 4); eine leere Liste ist kaputt.
			if (!Array.isArray(kindIds) || kindIds.length === 0 || !kindIds.every(zeichenkette)) break;
			// Der Fahrer steht mit Kurznamen, nicht mit absenderName: Dessen Klammer ("Mutter von ...")
			// stuende neben der Klammer mit der Richtung.
			const name = (id: string) => {
				const p = umfeld.personen.get(id);
				return p ? kurzname(p) : EHEMALIGES_MITGLIED;
			};
			const brauchen = kindIds.length === 1 ? 'braucht' : 'brauchen';
			return `Auto von ${name(fahrerId)} (${RICHTUNG_TEXT[richtung]}) zurückgezogen – ${undListe(kindIds.map(name))} ${brauchen} wieder eine Mitfahrt.`;
		}
	}
	return `${handelnd} hat den Thread geändert`;
}

export type TextTeil = { art: 'text'; text: string } | { art: 'link'; text: string; href: string };

// Nur http und https: javascript:, mailto: und nackte Adressen bleiben Text. Verworfen:
// "www." mitzunehmen, weil dafuer ein Schema ergaenzt werden muesste und der Link dann
// etwas anderes waere als der angezeigte Text.
const LINK = /https?:\/\/[^\s<>"]+/gi;
const ENDZEICHEN = /[.,;:!?)]+$/;
const MIT_ZIEL = /^https?:\/\/[^\s.,;:!?)/]/i;

/**
 * Zerlegt fremden Text in Text und Links. Die Oberflaeche setzt die Teile als
 * Text und als Anker ein, nie als HTML: Was jemand schreibt, kann so kein Markup
 * einschleusen. Verworfen: den Text zu escapen und als HTML einzusetzen, weil
 * jeder vergessene Aufruf eine Luecke waere.
 */
export function linkTeile(text: string): TextTeil[] {
	const teile: TextTeil[] = [];
	const anhaengen = (t: string): void => {
		if (!t) return;
		const letzter = teile[teile.length - 1];
		if (letzter?.art === 'text') letzter.text += t;
		else teile.push({ art: 'text', text: t });
	};
	let ab = 0;
	for (const treffer of text.matchAll(LINK)) {
		const link = treffer[0].replace(ENDZEICHEN, '');
		if (!MIT_ZIEL.test(link)) continue;
		anhaengen(text.slice(ab, treffer.index));
		teile.push({ art: 'link', text: link, href: link });
		ab = treffer.index + link.length;
	}
	anhaengen(text.slice(ab));
	return teile;
}

export interface VerlaufEintragDaten {
	id: string;
	art: 'NACHRICHT' | 'SYSTEM';
	autorId: string | null;
	text: string | null;
	systemArt: SystemArt | null;
	systemDaten: unknown;
	stand: number;
	angelegtAm: Date;
	geloeschtAm: Date | null;
	geloeschtVonId: string | null;
}

export interface VerlaufAnsicht {
	id: string;
	art: 'NACHRICHT' | 'SYSTEM';
	text: string | null;
	absender: string | null;
	eigen: boolean;
	angelegtAm: string;
	stand: number;
	geloescht: 'SELBST' | 'MODERATION' | null;
	darfLoeschen: boolean;
}

// Im Satz steht der Handelnde als Satzanfang, deshalb gross; absenderName liefert das
// kleingeschriebene Wort fuer die Zeile unter einer Nachricht. Wer nicht im Umfeld steht,
// ist entfernt oder unbekannt und heisst fuer alle gleich.
function handelnder(autorId: string | null, umfeld: Umfeld): string {
	const autor = autorId === null ? undefined : umfeld.personen.get(autorId);
	return autor ? kurzname(autor) : 'Ein ehemaliges Mitglied';
}

/**
 * Eine Zeile des Verlaufs, wie die Person sie sieht. Der Text einer geloeschten
 * Nachricht verlaesst die Funktion nie (null), die Zeile bleibt aber stehen und sagt,
 * wer geloescht hat. Verworfen: den Text mitzuschicken und die Oberflaeche ausblenden
 * zu lassen, weil er dann im Netz laege.
 * "Selbst" heisst: Loescher und Autor sind dieselbe bekannte Person. Fehlt der Urheber
 * der Loeschung, gilt Moderation, weil nur die einen Autor ohne Spur ueberschreiben kann.
 */
export function verlaufAnsicht(
	ich: ThreadPerson,
	kopf: ThreadKopf,
	eintrag: VerlaufEintragDaten,
	umfeld: Umfeld,
): VerlaufAnsicht {
	const nachricht = eintrag.art === 'NACHRICHT';
	const geloescht = eintrag.geloeschtAm
		? eintrag.geloeschtVonId !== null && eintrag.geloeschtVonId === eintrag.autorId
			? 'SELBST'
			: 'MODERATION'
		: null;
	let text: string | null;
	if (nachricht) text = geloescht ? null : eintrag.text;
	else if (eintrag.systemArt)
		text = systemSatz(eintrag.systemArt, eintrag.systemDaten, handelnder(eintrag.autorId, umfeld), umfeld);
	else text = `${handelnder(eintrag.autorId, umfeld)} hat den Thread geändert`;
	return {
		id: eintrag.id,
		art: eintrag.art,
		text,
		absender: nachricht ? absenderName(eintrag.autorId, umfeld) : null,
		eigen: nachricht && eintrag.autorId === ich.id,
		angelegtAm: eintrag.angelegtAm.toISOString(),
		stand: eintrag.stand,
		geloescht,
		darfLoeschen: darfLoeschenNachricht(ich, eintrag, kopf),
	};
}
