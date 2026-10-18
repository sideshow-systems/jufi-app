import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { initialen } from '@jufi/domain';
import { map } from 'rxjs';
import { type ApiFehler, fehlerVon, fehlertext } from '../gemeinsam/api-fehler';
import { AbschnittComponent, KarteComponent } from '../gestaltung/ui';
import { type Ansprechpartner, type KindAnsicht, MitgliederApi, type PersonListe } from './mitglieder-api';
import { MitgliedSitzung } from './mitglied-waechter';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from './sitzung-abgelaufen';
import { warnhinweisText } from './verwaltung/texte';
import { VereinKontext } from './verein-kontext';

/** So viele Namen nennt der Abschnitt der Verwaltung; der Rest steht hinter dem Link. */
const MAX_NAMEN = 5;

/**
 * Was in der Verwaltung wartet: offene Einladungen und Personen mit einem Hinweis. Eine
 * offene Einladung zaehlt nicht als Hinweis, sie hat ihre eigene Zeile; sonst stuende jede
 * eingeladene Person doppelt da. Rein, ohne Datum: Ob eine Einladung noch offen ist,
 * entscheidet der Server, wenn er den Hinweis ausgibt.
 */
export function wartet(personen: PersonListe[]): { offeneEinladungen: number; mitHinweis: PersonListe[] } {
	const hatArt = (p: PersonListe, art: string) => (p.warnhinweise ?? []).some((h) => h.art === art);
	return {
		offeneEinladungen: personen.filter((p) => hatArt(p, 'EINLADUNG_OFFEN')).length,
		mitHinweis: personen.filter((p) => (p.warnhinweise ?? []).some((h) => h.art !== 'EINLADUNG_OFFEN')),
	};
}

/**
 * Der Zugangsstand eines Kindes in drei Saetzen. Entscheidend ist erlaubt: Nach einem Entzug
 * kann ein Zugang noch bestehen, gilt aber nicht und soll nicht als eingerichtet erscheinen.
 * Eine fehlende Einwilligung ist kein eigener Satz, weil die Familie sie unter Meine
 * Jungfischer sieht und behebt; die Startseite soll nur den Stand zeigen.
 */
export function zugangsstand(zugang: KindAnsicht['zugang']): string {
	if (!zugang.erlaubt) return 'Ohne eigenen Zugang';
	return zugang.vorhanden ? 'Eigener Zugang eingerichtet' : 'Zugang erlaubt, noch nicht eingerichtet';
}

/** Der erste Hinweis, der keine offene Einladung ist (nach dem sich auch wartet richtet). */
function ersterHinweis(p: PersonListe): string {
	const h = (p.warnhinweise ?? []).find((w) => w.art !== 'EINLADUNG_OFFEN');
	return h ? warnhinweisText(h) : '';
}

/** value() wirft im Fehlerzustand; hasValue() fragt gefahrlos. */
function wertVon<T>(ressource: { hasValue: () => boolean; value: () => T }): T | undefined {
	return ressource.hasValue() ? ressource.value() : undefined;
}

/**
 * Startseite der Mitglieder: Begruessung, die eigenen Jungfischer, was in der Verwaltung
 * wartet und die Ansprechpartner. Jeder Abschnitt holt seine Daten selbst und scheitert
 * allein; verworfen: ein gemeinsamer Aufruf (forkJoin), bei dem ein Netzfehler im
 * Abschnitt Ansprechpartner auch die Begruessung und die Kinder mitnaehme.
 */
