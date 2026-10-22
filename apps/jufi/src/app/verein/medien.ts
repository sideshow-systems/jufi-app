import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { speicherText, type MedienBlock } from '@jufi/domain';
import { fehlertext, fehlertextNichtGefunden, fehlerVon } from '../gemeinsam/api-fehler';
import { IconComponent } from '../gestaltung/icon';
import { KarteComponent } from '../gestaltung/ui';
import { DateienApi } from './dateien-api';
import { dateiLink, typKuerzel } from './dateien-anzeige';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from './sitzung-abgelaufen';

type Reiter = 'fotos' | 'dokumente';

const REITER: readonly { wert: Reiter; text: string }[] = [
	{ wert: 'fotos', text: 'Fotos & Dateien' },
	{ wert: 'dokumente', text: 'Dokumente' },
];

/**
 * Die Seite Medien (TP4 Spec 3.1) mit zwei Reitern: "Fotos & Dateien" (Vorgabe) zeigt je Thread einen
 * Block mit den neuesten Fotos und den Dateien, "Dokumente" die globalen Dokumente des Vereins nach
 * Kategorien. Die Bloecke sind eine Uebersicht ohne Aenderungsknoepfe: Umbenennen, Loeschen und Hochladen
 * gibt es auf der Thread-Seite, "Zum Thread" fuehrt dorthin.
 *
 * Der Reiter steht im Query-Parameter reiter (Plan-Entscheidung 13), nicht in einem Signal: Wer aus einem
 * Thread mit "Zurueck" kommt, soll auf dem Reiter landen, den er verlassen hat, und ein geteilter Link
 * oeffnet denselben Reiter. Die Vorgabe hat keinen Parameter, sonst stuende er in jeder Adresse. Ein
 * Wechsel ersetzt den Eintrag im Verlauf (replaceUrl), wie die Suche der Thread-Liste: Zurueck soll von der
 * Seite wegfuehren und nicht durch die Reiter blaettern. Jeder Reiter laedt erst, wenn er offen ist;
 * verworfen: beide beim Betreten, denn die Dokumente brauchen die meisten Besuche nicht.
 *
 * Der Server liefert Kategorien und Dokumente schon in Anzeigereihenfolge und laesst leere Kategorien fuer
 * Mitglieder weg; die Seite zeigt nur an. Eine Kategorie ohne Dokument zeigt sie nie (auch nicht fuer
 * Pfleger, die hier nur lesen): Eine Ueberschrift ohne Inhalt sagt nichts.
 */
