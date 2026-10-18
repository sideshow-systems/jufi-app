import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { VereinKontext } from './verein-kontext';

/**
 * Name des Vereins als Ueberschrift. Gemeinsam fuer alle Vereinsseiten; den Verein selbst
 * laedt der VereinKontext, dort stehen auch Vereinsfarbe und Seitentitel. Ein unbekannter Verein oder ein Ladefehler zeigt nur den Plattformnamen: Das
 * Formular darunter bleibt benutzbar, der Server entscheidet ohnehin selbst (404).
 */
@Component({
	selector: 'jf-verein-kopf',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (kontext.verein(); as v) {
			@if (v !== 'nicht-gefunden') {
				<p class="gruss">{{ untertitel() }}</p>
				<h1>{{ v.anzeigename }}</h1>
			}
		}
	`,
	styles: `
		:host {
			display: block;
		}
		h1,
		p {
			margin: 0 0 var(--a3);
		}
		h1 {
			font-size: var(--schrift-titel);
		}
		.gruss {
			margin-bottom: var(--a1);
			color: var(--text-gedaempft);
		}
	`,
})
export class VereinKopfComponent {
	// Die Seiten reichen den Slug weiter, der Kontext kennt ihn aber schon aus der Adresse;
	// die Eingabe bleibt, damit die Aufrufer unveraendert sind.
	readonly slug = input.required<string>();
	/** Die kleine Zeile ueber dem Vereinsnamen, etwa Anmelden. */
	readonly untertitel = input.required<string>();

	protected readonly kontext = inject(VereinKontext);
}
