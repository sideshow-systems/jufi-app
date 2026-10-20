import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import {
	berlinerTag,
	berlinerUhrzeit,
	berlinZeitpunkt,
	EINHEIT_TEXT,
	einheitenFuer,
	ERGEBNIS_TEXT,
	type ErgebnisSicht,
	type Feldfehler,
	GRENZEN,
	type ModulEntwurf,
	type OptionEntwurf,
	type Rollenfilter,
	type TerminEntwurf,
	teilnahmeOptionen,
	type UmfrageSperre,
} from '@jufi/domain';
import { wertVon } from '../../../gemeinsam/formular';
import { IconComponent } from '../../../gestaltung/icon';
import { KnopfleisteComponent } from './knopfleiste';

type InfoModul = Extract<ModulEntwurf, { typ: 'INFO' }>;
type TerminModul = Extract<ModulEntwurf, { typ: 'TERMIN' }>;
type UmfrageModul = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;

// Ab hier zeigt das Textfeld, wie viel noch frei ist: Wer lange Aushaenge schreibt, soll die
// Grenze kommen sehen, statt erst beim Speichern auf den Fehler zu stossen.
const ZAEHLER_AB = 9000;

// Vorgabe, wenn nur ein Datum fuer die Frist da ist: eine Uhrzeit, die man sieht, statt einer,
// die still als Mitternacht gilt. Verworfen: 23:59, die Jugendleiter nennen Fristen meist als
// Abend vor dem Termin, und ein Wert, den das Feld zeigt, laesst sich ohnehin aendern.
const FRIST_UHRZEIT = '18:00';

// Ein Datum ist erst dann eine Frist, wenn es vollstaendig ist und ein sinnvolles Jahr hat:
// Auf dem Weg zu 2026 meldet der Browser 0002, 0020 und 0202, und berlinZeitpunkt machte aus
// 0002 das Jahr 1902.
const TAG = /^\d{4}-\d{2}-\d{2}$/;
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
const istPlausiblerTag = (tag: string): boolean => TAG.test(tag) && Number(tag.slice(0, 4)) >= 1000;

const ZAHL = new Intl.NumberFormat('de-DE');

// Die Optionen, mit denen eine frisch auf "ohne Teilnahme" gestellte Umfrage beginnt: zwei
// Antworten sind das Minimum, und eine leere Liste hiesse sofort einen Fehler.
const AUSGANGSOPTIONEN = (): OptionEntwurf[] => [
	{ schluessel: null, text: 'Ja' },
	{ schluessel: null, text: 'Nein' },
];

const leerNull = (w: string): string | null => (w === '' ? null : w);
const hakenVon = (e: Event): boolean => (e.target as HTMLInputElement).checked;

/**
 * Die Felder eines Moduls im Editor, je nach Typ. Gesteuert: Das Bauteil aendert seine Eingabe
 * nie, jede Eingabe meldet ein neues Modul ueber geaendert, der Besitzer (Editor) haelt den
 * Entwurf. Verworfen: das Modul hier zu halten und nur beim Speichern zu melden, denn die
 * Vorschau rechts im Editor folgt jedem Tastendruck.
 *
 * Gesperrt ist, was bestehende Antworten entwerten wuerde (Spec 3.14). Die Grenzen sind
 * dieselben wie die des Servers (vergleich.ts): Einheit und Teilnahme, sobald jemand mit einer
 * Option geantwortet hat; Mehrfachauswahl nur, wenn sie genutzt wurde; beantwortete Optionen
 * lassen sich nicht entfernen. Der Server entscheidet trotzdem unter der Sperre noch einmal.
 */
