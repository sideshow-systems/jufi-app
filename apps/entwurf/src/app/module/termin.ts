import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TerminModul } from '../daten/typen';
import { datumLang, uhrzeit } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';

/** Datum, Uhrzeit, Ort als Karten-Link, Treffpunkt. */
@Component({
	selector: 'jf-termin',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (modul().titel) {
			<h3>{{ modul().titel }}</h3>
		}
		<p><jf-icon name="kalender" /> {{ datum() }}</p>
		<p><jf-icon name="uhr" /> {{ zeit() }}</p>
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
	protected readonly datum = computed(() => datumLang(this.modul().beginn));
	protected readonly zeit = computed(() => {
		const m = this.modul();
		return m.ende ? `${uhrzeit(m.beginn)} – ${uhrzeit(m.ende)} Uhr` : `${uhrzeit(m.beginn)} Uhr`;
	});
	protected readonly karte = computed(
		() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(this.modul().ort)}`,
	);
}
