import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { type DokumentAnsicht, speicherText } from '@jufi/domain';
import { fehlertext, fehlertextNichtGefunden, fehlerVon } from '../gemeinsam/api-fehler';
import { IconComponent } from '../gestaltung/icon';
import { KarteComponent } from '../gestaltung/ui';
import { DateienApi } from './dateien-api';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from './sitzung-abgelaufen';

const KUERZEL = new Map<string, string>([
	['application/pdf', 'PDF'],
	['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word'],
	['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel'],
	['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PowerPoint'],
	['application/vnd.oasis.opendocument.text', 'OpenDocument'],
	['application/vnd.oasis.opendocument.spreadsheet', 'OpenDocument'],
	['image/jpeg', 'Bild'],
	['image/png', 'Bild'],
]);

/**
 * Nur das, was der Server inline ausliefert (PDF, JPEG, PNG): Alles andere zeigt der Browser nicht an,
 * und ein neuer Tab, der gleich wieder herunterlaedt, bliebe leer zurueck.
 */
const IM_BROWSER = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/**
 * Die Seite Medien (TP4 Spec 3.1): in Etappe 1 die globalen Dokumente nach Kategorien. Der Reiter
 * "Fotos & Dateien" kommt mit Etappe 2; eine Reiterleiste mit nur einem Reiter waere Ballast.
 * Der Server liefert Kategorien und Dokumente schon in Anzeigereihenfolge und laesst leere
 * Kategorien fuer Mitglieder weg; die Seite zeigt nur an. Eine Kategorie ohne Dokument zeigt sie
 * nie (auch nicht fuer Pfleger, die hier nur lesen): Eine Ueberschrift ohne Inhalt sagt nichts.
 */
@Component({
	selector: 'jf-medien',
	imports: [IconComponent, KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Medien</h1>

		@if (fehler(); as f) {
			<jf-karte>
				@if (f.status === 404) {
					<p>{{ nichtGefunden(f) }}</p>
				} @else {
					<p class="fehler" role="alert">{{ fehlertext(f) }}</p>
					<button type="button" class="knopf primaer" (click)="neuVersuchen()">Nochmal versuchen</button>
				}
			</jf-karte>
		} @else if (kategorien(); as liste) {
			@for (k of liste; track k.id) {
				<section [attr.aria-labelledby]="'kat-' + k.id">
					<h2 [id]="'kat-' + k.id">{{ k.name }}</h2>
					<ul>
						@for (d of k.dokumente; track d.id) {
							<li>
								<a
									class="reihe"
									[href]="adresse(d)"
									[attr.target]="imBrowser(d) ? '_blank' : null"
									[attr.rel]="imBrowser(d) ? 'noopener' : null"
								>
									<jf-icon name="dokument" />
									<span class="titel">{{ d.titel }}</span>
									<span class="zusatz">{{ kuerzel(d.typ) }} · {{ groesse(d.groesse) }}</span>
								</a>
							</li>
						}
					</ul>
				</section>
			} @empty {
				<p class="gedaempft">Noch keine Dokumente.</p>
			}
		} @else {
			<p class="gedaempft" role="status">Wird geladen …</p>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a4);
		}
		h1,
		h2,
		p,
		ul {
			margin: 0;
		}
		h1 {
			font-size: var(--schrift-gross);
		}
		h2 {
			font-size: var(--schrift);
		}
		section {
			display: grid;
			gap: var(--a2);
		}
		ul {
			display: grid;
			gap: var(--a2);
			padding: 0;
			list-style: none;
		}
		/* Icon links ueber beide Textzeilen: Titel und Zusatz bleiben bei langen Titeln beieinander. */
		.reihe {
			display: grid;
			grid-template-columns: auto 1fr;
			column-gap: var(--a3);
			align-items: center;
			min-height: var(--tippflaeche);
			padding: var(--a3) var(--a4);
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			color: var(--text);
			text-decoration: none;
			overflow-wrap: anywhere;
		}
		.reihe jf-icon {
			grid-row: 1 / span 2;
			font-size: 1.375rem;
			color: var(--text-gedaempft);
		}
		.titel {
			font-weight: 600;
		}
		.zusatz {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		jf-karte p + button {
			margin-top: var(--a3);
		}
		.fehler {
			color: var(--fehler);
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
	`,
})
export class MedienComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(DateienApi);
	private readonly router = inject(Router);

	protected readonly fehlertext = fehlertext;
	protected readonly nichtGefunden = fehlertextNichtGefunden;

	private readonly ressource = rxResource({
		params: () => ({ slug: this.slug() }),
		stream: ({ params }) => this.api.dokumente(params.slug),
	});
	private readonly fehlerRoh = fehlerVon(this.ressource);

	/** Gesetzt, sobald der Fehler zur Anmeldung schickt; dann zeigt die Seite keinen Fehlerblock mehr. */
	private readonly abgelaufen = signal(false);
	protected readonly fehler = computed(() => (this.abgelaufen() ? null : this.fehlerRoh()));

	/**
	 * undefined, solange nichts geladen ist. Kategorien ohne Dokument fallen weg (siehe oben); ist
	 * danach nichts uebrig, zeigt die Vorlage den Leertext.
	 */
	protected readonly kategorien = computed(() => {
		if (!this.ressource.hasValue()) return undefined;
		return this.ressource.value().kategorien.filter((k) => k.dokumente.length > 0);
	});

	constructor() {
		// Der Waechter prueft die Sitzung nur beim Betreten; ein 401 danach schickt zur Anmeldung (wie die Termine).
		effect(() => {
			const f = this.fehlerRoh();
			if (f === null || !istNichtAngemeldet(f)) return;
			untracked(() => {
				if (this.abgelaufen()) return;
				this.abgelaufen.set(true);
				void beiAbgelaufenerSitzung(this.router, this.slug(), f);
			});
		});
	}

	protected kuerzel(typ: string): string {
		return KUERZEL.get(typ) ?? 'Datei';
	}

	protected groesse(bytes: number): string {
		return speicherText(bytes);
	}

	protected imBrowser(d: DokumentAnsicht): boolean {
		return IM_BROWSER.has(d.typ);
	}

	protected adresse(d: DokumentAnsicht): string {
		return this.api.dateiAdresse(this.slug(), d.dateiId, !this.imBrowser(d));
	}

	protected neuVersuchen(): void {
		this.ressource.reload();
	}
}
