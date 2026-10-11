import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { InfoModul } from '../daten/typen';

/** Text mit Absaetzen; Leerzeilen trennen Absaetze, einfache Umbrueche bleiben erhalten. */
@Component({
	selector: 'jf-info',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (modul().titel) {
			<h3>{{ modul().titel }}</h3>
		}
		@for (a of absaetze(); track $index) {
			<p>{{ a }}</p>
		}
	`,
	styles: `
		h3 {
			margin: 0 0 var(--a2);
			font-size: var(--schrift);
		}
		p {
			margin: 0 0 var(--a2);
			white-space: pre-line;
		}
		p:last-child {
			margin-bottom: 0;
		}
	`,
})
export class InfoBauteil {
	readonly modul = input.required<InfoModul>();
	protected readonly absaetze = computed(() =>
		this.modul()
			.text.split(/\n\s*\n/)
			.map((a) => a.trim())
			.filter(Boolean),
	);
}
