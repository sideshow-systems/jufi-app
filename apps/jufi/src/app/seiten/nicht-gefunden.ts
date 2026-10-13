import { ChangeDetectionStrategy, Component } from '@angular/core';
import { KarteComponent } from '../gestaltung/ui';

/**
 * Ein Text fuer alles, was die Person nicht sehen darf oder was es nicht gibt
 * (Spec 6.5): getrennte Meldungen verraeten, dass es etwas gibt.
 */
@Component({
	selector: 'jf-nicht-gefunden',
	imports: [KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-karte>
				<h1>Nicht gefunden oder keine Berechtigung</h1>
			</jf-karte>
		</main>
	`,
	styles: `
		:host {
			display: block;
		}
		main {
			max-width: 32rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		h1 {
			margin: 0;
			font-size: var(--schrift-gross);
		}
	`,
})
export class NichtGefundenComponent {}
