import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	Injector,
	input,
	signal,
	untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
	berlinerTag,
	markierteTage,
	monatAus,
	MONATSNAMEN,
	monatsRaster,
	nachbarMonat,
	type TerminZeile,
	terminZeit,
} from '@jufi/domain';
import { fehlertext, fehlertextNichtGefunden, fehlerVon } from '../gemeinsam/api-fehler';
import { IconComponent } from '../gestaltung/icon';
import { KarteComponent } from '../gestaltung/ui';
import { Echtzeit, type EchtzeitEreignis } from './echtzeit';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from './sitzung-abgelaufen';
import { nachlader } from './threads/nachladen';
import { ThreadApi } from './threads/thread-api';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** value() wirft im Fehlerzustand; hasValue() fragt gefahrlos. */
function wertVon<T>(ressource: { hasValue: () => boolean; value: () => T }): T | undefined {
	return ressource.hasValue() ? ressource.value() : undefined;
}

/**
 * Nachrichten und Antworten aendern keinen Termin: Die Seite zeigt nur Zeit, Ort und Titel, und
 * Zusagen stehen nicht darin. Alles andere kann es (Modul, Titel, Zielgruppe, Archiv, Loeschen,
 * Umfeld, Abgleich). Verworfen: auf jedes Ereignis neu laden wie die Liste; in einem lebhaften
 * Chat fragte die Seite dann je Nachricht den ganzen Monat ab.
 */
function aendertTermine(e: EchtzeitEreignis): boolean {
	return e.typ !== 'signal' || (e.signal.art !== 'VERLAUF' && e.signal.art !== 'ANTWORT');
}

function monatsSchluessel(jahr: number, monat: number): string {
	return `${jahr}-${String(monat).padStart(2, '0')}`;
}

/**
 * Die Seite Termine (Spec 6.5): ein Monatsraster mit markierten Tagen, darunter die Termine des Monats.
 *
 * Der Monat steht in der Adresse (?monat=JJJJ-MM, Plan-Entscheidung 9), nicht im Zustand des Bauteils:
 * Wer aus einem Thread zurueckgeht, kommt in denselben Monat, und ein geteilter Link zeigt ihn auch.
 * Das Blaettern ist darum eine Navigation mit eigenem Verlaufseintrag; verworfen: replaceUrl, dann
 * fuehrte Zurueck aus dem Monat gleich von der Seite weg, statt einen Monat zurueck.
 *
 * Das Raster ist eine schlichte Tabelle und seine Felder tun nichts: Ein Tipp auf einen Tag fuehrte
 * bei mehreren Terminen oder keinem ins Leere. Wohin ein Termin gehoert, sagt die Liste darunter,
 * deren Zeilen in den Thread fuehren. Der Server liefert die Termine des Monats schon gefiltert und
 * sortiert; das Bauteil markiert und zeigt nur an.
 */
