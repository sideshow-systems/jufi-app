import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
	type AntwortEinheit,
	EINHEIT_TEXT,
	einheitenFuer,
	type Feldfehler,
	GRENZEN,
	HELFER_EINHEIT_GESPERRT,
	type HelferSperre,
	type ModulEntwurf,
	type PositionEntwurf,
	type Rollenfilter,
} from '@jufi/domain';
import { wertVon } from '../../../gemeinsam/formular';
import { IconComponent } from '../../../gestaltung/icon';
import { FristFelderComponent } from './frist-felder';
import { zeigtModulFeld } from './modul-felder';

type Helfer = Extract<ModulEntwurf, { typ: 'HELFER' }>;

/**
 * Die Felder einer Helferliste im Editor: Ueberschrift, Einheit, Frist und die Positionen mit Text
 * und Anzahl. Eigene Komponente neben jf-modul-felder (TP4-Spec 10), wie Dateien und Fotos: Deren
 * Datei traegt Umfrage, Termin und Info schon genug, und die Positionen haben mit der Anzahl und
 * der Sperre je Schluessel eine eigene Logik. Die Frist teilt sie sich mit der Umfrage
 * (jf-frist-felder).
 *
 * Gesteuert wie jf-modul-felder: Jede Eingabe meldet ein neues Modul ueber aendern, der Editor
 * haelt den Entwurf.
 *
 * Gesperrt ist, was bestehende Eintraege entwerten wuerde, mit denselben Zahlen wie der Server
 * (pruefeHelferAenderung): Eine belegte Position laesst sich nicht entfernen, und nach dem ersten
 * Eintrag liegt die Einheit fest. Die Anzahl bekommt die Belegung nur als min, nicht als harte
 * Grenze: Wer darunter tippt und speichert, bekommt den Konfliktsatz des Servers am Feld, der
 * nennt, wie viele schon eingetragen sind. Verworfen: die Eingabe still auf die Belegung
 * hochzusetzen, denn dann staende eine Zahl da, die niemand getippt hat.
 */
