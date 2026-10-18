import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { RouterLink } from '@angular/router';

export type Rechtstext = 'impressum' | 'datenschutz';

/**
 * Das Markdown kommt aus dem Repo und ist vertrauenswuerdig; Angulars Sanitizer laeuft bei
 * [innerHTML] trotzdem, damit ein spaeterer Fehler im Text kein Skript einschleusen kann.
 * Verworfen: HTML-Dateien statt Markdown, weil der Eigentuemer Markdown pflegt (Spec 2.3).
 *
 * Text und marked werden erst mit der Route geladen: Mitglieder, die nie ein Impressum
 * aufrufen, tragen weder die Texte noch den Markdown-Parser im Startbuendel.
 */
const LADER: Record<Rechtstext, () => Promise<{ default: string }>> = {
	impressum: () => import('../../rechtstexte/impressum.md'),
	datenschutz: () => import('../../rechtstexte/datenschutz.md'),
};

@Component({
	selector: 'jf-rechtstext',
	imports: [RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<!-- Wer aus der App kommt, will dorthin zurueck; wer den Link direkt oeffnet, hat keinen Verlauf und landet auf der Plattform. -->
			@if (kannZurueck) {
				<button type="button" class="knopf leise zurueck" (click)="zurueck()">← Zurück</button>
			} @else {
				<a class="knopf leise zurueck" routerLink="/">← JuFi App</a>
			}
			<article [innerHTML]="html()"></article>
		</main>
	`,
	styles: `
		:host {
			display: block;
		}
		main {
			max-width: 40rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		.zurueck {
			margin-bottom: var(--a4);
		}
		article {
			overflow-wrap: anywhere;
		}
		article :is(h1, h2, p) {
			margin: 0 0 var(--a3);
		}
		article h1 {
			font-size: var(--schrift-titel);
		}
		article h2 {
			margin-top: var(--a5);
			font-size: var(--schrift-gross);
		}
	`,
})
export class RechtstextComponent {
	/** Kommt ueber die Routen-data (withComponentInputBinding). */
	readonly art = input.required<Rechtstext>();

	private readonly verlauf = inject(DOCUMENT).defaultView?.history;
	protected readonly kannZurueck = (this.verlauf?.length ?? 0) > 1;

	private readonly text = resource({
		params: () => this.art(),
		loader: async ({ params }) => {
			const [{ default: markdown }, { marked }] = await Promise.all([LADER[params](), import('marked')]);
			return marked.parse(markdown, { async: false });
		},
	});

	// Bis der Text da ist, bleibt die Seite leer; der Fehlerfall (Nachladen scheitert) ebenso, das Netz ist dann ohnehin weg.
	protected readonly html = computed(() => (this.text.hasValue() ? this.text.value() : ''));

	protected zurueck(): void {
		this.verlauf?.back();
	}
}
