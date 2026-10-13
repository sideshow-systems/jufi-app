import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { VereinApi } from '../daten/verein-api';
import { ThemaService } from '../gestaltung/thema';
import { KarteComponent } from '../gestaltung/ui';
import { NichtGefundenComponent } from './nicht-gefunden';

/** Gleich dem title in index.html; dorthin faellt der Titel zurueck, sobald kein Verein mehr gezeigt wird. */
const STANDARDTITEL = 'JuFi App';

/** Platzhalter der Vereinsseite: zeigt, dass Slug, API und Vereinsfarbe zusammenspielen. */
@Component({
	selector: 'jf-verein-start',
	imports: [KarteComponent, NichtGefundenComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (verein.error()) {
			<main>
				<jf-karte>
					<p>Keine Verbindung – nochmal versuchen</p>
					<button type="button" class="knopf primaer" (click)="verein.reload()">Nochmal versuchen</button>
				</jf-karte>
			</main>
		} @else if (verein.value(); as v) {
			@if (v === 'nicht-gefunden') {
				<jf-nicht-gefunden />
			} @else {
				<main>
					<jf-karte>
						<h1>Willkommen bei den {{ v.anzeigename }}</h1>
					</jf-karte>
				</main>
			}
		}
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
		h1,
		p {
			margin: 0 0 var(--a3);
		}
		h1 {
			font-size: var(--schrift-gross);
		}
	`,
})
export class VereinStartComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(VereinApi);
	private readonly thema = inject(ThemaService);

	// Neuer Slug, neue Anfrage; eine noch laufende wird dabei verworfen.
	protected readonly verein = rxResource({
		params: () => this.slug(),
		stream: ({ params }) => this.api.lade(params),
	});

	constructor() {
		effect((onCleanup) => {
			// value() wirft im Fehlerzustand; hasValue() fragt gefahrlos.
			if (!this.verein.hasValue()) return;
			const v = this.verein.value();
			if (v && v !== 'nicht-gefunden') {
				this.thema.setzeVereinsfarbe(v.farbe);
				document.title = v.anzeigename;
				// Laeuft vor dem naechsten Durchlauf (neuer Slug, 404, Fehler) und beim
				// Zerstoeren der Seite. Ohne das trueg die Plattformseite oder ein
				// unbekannter Verein Titel und Farbe des vorigen Vereins.
				onCleanup(() => {
					this.thema.entferneVereinsfarbe();
					document.title = STANDARDTITEL;
				});
			}
		});
	}
}
