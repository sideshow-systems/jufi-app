import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Weisse Karte mit 14 px Radius (Stil "Am Wasser"). */
@Component({
	selector: 'jf-karte',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<ng-content />`,
	styles: `
		:host {
			display: block;
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			padding: var(--a4);
		}
	`,
})
export class KarteComponent {}

/** Kleine Statusmarke. */
@Component({
	selector: 'jf-pille',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '[class]': 'art()' },
	template: `<ng-content />`,
	styles: `
		:host {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 2px 10px;
			border-radius: var(--radius-pille);
			font-size: var(--schrift-klein);
			font-weight: 600;
			white-space: nowrap;
		}
		:host(.ok) {
			background: var(--erfolg-flaeche);
			color: var(--erfolg);
		}
		:host(.offen) {
			background: var(--warnung-flaeche);
			color: var(--warnung);
		}
		:host(.neutral) {
			background: var(--akzent-flaeche);
			color: var(--akzent);
		}
	`,
})
export class PilleComponent {
	readonly art = input<'ok' | 'offen' | 'neutral'>('neutral');
}

/** Abschnitt mit Titel in kleinen Versalien. */
@Component({
	selector: 'jf-abschnitt',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2>{{ titel() }}</h2>
		<ng-content />
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a2);
		}
		h2 {
			margin: var(--a2) 0 0;
			font-size: var(--schrift-klein);
			font-weight: 700;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--text-gedaempft);
		}
	`,
})
export class AbschnittComponent {
	readonly titel = input.required<string>();
}
