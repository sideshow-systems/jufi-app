import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { initialen } from '@jufi/domain';
import { VereinKontext } from './verein-kontext';

/**
 * Das Logo des Vereins in 32 px, ohne Logo ein Abzeichen mit den Initialen auf der Vereinsfarbe.
 * Beide Huellen (Mitglieder, Verwaltung) zeigen es ueber ihrem Namen. Verworfen: der Block in
 * jeder Huelle, die Fallunterscheidung (Logo, Initialen, Verein unbekannt) lief sonst auseinander.
 * Das Bild ist Zierde (alt leer), denn daneben steht der Name.
 */
@Component({
	selector: 'jf-vereins-logo',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (logo(); as url) {
			<img [src]="url" alt="" width="32" height="32" />
		} @else if (name(); as n) {
			<span class="abzeichen" aria-hidden="true">{{ initialen(n) }}</span>
		}
	`,
	styles: `
		:host {
			display: inline-flex;
			flex: none;
		}
		img {
			border-radius: 8px;
		}
		.abzeichen {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 32px;
			height: 32px;
			border-radius: 8px;
			background: var(--akzent);
			color: var(--auf-akzent);
			font-size: 0.8125rem;
			font-weight: 700;
		}
	`,
})
export class VereinsLogoComponent {
	private readonly kontext = inject(VereinKontext);
	protected readonly initialen = initialen;
	protected readonly logo = this.kontext.logoUrl;
	protected readonly name = computed(() => {
		const v = this.kontext.verein();
		return v && v !== 'nicht-gefunden' ? v.anzeigename : null;
	});
}
