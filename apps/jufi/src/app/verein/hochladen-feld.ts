import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { DateiArt } from '@jufi/domain';
import { IconComponent } from '../gestaltung/icon';
import { DateienApi } from './dateien-api';
import { ENDUNGEN_DATEI } from './dateien-anzeige';
import { Hochladeschlange } from './hochladeschlange';
import { zurAnmeldung } from './sitzung-abgelaufen';

/**
 * Fotos kommen ueber image/* (TP4-Spec 2.3): Am iPhone wandelt der Browser HEIC dabei selbst in
 * JPEG, eine Endungsliste liesse es gar nicht erst zur Auswahl zu. Verworfen: die Typen einzeln
 * nennen (image/jpeg,image/png,image/webp), denn dann bietet iOS HEIC-Fotos nur als Datei an und
 * der Server lehnt sie mit HEIC ab.
 */
const ACCEPT: Record<DateiArt, string> = { FOTO: 'image/*', DATEI: ENDUNGEN_DATEI };

/**
 * Knopf zur Dateiauswahl samt Liste der Uploads darunter: Je Datei eine Zeile mit Name oder
 * Vorschaubild, Balken beim Senden, "Wartet", Fehlertext, "Nochmal" und "Verwerfen". Die Zeilen
 * verschwinden von selbst, sobald der Server die Datei hat; was dann zu zeigen ist, entscheidet
 * die Seite ueber hochgeladen (sie laedt neu).
 *
 * Die Schlange entsteht erst bei der ersten Auswahl: Die Thread-Seite wird auch auf dem Server
 * gerendert, und der Upload-Client (XHR) soll dort nicht einmal gebaut werden.
 *
 * Der Slug ist Eingabe, weil ein 401 mitten im Upload denselben Weg zur Anmeldung nimmt wie jede
 * andere Anfrage der Seite (zurAnmeldung), und der fuehrt ueber den Slug. Verworfen: ihn aus der
 * Adresse des Ziels zu schneiden; das koppelte die Komponente an den Aufbau der Server-Routen.
 */
@Component({
	selector: 'jf-hochladen-feld',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<label class="knopf leise datei">
			<jf-icon name="plus" /> {{ beschriftung() }}
			<!-- Der Name steht am Feld: Ein aria-label am label wuerde das Feld darin nicht benennen. -->
			<input
				type="file"
				class="unsichtbar"
				data-hochladen
				multiple
				[accept]="accept()"
				[attr.aria-label]="beschriftung()"
				(change)="waehle($event)"
			/>
		</label>
		@if (reihe().length > 0) {
			<ul>
				@for (h of reihe(); track h.schluessel) {
					<li [attr.data-hochladung]="h.schluessel">
						<div class="kopf">
							@if (h.vorschau; as bild) {
								<img class="vorschau" [src]="bild" alt="" />
							}
							<span class="name">{{ h.datei.name }}</span>
						</div>
						@switch (h.zustand) {
							@case ('laeuft') {
								<progress max="1" [value]="h.anteil" [attr.aria-label]="'Fortschritt von ' + h.datei.name"></progress>
							}
							@case ('wartet') {
								<span class="gedaempft klein">Wartet</span>
							}
							@case ('fehler') {
								<p class="fehler" role="alert">{{ h.fehler }}</p>
								<span class="reihe">
									<button type="button" class="knopf klein" (click)="nochmal(h.schluessel)">Nochmal</button>
									<button type="button" class="knopf klein" (click)="verwirf(h.schluessel)">Verwerfen</button>
								</span>
							}
						}
					</li>
				}
			</ul>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
			justify-items: start;
		}
		/* Das Dateifeld sitzt im Knopf und ist unsichtbar, aber per Tab erreichbar; den Rahmen bekommt der Knopf. */
		.datei {
			position: relative;
			cursor: pointer;
		}
		.datei:focus-within {
			outline: 2px solid var(--akzent);
			outline-offset: 2px;
		}
		ul {
			display: grid;
			gap: var(--a2);
			width: 100%;
			margin: 0;
			padding: 0;
			list-style: none;
		}
		li {
			display: grid;
			gap: var(--a2);
			padding-top: var(--a2);
			border-top: 1px solid var(--linie);
			overflow-wrap: anywhere;
		}
		.kopf {
			display: flex;
			align-items: center;
			gap: var(--a3);
			min-width: 0;
		}
		.vorschau {
			width: 3rem;
			height: 3rem;
			object-fit: cover;
			border-radius: var(--radius);
			flex: none;
		}
		.name {
			font-weight: 600;
		}
		p {
			margin: 0;
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
		progress {
			width: 100%;
			accent-color: var(--akzent);
		}
		.fehler {
			color: var(--fehler);
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
		.klein {
			font-size: var(--schrift-klein);
		}
	`,
})
export class HochladenFeldComponent {
	readonly slug = input.required<string>();
	/** Die Adresse, an die jede Datei geht (siehe DateienApi.modulDateienAdresse und modulFotosAdresse). */
	readonly ziel = input.required<string>();
	readonly art = input.required<DateiArt>();
	readonly beschriftung = input.required<string>();
	/** Je angenommene Datei, mit der Antwort des Servers. */
	readonly hochgeladen = output<unknown>();

	private readonly api = inject(DateienApi);
	private readonly router = inject(Router);
	private readonly schlange = signal<Hochladeschlange | null>(null);

	protected readonly accept = computed(() => ACCEPT[this.art()]);
	protected readonly reihe = computed(() => this.schlange()?.reihe() ?? []);

	constructor() {
		inject(DestroyRef).onDestroy(() => this.schlange()?.beende());
	}

	protected waehle(ereignis: Event): void {
		const eingabe = ereignis.target as HTMLInputElement;
		const dateien = [...(eingabe.files ?? [])];
		// Geleert, damit dieselbe Datei nach einer Korrektur noch einmal gewaehlt werden kann (sonst feuert change nicht).
		eingabe.value = '';
		if (dateien.length === 0) return;
		this.schlangeHolen().fuegeHinzu(dateien, this.ziel());
	}

	protected nochmal(schluessel: number): void {
		this.schlange()?.nochmal(schluessel);
	}

	protected verwirf(schluessel: number): void {
		this.schlange()?.verwirf(schluessel);
	}

	private schlangeHolen(): Hochladeschlange {
		let s = this.schlange();
		if (s === null) {
			s = new Hochladeschlange({
				http: this.api.hochlader(),
				art: this.art(),
				nachErfolg: (_h, antwort) => this.hochgeladen.emit(antwort),
				beiNichtAngemeldet: () => void zurAnmeldung(this.router, this.slug()),
			});
			this.schlange.set(s);
		}
		return s;
	}
}
