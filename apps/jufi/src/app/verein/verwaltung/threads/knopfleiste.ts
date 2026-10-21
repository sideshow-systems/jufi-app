import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../../gestaltung/icon';

export type Formatart = 'fett' | 'kursiv' | 'liste' | 'link';

export interface Formatiert {
	text: string;
	start: number;
	ende: number;
}

const PLATZHALTER = 'Text';
const LINK_ZIEL = 'https://';

// Setzt vor und nach der Auswahl je ein Zeichenpaar. Ohne Auswahl entsteht ein Platzhalter,
// der danach markiert ist: Wer sofort weitertippt, ersetzt ihn. Verworfen: leere Zeichenpaare
// mit dem Cursor dazwischen, denn dann stehen bei einem Klick ohne Weitertippen nur
// "****" im Text.
function umschliesse(text: string, start: number, ende: number, vor: string, nach: string): Formatiert {
	const auswahl = text.slice(start, ende) || PLATZHALTER;
	const neuerStart = start + vor.length;
	return {
		text: text.slice(0, start) + vor + auswahl + nach + text.slice(ende),
		start: neuerStart,
		ende: neuerStart + auswahl.length,
	};
}

function linkAus(text: string, start: number, ende: number): Formatiert {
	const auswahl = text.slice(start, ende) || PLATZHALTER;
	// Markiert wird das Ziel, nicht der Linktext: Die Auswahl war schon der Linktext (oder der
	// Platzhalter), was fehlt, ist die Adresse.
	const zielStart = start + 1 + auswahl.length + 2;
	return {
		text: `${text.slice(0, start)}[${auswahl}](${LINK_ZIEL})${text.slice(ende)}`,
		start: zielStart,
		ende: zielStart + LINK_ZIEL.length,
	};
}

function listeAus(text: string, start: number, ende: number): Formatiert {
	// Eine Auswahl, die genau nach einem Zeilenumbruch endet, beruehrt die Zeile dahinter nicht:
	// Wer zwei Zeilen samt Umbruch markiert, will keine dritte Zeile mit Strich.
	const bis = ende > start && text[ende - 1] === '\n' ? ende - 1 : ende;
	// start === 0 gesondert: lastIndexOf mit negativem Startindex suchte ab 0 und fande einen
	// Umbruch am Textanfang, der nicht vor der ersten Zeile liegt.
	const erste = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
	const zeilenanfaenge = [erste];
	for (let i = erste; i < bis; i++) {
		if (text[i] === '\n' && i + 1 <= bis) zeilenanfaenge.push(i + 1);
	}
	// Von hinten einfuegen, damit die vorderen Positionen gueltig bleiben.
	let neu = text;
	for (const p of [...zeilenanfaenge].reverse()) neu = `${neu.slice(0, p)}- ${neu.slice(p)}`;
	return { text: neu, start: start + 2, ende: ende + 2 * zeilenanfaenge.length };
}

/**
 * Formatierung der Textauswahl als Markdown-Zeichen (Spec 4.3: fett, kursiv, Liste, Link).
 * Rein und ohne DOM, damit die Randfaelle (leere Auswahl, Zeilenenden) ohne Browser pruefbar
 * sind. Start und Ende der Rueckgabe sind die neue Auswahl.
 */
export function formatiere(text: string, start: number, ende: number, art: Formatart): Formatiert {
	const von = Math.min(start, ende);
	const bis = Math.max(start, ende);
	switch (art) {
		case 'fett':
			return umschliesse(text, von, bis, '**', '**');
		case 'kursiv':
			return umschliesse(text, von, bis, '_', '_');
		case 'liste':
			return listeAus(text, von, bis);
		case 'link':
			return linkAus(text, von, bis);
	}
}

/**
 * Knopfleiste ueber einem Textfeld. Sie schreibt direkt ins Feld und meldet den neuen Text:
 * Das Feld gehoert dem Besitzer (Modulfelder), die Leiste kennt nur das Element, weil sie
 * dessen Auswahl braucht. Verworfen: Auswahl und Text als Eingabe und Ausgabe durchreichen,
 * dann muesste der Besitzer nach jeder Formatierung die Auswahl selbst wieder setzen.
 * Das Setzen von value verwirft den Rueckgaengig-Verlauf des Feldes; document.execCommand
 * kaeme darum herum, ist aber veraltet und in Firefox fuer Textfelder unzuverlaessig.
 */
@Component({
	selector: 'jf-knopfleiste',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="leiste" role="toolbar" aria-label="Formatierung">
			<button
				type="button"
				class="knopf klein"
				aria-label="Fett"
				(mousedown)="$event.preventDefault()"
				(click)="wende('fett')"
			>
				<strong aria-hidden="true">F</strong>
			</button>
			<button
				type="button"
				class="knopf klein"
				aria-label="Kursiv"
				(mousedown)="$event.preventDefault()"
				(click)="wende('kursiv')"
			>
				<em aria-hidden="true">K</em>
			</button>
			<button
				type="button"
				class="knopf klein"
				aria-label="Liste"
				(mousedown)="$event.preventDefault()"
				(click)="wende('liste')"
			>
				<jf-icon name="liste" />
			</button>
			<button
				type="button"
				class="knopf klein"
				aria-label="Link"
				(mousedown)="$event.preventDefault()"
				(click)="wende('link')"
			>
				<jf-icon name="link" />
			</button>
		</div>
	`,
	styles: `
		:host {
			display: block;
		}
		.leiste {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
	`,
})
export class KnopfleisteComponent {
	readonly textarea = input.required<HTMLTextAreaElement>();
	readonly geaendert = output<string>();

	protected wende(art: Formatart): void {
		const feld = this.textarea();
		const r = formatiere(feld.value, feld.selectionStart, feld.selectionEnd, art);
		feld.value = r.text;
		feld.focus();
		feld.setSelectionRange(r.start, r.ende);
		this.geaendert.emit(r.text);
	}
}
