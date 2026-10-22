import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { berlinerTag, berlinerUhrzeit, berlinZeitpunkt } from '@jufi/domain';
import { wertVon } from '../../../gemeinsam/formular';

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

/**
 * Datum, Uhrzeit und "ohne Frist" einer Frist in Berliner Zeit, gemeinsam fuer Umfrage und
 * Helferliste. Herausgeloest statt in jf-helfer-felder kopiert: Die Eingabe hat ihre Tuecken
 * (halbe Jahre beim Tippen, Uhrzeit ohne Datum, Zuruecksetzen beim Verlassen), und zwei Kopien
 * liefen beim naechsten Fund auseinander. Gesteuert wie die Modulfelder: Die Frist kommt herein,
 * jede fertige Eingabe meldet die neue als UTC-ISO oder null.
 */
@Component({
	selector: 'jf-frist-felder',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
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
						[attr.aria-invalid]="fehler() ? 'true' : null"
						[attr.aria-describedby]="fehler() ? fehlerId() : null"
						(input)="fristTagSetzen(wert($event))"
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
						[attr.aria-invalid]="fehler() ? 'true' : null"
						[attr.aria-describedby]="fehler() ? fehlerId() : null"
						(input)="fristZeitSetzen(wert($event))"
						(blur)="gleicheAb($event, fristZeit())"
					/>
				</label>
			</div>
			<label class="haken">
				<input type="checkbox" name="ohneFrist" [checked]="ohneFrist()" (change)="ohneFristSetzen(haken($event))" />
				ohne Frist
			</label>
			@if (fehler(); as text) {
				<p class="fehler" role="alert" [id]="fehlerId()">{{ text }}</p>
			}
		</fieldset>
	`,
	styles: `
		:host {
			display: block;
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
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		.reihe > .feld {
			flex: 1 1 8rem;
			min-width: 0;
		}
		[aria-invalid='true'] {
			border-color: var(--fehler);
		}
		.fehler {
			margin: 0;
			color: var(--fehler);
		}
	`,
})
export class FristFelderComponent {
	/** UTC-ISO oder null fuer "ohne Frist". */
	readonly frist = input.required<string | null>();
	/** Der Satz am Feld, sonst null. */
	readonly fehler = input<string | null | undefined>(null);
	/** Die ID des Fehlersatzes; der Besitzer vergibt sie, damit sie je Modul eindeutig ist. */
	readonly fehlerId = input.required<string>();
	readonly aendern = output<string | null>();

	protected readonly wert = wertVon;
	protected haken(e: Event): boolean {
		return (e.target as HTMLInputElement).checked;
	}

	// Die Frist steht im Modul als UTC-ISO, im Formular als Berliner Tag und Uhrzeit. Lokal
	// gehalten und aus der Eingabe nachgefuehrt: Ein Datum ohne Uhrzeit oder umgekehrt ist noch
	// kein Zeitpunkt und kaeme sonst nie ins Modul. linkedSignal statt effect, damit die Eingabe
	// nicht eine Runde zu spaet zurueckspringt. Die Quelle ist der Frist-Wert (eine Zeichenkette),
	// nicht das Modul: Jede andere Eingabe meldet ein neues Modulobjekt, und an dessen Identitaet
	// gekoppelt wuerde sie den lokalen Stand (halbe Eingabe, abgewaehltes "ohne Frist") verwerfen.
	protected readonly ohneFrist = linkedSignal(() => this.frist() === null);
	protected readonly fristTag = linkedSignal(() => {
		const f = this.frist();
		return f ? berlinerTag(new Date(f)) : '';
	});
	protected readonly fristZeit = linkedSignal(() => {
		const f = this.frist();
		return f ? berlinerUhrzeit(new Date(f)) : '';
	});

	// Waehrend des Tippens meldet der Browser auch Zwischenstaende: '' bei einem geleerten
	// Segment, "0002-10-22" auf dem Weg zu "2026-10-22". Beides ist keine Frist. Weder melden
	// noch ins Feld zurueckschreiben (das binding nimmt dem Tippenden sonst das Segment unter
	// den Fingern weg); abgeschaltet wird nur ueber "ohne Frist". Verworfen: (change) statt
	// (input): Chrome meldet change auch fuer jedes gueltige Zwischenjahr und fuer ein
	// geleertes Feld, es loeste also nichts. Beim Verlassen springt das Feld auf den Stand des
	// Moduls zurueck (gleicheAb).
	protected fristTagSetzen(tag: string): void {
		if (!istPlausiblerTag(tag)) return;
		this.fristTag.set(tag);
		const zeit = this.fristZeit() || FRIST_UHRZEIT;
		this.fristZeit.set(zeit);
		this.ohneFrist.set(false);
		this.aendern.emit(berlinZeitpunkt(tag, zeit).toISOString());
	}

	protected fristZeitSetzen(wert: string): void {
		if (!UHRZEIT.test(wert)) return;
		this.fristZeit.set(wert);
		const tag = this.fristTag();
		// Ohne Datum merkt sich das Feld die Uhrzeit nur; das Datum macht sie zum Zeitpunkt.
		if (tag === '') return;
		this.aendern.emit(berlinZeitpunkt(tag, wert).toISOString());
	}

	protected gleicheAb(e: Event, stand: string): void {
		const feld = e.target as HTMLInputElement;
		if (feld.value !== stand) feld.value = stand;
	}

	protected ohneFristSetzen(ohne: boolean): void {
		this.ohneFrist.set(ohne);
		if (!ohne) return;
		this.fristTag.set('');
		this.fristZeit.set('');
		this.aendern.emit(null);
	}
}
