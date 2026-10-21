import {
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	inject,
	input,
	signal,
	untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import type { ThreadListe } from '@jufi/domain';
import { fehlertext, fehlertextNichtGefunden, fehlerVon } from '../../gemeinsam/api-fehler';
import { AbschnittComponent, KarteComponent } from '../../gestaltung/ui';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from '../sitzung-abgelaufen';
import { ThreadApi } from './thread-api';
import { ThreadUebersicht } from './thread-uebersicht';

/** So lange wartet die Suche nach dem letzten Tastendruck; kurz genug, um sich direkt anzufuehlen, lang genug fuer eine Anfrage je Wort. */
const ENTPRELLEN_MS = 300;

/** Der Server nimmt hoechstens 100 Zeichen (sonst 400); das Feld verhindert den Fehler, statt ihn zu zeigen. */
const MAX_SUCHE = 100;

/** value() wirft im Fehlerzustand; hasValue() fragt gefahrlos. */
function wertVon<T>(ressource: { hasValue: () => boolean; value: () => T }): T | undefined {
	return ressource.hasValue() ? ressource.value() : undefined;
}

/**
 * Die Seite Threads (Spec 6.5): Angepinnt, Aktiv und das eingeklappte Archiv, darueber die Suche.
 *
 * Den Grundzustand (keine Suche, Archiv zu) liefert die Liste der Huelle (ThreadUebersicht): Sie
 * fragt ohnehin fuer den Punkt an der Leiste, und eine zweite Anfrage der Seite koennte eine andere
 * Antwort bringen. Alles, was mehr braucht, haengt an einer eigenen Ressource, die nur laeuft, wenn
 * das Archiv aufgeklappt oder gesucht wird. Sie fragt immer mit archiv=1: Bei einer Suche muss ein
 * archivierter Treffer zu finden sein (Spec 1.1), und das Aufklappen soll nicht ein zweites Mal
 * fragen, wenn schon gesucht wurde. Verworfen: Archiv und Suche je mit eigener Ressource, das waeren
 * zwei Antworten auf dieselbe Frage nach den archivierten Treffern.
 */
@Component({
	selector: 'jf-thread-liste',
	imports: [AbschnittComponent, KarteComponent, NgTemplateOutlet, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Threads</h1>

		<label class="feld">
			<span>Threads durchsuchen</span>
			<input
				type="search"
				autocomplete="off"
				enterkeyhint="search"
				[maxLength]="maxSuche"
				[value]="eingabe()"
				(input)="tippe($event)"
			/>
		</label>

		<!-- Eine Zeile fuer alle drei Abschnitte; verworfen: dreimal dasselbe Markup, das beim naechsten Merkmal auseinanderliefe. -->
		<ng-template #reihe let-t>
			<li>
				<a class="reihe" [routerLink]="['/', slug(), 't', t.segment]">
					<span class="text">
						<span class="titel"
							>{{ t.titel }}
							@if (t.entwurf) {
								· Entwurf
							}
						</span>
						@if (t.naechsterTermin) {
							<span class="termin">{{ t.naechsterTermin }}</span>
						}
					</span>
					@if (t.neu) {
						<span class="punkt" role="img" aria-label="neu"></span>
					}
				</a>
			</li>
		</ng-template>

		@if (fehler(); as f) {
			<jf-karte>
				@if (f.status === 404) {
					<p>{{ nichtGefunden(f) }}</p>
				} @else {
					<p class="fehler" role="alert">{{ fehlertext(f) }}</p>
					<button type="button" class="knopf primaer" (click)="neuVersuchen()">Nochmal versuchen</button>
				}
			</jf-karte>
		} @else if (haupt(); as h) {
			@if (angepinnt().length > 0) {
				<jf-abschnitt titel="Angepinnt">
					<ul>
						@for (t of angepinnt(); track t.id) {
							<ng-container [ngTemplateOutlet]="reihe" [ngTemplateOutletContext]="{ $implicit: t }" />
						}
					</ul>
				</jf-abschnitt>
			}
			@if (aktiv().length > 0) {
				<jf-abschnitt titel="Aktiv">
					<ul>
						@for (t of aktiv(); track t.id) {
							<ng-container [ngTemplateOutlet]="reihe" [ngTemplateOutletContext]="{ $implicit: t }" />
						}
					</ul>
				</jf-abschnitt>
			}
			@if (h.archiv > 0) {
				<details class="archiv" [open]="archivAuf()" (toggle)="beimUmschalten($event)">
					<summary>Archiv · {{ h.archiv }}</summary>
					@if (archivFehler(); as f) {
						<p class="fehler" role="alert">{{ fehlertext(f) }}</p>
						<button type="button" class="knopf" (click)="neuVersuchen()">Nochmal versuchen</button>
					} @else if (!archivGeladen()) {
						<p class="gedaempft" role="status">Wird geladen …</p>
					} @else {
						<ul>
							@for (t of archivZeilen(); track t.id) {
								<ng-container [ngTemplateOutlet]="reihe" [ngTemplateOutletContext]="{ $implicit: t }" />
							}
						</ul>
					}
				</details>
			}
			@if (angepinnt().length === 0 && aktiv().length === 0 && h.archiv === 0) {
				<jf-karte>
					<p class="gedaempft">{{ suchbegriff() ? 'Keine Treffer.' : 'Noch keine Threads.' }}</p>
				</jf-karte>
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
		p,
		ul {
			margin: 0;
		}
		h1 {
			font-size: var(--schrift-gross);
		}
		ul {
			display: grid;
			gap: var(--a2);
			padding: 0;
			list-style: none;
		}
		jf-karte p + button {
			margin-top: var(--a3);
		}
		.reihe {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--a3);
			min-height: var(--tippflaeche);
			padding: var(--a3) var(--a4);
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			color: var(--text);
			text-decoration: none;
		}
		.text {
			display: grid;
			gap: var(--a1);
			min-width: 0;
		}
		.titel {
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.termin {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		/* Wie der Punkt der Leiste, nur ohne Ring: Die Zeile hat einen einfarbigen Grund. */
		.punkt {
			flex: none;
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background: var(--akzent);
		}
		.archiv {
			display: grid;
		}
		.archiv[open] summary {
			margin-bottom: var(--a2);
		}
		summary {
			display: flex;
			align-items: center;
			min-height: var(--tippflaeche);
			cursor: pointer;
			font-size: var(--schrift-klein);
			font-weight: 700;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--text-gedaempft);
		}
		.fehler {
			color: var(--fehler);
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
	`,
})
export class ThreadListeComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	/** Die Suche aus der Adresse (?suche=); so fuehrt ein geteilter Link und der Zurueck-Pfeil aus einem Thread zur selben Suche. */
	readonly suche = input<string | undefined>(undefined);

	private readonly api = inject(ThreadApi);
	private readonly uebersicht = inject(ThreadUebersicht);
	private readonly router = inject(Router);

	protected readonly maxSuche = MAX_SUCHE;
	protected readonly fehlertext = fehlertext;
	protected readonly nichtGefunden = fehlertextNichtGefunden;

	/** Der Text im Feld, sofort; suchbegriff folgt nach der Pause. */
	protected readonly eingabe = signal('');
	/** Was gesucht wird: getrimmt, leer heisst keine Suche. */
	protected readonly suchbegriff = signal('');
	protected readonly archivAuf = signal(false);
	/**
	 * Ob jemand das Archiv aufgeklappt hat und damit die Archivzeilen braucht. Bleibt nach dem Zuklappen
	 * stehen, damit das erneute Aufklappen nicht noch einmal fragt (verworfen: bei jedem Aufklappen neu
	 * laden, die Zeilen sind wenige Sekunden alt).
	 */
	private readonly archivAngefordert = signal(false);

	/**
	 * Die Anfrage mit Archiv; ohne Suche und ohne aufgeklapptes Archiv ruht sie. Gleich ist gleich:
	 * Ohne equal erzeugte jedes Auf- und Zuklappen waehrend einer Suche ein neues Objekt und damit
	 * dieselbe Anfrage noch einmal.
	 */
	private readonly erweiterteAbfrage = computed(
		() =>
			this.suchbegriff() !== '' || this.archivAngefordert()
				? { slug: this.slug(), suche: this.suchbegriff() }
				: undefined,
		{ equal: (a, b) => a?.slug === b?.slug && a?.suche === b?.suche },
	);

	private readonly erweitert = rxResource({
		params: () => this.erweiterteAbfrage(),
		stream: ({ params }) =>
			this.api.liste(params.slug, { ...(params.suche ? { suche: params.suche } : {}), archiv: true }),
	});

	private readonly grundFehlerRoh = fehlerVon(this.uebersicht.liste);
	private readonly erweitertFehlerRoh = fehlerVon(this.erweitert);

	/** Gesetzt, sobald ein Fehler zur Anmeldung schickt; dann zeigt die Seite keinen Fehlerblock mehr. */
	private readonly abgelaufen = signal(false);

	/** Mit Suche die Antwort der erweiterten Ressource (die Abschnitte kommen aus ihr), sonst die Liste der Huelle. */
	protected readonly haupt = computed<ThreadListe | undefined>(() =>
		this.suchbegriff() ? wertVon(this.erweitert) : wertVon(this.uebersicht.liste),
	);

	protected readonly fehler = computed(() => {
		if (this.abgelaufen()) return null;
		return this.suchbegriff() ? this.erweitertFehlerRoh() : this.grundFehlerRoh();
	});

	/** Ohne Suche scheitert nur das Archiv; die Liste darueber bleibt stehen. Mit Suche ist es der Fehler der ganzen Seite. */
	protected readonly archivFehler = computed(() =>
		this.suchbegriff() || this.abgelaufen() ? null : this.erweitertFehlerRoh(),
	);
	protected readonly archivGeladen = computed(() => this.erweitert.hasValue());

	private readonly aktive = computed(() => (this.haupt()?.threads ?? []).filter((t) => !t.archiviert));
	protected readonly angepinnt = computed(() => this.aktive().filter((t) => t.angepinnt));
	protected readonly aktiv = computed(() => this.aktive().filter((t) => !t.angepinnt));
	protected readonly archivZeilen = computed(() =>
		(wertVon(this.erweitert)?.threads ?? []).filter((t) => t.archiviert),
	);

	/** Was zuletzt in der Adresse stand oder dorthin geschrieben wurde; erkennt, ob eine Aenderung der Adresse von aussen kommt. */
	private urlStand = '';
	private zeitgeber: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		inject(DestroyRef).onDestroy(() => clearTimeout(this.zeitgeber));

		// Nur eine Adresse, die wir nicht selbst geschrieben haben, ueberschreibt das Feld: Sonst setzte die
		// Antwort der eigenen Navigation den Text zurueck, den die Person inzwischen weitergetippt hat.
		// Von aussen kommen der Aufruf mit ?suche= und Vor und Zurueck im Browser; beide suchen sofort.
		effect(() => {
			const roh = this.suche() ?? '';
			untracked(() => {
				const wert = roh.trim();
				if (wert === this.urlStand) return;
				this.urlStand = wert;
				clearTimeout(this.zeitgeber);
				this.eingabe.set(roh);
				this.setzeSuche(wert);
			});
		});

		// Der Waechter prueft die Sitzung nur beim Betreten; ein 401 danach schickt zur Anmeldung (wie die Startseite).
		effect(() => {
			const fehler = [this.grundFehlerRoh(), this.erweitertFehlerRoh()].find(
				(f) => f !== null && istNichtAngemeldet(f),
			);
			if (!fehler) return;
			untracked(() => {
				// Vor dem await gesetzt: Zwei Ressourcen, die zugleich 401 bekommen, navigierten sonst beide.
				if (this.abgelaufen()) return;
				this.abgelaufen.set(true);
				void beiAbgelaufenerSitzung(this.router, this.slug(), fehler);
			});
		});
	}

	protected tippe(ereignis: Event): void {
		const roh = (ereignis.target as HTMLInputElement).value;
		this.eingabe.set(roh);
		clearTimeout(this.zeitgeber);
		this.zeitgeber = setTimeout(() => this.uebernimm(roh), ENTPRELLEN_MS);
	}

	protected beimUmschalten(ereignis: Event): void {
		const offen = (ereignis.target as HTMLDetailsElement).open;
		this.archivAuf.set(offen);
		if (offen) this.archivAngefordert.set(true);
	}

	protected neuVersuchen(): void {
		if (this.suchbegriff() || this.archivFehler()) this.erweitert.reload();
		else this.uebersicht.neuLaden();
	}

	/**
	 * Schreibt die Suche in die Adresse (replaceUrl: Jeder Buchstabe soll keinen Eintrag im Verlauf
	 * machen, sonst fuehrte Zurueck durch das Wort statt von der Seite weg) und stellt die Ansicht um.
	 */
	private uebernimm(roh: string): void {
		const wert = roh.trim();
		if (wert === this.suchbegriff()) return;
		this.urlStand = wert;
		this.setzeSuche(wert);
		void this.router.navigate([], {
			queryParams: { suche: wert || null },
			queryParamsHandling: 'merge',
			replaceUrl: true,
		});
	}

	/**
	 * Eine Suche klappt das Archiv auf, damit archivierte Treffer nicht hinter dem Zuklappen liegen;
	 * ohne Suche ist wieder Grundzustand mit zugeklapptem Archiv und der Liste der Huelle, ohne neue
	 * Anfrage (verworfen: ein offenes Archiv ueber die Suche hinaus mitnehmen, dafuer fehlten die Zeilen).
	 */
	private setzeSuche(wert: string): void {
		const vorher = this.suchbegriff();
		this.suchbegriff.set(wert);
		if (wert && !vorher) this.archivAuf.set(true);
		if (!wert && vorher) {
			this.archivAuf.set(false);
			this.archivAngefordert.set(false);
		}
	}
}
