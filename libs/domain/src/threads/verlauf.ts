import { terminFehler, terminZeit, type TerminDaten } from '../module/termin/termin.js';
import { fristZeitpunkt } from '../module/umfrage/umfrage.js';
import type { ThreadModus } from './typen.js';

export const MODUS_TEXT: Readonly<Record<ThreadModus, string>> = {
	AUSHANG: 'Nur Aushang',
	KOMMENTARE: 'Aushang + Kommentare',
	CHAT: 'Offener Chat',
};

export type SystemArt = 'VEROEFFENTLICHT' | 'TERMIN_GEAENDERT' | 'FRIST_GEAENDERT' | 'MODUS_GEAENDERT';

const TAG = /^\d{4}-\d{2}-\d{2}$/;

function zeichenkette(wert: unknown): wert is string {
	return typeof wert === 'string';
}

function zeichenketteOderNull(wert: unknown): wert is string | null {
	return wert === null || typeof wert === 'string';
}

function istTag(wert: unknown): wert is string {
	return zeichenkette(wert) && TAG.test(wert) && kalendertagGibtEs(wert);
}

// 2026-02-31 passt auf die Form, ist aber kein Tag; Date.UTC rollt ihn still in den Maerz.
function kalendertagGibtEs(tag: string): boolean {
	const [j, m, t] = tag.split('-').map(Number);
	const d = new Date(Date.UTC(j, m - 1, t));
	return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
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
 */
export function systemSatz(art: SystemArt, daten: unknown, handelnd: string): string {
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