@Component({
	selector: 'jf-helfer-felder',
	imports: [FristFelderComponent, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="felder">
			<label class="feld">
				Überschrift (optional)
				<input
					type="text"
					name="titel"
					autocomplete="off"
					[value]="modul().titel ?? ''"
					[attr.aria-invalid]="fehlerAn('titel') ? 'true' : null"
					[attr.aria-describedby]="fehlerAn('titel') ? fehlerId('titel') : null"
					(input)="titelSetzen(wert($event))"
				/>
			</label>
			@if (fehlerAn('titel'); as text) {
				<p class="fehler" role="alert" [id]="fehlerId('titel')">{{ text }}</p>
			}

			<label class="feld">
				Einheit
				<select
					name="einheit"
					[disabled]="einheitFest()"
					[attr.aria-invalid]="fehlerAn('einheit') ? 'true' : null"
					[attr.aria-describedby]="einheitBeschreibung()"
					(change)="setzen({ einheit: wertAlsEinheit($event) })"
				>
					@for (e of einheiten(); track e) {
						<option [value]="e" [selected]="e === modul().einheit">{{ einheitText[e] }}</option>
					}
					@if (fremdeEinheit(); as e) {
						<option [value]="e" selected>{{ einheitText[e] }} (passt nicht zur Zielgruppe)</option>
					}
				</select>
			</label>
			@if (einheitFest()) {
				<p class="hinweis gedaempft klein" [id]="feldId('einheit-hinweis')">{{ einheitGesperrt }}</p>
			}
			@if (fehlerAn('einheit'); as text) {
				<p class="fehler" role="alert" [id]="fehlerId('einheit')">{{ text }}</p>
			}

			<fieldset class="positionen">
				<legend>Positionen</legend>
				<ol class="positionsliste">
					@for (p of modul().positionen; track $index; let i = $index; let erste = $first; let letzte = $last) {
						<li [attr.data-position]="i">
							<input
								type="text"
								class="positionstext"
								[name]="'position-' + i"
								autocomplete="off"
								[maxLength]="grenzen.positionText"
								[attr.aria-label]="'Position ' + (i + 1)"
								[attr.aria-invalid]="fehlerAn('positionen') ? 'true' : null"
								[attr.aria-describedby]="fehlerAn('positionen') ? fehlerId('positionen') : null"
								[value]="p.text"
								(input)="positionSetzen(i, { text: wert($event) })"
							/>
							<label class="anzahl">
								<span class="gedaempft klein" aria-hidden="true">Anzahl</span>
								<input
									type="number"
									inputmode="numeric"
									[name]="'anzahl-' + i"
									[min]="mindestens(p)"
									[max]="grenzen.anzahl"
									step="1"
									[attr.aria-label]="'Anzahl: Position ' + (i + 1)"
									[attr.aria-invalid]="fehlerAn('positionen') ? 'true' : null"
									[attr.aria-describedby]="fehlerAn('positionen') ? fehlerId('positionen') : null"
									[value]="p.anzahl"
									(input)="anzahlSetzen(i, wert($event))"
									(blur)="gleicheAb($event, p.anzahl)"
								/>
							</label>
							<span class="knoepfe">
								<button
									type="button"
									class="knopf leise nur-icon"
									[attr.aria-label]="'Nach oben: Position ' + (i + 1)"
									[disabled]="erste"
									(click)="schieben(i, -1)"
								>
									<jf-icon name="hoch" />
								</button>
								<button
									type="button"
									class="knopf leise nur-icon"
									[attr.aria-label]="'Nach unten: Position ' + (i + 1)"
									[disabled]="letzte"
									(click)="schieben(i, 1)"
								>
									<jf-icon name="runter" />
								</button>
								<button
									type="button"
									class="knopf leise nur-icon"
									[attr.aria-label]="'Entfernen: Position ' + (i + 1)"
									[disabled]="belegt(p) > 0"
									[attr.aria-describedby]="belegt(p) > 0 ? feldId('position-' + i + '-grund') : null"
									(click)="entfernen(i)"
								>
									<jf-icon name="schliessen" />
								</button>
								<!-- Ein gesperrter Knopf ohne Grund waere fuer Screenreader nur "nicht verfuegbar". -->
								@if (belegt(p) > 0) {
									<span class="unsichtbar" [id]="feldId('position-' + i + '-grund')">Hat schon Einträge</span>
								}
							</span>
						</li>
					}
				</ol>
				@if (fehlerAn('positionen'); as text) {
					<p class="fehler" role="alert" [id]="fehlerId('positionen')">{{ text }}</p>
				}
				<div>
					<button
						type="button"
						class="knopf klein hinzufuegen"
						[disabled]="modul().positionen.length >= grenzen.positionen"
						(click)="hinzufuegen()"
					>
						<jf-icon name="plus" />
						Position hinzufügen
					</button>
				</div>
			</fieldset>

			<jf-frist-felder
				[frist]="modul().frist"
				[fehler]="fehlerAn('frist')"
				[fehlerId]="fehlerId('frist')"
				(aendern)="setzen({ frist: $event })"
			/>
		</div>
	`,
	styles: `
		:host {
			display: block;
		}
		.felder {
			display: grid;
			gap: var(--a3);
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
		.positionsliste {
			display: grid;
			gap: var(--a2);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		/* Am Rechner eine Zeile; am Handy rutschen Anzahl und Knoepfe unter den Text, statt ihn auf ein paar Zeichen zu quetschen. */
		.positionsliste li {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a1) var(--a2);
		}
		.positionstext {
			flex: 1 1 12rem;
			min-width: 0;
		}
		.positionstext,
		.anzahl input {
			min-height: var(--tippflaeche);
			padding: var(--a2) var(--a3);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--karte);
			color: var(--text);
			font: inherit;
		}
		.anzahl {
			display: inline-flex;
			align-items: center;
			gap: var(--a1);
		}
		.anzahl input {
			width: 4.5rem;
		}
		.knoepfe {
			display: inline-flex;
			gap: var(--a1);
		}
		[aria-invalid='true'] {
			border-color: var(--fehler);
		}
		.hinweis,
		.fehler {
			margin: 0;
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class HelferFelderComponent {
	readonly modul = input.required<Helfer>();
	readonly index = input.required<number>();
	readonly rollenfilter = input.required<Rollenfilter>();
	/** Null: keine gespeicherte Helferliste (neues Modul), also nichts gesperrt. */
	readonly sperre = input.required<HelferSperre | null>();
	/** Die Fehler dieses Moduls (Pfad module.N.feld); gezeigt wird, was zeigtModulFeld nennt. */
	readonly fehler = input<readonly Feldfehler[]>([]);
	readonly aendern = output<Helfer>();

	protected readonly grenzen = GRENZEN;
	protected readonly einheitText = EINHEIT_TEXT;
	protected readonly einheitGesperrt = HELFER_EINHEIT_GESPERRT;
	protected readonly wert = wertVon;

	protected readonly einheiten = computed(() => einheitenFuer(this.rollenfilter()));
	protected readonly fremdeEinheit = computed(() => {
		const e = this.modul().einheit;
		return this.einheiten().includes(e) ? null : e;
	});
	protected readonly einheitFest = computed(() => this.sperre()?.eingetragen ?? false);
	protected readonly einheitBeschreibung = computed(() => {
		const ids = [
			...(this.einheitFest() ? [this.feldId('einheit-hinweis')] : []),
			...(this.fehlerAn('einheit') ? [this.fehlerId('einheit')] : []),
		];
		return ids.length > 0 ? ids.join(' ') : null;
	});

	// Wie in jf-modul-felder: je Feld der erste Fehler, und nur Felder aus zeigtModulFeld, damit die
	// Vorlage nie mehr zeigt, als der Editor ihr zutraut.
	private readonly fehlerNachFeld = computed(() => {
		const vorsatz = `module.${this.index()}.`;
		const modul = this.modul();
		const karte = new Map<string, string>();
		for (const f of this.fehler()) {
			const feld = f.feld.slice(vorsatz.length);
			if (f.feld.startsWith(vorsatz) && zeigtModulFeld(modul, feld) && !karte.has(feld)) karte.set(feld, f.text);
		}
		return karte;
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

	/** Eintraege an dieser Position; eine neue (ohne Schluessel) hat keine. Am Schluessel, nicht an der Stelle. */
	protected belegt(p: PositionEntwurf): number {
		return p.schluessel === null ? 0 : (this.sperre()?.belegt[p.schluessel] ?? 0);
	}

	protected mindestens(p: PositionEntwurf): number {
		return Math.max(1, this.belegt(p));
	}

	protected wertAlsEinheit(e: Event): AntwortEinheit {
		return wertVon(e) as AntwortEinheit;
	}

	// ---- Aenderungen: immer ein neues Modul melden, nie das alte anfassen ----

	protected setzen(teil: Partial<Helfer>): void {
		this.aendern.emit({ ...this.modul(), ...teil });
	}

	protected titelSetzen(titel: string): void {
		this.setzen({ titel: titel === '' ? null : titel });
	}

	private positionenSetzen(positionen: PositionEntwurf[]): void {
		this.setzen({ positionen });
	}

	protected positionSetzen(i: number, teil: Partial<PositionEntwurf>): void {
		this.positionenSetzen(this.modul().positionen.map((p, j) => (j === i ? { ...p, ...teil } : p)));
	}

	// Ein geleertes Feld ist mitten im Tippen keine Anzahl: nicht melden, sonst stuende NaN im
	// Entwurf (als JSON null). Beim Verlassen springt es auf den Stand des Moduls zurueck. Was
	// ausserhalb von 1 bis 99 liegt, geht dagegen in den Entwurf, damit entwurfFehler es benennt.
	protected anzahlSetzen(i: number, wert: string): void {
		const anzahl = Number(wert);
		if (wert.trim() === '' || !Number.isFinite(anzahl)) return;
		this.positionSetzen(i, { anzahl });
	}

	protected gleicheAb(e: Event, stand: number): void {
		const feld = e.target as HTMLInputElement;
		if (feld.value !== String(stand)) feld.value = String(stand);
	}

	protected hinzufuegen(): void {
		this.positionenSetzen([...this.modul().positionen, { schluessel: null, text: '', anzahl: 1 }]);
	}

	protected entfernen(i: number): void {
		this.positionenSetzen(this.modul().positionen.filter((_, j) => j !== i));
	}

	protected schieben(i: number, richtung: -1 | 1): void {
		const ziel = i + richtung;
		const positionen = [...this.modul().positionen];
		const hier = positionen[i];
		const dort = positionen[ziel];
		if (hier === undefined || dort === undefined) return;
		positionen[i] = dort;
		positionen[ziel] = hier;
		this.positionenSetzen(positionen);
	}
}