@Component({
	selector: 'jf-start',
	imports: [AbschnittComponent, KarteComponent, NgTemplateOutlet, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (sitzung.ich(); as ich) {
			<jf-karte>
				<div class="gruss">
					@if (verein(); as v) {
						@if (kontext.logoUrl(); as logo) {
							<img [src]="logo" alt="" width="64" height="64" />
						} @else {
							<span class="abzeichen" aria-hidden="true">{{ initialen(v.anzeigename) }}</span>
						}
					}
					<div class="namen">
						<h1>Hallo {{ ich.person.vorname }}</h1>
						@if (verein(); as v) {
							<p>{{ v.anzeigename }}</p>
						}
					</div>
				</div>
			</jf-karte>
		}

		<!-- Ein Block fuer alle drei Abschnitte; verworfen: dreimal dasselbe Markup, das beim naechsten Abschnitt auseinanderliefe. -->
		<ng-template #fehlerblock let-f let-neu="neu">
			<p class="fehler" role="alert">{{ fehlertext(f) }}</p>
			<button type="button" class="knopf" (click)="neu()">Nochmal versuchen</button>
		</ng-template>

		@if (sitzung.ich()?.hatKinder) {
			<jf-abschnitt titel="Deine Jungfischer">
				@if (kinderFehler(); as f) {
					<jf-karte>
						<ng-container
							[ngTemplateOutlet]="fehlerblock"
							[ngTemplateOutletContext]="{ $implicit: f, neu: neuKinder }"
						/>
					</jf-karte>
				} @else if (!kinderRessource.hasValue()) {
					<jf-karte><p class="gedaempft">Wird geladen …</p></jf-karte>
				} @else {
					@for (k of kinder(); track k.id) {
						<jf-karte>
							<!-- Die ganze Karte ist der Link: Eine kleine Schaltflaeche darin waere am Handy schwerer zu treffen. -->
							<a class="verweis" [routerLink]="['/', slug(), 'meine-jungfischer']">
								<strong>{{ k.vorname }} {{ k.nachname }}</strong>
								@if (k.jugendsprecher) {
									<span class="zeile">Jugendsprecher/in</span>
								}
								@if (k.untergruppen.length > 0) {
									<span class="zeile">{{ untergruppen(k) }}</span>
								}
								<span class="zeile">{{ zugangsstand(k.zugang) }}</span>
							</a>
						</jf-karte>
					} @empty {
						<jf-karte><p class="gedaempft">Es sind keine Jungfischer mit dir verbunden.</p></jf-karte>
					}
				}
			</jf-abschnitt>
		}

		@if (zeigeVerwaltung()) {
			<jf-abschnitt titel="In der Verwaltung warten">
				<jf-karte>
					@if (verwaltungFehler(); as f) {
						<ng-container
							[ngTemplateOutlet]="fehlerblock"
							[ngTemplateOutletContext]="{ $implicit: f, neu: neuPersonen }"
						/>
					} @else if (warten(); as w) {
						@if (w.offeneEinladungen === 0 && w.mitHinweis.length === 0) {
							<p>Gerade wartet nichts.</p>
						} @else {
							@if (w.offeneEinladungen > 0) {
								<p>
									{{ w.offeneEinladungen === 1 ? '1 offene Einladung' : w.offeneEinladungen + ' offene Einladungen' }}
								</p>
							}
							@if (w.mitHinweis.length > 0) {
								<p>
									{{
										w.mitHinweis.length === 1 ? '1 Person mit Hinweis' : w.mitHinweis.length + ' Personen mit Hinweis'
									}}
								</p>
								<ul>
									@for (p of namen(w.mitHinweis); track p.id) {
										<li>
											<strong>{{ p.vorname }} {{ p.nachname }}</strong>
											<span class="zeile">{{ hinweis(p) }}</span>
										</li>
									}
								</ul>
							}
						}
						<a class="knopf" [routerLink]="['/', slug(), 'verwaltung']">Zur Verwaltung</a>
					} @else {
						<p class="gedaempft">Wird geladen …</p>
					}
				</jf-karte>
			</jf-abschnitt>
		}

		<jf-abschnitt titel="Ansprechpartner">
			<jf-karte>
				@if (ansprechpartnerFehler(); as f) {
					<ng-container
						[ngTemplateOutlet]="fehlerblock"
						[ngTemplateOutletContext]="{ $implicit: f, neu: neuAnsprechpartner }"
					/>
				} @else if (!ansprechpartnerRessource.hasValue()) {
					<p class="gedaempft">Wird geladen …</p>
				} @else {
					<ul>
						@for (a of ansprechpartner(); track a.id) {
							<li>{{ a.vorname }} {{ a.nachname }}</li>
						} @empty {
							<li class="gedaempft">Noch niemand eingetragen.</li>
						}
					</ul>
				}
			</jf-karte>
		</jf-abschnitt>
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
		.gruss {
			display: flex;
			align-items: center;
			gap: var(--a4);
		}
		.gruss img,
		.abzeichen {
			flex: none;
			width: 64px;
			height: 64px;
			border-radius: 14px;
		}
		.abzeichen {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			background: var(--akzent);
			color: var(--auf-akzent);
			font-size: var(--schrift-gross);
			font-weight: 700;
		}
		.namen {
			min-width: 0;
		}
		.namen p {
			color: var(--text-gedaempft);
			overflow-wrap: anywhere;
		}
		jf-karte p + p,
		jf-karte p + ul,
		jf-karte ul + a,
		jf-karte p + a,
		jf-karte p + button {
			margin-top: var(--a3);
		}
		ul {
			display: grid;
			gap: var(--a3);
			padding: 0;
			list-style: none;
		}
		li {
			display: grid;
			overflow-wrap: anywhere;
		}
		.verweis {
			display: grid;
			gap: var(--a1);
			min-height: var(--tippflaeche);
			color: inherit;
			text-decoration: none;
			overflow-wrap: anywhere;
		}
		.zeile {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		.fehler {
			color: var(--fehler);
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
	`,
})
export class StartComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	protected readonly kontext = inject(VereinKontext);
	private readonly mitglieder = inject(MitgliederApi);
	private readonly router = inject(Router);
	protected readonly sitzung = inject(MitgliedSitzung);
	protected readonly initialen = initialen;
	protected readonly zugangsstand = zugangsstand;
	protected readonly hinweis = ersterHinweis;

	/** Leer, solange der Verein laedt; Ladefehler und unbekannten Verein faengt die Huelle ab. */
	protected readonly verein = computed(() => {
		const v = this.kontext.verein();
		return v && v !== 'nicht-gefunden' ? v : null;
	});

	/**
	 * Nur MITGLIEDER: Betreuer lesen die Liste, sehen darin aber keine Warnhinweise und koennten
	 * nichts davon erledigen (Plan-Entscheidung 7). Ohne das Recht geht die Anfrage gar nicht erst
	 * raus; der Server wuerde sie zwar beantworten, aber der Abschnitt waere leer.
	 */
	protected readonly zeigeVerwaltung = computed(
		() => this.sitzung.ich()?.person.rechte.includes('MITGLIEDER') === true,
	);

	// Ohne Parameter ruht eine Ressource und schickt nichts: So entfaellt die Anfrage fuer Personen ohne Kinder.
	protected readonly kinderRessource = rxResource({
		params: () => (this.sitzung.ich()?.hatKinder ? this.slug() : undefined),
		stream: ({ params }) => this.mitglieder.meineJungfischer(params).pipe(map((a) => a.kinder)),
	});
	protected readonly personenRessource = rxResource({
		params: () => (this.zeigeVerwaltung() ? this.slug() : undefined),
		stream: ({ params }) => this.mitglieder.personen(params).pipe(map((a) => a.personen)),
	});
	protected readonly ansprechpartnerRessource = rxResource({
		params: () => this.slug(),
		stream: ({ params }) => this.mitglieder.ansprechpartner(params).pipe(map((a) => a.ansprechpartner)),
	});

	private readonly kinderFehlerRoh = fehlerVon(this.kinderRessource);
	private readonly verwaltungFehlerRoh = fehlerVon(this.personenRessource);
	private readonly ansprechpartnerFehlerRoh = fehlerVon(this.ansprechpartnerRessource);

	/** Gesetzt, sobald ein Abschnitt zur Anmeldung schickt; dann zeigt kein Abschnitt mehr einen Fehlerblock. */
	private readonly abgelaufen = signal(false);

	// Nach einem 401 bleibt die Seite noch kurz stehen; ein Fehlerblock mit Knopf waere dann falsch.
	protected readonly kinderFehler = computed(() => (this.abgelaufen() ? null : this.kinderFehlerRoh()));
	protected readonly verwaltungFehler = computed(() => (this.abgelaufen() ? null : this.verwaltungFehlerRoh()));
	protected readonly ansprechpartnerFehler = computed(() =>
		this.abgelaufen() ? null : this.ansprechpartnerFehlerRoh(),
	);
	protected readonly fehlertext = fehlertext;
	protected readonly neuKinder = () => this.kinderRessource.reload();
	protected readonly neuPersonen = () => this.personenRessource.reload();
	protected readonly neuAnsprechpartner = () => this.ansprechpartnerRessource.reload();

	protected readonly kinder = computed<KindAnsicht[]>(() => wertVon(this.kinderRessource) ?? []);
	protected readonly ansprechpartner = computed<Ansprechpartner[]>(() => wertVon(this.ansprechpartnerRessource) ?? []);
	/** Erst da, wenn die Liste geladen ist: Sonst stuende kurz "Gerade wartet nichts" da. */
	protected readonly warten = computed(() => {
		const personen = wertVon(this.personenRessource);
		return personen ? wartet(personen) : null;
	});

	constructor() {
		// Der Waechter prueft die Sitzung nur beim Betreten; ein Abschnitt, der danach 401 bekommt,
		// schickt zur Anmeldung statt einen Fehler zu zeigen (wie die Seite Meine Jungfischer).
		effect(() => {
			const fehler = [this.kinderFehlerRoh(), this.verwaltungFehlerRoh(), this.ansprechpartnerFehlerRoh()];
			untracked(() => void this.pruefeAbgelaufen(fehler));
		});
	}

	protected untergruppen(k: KindAnsicht): string {
		return k.untergruppen.map((u) => u.name).join(', ');
	}

	protected namen(personen: PersonListe[]): PersonListe[] {
		return personen.slice(0, MAX_NAMEN);
	}

	private async pruefeAbgelaufen(fehler: (ApiFehler | null)[]): Promise<void> {
		const abgelaufen = fehler.find((f) => f !== null && istNichtAngemeldet(f));
		if (!abgelaufen || this.abgelaufen()) return;
		// Vor dem await gesetzt: Zwei Abschnitte, die gleichzeitig 401 bekommen, navigierten sonst beide.
		this.abgelaufen.set(true);
		await beiAbgelaufenerSitzung(this.router, this.slug(), abgelaufen);
	}
}
