import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent, type IconName } from './icon';
import { type ThemaWahl, ThemaService } from './thema';

const THEMEN: { wert: ThemaWahl; text: string; icon: IconName }[] = [
	{ wert: 'hell', text: 'Hell', icon: 'hell' },
	{ wert: 'dunkel', text: 'Dunkel', icon: 'dunkel' },
	{ wert: 'system', text: 'System', icon: 'system' },
];

/** Hell/Dunkel/System; steht unter "Mehr" und in den Verwaltungs-Einstellungen (Rahmen 5.1.1). */
@Component({
	selector: 'jf-thema-wahl',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="thema" role="group" aria-label="Darstellung">
			@for (w of themen; track w.wert) {
				<button
					type="button"
					class="knopf"
					[class.primaer]="thema.wahl() === w.wert"
					[attr.aria-pressed]="thema.wahl() === w.wert"
					(click)="thema.setzeWahl(w.wert)"
				>
					<jf-icon [name]="w.icon" /> {{ w.text }}
				</button>
			}
		</div>
	`,
	styles: `
		:host {
			display: block;
		}
		.thema {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: var(--a2);
		}
		.thema .knopf {
			padding: 0 var(--a2);
		}
	`,
})
export class ThemaWahlComponent {
	protected readonly thema = inject(ThemaService);
	protected readonly themen = THEMEN;
}
