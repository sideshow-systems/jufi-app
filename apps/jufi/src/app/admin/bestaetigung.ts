import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	inject,
	input,
	output,
	viewChild,
} from '@angular/core';

/** Je Dialog eigene ids fuer aria-labelledby und -describedby, falls je zwei zugleich im DOM stuenden. */
let naechsteId = 0;

/**
 * Rueckfrage vor einer Handlung, die der Verein oder die Mitglieder spueren.
 * Ein eigenes Bauteil statt window.confirm: Der Browserdialog laesst sich nicht
 * gestalten, nicht in Tests treiben und blockiert den ganzen Tab.
 *
 * Eine Ueberlagerung statt des nativen dialog-Elements mit showModal: jsdom kennt
 * showModal nicht, die Tests liefen dann gegen etwas anderes als der Browser.
 * Dafuer gehoert die Fokusfuehrung hierher: Der Fokus landet beim Oeffnen auf dem
 * Dialog (der ihn vorliest), Tab wandert nur zwischen den beiden Knoepfen, Escape
 * und ein Klick daneben brechen ab, und beim Schliessen kehrt der Fokus zum Knopf
 * zurueck, der die Frage geoeffnet hat.
 *
 * Der Elternteil blendet das Bauteil mit @if ein und aus; es hat keinen eigenen
 * Offen-Zustand.
 */
@Component({
	selector: 'jf-bestaetigung',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown.escape)': 'abgebrochen.emit()' },
	template: `
		<div class="hintergrund" (click)="abgebrochen.emit()">
			<div
				#dialog
				class="dialog"
				role="dialog"
				aria-modal="true"
				[attr.aria-labelledby]="titelId"
				[attr.aria-describedby]="textId"
				tabindex="-1"
				(click)="$event.stopPropagation()"
				(keydown)="taste($event)"
			>
				<h2 [id]="titelId">{{ titel() }}</h2>
				<p [id]="textId">{{ text() }}</p>
				<div class="knoepfe">
					<button type="button" class="knopf" (click)="abgebrochen.emit()">Abbrechen</button>
					<button type="button" class="knopf primaer" (click)="bestaetigt.emit()">{{ bestaetigung() }}</button>
				</div>
			</div>
		</div>
	`,
	styles: `
		.hintergrund {
			position: fixed;
			inset: 0;
			z-index: 50;
			display: grid;
			/* Eine feste Spalte mit Obergrenze: Mit auto richtete sich die Spalte nach dem breitesten Wort der Frage,
			   und ein langer Titel ohne Leerzeichen schob den Dialog aus dem Fenster (gemessen bei 375 px). */
			grid-template-columns: minmax(0, 1fr);
			place-items: center;
			padding: var(--a4);
			background: rgb(0 0 0 / 0.45);
		}
		.dialog {
			width: min(100%, 28rem);
			padding: var(--a5);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			background: var(--karte);
			box-shadow: var(--schatten);
		}
		.dialog:focus {
			outline: none;
		}
		h2 {
			margin: 0 0 var(--a2);
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0 0 var(--a4);
			overflow-wrap: anywhere;
		}
		.knoepfe {
			display: flex;
			justify-content: flex-end;
			gap: var(--a3);
		}
	`,
})
export class BestaetigungComponent {
	/** Der Name des Dialogs fuer Screenreader; sichtbar als Ueberschrift ueber der Frage. */
	readonly titel = input('Bitte bestätigen');
	readonly text = input.required<string>();
	/** Beschriftung des Knopfes, der die Handlung ausloest (nicht "OK", sondern was geschieht). */
	readonly bestaetigung = input('Bestätigen');
	readonly bestaetigt = output<void>();
	readonly abgebrochen = output<void>();

	protected readonly titelId = `bestaetigung-titel-${naechsteId}`;
	protected readonly textId = `bestaetigung-text-${naechsteId++}`;

	private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

	constructor() {
		const davor = document.activeElement;
		afterNextRender(() => this.dialog().nativeElement.focus());
		inject(DestroyRef).onDestroy(() => {
			if (davor instanceof HTMLElement && davor.isConnected) davor.focus();
		});
	}

	/** Haelt Tab im Dialog: Vom letzten Knopf geht es zum ersten, von Umschalt+Tab auf dem Dialog zum letzten. */
	protected taste(ereignis: KeyboardEvent): void {
		if (ereignis.key !== 'Tab') return;
		const dialog = this.dialog().nativeElement;
		const knoepfe = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
		const erster = knoepfe[0];
		const letzter = knoepfe[knoepfe.length - 1];
		const aktiv = document.activeElement;
		if (ereignis.shiftKey && (aktiv === erster || aktiv === dialog)) {
			ereignis.preventDefault();
			letzter?.focus();
		} else if (!ereignis.shiftKey && aktiv === letzter) {
			ereignis.preventDefault();
			erster?.focus();
		}
	}
}
