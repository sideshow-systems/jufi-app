import { NgTemplateOutlet } from '@angular/common';
import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	ElementRef,
	inject,
	Injector,
	input,
	output,
	signal,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
	type AutoEingabe,
	type FahrtAutoAnsicht,
	type FahrtModulAnsicht,
	type FahrtRichtungAnsicht,
	RICHTUNG_TEXT,
	type Richtung,
	tagKurz,
	undListe,
} from '@jufi/domain';
import { firstValueFrom, type Observable } from 'rxjs';
import { type ApiFehler, alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { BestaetigungComponent } from '../../admin/bestaetigung';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { AUTO_FELDER, type AutoFeld, FahrtAutoFormular, type AutoStart } from './fahrt-auto-formular';
import { ThreadApi } from './thread-api';

/** Eine Zeile mit einem Kind: im Auto, unter "Braucht noch Mitfahrt" oder unter "Kommt selbst". */
interface KindZeile {
	kindId: string;
	name: string;
	nichtMehrDabei: boolean;
	herausnehmen: boolean;
	umsetzen: boolean;
}

/** Ein eigenes Kind (oder die Person selbst), fuer das die Knoepfe stehen; name null heisst die Person selbst. */
interface Eigenes {
	kindId: string;
	name: string | null;
}

interface AutoKarte {
	auto: FahrtAutoAnsicht;
	info: string | null;
	frei: string;
	mitfahrer: KindZeile[];
	einsteigen: Eigenes[];
	aendern: boolean;
}

/** Eine Zeile der Auswahl beim Umsetzen: ein Auto mit Platz oder "Kommt selbst". */
interface Ziel {
	wert: string;
	text: string;
}

type Formular =
	| { art: 'auto'; autoId: string | null; zurueck: string; start: AutoStart }
	| { art: 'umsetzen'; kindId: string; name: string; zurueck: string };

type Rueckfrage = { autoId: string; text: string };

type FahrtAntwort = { modul: FahrtModulAnsicht };

// Der Wert der Auswahl fuer "Kommt selbst"; Auto-IDs sind Kennungen und kollidieren damit nicht.
const SELBST = 'selbst';

const REICHTUNGEN: readonly Richtung[] = ['HIN', 'RUECK'];
const REITER_TEXT: Readonly<Record<Richtung, string>> = { HIN: 'Hin', RUECK: 'Rück' };

/** Je Karte eine Nummer fuer die ids, falls mehrere Fahrgemeinschaften auf einer Seite stuenden. */
let nummer = 0;

const frei = (a: FahrtAutoAnsicht) => (a.frei > 0 ? `${a.frei} frei` : 'voll');

function wann(a: FahrtAutoAnsicht): string | null {
	const w = [a.abfahrtTag === null ? null : tagKurz(a.abfahrtTag), a.abfahrtZeit].filter(Boolean).join(' ');
	return w === '' ? null : w;
}

/**
 * Die Auswahl beim Umsetzen: die Autos der Richtung mit freiem Platz und "Kommt selbst", ohne das,
 * wo das Kind schon steht. Ein Umsetzen dorthin aendert nichts, und ein volles Auto wuerde der
 * Server mit VOLL abweisen. Dieselbe Liste entscheidet, ob der Knopf Umsetzen ueberhaupt steht.
 */
function zieleFuer(r: FahrtRichtungAnsicht, kindId: string): Ziel[] {
	const selbst = r.kommtSelbst.some((k) => k.kindId === kindId);
	const autos = r.autos
		.filter((a) => a.frei > 0 && !a.mitfahrer.some((m) => m.kindId === kindId))
		.map((a) => ({ wert: a.id, text: `${[a.fahrer, wann(a)].filter(Boolean).join(' – ')} (${frei(a)})` }));
	return selbst ? autos : [...autos, { wert: SELBST, text: 'Kommt selbst' }];
}

/**
 * Die Fahrgemeinschaft, wie der Server sie fuer die Person ausgerechnet hat (Spec 6.2): Platz,
 * Mitfahrer und jedes Recht je Auto und je Kind kommen fertig, die Karte entscheidet nichts davon
 * selbst. Nach einer Handlung meldet sie die neue Ansicht nach oben (geaendert), wie die Helferliste.
 *
 * Eine Handlung zur Zeit, die ganze Karte gesperrt. Verworfen: je Auto sperren; jede Antwort bringt
 * die ganze Ansicht zurueck, und ueberholten sich zwei, setzte die spaeter eintreffende eine
 * aeltere ueber die neuere.
 *
 * Scheitert eine Handlung, weil sich die Fahrt geaendert hat (voll, archiviert, Auto weg), zeigt die
 * Karte den Satz des Servers und meldet veraltet; die Seite laedt dann still neu. Nur PLAETZE ist
 * eine Fehleingabe des Formulars und bleibt am Feld. Verworfen: die Ansicht aus der Fehlerantwort
 * zu bauen; der Server schickt sie nur bei Erfolg.
 *
 * Der Umschalter Hin/Rueck ist reine Anzeige und liegt hier, nicht in der Adresse wie bei den
 * Medien: Er gehoert zu einer Karte von mehreren auf der Seite.
 */
@Component({
	selector: 'jf-fahrt-modul',
	imports: [BestaetigungComponent, FahrtAutoFormular, NgTemplateOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2>{{ modul().titel || 'Fahrgemeinschaft' }}</h2>
		@if (fehler(); as f) {
			<p class="fehler" role="alert">{{ f }}</p>
		}

		@if (richtungen().length > 1) {
			<div class="reiter" role="tablist" aria-label="Richtung">
				@for (r of richtungen(); track r.richtung) {
					<button
						type="button"
						role="tab"
						class="reiter-knopf"
						[id]="reiterId(r.richtung)"
						[attr.aria-selected]="aktuell()?.richtung === r.richtung"
						[attr.aria-controls]="tafelId"
						[attr.tabindex]="aktuell()?.richtung === r.richtung ? 0 : -1"
						(click)="waehle(r.richtung)"
						(keydown)="taste($event, r.richtung)"
					>
						{{ reiterText[r.richtung] }}
					</button>
				}
			</div>
		}

		@if (ansicht(); as v) {
			<div
				class="tafel"
				[id]="tafelId"
				[attr.role]="richtungen().length > 1 ? 'tabpanel' : null"
				[attr.aria-labelledby]="richtungen().length > 1 ? reiterId(v.richtung.richtung) : null"
			>
				<h3 tabindex="-1">{{ richtungText[v.richtung.richtung] }}</h3>

				@for (k of v.autos; track k.auto.id) {
					<section class="auto" [attr.data-auto]="k.auto.id">
						<div class="kopf">
							<strong class="fahrer">{{ k.auto.fahrer }}</strong>
							<span class="frei" [class.voll]="k.auto.frei === 0">{{ k.frei }}</span>
						</div>
						@if (k.info; as info) {
							<p class="info">{{ info }}</p>
						}
						@if (k.auto.notiz; as notiz) {
							<p class="notiz gedaempft">{{ notiz }}</p>
						}
						@if (k.mitfahrer.length > 0) {
							<ul class="kinder">
								@for (z of k.mitfahrer; track z.kindId) {
									<ng-container [ngTemplateOutlet]="zeile" [ngTemplateOutletContext]="{ $implicit: z }" />
								}
							</ul>
						}
						@if (k.einsteigen.length > 0 || k.aendern) {
							<div class="aktionen">
								@for (e of k.einsteigen; track e.kindId) {
									<button type="button" class="knopf klein" [disabled]="sendet()" (click)="setzeEin(e, k.auto.id)">
										{{ e.name ? e.name + ' einsteigen' : 'Einsteigen' }}
									</button>
								}
								@if (k.aendern) {
									<button
										type="button"
										class="knopf leise klein"
										[attr.data-fokus]="'aendern-' + k.auto.id"
										[disabled]="sendet()"
										(click)="oeffneAuto(k.auto)"
									>
										Auto ändern
									</button>
									<button
										type="button"
										class="knopf leise klein"
										[disabled]="sendet()"
										(click)="frageZurueckziehen(k.auto)"
									>
										Auto zurückziehen
									</button>
								}
							</div>
						}
						@if (formular(); as f) {
							@if (f.art === 'auto' && f.autoId === k.auto.id) {
								<jf-fahrt-auto-formular
									[start]="f.start"
									[aendern]="f.autoId !== null"
									[gesperrt]="sendet()"
									(abgeschickt)="sendeAuto($event, f.autoId)"
									(abgebrochen)="schliesse()"
								/>
							}
						}
					</section>
				} @empty {
					<p class="leer gedaempft klein">Noch kein Auto.</p>
				}

				@if (v.anbieten) {
					<div class="aktionen">
						<button
							type="button"
							class="knopf primaer klein"
							data-fokus="anbieten"
							[disabled]="sendet()"
							(click)="oeffneAuto(null)"
						>
							Auto anbieten
						</button>
					</div>
				}
				@if (formular(); as f) {
					@if (f.art === 'auto' && f.autoId === null) {
						<jf-fahrt-auto-formular
							[start]="f.start"
							[aendern]="f.autoId !== null"
							[gesperrt]="sendet()"
							(abgeschickt)="sendeAuto($event, f.autoId)"
							(abgebrochen)="schliesse()"
						/>
					}
				}

				<section class="abschnitt" data-abschnitt="braucht">
					<h4>Braucht noch Mitfahrt</h4>
					@if (v.braucht.length === 0) {
						<p class="leer gedaempft klein">Alle haben eine Mitfahrt.</p>
					} @else {
						<ul class="kinder">
							@for (z of v.braucht; track z.kindId) {
								<ng-container [ngTemplateOutlet]="zeile" [ngTemplateOutletContext]="{ $implicit: z }" />
							}
						</ul>
					}
				</section>

				@if (v.selbst.length > 0 || v.selbstKnoepfe.length > 0) {
					<section class="abschnitt" data-abschnitt="selbst">
						<h4>Kommt selbst</h4>
						@if (v.selbst.length > 0) {
							<ul class="kinder">
								@for (z of v.selbst; track z.kindId) {
									<ng-container [ngTemplateOutlet]="zeile" [ngTemplateOutletContext]="{ $implicit: z }" />
								}
							</ul>
						}
						@if (v.selbstKnoepfe.length > 0) {
							<div class="aktionen">
								@for (e of v.selbstKnoepfe; track e.kindId) {
									<button type="button" class="knopf klein" [disabled]="sendet()" (click)="setzeEin(e, null)">
										{{ e.name ? e.name + ' kommt selbst' : 'Kommt selbst' }}
									</button>
								}
							</div>
						}
					</section>
				}
			</div>
		}

		@if (rueckfrage(); as q) {
			<jf-bestaetigung
				titel="Auto zurückziehen"
				[text]="q.text"
				bestaetigung="Zurückziehen"
				(bestaetigt)="zieheZurueck(q)"
				(abgebrochen)="rueckfrage.set(null)"
			/>
		}

		<ng-template #zeile let-z>
			<li class="kind" [attr.data-kind]="z.kindId">
				<div class="kindzeile">
					<span class="name">{{ z.name }}</span>
					@if (z.nichtMehrDabei) {
						<span class="hinweis gedaempft klein">nicht mehr dabei</span>
					}
					@if (z.umsetzen) {
						<button
							type="button"
							class="knopf leise klein"
							[attr.data-fokus]="'umsetzen-' + z.kindId"
							[attr.aria-label]="z.name + ' umsetzen'"
							[disabled]="sendet()"
							(click)="oeffneUmsetzen(z)"
						>
							Umsetzen
						</button>
					}
					@if (z.herausnehmen) {
						<button
							type="button"
							class="knopf klein"
							[attr.aria-label]="z.name + ' herausnehmen'"
							[disabled]="sendet()"
							(click)="nimmHeraus(z.kindId)"
						>
							Herausnehmen
						</button>
					}
				</div>
				@if (formular(); as f) {
					@if (f.art === 'umsetzen' && f.kindId === z.kindId) {
						<form class="formular" novalidate (submit)="sendeUmsetzen($event, f.kindId)">
							<label class="feld">
								<span>{{ f.name }} umsetzen in</span>
								<select data-erstes name="ziel" [disabled]="sendet()" (change)="ziel.set(wert($event))">
									@for (o of ziele(); track o.wert) {
										<option [value]="o.wert" [selected]="o.wert === ziel()">{{ o.text }}</option>
									}
								</select>
							</label>
							<div class="aktionen">
								<button type="submit" class="knopf primaer klein" [disabled]="sendet()">Speichern</button>
								<button type="button" class="knopf klein" [disabled]="sendet()" (click)="schliesse()">Abbrechen</button>
							</div>
						</form>
					}
				}
			</li>
		</ng-template>
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		h2 {
			margin: 0;
			font-size: var(--schrift);
			overflow-wrap: anywhere;
		}
		h3 {
			margin: 0;
			font-size: var(--schrift);
		}
		h3:focus {
			outline: none;
		}
		h4 {
			margin: 0;
			font-size: var(--schrift-klein);
			color: var(--text-gedaempft);
		}
		p {
			margin: 0;
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
		.tafel,
		.auto,
		.abschnitt {
			display: grid;
			gap: var(--a2);
			min-width: 0;
		}
		.auto {
			padding-top: var(--a2);
			border-top: 1px solid var(--linie);
		}
		.kopf {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: var(--a2);
		}
		.fahrer,
		.info,
		.notiz,
		.name {
			min-width: 0;
			overflow-wrap: anywhere;
		}
		.frei {
			flex: none;
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		.frei.voll {
			color: var(--warnung);
		}
		.kinder {
			display: grid;
			gap: var(--a1);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.kind {
			display: grid;
			gap: var(--a2);
		}
		.kindzeile {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		.kindzeile .name {
			flex: 1 1 auto;
		}
		.aktionen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
		.formular {
			display: grid;
			gap: var(--a2);
		}
		.formular select {
			min-width: 0;
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class FahrtModul {
	readonly modul = input.required<FahrtModulAnsicht>();
	readonly slug = input.required<string>();
	/**
	 * Die Vorschau des Editors: Sie hat weder Autos noch Kinder. Der Schalter haelt die Knoepfe auch
	 * dann fort, wenn eine Ansicht doch welche mitbraechte. Verworfen: erfundene Autos in der
	 * Vorschau, deren Knoepfe die API riefen.
	 */
	readonly vorschau = input(false);
	/** Die Ansicht des Servers nach einer Handlung; die Seite setzt sie in ihren Thread ein. */
	readonly geaendert = output<FahrtModulAnsicht>();
	/** Die Fahrt hat sich seit dem Laden geaendert; die Seite soll still neu laden. */
	readonly veraltet = output<void>();

	private readonly api = inject(ThreadApi);
	private readonly router = inject(Router);
	private readonly injector = inject(Injector);
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly autoFormular = viewChild(FahrtAutoFormular);

	protected readonly richtungText = RICHTUNG_TEXT;
	protected readonly reiterText = REITER_TEXT;
	protected readonly sendet = signal(false);
	/** Der Satz oben am Modul: Fehler ohne Eingabefeld und alles, was die Ansicht veraltet macht. */
	protected readonly fehler = signal<string | null>(null);
	protected readonly formular = signal<Formular | null>(null);
	protected readonly rueckfrage = signal<Rueckfrage | null>(null);
	protected readonly ziel = signal('');
	private readonly gewaehlt = signal<Richtung | null>(null);
	/** Eine Antwort, die erst nach dem Verlassen der Seite eintrifft, soll nichts mehr ausloesen. */
	private weg = false;

	protected readonly tafelId = `fahrt-tafel-${nummer++}`;

	constructor() {
		inject(DestroyRef).onDestroy(() => (this.weg = true));
	}

	protected readonly richtungen = computed(() => this.modul().richtungen);

	/** Die gewaehlte Richtung; eine, die die neue Ansicht nicht mehr hat, faellt auf die erste zurueck. */
	protected readonly aktuell = computed<FahrtRichtungAnsicht | null>(() => {
		const r = this.richtungen();
		return r.find((x) => x.richtung === this.gewaehlt()) ?? r[0] ?? null;
	});

	protected readonly ansicht = computed(() => {
		const r = this.aktuell();
		if (r === null) return null;
		const m = this.modul();
		const bedienbar = !this.vorschau();
		const eigene: Eigenes[] = bedienbar
			? m.kinder.map((k) => ({ kindId: k.kindId, name: k.selbst ? null : k.vorname }))
			: [];
		const umsetzen = (kindId: string) => bedienbar && m.leitung && zieleFuer(r, kindId).length > 0;
		const zeile = (z: {
			kindId: string;
			name: string;
			nichtMehrDabei?: boolean;
			darfHerausnehmen?: boolean;
		}): KindZeile => ({
			kindId: z.kindId,
			name: z.name,
			nichtMehrDabei: z.nichtMehrDabei ?? false,
			herausnehmen: bedienbar && (z.darfHerausnehmen ?? false),
			umsetzen: umsetzen(z.kindId),
		});
		return {
			richtung: r,
			anbieten: bedienbar && r.darfAnbieten,
			autos: r.autos.map((auto): AutoKarte => ({
				auto,
				info: [wann(auto), auto.ort].filter(Boolean).join(' · ') || null,
				frei: frei(auto),
				mitfahrer: auto.mitfahrer.map(zeile),
				aendern: bedienbar && auto.darfAendern,
				// Wer schon in diesem Auto sitzt, steigt nicht noch einmal ein; ein anderes Auto ist ein Wechsel.
				einsteigen: auto.frei > 0 ? eigene.filter((e) => !auto.mitfahrer.some((x) => x.kindId === e.kindId)) : [],
			})),
			braucht: r.brauchtMitfahrt.map(zeile),
			selbst: r.kommtSelbst.map(zeile),
			selbstKnoepfe: eigene.filter((e) => !r.kommtSelbst.some((x) => x.kindId === e.kindId)),
		};
	});

	/** Die Auswahl des offenen Umsetzen-Formulars. */
	protected readonly ziele = computed(() => {
		const f = this.formular();
		const r = this.aktuell();
		return f !== null && f.art === 'umsetzen' && r !== null ? zieleFuer(r, f.kindId) : [];
	});

	protected reiterId(richtung: Richtung): string {
		return `${this.tafelId}-${richtung}`;
	}

	protected wert(e: Event): string {
		return (e.target as HTMLInputElement).value;
	}

	protected waehle(richtung: Richtung): void {
		if (richtung === this.aktuell()?.richtung) return;
		this.gewaehlt.set(richtung);
		this.formular.set(null);
		this.fehler.set(null);
	}

	/**
	 * Pfeiltasten wechseln den Richtungsreiter und nehmen den Fokus mit, Pos1 und Ende springen zum
	 * ersten und letzten (Muster der Medien-Reiter, WAI-ARIA).
	 */
	protected taste(ereignis: KeyboardEvent, aktuell: Richtung): void {
		const i = REICHTUNGEN.indexOf(aktuell);
		const index =
			ereignis.key === 'ArrowRight'
				? (i + 1) % REICHTUNGEN.length
				: ereignis.key === 'ArrowLeft'
					? (i - 1 + REICHTUNGEN.length) % REICHTUNGEN.length
					: ereignis.key === 'Home'
						? 0
						: ereignis.key === 'End'
							? REICHTUNGEN.length - 1
							: -1;
		const richtung = REICHTUNGEN[index];
		if (richtung === undefined) return;
		ereignis.preventDefault();
		this.host.nativeElement.querySelector<HTMLElement>(`#${this.reiterId(richtung)}`)?.focus();
		this.waehle(richtung);
	}

	/** Das Formular fuer ein neues Auto (autoId null) oder zum Aendern; der Tag ist mit dem Vorschlag vorbelegt (Entscheidung 15). */
	protected oeffneAuto(auto: FahrtAutoAnsicht | null): void {
		if (this.sendet()) return;
		this.fehler.set(null);
		this.formular.set({
			art: 'auto',
			autoId: auto?.id ?? null,
			zurueck: auto === null ? 'anbieten' : `aendern-${auto.id}`,
			start: {
				plaetze: auto === null ? '' : String(auto.plaetze),
				abfahrtTag: auto === null ? (this.aktuell()?.vorschlagTag ?? '') : (auto.abfahrtTag ?? ''),
				abfahrtZeit: auto?.abfahrtZeit ?? '',
				ort: auto?.ort ?? '',
				notiz: auto?.notiz ?? '',
			},
		});
	}

	protected oeffneUmsetzen(z: KindZeile): void {
		const r = this.aktuell();
		if (this.sendet() || r === null) return;
		this.fehler.set(null);
		this.ziel.set(zieleFuer(r, z.kindId)[0]?.wert ?? '');
		this.formular.set({ art: 'umsetzen', kindId: z.kindId, name: z.name, zurueck: `umsetzen-${z.kindId}` });
		this.fokussiere(() => this.suche('form [data-erstes]'));
	}

	/** Abbrechen: Der Fokus kehrt zu dem Knopf zurueck, der das Formular geoeffnet hat. */
	protected schliesse(): void {
		const f = this.formular();
		this.formular.set(null);
		if (f !== null) this.fokussiere(() => this.suche(`[data-fokus="${f.zurueck}"]`));
	}

	/**
	 * Erst nach dem Zeichnen: Das Formular und die Ueberschrift der neuen Ansicht gibt es vorher
	 * noch nicht. Verworfen: viewChild je Ziel; die Ziele wechseln mit Auto und Kind, und eine
	 * Suche im eigenen Element ist kuerzer als ein Dutzend Abfragen.
	 */
	private fokussiere(ziel: () => HTMLElement | null | undefined): void {
		afterNextRender(() => ziel()?.focus(), { injector: this.injector });
	}

	private suche(auswahl: string): HTMLElement | null {
		return this.host.nativeElement.querySelector<HTMLElement>(auswahl);
	}

	/**
	 * Nach Erfolg und nach einer Abweisung verschwinden Formular oder Knopf, und der Fokus fiele auf
	 * body: Tastatur und Screenreader verloren den Ort. Die Ueberschrift der Richtung bleibt stehen.
	 */
	private fokussiereUeberschrift(): void {
		this.fokussiere(() => this.suche('h3'));
	}

	protected async setzeEin(e: Eigenes, autoId: string | null): Promise<void> {
		const r = this.aktuell();
		if (r === null) return;
		await this.fuehreAus(() =>
			this.api.setzeEin(this.slug(), this.modul().id, r.richtung, e.kindId, this.koerper(autoId)),
		);
	}

	protected async nimmHeraus(kindId: string): Promise<void> {
		const r = this.aktuell();
		if (r === null) return;
		await this.fuehreAus(() => this.api.nimmHeraus(this.slug(), this.modul().id, r.richtung, kindId));
	}

	protected async sendeUmsetzen(ereignis: Event, kindId: string): Promise<void> {
		ereignis.preventDefault();
		const r = this.aktuell();
		if (r === null || this.sendet()) return;
		const wert = this.ziel();
		await this.fuehreAus(() =>
			this.api.setzeEin(this.slug(), this.modul().id, r.richtung, kindId, this.koerper(wert === SELBST ? null : wert)),
		);
	}

	/** Eine clientId je Absenden: Wiederholt das Netz die Anfrage, erkennt der Server sie. */
	private koerper(autoId: string | null): { autoId: string | null; clientId: string } {
		return { autoId, clientId: crypto.randomUUID() };
	}

	/** Die Eingabe hat die Vorpruefung des Formulars bestanden; der Server entscheidet endgueltig. */
	protected async sendeAuto(auto: AutoEingabe, autoId: string | null): Promise<void> {
		const r = this.aktuell();
		if (r === null) return;
		await this.fuehreAus(() =>
			autoId === null
				? this.api.bieteAuto(this.slug(), this.modul().id, {
						...auto,
						richtung: r.richtung,
						clientId: crypto.randomUUID(),
					})
				: this.api.aendereAuto(this.slug(), autoId, auto),
		);
	}

	protected async frageZurueckziehen(auto: FahrtAutoAnsicht): Promise<void> {
		if (this.sendet()) return;
		if (auto.mitfahrer.length === 0) {
			await this.zieheZurueck({ autoId: auto.id, text: '' });
			return;
		}
		const namen = undListe(auto.mitfahrer.map((m) => m.name));
		this.rueckfrage.set({
			autoId: auto.id,
			text: `${namen} ${auto.mitfahrer.length === 1 ? 'braucht' : 'brauchen'} dann wieder eine Mitfahrt.`,
		});
	}

	protected async zieheZurueck(q: Rueckfrage): Promise<void> {
		this.rueckfrage.set(null);
		await this.fuehreAus(() => this.api.zieheAutoZurueck(this.slug(), q.autoId));
	}

	private async fuehreAus(aufruf: () => Observable<FahrtAntwort>): Promise<void> {
		if (this.sendet()) return;
		this.sendet.set(true);
		this.fehler.set(null);
		try {
			const { modul } = await firstValueFrom(aufruf());
			if (this.weg) return;
			this.formular.set(null);
			this.geaendert.emit(modul);
			this.fokussiereUeberschrift();
		} catch (ursache) {
			if (this.weg) return;
			const f = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), f)) return;
			this.zeigeFehler(f);
		} finally {
			this.sendet.set(false);
		}
	}

	/**
	 * 404 heisst, dass Fahrt oder Recht in der Zwischenzeit weg sind. 409 heisst, dass die Ansicht
	 * veraltet ist (voll, archiviert, nicht dabei, schon ein Auto): Der Satz steht am Modul, das
	 * Formular schliesst, und die Seite laedt neu. PLAETZE ist dagegen eine Fehleingabe: Der Satz
	 * steht am Feld und das Formular bleibt, ein Neuladen aenderte nichts. CLIENT_ID_VERGEBEN trifft
	 * eine erneute Anfrage mit frischer clientId nicht mehr. Alles andere (Netz, 429) laesst das
	 * Formular offen fuer einen neuen Versuch.
	 */
	private zeigeFehler(f: ApiFehler): void {
		if (f.status === 400 && AUTO_FELDER.includes(f.feld as AutoFeld)) {
			this.autoFormular()?.zeigeFehler(f.feld as AutoFeld);
			return;
		}
		if (f.status === 404) {
			this.formular.set(null);
			this.fehler.set('Das gibt es nicht mehr, oder du darfst hier nichts ändern.');
			this.veraltet.emit();
			this.fokussiereUeberschrift();
			return;
		}
		if (f.status === 409 && f.code === 'PLAETZE') {
			this.autoFormular()?.zeigeFehler('plaetze', f.fehler);
			return;
		}
		if (f.status === 409 && f.code !== 'CLIENT_ID_VERGEBEN') {
			this.formular.set(null);
			this.fehler.set(fehlertext(f));
			this.veraltet.emit();
			this.fokussiereUeberschrift();
			return;
		}
		this.fehler.set(fehlertext(f));
	}
}
