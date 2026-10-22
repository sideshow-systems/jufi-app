import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	inject,
	Injector,
	input,
	linkedSignal,
	output,
	signal,
} from '@angular/core';
import { type AutoEingabe, GRENZEN, pruefeAuto } from '@jufi/domain';

export type AutoFeld = keyof AutoEingabe;

/** Die Felder der Eingabe, auch fuer die Antwort 400 des Servers, die nur den Namen nennt. */
export const AUTO_FELDER: readonly AutoFeld[] = ['plaetze', 'abfahrtTag', 'abfahrtZeit', 'ort', 'notiz'];

/** Die Werte der Felder als Text, wie die Eingabefelder sie halten. */
export type AutoStart = Record<AutoFeld, string>;

// Die Saetze zu den Feldern kennt nur der Client: Der Server nennt bei 400 nur das Feld, und die
// Vorpruefung mit pruefeAuto meldet dasselbe Feld, damit beide Wege denselben Satz zeigen.
export const FELD_TEXT: Readonly<Record<AutoFeld, string>> = {
	plaetze: `Bitte 1 bis ${GRENZEN.plaetze} Plätze angeben.`,
	abfahrtTag: 'Bitte einen gültigen Tag angeben.',
	abfahrtZeit: 'Bitte die Uhrzeit als HH:MM angeben.',
	ort: `Höchstens ${GRENZEN.autoText} Zeichen, ohne Steuerzeichen.`,
	notiz: `Höchstens ${GRENZEN.autoText} Zeichen, ohne Steuerzeichen.`,
};

interface FeldBeschreibung {
	name: AutoFeld;
	beschriftung: string;
	typ: string;
	zahl: boolean;
}

const FELD_LISTE: readonly FeldBeschreibung[] = [
	{ name: 'plaetze', beschriftung: 'Plätze für Kinder', typ: 'number', zahl: true },
	{ name: 'abfahrtTag', beschriftung: 'Abfahrt am', typ: 'date', zahl: false },
	{ name: 'abfahrtZeit', beschriftung: 'Uhrzeit', typ: 'time', zahl: false },
	{ name: 'ort', beschriftung: 'Treffpunkt', typ: 'text', zahl: false },
	{ name: 'notiz', beschriftung: 'Notiz (optional)', typ: 'text', zahl: false },
];

/** Je Formular eine Nummer fuer die ids der Fehlersaetze. */
let nummer = 0;

/**
 * Das Formular zum Anbieten und Aendern eines Autos (Spec 6.2). Es haelt nur die Eingabe und ihre
 * Fehler; senden, sperren und die Fehler des Servers entscheidet die Karte der Fahrgemeinschaft.
 * Eigene Datei, weil die Karte sonst ueber die Haelfte aus Feldern bestuende.
 *
 * Die Vorpruefung nutzt dieselbe Regel wie der Server (pruefeAuto) und erspart den Weg ueber eine
 * 400 im Ratenfenster; der Server bleibt die Instanz, die entscheidet. Leere Felder gehen als
 * null. Der Satz zu einem Feld steht unter dem Feld und verschwindet, sobald es sich aendert.
 */