@Component({
	selector: 'jf-medien',
	imports: [IconComponent, KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Medien</h1>

		<div class="reiter" role="tablist" aria-label="Medien">
			@for (r of reiterListe; track r.wert) {
				<button
					type="button"
					role="tab"
					class="reiter-knopf"
					[id]="'medien-reiter-' + r.wert"
					[attr.aria-selected]="aktiv() === r.wert"
					[attr.aria-controls]="'medien-tafel'"
					[attr.tabindex]="aktiv() === r.wert ? 0 : -1"
					(click)="waehle(r.wert)"
					(keydown)="taste($event, r.wert)"
				>
					{{ r.text }}
				</button>
			}
		</div>

		<div class="tafel" role="tabpanel" id="medien-tafel" [attr.aria-labelledby]="'medien-reiter-' + aktiv()">
			@if (fehler(); as f) {
				<jf-karte>
					@if (f.status === 404) {
						<p>{{ nichtGefunden(f) }}</p>
					} @else {
						<p class="fehler" role="alert">{{ fehlertext(f) }}</p>
						<button type="button" class="knopf primaer" (click)="neuVersuchen()">Nochmal versuchen</button>
					}
				</jf-karte>
			} @else if (aktiv() === 'fotos') {
				@if (bloecke(); as liste) {
					@for (b of liste; track b.threadId) {
						<jf-karte data-block>
							<div class="block">
								<h2>
									<a [routerLink]="['/', slug(), 't', b.segment]">{{ b.titel }}</a>
									@if (b.archiviert) {
										<span class="archiv">Archiv</span>
									}
								</h2>
								@if (b.fotos > 0) {
									<ul class="vorschau">
										@for (id of b.vorschau; track id) {
											<li>
												<img [src]="api.vorschauAdresse(slug(), id)" alt="" loading="lazy" />
											</li>
										}
									</ul>
									<p class="zahl gedaempft">{{ fotoZahl(b.fotos) }}</p>
								}
								@if (b.dateien.length > 0) {
									<ul class="dateien">
										@for (d of b.dateien; track d.id) {
											<li>
												@let link = dateiLink(slug(), d);
												<a
													class="reihe"
													[href]="link.href"
													[attr.target]="link.neuerTab ? '_blank' : null"
													[attr.rel]="link.neuerTab ? 'noopener' : null"
												>
													<jf-icon name="dokument" />
													<span class="titel">{{ d.name }}</span>
													<span class="zusatz">{{ typKuerzel(d.typ) }} · {{ groesse(d.groesse) }}</span>
												</a>
											</li>
										}
									</ul>
									@if (b.weitereDateien > 0) {
										<p class="weitere gedaempft">und {{ b.weitereDateien }} weitere</p>
									}
								}
								<a class="knopf zum-thread" [routerLink]="['/', slug(), 't', b.segment]">Zum Thread</a>
							</div>
						</jf-karte>
					} @empty {
						<p class="gedaempft">Noch keine Fotos oder Dateien.</p>
					}
				} @else {
					<p class="gedaempft" role="status">Wird geladen …</p>
				}
			} @else if (kategorien(); as liste) {
				@for (k of liste; track k.id) {
					<section [attr.aria-labelledby]="'kat-' + k.id">
						<h2 [id]="'kat-' + k.id">{{ k.name }}</h2>
						<ul>
							@for (d of k.dokumente; track d.id) {
								<li>
									@let link = dateiLink(slug(), { id: d.dateiId, typ: d.typ });
									<a
										class="reihe"
										[href]="link.href"
										[attr.target]="link.neuerTab ? '_blank' : null"
										[attr.rel]="link.neuerTab ? 'noopener' : null"
									>
										<jf-icon name="dokument" />
										<span class="titel">{{ d.titel }}</span>
										<span class="zusatz">{{ typKuerzel(d.typ) }} · {{ groesse(d.groesse) }}</span>
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
		</div>
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
		.reiter {
			display: flex;
			gap: var(--a1);
			padding: var(--a1);
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius-pille);
		}
		.reiter-knopf {
			flex: 1 1 0;
			min-height: var(--tippflaeche);
			padding: 0 var(--a3);
			border: 0;
			border-radius: var(--radius-pille);
			background: transparent;
			color: var(--text-gedaempft);
			font: inherit;
			font-weight: 600;
		}
		.reiter-knopf[aria-selected='true'] {
			background: var(--akzent-flaeche);
			color: var(--akzent);
		}
		.tafel {
			display: grid;
			gap: var(--a4);
		}
		.block {
			display: grid;
			gap: var(--a3);
			justify-items: start;
		}
		.block > ul,
		.block .reihe {
			justify-self: stretch;
		}
		/* Der Titel darf umbrechen, das Kennzeichen steht hinter dem letzten Wort. */
		.block h2 {
			overflow-wrap: anywhere;
		}
		.block h2 a {
			color: var(--text);
		}
		.archiv {
			display: inline-block;
			margin-left: var(--a2);
			padding: 0 var(--a2);
			border-radius: var(--radius-pille);
			background: var(--akzent-flaeche);
			color: var(--akzent);
			font-size: var(--schrift-klein);
			font-weight: 600;
			vertical-align: middle;
		}
		/* Immer sechs Spalten mit minmax(0, 1fr): Die Reihe bleibt bei 375 px in der Karte, auch mit sechs Bildern. */
		.vorschau {
			grid-template-columns: repeat(6, minmax(0, 1fr));
			gap: var(--a1);
		}
		.vorschau img {
			display: block;
			width: 100%;
			aspect-ratio: 1;
			border-radius: var(--radius-klein);
			background: var(--linie);
			object-fit: cover;
		}
		.zahl,
		.weitere {
			font-size: var(--schrift-klein);
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

	protected readonly api = inject(DateienApi);
	private readonly router = inject(Router);

	/**
	 * Der Query-Parameter reiter (withComponentInputBinding); bei wiederholtem Parameter eine Liste.
	 * Alles ausser "dokumente" ist die Vorgabe: Ein veralteter oder erfundener Wert soll eine Seite
	 * zeigen und keinen Fehler.
	 */
	readonly reiter = input<string | string[] | undefined>(undefined);

	protected readonly reiterListe = REITER;
	protected readonly aktiv = computed<Reiter>(() => (this.reiter() === 'dokumente' ? 'dokumente' : 'fotos'));

	protected readonly dateiLink = dateiLink;
	protected readonly typKuerzel = typKuerzel;
	protected readonly fehlertext = fehlertext;
	protected readonly nichtGefunden = fehlertextNichtGefunden;

	private readonly medienRessource = rxResource({
		params: () => (this.aktiv() === 'fotos' ? { slug: this.slug() } : undefined),
		stream: ({ params }) => this.api.medien(params.slug),
	});
	private readonly dokumenteRessource = rxResource({
		params: () => (this.aktiv() === 'dokumente' ? { slug: this.slug() } : undefined),
		stream: ({ params }) => this.api.dokumente(params.slug),
	});
	private readonly medienFehler = fehlerVon(this.medienRessource);
	private readonly dokumenteFehler = fehlerVon(this.dokumenteRessource);
	/** Der Fehler des offenen Reiters; der andere Reiter laedt nicht und hat keinen. */
	private readonly fehlerRoh = computed(() =>
		this.aktiv() === 'fotos' ? this.medienFehler() : this.dokumenteFehler(),
	);

	/** Gesetzt, sobald der Fehler zur Anmeldung schickt; dann zeigt die Seite keinen Fehlerblock mehr. */
	private readonly abgelaufen = signal(false);
	protected readonly fehler = computed(() => (this.abgelaufen() ? null : this.fehlerRoh()));

	/** undefined, solange nichts geladen ist; ohne Threads mit Medien eine leere Liste (Leertext der Vorlage). */
	protected readonly bloecke = computed<MedienBlock[] | undefined>(() =>
		this.medienRessource.hasValue() ? this.medienRessource.value().bloecke : undefined,
	);

	/**
	 * undefined, solange nichts geladen ist. Kategorien ohne Dokument fallen weg (siehe oben); ist
	 * danach nichts uebrig, zeigt die Vorlage den Leertext.
	 */
	protected readonly kategorien = computed(() => {
		if (!this.dokumenteRessource.hasValue()) return undefined;
		return this.dokumenteRessource.value().kategorien.filter((k) => k.dokumente.length > 0);
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

	protected groesse(bytes: number): string {
		return speicherText(bytes);
	}

	protected fotoZahl(n: number): string {
		return `${n} ${n === 1 ? 'Foto' : 'Fotos'}`;
	}

	protected neuVersuchen(): void {
		(this.aktiv() === 'fotos' ? this.medienRessource : this.dokumenteRessource).reload();
	}

	protected waehle(reiter: Reiter): void {
		if (reiter === this.aktiv()) return;
		void this.router.navigate([], {
			queryParams: { reiter: reiter === 'dokumente' ? 'dokumente' : null },
			queryParamsHandling: 'merge',
			replaceUrl: true,
		});
	}

	/**
	 * Pfeiltasten wechseln den Reiter und nehmen den Fokus mit, Pos1 und Ende springen zum ersten und
	 * letzten (Muster der WAI-ARIA-Reiter). Der Fokus wandert sofort statt nach dem Rendern: Die Knoepfe
	 * bleiben beim Wechsel stehen, nur ihr Zustand aendert sich.
	 */
	protected taste(ereignis: KeyboardEvent, aktuell: Reiter): void {
		const i = REITER.findIndex((r) => r.wert === aktuell);
		const ziel =
			ereignis.key === 'ArrowRight'
				? (i + 1) % REITER.length
				: ereignis.key === 'ArrowLeft'
					? (i - 1 + REITER.length) % REITER.length
					: ereignis.key === 'Home'
						? 0
						: ereignis.key === 'End'
							? REITER.length - 1
							: -1;
		if (ziel < 0) return;
		ereignis.preventDefault();
		const knoepfe = (ereignis.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(
			'[role="tab"]',
		);
		knoepfe?.[ziel]?.focus();
		this.waehle(REITER[ziel].wert);
	}
}
