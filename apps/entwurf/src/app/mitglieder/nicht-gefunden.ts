import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import { IconComponent } from '../gestaltung/icon';

/**
 * Eine Antwort fuer "gibt es nicht" und "darfst du nicht sehen" (Rahmen 8):
 * wer einen fremden Link bekommt, erfaehrt nicht, ob der Thread existiert.
 */
@Component({
	selector: 'jf-nicht-gefunden',
	imports: [RouterLink, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<jf-icon name="frage" />
		<h1>Nicht gefunden oder keine Berechtigung</h1>
		<p>Diese Seite gibt es nicht, oder sie ist für dich nicht sichtbar.</p>
		<a class="knopf primaer" [routerLink]="'/' + slug">Zum Start</a>
	`,
	styles: `
		:host {
			display: grid;
			justify-items: center;
			gap: var(--a3);
			padding: var(--a6) var(--a4);
			text-align: center;
		}
		jf-icon {
			font-size: 2.5rem;
			color: var(--text-gedaempft);
		}
		h1 {
			margin: 0;
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0;
			color: var(--text-gedaempft);
		}
	`,
})
export class NichtGefunden {
	protected readonly slug = inject(EntwurfStore).stand().verein.slug;
}