@Component({
	selector: 'jf-fahrt-auto-formular',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<form novalidate (submit)="senden($event)">
			@for (f of felder; track f.name; let erstes = $first) {
				<div class="gruppe" [attr.data-feld]="f.name">
					<label class="feld">
						<span>{{ f.beschriftung }}</span>
						<input
							[attr.data-erstes]="erstes ? '' : null"
							[name]="f.name"
							[type]="f.typ"
							[attr.inputmode]="f.zahl ? 'numeric' : null"
							[attr.min]="f.zahl ? 1 : null"
							[attr.max]="f.zahl ? grenzen.plaetze : null"
							[attr.maxlength]="f.typ === 'text' ? grenzen.autoText : null"
							[attr.autocomplete]="f.typ === 'text' ? 'off' : null"
							[attr.aria-invalid]="fehler()[f.name] ? 'true' : null"
							[attr.aria-describedby]="fehler()[f.name] ? fehlerId(f.name) : null"
							[value]="werte()[f.name]"
							[disabled]="gesperrt()"
							(input)="tippe(f.name, $event)"
						/>
					</label>
					@if (fehler()[f.name]; as text) {
						<p class="fehler" role="alert" [id]="fehlerId(f.name)">{{ text }}</p>
					}
				</div>
			}
			<div class="aktionen">
				<button type="submit" class="knopf primaer klein" [disabled]="gesperrt()">
					{{ aendern() ? 'Speichern' : 'Anbieten' }}
				</button>
				<button type="button" class="knopf klein" [disabled]="gesperrt()" (click)="abgebrochen.emit()">
					Abbrechen
				</button>
			</div>
		</form>
	`,
	styles: `
		form {
			display: grid;
			gap: var(--a2);
		}
		input {
			min-width: 0;
		}
		.gruppe {
			display: grid;
			gap: var(--a1);
		}
		.aktionen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
		.fehler {
			margin: 0;
			color: var(--fehler);
		}
	`,
})
export class FahrtAutoFormular {
	/** Die Vorbelegung: leer fuer ein neues Auto (nur der Tag nach Vorschlag), sonst die Werte des Autos. */
	readonly start = input.required<AutoStart>();
	/** Aendern statt Anbieten: nur die Beschriftung des Knopfes, die Route waehlt die Karte. */
	readonly aendern = input(false);
	readonly gesperrt = input(false);
	readonly abgeschickt = output<AutoEingabe>();
	readonly abgebrochen = output<void>();

	protected readonly felder = FELD_LISTE;
	protected readonly grenzen = GRENZEN;
	protected readonly werte = linkedSignal<AutoStart>(() => this.start());
	protected readonly fehler = signal<Partial<Record<AutoFeld, string>>>({});

	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly injector = inject(Injector);
	private readonly id = nummer++;

	constructor() {
		// Wer Auto anbieten oder Auto aendern drueckt, will gleich tippen.
		this.fokussiere('plaetze');
	}

	/**
	 * Der Satz zu einem Feld, das der Server abgewiesen hat (400 mit feld, 409 PLAETZE); ohne Text
	 * der Satz der Vorpruefung. Der Fokus geht in das Feld.
	 */
	zeigeFehler(feld: AutoFeld, text: string = FELD_TEXT[feld]): void {
		this.fehler.set({ [feld]: text });
		this.fokussiere(feld);
	}

	protected fehlerId(feld: AutoFeld): string {
		return `fahrt-auto-${this.id}-fehler-${feld}`;
	}

	protected tippe(feld: AutoFeld, e: Event): void {
		this.werte.update((w) => ({ ...w, [feld]: (e.target as HTMLInputElement).value }));
		this.fehler.update((alt) => {
			const neu = { ...alt };
			delete neu[feld];
			return neu;
		});
	}

	protected senden(ereignis: Event): void {
		ereignis.preventDefault();
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (this.gesperrt()) return;
		const w = this.werte();
		const leer = (t: string) => (t.trim() === '' ? null : t.trim());
		const pruefung = pruefeAuto({
			plaetze: Number(w.plaetze),
			abfahrtTag: leer(w.abfahrtTag),
			abfahrtZeit: leer(w.abfahrtZeit),
			ort: leer(w.ort),
			notiz: leer(w.notiz),
		});
		if (!pruefung.ok) {
			this.zeigeFehler(pruefung.feld);
			return;
		}
		this.fehler.set({});
		this.abgeschickt.emit(pruefung.auto);
	}

	// Erst nach dem Zeichnen: Das Feld gibt es beim Erzeugen noch nicht, und ein Fehlersatz aendert
	// die Zeichnung vor dem Fokus.
	private fokussiere(feld: AutoFeld): void {
		afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`[name="${feld}"]`)?.focus(), {
			injector: this.injector,
		});
	}
}
