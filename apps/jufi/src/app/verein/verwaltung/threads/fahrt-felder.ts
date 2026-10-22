import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
	type FahrtSperre,
	type Feldfehler,
	type ModulEntwurf,
	type Richtung,
	RICHTUNG_TEXT,
	RICHTUNGEN,
} from '@jufi/domain';
import { wertVon } from '../../../gemeinsam/formular';
import { zeigtModulFeld } from './modul-felder';

type Fahrt = Extract<ModulEntwurf, { typ: 'FAHRT' }>;

/** Das Feld des Entwurfs (und des Fehlerpfads) je Richtung. */
const FELD = { HIN: 'hin', RUECK: 'rueck' } as const satisfies Record<Richtung, 'hin' | 'rueck'>;

/** Der Grund neben einem gesperrten Kaestchen; den Konfliktsatz des Servers gibt es erst nach dem Speichern. */
const GRUND = 'Hat schon Autos oder Mitfahrten.';

/**
 * Die Felder einer Fahrgemeinschaft im Editor: Ueberschrift und je ein Kaestchen fuer Hin- und
 * Rueckfahrt. Eigene Komponente neben jf-modul-felder (TP4-Spec 10), wie Dateien, Fotos und
 * Helferliste: Deren Datei traegt Umfrage, Termin und Info schon genug, und die Sperre je
 * Richtung ist eine eigene Logik.
 *
 * Gesteuert wie jf-helfer-felder: Jede Eingabe meldet ein neues Modul ueber aendern, der Editor
 * haelt den Entwurf.
 *
 * Eine Richtung mit Autos oder Mitfahrten laesst sich nicht abschalten (Plan-Entscheidung 10,
 * pruefeFahrtAenderung); das Kaestchen ist dann gesperrt, mit denselben Zahlen wie der Server
 * (fahrtSperre). Der Grund steht als Satz daneben. Verworfen: der Grund nur fuer Screenreader wie
 * bei der Helferliste (Etappe 3, Eigentuemerfrage B2), denn ein graues Kaestchen ohne Satz laesst
 * Sehende raten.
 *
 * Die Texte der Fehler kommen vom Server (entwurfFehler und vergleich.ts), diese Komponente
 * erfindet keine eigenen Pruefsaetze. "typ" (zweite Fahrgemeinschaft) hat kein Feld und steht als
 * Satz oben im Modul.
 */
@Component({
	selector: 'jf-fahrt-felder',
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
			@if (fehlerAn('typ'); as text) {
				<p class="fehler" role="alert" [id]="fehlerId('typ')">{{ text }}</p>
			}

			<fieldset class="richtungen">
				<legend>Richtungen</legend>
				@for (r of richtungen; track r) {
					<div class="richtung">
						<label class="haken">
							<input
								type="checkbox"
								[name]="feld[r]"
								[checked]="modul()[feld[r]]"
								[disabled]="gesperrt(r)"
								[attr.aria-invalid]="fehlerAn(feld[r]) ? 'true' : null"
								[attr.aria-describedby]="beschreibung(r)"
								(change)="richtungSetzen(r, haken($event))"
							/>
							{{ richtungText[r] }}
						</label>
						@if (gesperrt(r)) {
							<p class="grund gedaempft klein" [id]="feldId(feld[r] + '-grund')">{{ grund }}</p>
						}
						@if (fehlerAn(feld[r]); as text) {
							<p class="fehler" role="alert" [id]="fehlerId(feld[r])">{{ text }}</p>
						}
					</div>
				}
			</fieldset>
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
			gap: var(--a1);
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
		.richtung {
			display: grid;
		}
		.grund,
		.fehler {
			margin: 0;
		}
		.fehler {
			color: var(--fehler);
		}
		[aria-invalid='true'] {
			outline: 2px solid var(--fehler);
			outline-offset: 2px;
		}
	`,
})
export class FahrtFelderComponent {
	readonly modul = input.required<Fahrt>();
	readonly index = input.required<number>();
	/** Null: keine gespeicherte Fahrgemeinschaft (neues Modul), also nichts gesperrt. */
	readonly sperre = input.required<FahrtSperre | null>();
	/** Die Fehler dieses Moduls (Pfad module.N.feld); gezeigt wird, was zeigtModulFeld nennt. */
	readonly fehler = input<readonly Feldfehler[]>([]);
	readonly aendern = output<Fahrt>();

	protected readonly richtungen = RICHTUNGEN;
	protected readonly richtungText = RICHTUNG_TEXT;
	protected readonly feld = FELD;
	protected readonly grund = GRUND;
	protected readonly wert = wertVon;

	// Wie in jf-helfer-felder: je Feld der erste Fehler, und nur Felder aus zeigtModulFeld, damit die
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

	protected gesperrt(r: Richtung): boolean {
		return this.sperre()?.[r] ?? false;
	}

	/** Der Grund und der Fehler dieses Kaestchens, damit Screenreader beides mit dem Kaestchen lesen. */
	protected beschreibung(r: Richtung): string | null {
		const feld = FELD[r];
		const ids = [
			...(this.gesperrt(r) ? [this.feldId(`${feld}-grund`)] : []),
			...(this.fehlerAn(feld) ? [this.fehlerId(feld)] : []),
		];
		return ids.length > 0 ? ids.join(' ') : null;
	}

	protected haken(e: Event): boolean {
		return (e.target as HTMLInputElement).checked;
	}

	// ---- Aenderungen: immer ein neues Modul melden, nie das alte anfassen ----

	protected titelSetzen(titel: string): void {
		this.aendern.emit({ ...this.modul(), titel: titel === '' ? null : titel });
	}

	protected richtungSetzen(r: Richtung, an: boolean): void {
		this.aendern.emit({ ...this.modul(), [FELD[r]]: an });
	}
}
