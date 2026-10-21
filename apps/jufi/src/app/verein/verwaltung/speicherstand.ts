import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { fastVoll, MB, type SpeicherAntwort, speicherText } from '@jufi/domain';
import { IconComponent } from '../../gestaltung/icon';

/**
 * Der Speicherstand des Vereins als eine Zeile, ab 90 Prozent mit Warnung. Ein Bauteil, weil ihn
 * Dokumente und Einstellungen gleich zeigen und die Schwelle (fastVoll) nur an einer Stelle
 * angewendet werden soll; die Seiten laden den Stand selbst, denn sie brauchen ihn nach eigenen
 * Aktionen neu.
 */
@Component({
	selector: 'jf-speicherstand',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<p class="speicher">
			@if (warnt()) {
				<jf-icon name="warnung" />
			}
			<span>{{ satz() }}</span>
		</p>
		@if (warnt()) {
			<p class="speicher-warnung">Der Speicher ist fast voll.</p>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a1);
		}
		p {
			margin: 0;
		}
		.speicher {
			display: flex;
			align-items: center;
			gap: var(--a2);
			font-weight: 600;
		}
		.speicher jf-icon,
		.speicher-warnung {
			color: var(--warnung);
		}
		.speicher-warnung {
			font-weight: 600;
		}
	`,
})
export class SpeicherstandComponent {
	readonly stand = input.required<SpeicherAntwort>();

	protected readonly warnt = computed(() => fastVoll(this.stand().verbrauchBytes, this.stand().grenzeMb));
	protected readonly satz = computed(
		() => `${speicherText(this.stand().verbrauchBytes)} von ${speicherText(this.stand().grenzeMb * MB)} belegt`,
	);
}