@Component({
	selector: 'jf-termine',
	imports: [IconComponent, KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Termine</h1>

		<div class="kopf">
			<button type="button" class="knopf nur-icon" aria-label="Voriger Monat" (click)="blaettere(-1)">
				<jf-icon name="zurueck" />
			</button>
			<h2 id="monat-ueberschrift">{{ ueberschrift() }}</h2>
			<button type="button" class="knopf nur-icon" aria-label="Nächster Monat" (click)="blaettere(1)">
				<jf-icon name="vor" />
			</button>
		</div>

		<table aria-labelledby="monat-ueberschrift">
			<thead>
				<tr>
					@for (w of wochentage; track w) {
						<th scope="col">{{ w }}</th>
					}
				</tr>
			</thead>
			<tbody>
				@for (woche of wochen(); track $index) {
					<tr>
						@for (f of woche; track $index) {
							<td [class.markiert]="f.markiert" [attr.aria-current]="f.heute ? 'date' : null">
								@if (f.nummer) {
									<span class="nr">{{ f.nummer }}</span>
									@if (f.markiert) {
										<!-- Der Punkt allein sagt es nur mit Farbe; der Text ist fuer Vorlesegeraete. -->
										<span class="unsichtbar"> Termin</span>
										<span class="punkt" aria-hidden="true"></span>
									}
								}
							</td>
						}
					</tr>
				}
			</tbody>
		</table>

		@if (fehler(); as f) {
			<jf-karte>
				@if (f.status === 404) {
					<p>{{ nichtGefunden(f) }}</p>
				} @else {
					<p class="fehler" role="alert">{{ fehlertext(f) }}</p>
					<button type="button" class="knopf primaer" (click)="neuVersuchen()">Nochmal versuchen</button>
				}
			</jf-karte>
		} @else if (antwort(); as a) {
			@if (a.length > 0) {
				<ul>
					@for (t of zeilen(); track t.schluessel) {
						<li>
							<a class="reihe" [routerLink]="['/', slug(), 't', t.segment, 'm', t.modulId]">
								<span class="titel">{{ t.titel }}</span>
								<span class="zusatz">{{ t.zusatz }}</span>
							</a>
						</li>
					}
				</ul>
			} @else {
				<p class="gedaempft">Keine Termine in diesem Monat.</p>
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
			text-align: center;
		}
		.kopf {
			display: grid;
			grid-template-columns: var(--tippflaeche) 1fr var(--tippflaeche);
			align-items: center;
			gap: var(--a2);
		}
		/* Feste Spaltenbreite statt Inhaltsbreite: Sieben gleich breite Spalten passen auch in 375 px. */
		table {
			width: 100%;
			table-layout: fixed;
			border-collapse: collapse;
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
		}
		th {
			padding: var(--a2) 0;
			font-size: var(--schrift-klein);
			font-weight: 700;
			color: var(--text-gedaempft);
		}
		td {
			height: 44px;
			padding: var(--a1) 0;
			text-align: center;
			vertical-align: top;
		}
		.nr {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 28px;
			height: 28px;
			border-radius: var(--radius-pille);
		}
		td[aria-current='date'] .nr {
			background: var(--akzent);
			color: var(--auf-akzent);
			font-weight: 700;
		}
		.punkt {
			display: block;
			width: 6px;
			height: 6px;
			margin: 0 auto;
			border-radius: 50%;
			background: var(--akzent);
		}
		ul {
			display: grid;
			gap: var(--a2);
			padding: 0;
			list-style: none;
		}
		.reihe {
			display: grid;
			gap: var(--a1);
			min-height: var(--tippflaeche);
			padding: var(--a3) var(--a4);
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			color: var(--text);
			text-decoration: none;
			overflow-wrap: anywhere;
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
export class TermineComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	/**
	 * JJJJ-MM aus der Adresse; fehlt er oder ist er ungueltig, gilt der aktuelle Monat. Ein
	 * wiederholter Parameter (?monat=a&monat=b) kommt als Liste an und gilt als fehlend, statt dass
	 * erst das Muster in monatAus ihn zufaellig verwirft.
	 */
	readonly monat = input<string | string[] | undefined>(undefined);

	private readonly api = inject(ThreadApi);
	private readonly router = inject(Router);

	protected readonly wochentage = WOCHENTAGE;
	protected readonly fehlertext = fehlertext;
	protected readonly nichtGefunden = fehlertextNichtGefunden;

	/**
	 * Die Uhr liest das Bauteil einmal beim Anlegen, nicht im Signalgraphen: "heute" und der
	 * Vorgabemonat haengen am Berliner Tag, und eine Uhr, die sich selbst fortschriebe, lieferte der
	 * Seite nur nach, was sie mitten im Blaettern ohnehin nicht braucht (verworfen: ein Intervall).
	 * Wer die Seite ueber Mitternacht offen laesst, sieht bis zum naechsten Aufruf den alten Tag.
	 * Berlin statt der Zeitzone des Geraets: Der Verein lebt dort, und um 00:30 am 1. soll nicht
	 * noch der alte Monat stehen.
	 */
	private readonly heute = berlinerTag(new Date());

	private readonly gewaehlt = computed(() => {
		const monat = this.monat();
		const aus = monatAus(typeof monat === 'string' ? monat : '') ?? monatAus(this.heute.slice(0, 7));
		// Nur fuer den Typ: heute ist immer ein gueltiges Datum, der zweite Zweig also nicht erreichbar.
		return aus ?? { jahr: 1970, monat: 1 };
	});
	private readonly schluessel = computed(() => monatsSchluessel(this.gewaehlt().jahr, this.gewaehlt().monat));

	protected readonly ueberschrift = computed(() => `${MONATSNAMEN[this.gewaehlt().monat - 1]} ${this.gewaehlt().jahr}`);

	private readonly ressource = rxResource({
		params: () => ({ slug: this.slug(), monat: this.schluessel() }),
		stream: ({ params }) => this.api.termine(params.slug, params.monat),
	});
	private readonly fehlerRoh = fehlerVon(this.ressource);
	private readonly nachladen = nachlader(this.ressource, inject(Injector));

	/** Gesetzt, sobald der Fehler zur Anmeldung schickt; dann zeigt die Seite keinen Fehlerblock mehr. */
	private readonly abgelaufen = signal(false);
	protected readonly fehler = computed(() => (this.abgelaufen() ? null : this.fehlerRoh()));

	/** undefined, solange nichts geladen ist; das Raster steht trotzdem schon da, nur ohne Markierungen. */
	protected readonly antwort = computed<TerminZeile[] | undefined>(() => wertVon(this.ressource)?.termine);

	protected readonly wochen = computed(() => {
		const { jahr, monat } = this.gewaehlt();
		const markiert = markierteTage(this.antwort() ?? [], jahr, monat);
		const felder = monatsRaster(jahr, monat).map((tag) => ({
			nummer: tag ? Number(tag.slice(8, 10)) : null,
			markiert: tag !== null && markiert.has(tag),
			heute: tag === this.heute,
		}));
		const wochen: (typeof felder)[] = [];
		for (let i = 0; i < felder.length; i += 7) wochen.push(felder.slice(i, i + 7));
		return wochen;
	});

	/** Der Ort steht als Text, nicht als Karten-Link: Die ganze Zeile ist schon ein Link (Termin-Modul hat die Karte). */
	protected readonly zeilen = computed(() =>
		(this.antwort() ?? []).map((t) => ({
			schluessel: `${t.threadId}/${t.termin.modulId}`,
			segment: t.segment,
			modulId: t.termin.modulId,
			titel: t.titel,
			zusatz: [terminZeit(t.termin), t.termin.ort].filter(Boolean).join(' · '),
		})),
	);

	constructor() {
		inject(Echtzeit)
			.ereignisse.pipe(takeUntilDestroyed())
			.subscribe((e) => {
				if (aendertTermine(e)) this.nachladen();
			});

		// Der Waechter prueft die Sitzung nur beim Betreten; ein 401 danach schickt zur Anmeldung (wie die Startseite).
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

	protected blaettere(schritt: -1 | 1): void {
		const { jahr, monat } = this.gewaehlt();
		const neu = nachbarMonat(jahr, monat, schritt);
		void this.router.navigate([], {
			queryParams: { monat: monatsSchluessel(neu.jahr, neu.monat) },
			replaceUrl: false,
		});
	}

	protected neuVersuchen(): void {
		this.ressource.reload();
	}
}
