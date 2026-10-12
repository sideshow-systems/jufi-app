import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TerminModul } from '../daten/typen';
import { IconComponent } from '../gestaltung/icon';
import { terminZeit } from '../regeln/terminzeit';

/** Datum und Uhrzeit in einer Zeile (auch mehrtaegig), Ort als Karten-Link, Treffpunkt. */
@Component({
	selector: 'jf-termin',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (modul().titel) {
			<h3>{{ modul().titel }}</h3>
		}
		<p><jf-icon name="kalender" /> {{ zeit() }}</p>
		<p>
			<jf-icon name="ort" />
			<a [href]="karte()" target="_blank" rel="noopener">{{ modul().ort }}</a>
		</p>
		@if (modul().treffpunkt) {
			<p class="gedaempft">Treffpunkt: {{ modul().treffpunkt }}</p>
		}
	`,
	styles: `
		h3 {
			margin: 0 0 var(--a2);
			font-size: var(--schrift);
		}
		p {
			display: flex;
			align-items: center;
			gap: var(--a2);
			margin: 0 0 var(--a1);
		}
		jf-icon {
			color: var(--akzent);
			flex: none;
		}
		a {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			color: var(--akzent);
			font-weight: 600;
		}
	`,
})
export class TerminBauteil {
	readonly modul = input.required<TerminModul>();
	protected readonly zeit = computed(() => terminZeit(this.modul()));
	protected readonly karte = computed(
		() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.modul().ort)}`,
	);
}