@Component({
	selector: 'jf-modul-felder',
	imports: [IconComponent, KnopfleisteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (info(); as m) {
			<div class="felder">
				<label class="feld">
					Überschrift (optional)
					<input
						type="text"
						name="titel"
						autocomplete="off"
						[value]="m.titel ?? ''"
						[attr.aria-invalid]="fehlerAn('titel') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('titel') ? fehlerId('titel') : null"
						(input)="titelSetzen(m, wert($event))"
					/>
				</label>
				@if (fehlerAn('titel'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('titel')">{{ text }}</p>
				}
				<div class="textblock">
					<span class="beschriftung" [id]="feldId('text-beschriftung')">Text</span>
					<jf-knopfleiste [textarea]="textfeld" (geaendert)="infoTextSetzen(m, $event)" />
					<textarea
						#textfeld
						name="text"
						rows="6"
						class="textfeld"
						[value]="m.text"
						[attr.aria-labelledby]="feldId('text-beschriftung')"
						[attr.aria-invalid]="fehlerAn('text') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('text') ? fehlerId('text') : null"
						(input)="infoTextSetzen(m, wert($event))"
					></textarea>
				</div>
				@if (zaehler(m); as z) {
					<p class="zaehler gedaempft klein">{{ z }}</p>
				}
				@if (fehlerAn('text'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('text')">{{ text }}</p>
				}
			</div>
		}

		@if (terminModul(); as m) {
			<div class="felder">
				<label class="feld">
					Überschrift (optional)
					<input
						type="text"
						name="titel"
						autocomplete="off"
						[value]="m.titel ?? ''"
						[attr.aria-invalid]="fehlerAn('titel') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('titel') ? fehlerId('titel') : null"
						(input)="titelSetzen(m, wert($event))"
					/>
				</label>
				@if (fehlerAn('titel'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('titel')">{{ text }}</p>
				}
				<div class="reihe">
					<label class="feld">
						Startdatum
						<input
							type="date"
							name="startDatum"
							[value]="m.termin.startDatum"
							[attr.aria-invalid]="fehlerAn('termin') ? 'true' : null"
							[attr.aria-describedby]="fehlerAn('termin') ? fehlerId('termin') : null"
							(input)="terminSetzen(m, { startDatum: wert($event) })"
						/>
					</label>
					<label class="feld">
						Enddatum (optional)
						<input
							type="date"
							name="endDatum"
							[value]="m.termin.endDatum ?? ''"
							[attr.aria-invalid]="fehlerAn('termin') ? 'true' : null"
							[attr.aria-describedby]="fehlerAn('termin') ? fehlerId('termin') : null"
							(input)="terminSetzen(m, { endDatum: leer(wert($event)) })"
						/>
					</label>
				</div>
				<div class="reihe">
					<label class="feld">
						Beginn (optional)
						<input
							type="time"
							name="beginn"
							[value]="m.termin.beginn ?? ''"
							[attr.aria-invalid]="fehlerAn('termin') ? 'true' : null"
							[attr.aria-describedby]="fehlerAn('termin') ? fehlerId('termin') : null"
							(input)="terminSetzen(m, { beginn: leer(wert($event)) })"
						/>
					</label>
					<label class="feld">
						Ende (optional)
						<input
							type="time"
							name="ende"
							[value]="m.termin.ende ?? ''"
							[attr.aria-invalid]="fehlerAn('termin') ? 'true' : null"
							[attr.aria-describedby]="fehlerAn('termin') ? fehlerId('termin') : null"
							(input)="terminSetzen(m, { ende: leer(wert($event)) })"
						/>
					</label>
				</div>
				@if (fehlerAn('termin'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('termin')">{{ text }}</p>
				}
				<label class="feld">
					Ort (optional)
					<input
						type="text"
						name="ort"
						autocomplete="off"
						[value]="m.termin.ort ?? ''"
						[attr.aria-invalid]="fehlerAn('ort') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('ort') ? fehlerId('ort') : null"
						(input)="terminSetzen(m, { ort: leer(wert($event)) })"
					/>
				</label>
				@if (fehlerAn('ort'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('ort')">{{ text }}</p>
				}
				<label class="feld">
					Treffpunkt (optional)
					<input
						type="text"
						name="treffpunkt"
						autocomplete="off"
						[value]="m.termin.treffpunkt ?? ''"
						[attr.aria-invalid]="fehlerAn('treffpunkt') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('treffpunkt') ? fehlerId('treffpunkt') : null"
						(input)="terminSetzen(m, { treffpunkt: leer(wert($event)) })"
					/>
				</label>
				@if (fehlerAn('treffpunkt'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('treffpunkt')">{{ text }}</p>
				}
			</div>
		}

		@if (umfrage(); as m) {
			<div class="felder">
				<label class="feld">
					Überschrift (optional)
					<input
						type="text"
						name="titel"
						autocomplete="off"
						[value]="m.titel ?? ''"
						[attr.aria-invalid]="fehlerAn('titel') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('titel') ? fehlerId('titel') : null"
						(input)="titelSetzen(m, wert($event))"
					/>
				</label>
				@if (fehlerAn('titel'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('titel')">{{ text }}</p>
				}
				<label class="feld">
					Frage
					<input
						type="text"
						name="frage"
						autocomplete="off"
						[value]="m.frage"
						[attr.aria-invalid]="fehlerAn('frage') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('frage') ? fehlerId('frage') : null"
						(input)="umfrageSetzen(m, { frage: wert($event) })"
					/>
				</label>
				@if (fehlerAn('frage'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('frage')">{{ text }}</p>
				}

				<label class="haken">
					<input
						type="checkbox"
						name="teilnahme"
						[checked]="m.teilnahme"
						[disabled]="antwortenSperren()"
						[attr.aria-invalid]="fehlerAn('teilnahme') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('teilnahme') ? fehlerId('teilnahme') : null"
						(change)="teilnahmeSetzen(m, haken($event))"
					/>
					Teilnahme-Umfrage
				</label>
				@if (antwortenSperren()) {
					<p class="hinweis gedaempft klein">{{ gesperrtText }}</p>
				}
				@if (fehlerAn('teilnahme'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('teilnahme')">{{ text }}</p>
				}

				@if (m.teilnahme) {
					<label class="haken">
						<input
							type="checkbox"
							name="vielleicht"
							[checked]="m.vielleicht"
							[disabled]="vielleichtGesperrt(m)"
							(change)="vielleichtSetzen(m, haken($event))"
						/>
						Vielleicht anbieten
					</label>
					@if (vielleichtGesperrt(m)) {
						<p class="hinweis gedaempft klein">{{ gesperrtText }}</p>
					}
				} @else {
					<fieldset class="optionen">
						<legend>Antworten</legend>
						<ol class="optionsliste">
							@for (o of m.optionen; track $index; let i = $index; let erste = $first; let letzte = $last) {
								<li [attr.data-option]="i">
									<input
										type="text"
										class="optionstext"
										[name]="'option-' + i"
										autocomplete="off"
										[attr.aria-label]="'Antwort ' + (i + 1)"
										[attr.aria-invalid]="fehlerAn('optionen') ? 'true' : null"
										[attr.aria-describedby]="fehlerAn('optionen') ? fehlerId('optionen') : null"
										[value]="o.text"
										(input)="optionSetzen(m, i, wert($event))"
									/>
									<button
										type="button"
										class="knopf leise nur-icon"
										[attr.aria-label]="'Nach oben: Antwort ' + (i + 1)"
										[disabled]="erste"
										(click)="optionSchieben(m, i, -1)"
									>
										<jf-icon name="hoch" />
									</button>
									<button
										type="button"
										class="knopf leise nur-icon"
										[attr.aria-label]="'Nach unten: Antwort ' + (i + 1)"
										[disabled]="letzte"
										(click)="optionSchieben(m, i, 1)"
									>
										<jf-icon name="runter" />
									</button>
									@if (!optionBeantwortet(o)) {
										<button
											type="button"
											class="knopf leise nur-icon"
											[attr.aria-label]="'Entfernen: Antwort ' + (i + 1)"
											(click)="optionEntfernen(m, i)"
										>
											<jf-icon name="schliessen" />
										</button>
									} @else {
										<span class="platz" aria-hidden="true"></span>
									}
								</li>
							}
						</ol>
						@if (hatBeantwortete(m)) {
							<p class="hinweis gedaempft klein">
								Antworten, auf die schon geantwortet wurde, lassen sich nicht entfernen.
							</p>
						}
						@if (fehlerAn('optionen'); as text) {
							<p class="fehler" role="alert" [id]="fehlerId('optionen')">{{ text }}</p>
						}
						<div class="reihe">
							<button
								type="button"
								class="knopf klein hinzufuegen"
								[disabled]="m.optionen.length >= grenzen.optionen"
								(click)="optionHinzufuegen(m)"
							>
								<jf-icon name="plus" />
								Hinzufügen
							</button>
						</div>
					</fieldset>
					<label class="haken">
						<input
							type="checkbox"
							name="mehrfach"
							[checked]="m.mehrfach"
							[disabled]="mehrfachFest(m)"
							[attr.aria-invalid]="fehlerAn('mehrfach') ? 'true' : null"
							[attr.aria-describedby]="fehlerAn('mehrfach') ? fehlerId('mehrfach') : null"
							(change)="umfrageSetzen(m, { mehrfach: haken($event) })"
						/>
						Mehrfachauswahl
					</label>
					@if (mehrfachFest(m)) {
						<p class="hinweis gedaempft klein">{{ gesperrtText }}</p>
					}
					@if (fehlerAn('mehrfach'); as text) {
						<p class="fehler" role="alert" [id]="fehlerId('mehrfach')">{{ text }}</p>
					}
				}

				<label class="feld">
					Einheit
					<select
						name="einheit"
						[disabled]="antwortenSperren()"
						[attr.aria-invalid]="fehlerAn('einheit') ? 'true' : null"
						[attr.aria-describedby]="fehlerAn('einheit') ? fehlerId('einheit') : null"
						(change)="umfrageSetzen(m, { einheit: wertAlsEinheit($event) })"
					>
						@for (e of einheiten(); track e) {
							<option [value]="e" [selected]="e === m.einheit">{{ einheitText[e] }}</option>
						}
						@if (fremdeEinheit(m); as e) {
							<option [value]="e" selected>{{ einheitText[e] }} (passt nicht zur Zielgruppe)</option>
						}
					</select>
				</label>
				@if (antwortenSperren()) {
					<p class="hinweis gedaempft klein">{{ gesperrtText }}</p>
				}
				@if (fehlerAn('einheit'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('einheit')">{{ text }}</p>
				}

				<label class="feld">
					Ergebnisse
					<select name="ergebnisse" (change)="umfrageSetzen(m, { ergebnisse: wertAlsErgebnis($event) })">
						@for (e of ergebnisse; track e) {
							<option [value]="e" [selected]="e === m.ergebnisse">{{ ergebnisText[e] }}</option>
						}
					</select>
				</label>

				<fieldset class="frist">
					<legend>Frist (Berliner Zeit)</legend>
					<div class="reihe">
						<label class="feld">
							Datum
							<input
								type="date"
								name="fristTag"
								[value]="fristTag()"
								[disabled]="ohneFrist()"
								[attr.aria-invalid]="fehlerAn('frist') ? 'true' : null"
								[attr.aria-describedby]="fehlerAn('frist') ? fehlerId('frist') : null"
								(input)="fristTagSetzen(m, wert($event))"
								(blur)="gleicheAb($event, fristTag())"
							/>
						</label>
						<label class="feld">
							Uhrzeit
							<input
								type="time"
								name="fristZeit"
								[value]="fristZeit()"
								[disabled]="ohneFrist()"
								[attr.aria-invalid]="fehlerAn('frist') ? 'true' : null"
								[attr.aria-describedby]="fehlerAn('frist') ? fehlerId('frist') : null"
								(input)="fristZeitSetzen(m, wert($event))"
								(blur)="gleicheAb($event, fristZeit())"
							/>
						</label>
					</div>
					<label class="haken">
						<input
							type="checkbox"
							name="ohneFrist"
							[checked]="ohneFrist()"
							(change)="ohneFristSetzen(m, haken($event))"
						/>
						ohne Frist
					</label>
					@if (fehlerAn('frist'); as text) {
						<p class="fehler" role="alert" [id]="fehlerId('frist')">{{ text }}</p>
					}
				</fieldset>
			</div>
		}
	`,
	styles: `
		:host {
			display: block;
		}
		.felder {
			display: grid;
			gap: var(--a3);
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		.reihe > .feld {
			flex: 1 1 8rem;
			min-width: 0;
		}
		fieldset {
			display: grid;
			gap: var(--a3);
			margin: 0;
			padding: 0;
			border: 0;
			min-width: 0;
		}
		legend {
			padding: 0;
			font-size: var(--schrift-klein);
			font-weight: 600;
			color: var(--text-gedaempft);
		}
		.textblock {
			display: grid;
			gap: var(--a2);
		}
		.beschriftung {
			font-size: var(--schrift-klein);
			font-weight: 600;
			color: var(--text-gedaempft);
		}
		.textfeld {
			min-height: 8rem;
			padding: var(--a2) var(--a3);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--karte);
			color: var(--text);
			font: inherit;
			resize: vertical;
		}
		.optionsliste {
			display: grid;
			gap: var(--a2);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.optionsliste li {
			display: flex;
			align-items: center;
			gap: var(--a1);
		}
		.optionstext {
			flex: 1 1 auto;
			min-width: 0;
			min-height: var(--tippflaeche);
			padding: var(--a2) var(--a3);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--karte);
			color: var(--text);
			font: inherit;
		}
		.platz {
			flex: none;
			width: var(--tippflaeche);
		}
		[aria-invalid='true'] {
			border-color: var(--fehler);
		}
		.hinweis,
		.zaehler,
		.fehler {
			margin: 0;
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class ModulFelderComponent {
	readonly modul = input.required<ModulEntwurf>();
	readonly index = input.required<number>();
	readonly rollenfilter = input.required<Rollenfilter>();
	/** Null: keine gespeicherte Umfrage (neues Modul oder anderer Typ), also nichts gesperrt. */
	readonly sperre = input.required<UmfrageSperre | null>();
	readonly fehler = input.required<Feldfehler[]>();
	readonly geaendert = output<ModulEntwurf>();

	protected readonly gesperrtText = 'Gesperrt, weil schon Antworten da sind';
	protected readonly grenzen = GRENZEN;
	protected readonly einheitText = EINHEIT_TEXT;
	protected readonly ergebnisText = ERGEBNIS_TEXT;
	protected readonly ergebnisse = Object.keys(ERGEBNIS_TEXT) as ErgebnisSicht[];
	protected readonly wert = wertVon;
	protected readonly haken = hakenVon;
	protected readonly leer = leerNull;

	// Je Typ ein eigener Ausdruck statt einer Weiche im Ausdruck: So stehen die Felder im Muster
	// ohne Typumwandlung in der Vorlage.
	protected readonly info = computed<InfoModul | null>(() => {
		const m = this.modul();
		return m.typ === 'INFO' ? m : null;
	});
	protected readonly terminModul = computed<TerminModul | null>(() => {
		const m = this.modul();
		return m.typ === 'TERMIN' ? m : null;
	});
	protected readonly umfrage = computed<UmfrageModul | null>(() => {
		const m = this.modul();
		return m.typ === 'UMFRAGE' ? m : null;
	});

	protected readonly einheiten = computed(() => einheitenFuer(this.rollenfilter()));

	// Zeichen der Fehler je Feld; der Pfad kommt aus entwurfFehler ("module.<i>.<feld>"). Mehrere
	// Fehler am selben Feld zeigt nur der erste: Der zweite waere meist dieselbe Ursache.
	private readonly fehlerNachFeld = computed(() => {
		const vorsatz = `module.${this.index()}.`;
		const karte = new Map<string, string>();
		for (const f of this.fehler()) {
			if (f.feld.startsWith(vorsatz) && !karte.has(f.feld.slice(vorsatz.length))) {
				karte.set(f.feld.slice(vorsatz.length), f.text);
			}
		}
		return karte;
	});

	// Einheit und Teilnahme liegen fest, sobald eine Antwort mit Option da ist; eine Antwort
	// ohne Option (beantwortet, aber keine Schluessel) haelt der Server nicht davon ab.
	protected readonly antwortenSperren = computed(() => (this.sperre()?.schluessel.length ?? 0) > 0);

	// Die Frist steht im Modul als UTC-ISO, im Formular als Berliner Tag und Uhrzeit. Lokal
	// gehalten und aus dem Modul nachgefuehrt: Ein Datum ohne Uhrzeit oder umgekehrt ist noch
	// kein Zeitpunkt und kaeme sonst nie ins Modul. linkedSignal statt effect, damit die
	// Eingabe nicht eine Runde zu spaet zurueckspringt. Die Quelle ist der Frist-Wert, nicht
	// das Modul: Jede andere Eingabe meldet ein neues Modulobjekt, und an dessen Identitaet
	// gekoppelt wuerde sie den lokalen Stand (halbe Eingabe, abgewaehltes "ohne Frist") verwerfen.
	private readonly frist = computed(() => this.umfrage()?.frist ?? null);
	protected readonly ohneFrist = linkedSignal(() => this.frist() === null);
	protected readonly fristTag = linkedSignal(() => {
		const f = this.frist();
		return f ? berlinerTag(new Date(f)) : '';
	});
	protected readonly fristZeit = linkedSignal(() => {
		const f = this.frist();
		return f ? berlinerUhrzeit(new Date(f)) : '';
	});

	protected fehlerAn(feld: string): string | undefined {
		return this.fehlerNachFeld().get(feld);
	}

	protected feldId(feld: string): string {
		return `modul-${this.index()}-${feld}`;
	}

	protected fehlerId(feld: string): string {
		return this.feldId(`${feld}-fehler`);
	}

	protected zaehler(m: InfoModul): string | null {
		// Zeichen, nicht UTF-16-Einheiten: Der Server zaehlt so ([...s].length), ein Emoji ist eins.
		const n = [...m.text].length;
		return n >= ZAEHLER_AB ? `${ZAHL.format(n)} von ${ZAHL.format(GRENZEN.infoText)} Zeichen` : null;
	}

	protected fremdeEinheit(m: UmfrageModul) {
		return this.einheiten().includes(m.einheit) ? null : m.einheit;
	}

	protected optionBeantwortet(o: OptionEntwurf): boolean {
		return o.schluessel !== null && (this.sperre()?.schluessel.includes(o.schluessel) ?? false);
	}

	protected hatBeantwortete(m: UmfrageModul): boolean {
		return m.optionen.some((o) => this.optionBeantwortet(o));
	}

	protected mehrfachFest(m: UmfrageModul): boolean {
		return m.mehrfach && (this.sperre()?.mehrfachGenutzt ?? false);
	}

	// "Vielleicht" ist eine feste Antwort der Teilnahme; hat jemand sie gewaehlt, wuerde das
	// Abschalten sie entfernen, und beantwortete Optionen bleiben (siehe optionBeantwortet).
	protected vielleichtGesperrt(m: UmfrageModul): boolean {
		return m.vielleicht && (this.sperre()?.schluessel.includes('vielleicht') ?? false);
	}

	protected wertAlsEinheit(e: Event): UmfrageModul['einheit'] {
		return wertVon(e) as UmfrageModul['einheit'];
	}

	protected wertAlsErgebnis(e: Event): ErgebnisSicht {
		return wertVon(e) as ErgebnisSicht;
	}

	// ---- Aenderungen: immer ein neues Modul melden, nie das alte anfassen ----

	protected titelSetzen(m: ModulEntwurf, titel: string): void {
		this.geaendert.emit({ ...m, titel: leerNull(titel) });
	}

	protected infoTextSetzen(m: InfoModul, text: string): void {
		this.geaendert.emit({ ...m, text });
	}

	protected terminSetzen(m: TerminModul, teil: Partial<TerminEntwurf>): void {
		this.geaendert.emit({ ...m, termin: { ...m.termin, ...teil } });
	}

	protected umfrageSetzen(m: UmfrageModul, teil: Partial<UmfrageModul>): void {
		this.geaendert.emit({ ...m, ...teil });
	}

	protected teilnahmeSetzen(m: UmfrageModul, an: boolean): void {
		// Die Antworten einer Teilnahme sind fest (Spec 3.12), der Server setzt sie ohnehin;
		// hier stehen sie schon, damit die Vorschau sie zeigt. Beim Abschalten beginnt die Liste
		// mit zwei Antworten statt mit den festen Schluesseln, die nur eine Teilnahme haben darf.
		// "Mehrfachauswahl" gibt es bei einer Teilnahme nicht und das Feld ist dann ausgeblendet:
		// Ein stehengebliebenes true wuerde unsichtbar mitgespeichert.
		this.umfrageSetzen(m, {
			teilnahme: an,
			...(an ? { mehrfach: false } : {}),
			optionen: an ? this.teilnahmeAntworten(m.vielleicht) : AUSGANGSOPTIONEN(),
		});
	}

	protected vielleichtSetzen(m: UmfrageModul, an: boolean): void {
		this.umfrageSetzen(m, { vielleicht: an, optionen: this.teilnahmeAntworten(an) });
	}

	private teilnahmeAntworten(vielleicht: boolean): OptionEntwurf[] {
		return teilnahmeOptionen(vielleicht).map((o) => ({ schluessel: o.schluessel, text: o.text }));
	}

	protected optionSetzen(m: UmfrageModul, i: number, text: string): void {
		this.umfrageSetzen(m, { optionen: m.optionen.map((o, j) => (j === i ? { ...o, text } : o)) });
	}

	protected optionHinzufuegen(m: UmfrageModul): void {
		this.umfrageSetzen(m, { optionen: [...m.optionen, { schluessel: null, text: '' }] });
	}

	protected optionEntfernen(m: UmfrageModul, i: number): void {
		this.umfrageSetzen(m, { optionen: m.optionen.filter((_, j) => j !== i) });
	}

	protected optionSchieben(m: UmfrageModul, i: number, richtung: -1 | 1): void {
		const ziel = i + richtung;
		if (ziel < 0 || ziel >= m.optionen.length) return;
		const optionen = [...m.optionen];
		[optionen[i], optionen[ziel]] = [optionen[ziel], optionen[i]];
		this.umfrageSetzen(m, { optionen });
	}

	// Waehrend des Tippens meldet der Browser auch Zwischenstaende: '' bei einem geleerten
	// Segment, "0002-10-22" auf dem Weg zu "2026-10-22". Beides ist keine Frist. Weder melden
	// noch ins Feld zurueckschreiben (das binding nimmt dem Tippenden sonst das Segment unter
	// den Fingern weg); abgeschaltet wird nur ueber "ohne Frist". Verworfen: (change) statt
	// (input): Chrome meldet change auch fuer jedes gueltige Zwischenjahr und fuer ein
	// geleertes Feld, es loeste also nichts. Beim Verlassen springt das Feld auf den Stand des
	// Moduls zurueck (gleicheAb).
	protected fristTagSetzen(m: UmfrageModul, tag: string): void {
		if (!istPlausiblerTag(tag)) return;
		this.fristTag.set(tag);
		const zeit = this.fristZeit() || FRIST_UHRZEIT;
		this.fristZeit.set(zeit);
		this.ohneFrist.set(false);
		this.umfrageSetzen(m, { frist: berlinZeitpunkt(tag, zeit).toISOString() });
	}

	protected fristZeitSetzen(m: UmfrageModul, wert: string): void {
		if (!UHRZEIT.test(wert)) return;
		this.fristZeit.set(wert);
		const tag = this.fristTag();
		// Ohne Datum merkt sich das Feld die Uhrzeit nur; das Datum macht sie zum Zeitpunkt.
		if (tag === '') return;
		this.umfrageSetzen(m, { frist: berlinZeitpunkt(tag, wert).toISOString() });
	}

	protected gleicheAb(e: Event, stand: string): void {
		const feld = e.target as HTMLInputElement;
		if (feld.value !== stand) feld.value = stand;
	}

	protected ohneFristSetzen(m: UmfrageModul, ohne: boolean): void {
		this.ohneFrist.set(ohne);
		if (!ohne) return;
		this.fristTag.set('');
		this.fristZeit.set('');
		this.umfrageSetzen(m, { frist: null });
	}
}
