import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { VereinApi } from '../daten/verein-api';
import { ThemaService } from '../gestaltung/thema';

/** Gleich dem title in index.html; dorthin faellt der Titel zurueck, sobald die Seite weg ist. */
const STANDARDTITEL = 'JuFi App';

/**
 * Name des Vereins als Ueberschrift, dazu Vereinsfarbe und Seitentitel. Gemeinsam fuer
 * Anmelden und Zugang verloren, damit beide Seiten nicht dieselbe Ladelogik tragen.
 * Ein unbekannter Verein oder ein Ladefehler zeigt nur den Plattformnamen: Das
 * Formular darunter bleibt benutzbar, der Server entscheidet ohnehin selbst (404).
 */
@Component({
	selector: 'jf-verein-kopf',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (verein.hasValue() && verein.value(); as v) {
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
	readonly slug = input.required<string>();
	/** Die kleine Zeile ueber dem Vereinsnamen, etwa Anmelden. */
	readonly untertitel = input.required<string>();

	private readonly api = inject(VereinApi);
	private readonly thema = inject(ThemaService);

	protected readonly verein = rxResource({
		params: () => this.slug(),
		stream: ({ params }) => this.api.lade(params),
	});

	constructor() {
		effect((onCleanup) => {
			if (!this.verein.hasValue()) return;
			const v = this.verein.value();
			if (v && v !== 'nicht-gefunden') {
				this.thema.setzeVereinsfarbe(v.farbe);
				document.title = v.anzeigename;
				onCleanup(() => {
					this.thema.entferneVereinsfarbe();
					document.title = STANDARDTITEL;
				});
			}
		});
	}
}
