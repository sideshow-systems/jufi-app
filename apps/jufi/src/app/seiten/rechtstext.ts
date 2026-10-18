import { DOCUMENT } from '@angular/common';
import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	input,
	resource,
	ViewEncapsulation,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../gestaltung/icon';
import { STANDARDTITEL } from '../verein/verein-kontext';

export type Rechtstext = 'impressum' | 'datenschutz';

const TITEL: Record<Rechtstext, string> = {
	impressum: 'Impressum',
	datenschutz: 'Datenschutz',
};

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

/**
 * Encapsulation None, weil [innerHTML] Elemente ohne das Kapselungsattribut erzeugt: Eine gekapselte
 * Regel wie article h1 wird zu article[_ngcontent] h1[_ngcontent] und trifft keine Ueberschrift des
 * Markdowns. Damit die Regeln trotzdem nirgends sonst wirken, haengt jede an jf-rechtstext.
 * Verworfen: :host ::ng-deep, das Angular als veraltet fuehrt und das beim Entfernen still aufhoert zu wirken.
 */
@Component({
	selector: 'jf-rechtstext',
	imports: [IconComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	encapsulation: ViewEncapsulation.None,
	template: `
		<main>
			<!-- Zurueck nur, wenn davor eine Seite der App lag. Bei einem Direktaufruf (Mail, Messenger, Suche) fuehrte
			     Zurueck aus der App heraus, dann steht hier der Link zur Plattform. -->
			@if (kannZurueck) {
				<button type="button" class="knopf leise zurueck" (click)="zurueck()"><jf-icon name="zurueck" /> Zurück</button>
			} @else {
				<a class="knopf leise zurueck" routerLink="/"> <jf-icon name="zurueck" /> JuFi App </a>
			}
			@if (text.error()) {
				<!-- Ein Link mit href statt routerLink: Er laedt die ganze Seite und holt damit die Dateien des neuen Stands. -->
				<p class="meldung" role="alert">Der Text konnte nicht geladen werden.</p>
				<a class="knopf leise" [href]="adresse()">Neu laden</a>
			} @else if (text.isLoading()) {
				<p class="meldung" role="status">Wird geladen …</p>
			} @else {
				<article [innerHTML]="html()"></article>
			}
		</main>
	`,
	styles: `
		jf-rechtstext {
			display: block;
		}
		jf-rechtstext main {
			max-width: 40rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		jf-rechtstext .zurueck {
			margin-bottom: var(--a4);
		}
		jf-rechtstext .meldung {
			margin: 0 0 var(--a4);
		}
		jf-rechtstext article {
			overflow-wrap: anywhere;
		}
		jf-rechtstext article :is(h1, h2, p) {
			margin: 0 0 var(--a3);
		}
		jf-rechtstext article h1 {
			font-size: var(--schrift-titel);
		}
		jf-rechtstext article h2 {
			margin-top: var(--a5);
			font-size: var(--schrift-gross);
		}
	`,
})
export class RechtstextComponent {
	/** Kommt ueber die Routen-data (withComponentInputBinding). */
	readonly art = input.required<Rechtstext>();

	private readonly dokument = inject(DOCUMENT);

	/**
	 * Gefragt wird, ob die App selbst schon eine Seite gezeigt hat, nicht history.length: Ein Direktaufruf hat
	 * dort schon zwei Eintraege (die Seite davor, etwa Neuer Tab oder die Mail), und back() fuehrte aus der App
	 * heraus. Waehrend der Navigation, die diese Seite erzeugt, ist currentNavigation die eigene und
	 * previousNavigation die letzte erfolgreiche der App.
	 */
	protected readonly kannZurueck = inject(Router).currentNavigation()?.previousNavigation != null;

	protected readonly adresse = computed(() => `/${this.art()}`);

	protected readonly text = resource({
		params: () => this.art(),
		loader: async ({ params }) => {
			const [{ default: markdown }, { marked }] = await Promise.all([LADER[params](), import('marked')]);
			return marked.parse(markdown, { async: false });
		},
	});

	protected readonly html = computed(() => (this.text.hasValue() ? this.text.value() : ''));

	constructor() {
		// Ohne eigenen Titel sind Impressum und Datenschutz in der Tab-Leiste und fuer Screenreader nicht zu
		// unterscheiden. Aufgeraeumt wird nur, was noch der eigene Titel ist (siehe VereinKontext).
		effect((onCleanup) => {
			const titel = `${TITEL[this.art()]} – ${STANDARDTITEL}`;
			this.dokument.title = titel;
			onCleanup(() => {
				if (this.dokument.title === titel) this.dokument.title = STANDARDTITEL;
			});
		});
	}

	protected zurueck(): void {
		this.dokument.defaultView?.history.back();
	}
}
