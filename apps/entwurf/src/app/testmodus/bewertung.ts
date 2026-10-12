import {
	afterRenderEffect,
	ChangeDetectionStrategy,
	Component,
	computed,
	ElementRef,
	inject,
	signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import { MeldungService } from '../gestaltung/meldung';
import { aktuellerPfad } from './ort';
import { RueckmeldungDialog } from './rueckmeldung';
import { TM_STIL } from './stil';
import { TestmodusService } from './testmodus';
import type { Ergebnis } from './typen';

const STATUS: Record<Ergebnis['ausgang'], [string, string]> = {
	geschafft: ['✅', 'geschafft'],
	nichtWeiter: ['❌', 'nicht weiter'],
	uebersprungen: ['⏭', 'übersprungen'],
	schonErledigt: ['☑️', 'schon erledigt'],
};

const SMILEYS: { wert: NonNullable<Ergebnis['smiley']>; zeichen: string; text: string }[] = [
	{ wert: 'gut', zeichen: '😀', text: 'Leicht' },
	{ wert: 'mittel', zeichen: '😐', text: 'Es ging' },
	{ wert: 'schlecht', zeichen: '😟', text: 'Schwer' },
];

/**
 * Die Dialoge des Testmodus (Spec TP1 5.4): Bewertung nach jeder Aufgabe,
 * "Wo haengst du?", Aufgabenliste, Notiz zur Seite und die Rueckfrage vor dem
 * Zuruecksetzen. Die Rueckmeldung selbst steht in rueckmeldung.ts.
 */
@Component({
	selector: 'jf-testmodus-dialoge',
	imports: [FormsModule, RueckmeldungDialog],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown.escape)': 'abbrechen()' },
	template: `
		@if (testmodus.dialog(); as d) {
			<div class="ueberlagerung" (click)="abbrechen()">
				<div
					class="karte"
					role="dialog"
					aria-modal="true"
					[attr.aria-labelledby]="'tm-titel'"
					(click)="$event.stopPropagation()"
				>
					@switch (d.art) {
						@case ('geschafft') {
							<h2 id="tm-titel">Geschafft! Wie leicht war das?</h2>
							<div class="smileys" role="radiogroup" aria-label="Wie leicht war das?">
								@for (s of smileys; track s.wert) {
									<button
										type="button"
										role="radio"
										[attr.aria-checked]="smiley() === s.wert"
										[attr.aria-label]="s.text"
										[class.gewaehlt]="smiley() === s.wert"
										(click)="smiley.set(s.wert)"
									>
										{{ s.zeichen }}
									</button>
								}
							</div>
							<label class="feld">
								Was war unklar? (freiwillig)
								<textarea name="notiz" rows="2" [(ngModel)]="notiz"></textarea>
							</label>
							<button type="button" class="tm-knopf" (click)="weiter()">Weiter</button>
						}
						@case ('nichtWeiter') {
							<h2 id="tm-titel">Kein Problem!</h2>
							<p>Das hilft uns sehr. Magst du kurz sagen, wo du hängst?</p>
							<label class="feld">
								Wo hängst du? (freiwillig)
								<textarea name="notiz" rows="2" [(ngModel)]="notiz"></textarea>
							</label>
							<button type="button" class="tm-knopf" (click)="nichtWeiter()">Zur nächsten Aufgabe</button>
							<button type="button" class="tm-knopf leise" (click)="abbrechen()">Doch weiter versuchen</button>
						}
						@case ('liste') {
							<h2 id="tm-titel">Aufgaben für {{ store.person().vorname }}</h2>
							@if (testmodus.aufgaben().length) {
								<ol class="liste">
									@for (a of testmodus.aufgaben(); track a.id; let i = $index) {
										<li [class.aktuell]="i === testmodus.index() && aufgabenAn()">
											<span class="status" aria-hidden="true">{{ status(i) }}</span>
											<span>{{ a.text }}</span>
											<span class="unsichtbar">{{ statusText(i) }}</span>
										</li>
									}
								</ol>
							} @else {
								<p>Wähl zuerst eine Person über „Person wechseln".</p>
							}
							@if (testmodus.zustand().person && !aufgabenAn()) {
								<button type="button" class="tm-knopf" (click)="starten()">Aufgaben starten</button>
							}
							<button type="button" class="tm-knopf leise" (click)="abbrechen()">Schließen</button>
						}
						@case ('seite') {
							<h2 id="tm-titel">Rückmeldung zu dieser Seite</h2>
							<p class="klein gedaempft">{{ pfad() }}</p>
							<label class="feld">
								Was fällt dir hier auf?
								<textarea name="notiz" rows="3" [(ngModel)]="notiz"></textarea>
							</label>
							<button type="button" class="tm-knopf" (click)="seiteMerken()">Notiz merken</button>
							<button type="button" class="tm-knopf leise" (click)="abbrechen()">Abbrechen</button>
						}
						@case ('zuruecksetzen') {
							<h2 id="tm-titel">Entwurf zurücksetzen?</h2>
							<p>Alle Einträge, der Fortschritt und noch nicht gesendete Rückmeldungen gehen verloren.</p>
							<button type="button" class="tm-knopf gefahr" (click)="zuruecksetzen()">Zurücksetzen</button>
							<button type="button" class="tm-knopf leise" (click)="abbrechen()">Abbrechen</button>
						}
						@case ('rueckmeldung') {
							<jf-rueckmeldung (schliessen)="abbrechen()" />
						}
					}
				</div>
			</div>
		}
	`,
	styles: [
		TM_STIL,
		`
			.ueberlagerung {
				position: fixed;
				inset: 0;
				z-index: 300;
				display: grid;
				align-items: end;
				justify-items: center;
				padding: var(--a4) var(--a4) calc(var(--a4) + var(--sicher-unten));
				background: rgb(0 0 0 / 0.5);
			}
			@media (min-width: 600px) {
				.ueberlagerung {
					align-items: center;
				}
			}
			.karte {
				display: grid;
				gap: var(--a3);
				width: min(420px, 100%);
				max-height: calc(100dvh - 2 * var(--a4));
				overflow-y: auto;
				padding: var(--a5);
				border-top: 6px solid var(--tm);
				border-radius: var(--radius);
				background: var(--karte);
				box-shadow: var(--schatten);
			}
			h2 {
				margin: 0;
				font-size: var(--schrift-gross);
			}
			p {
				margin: 0;
			}
			.smileys {
				display: flex;
				justify-content: center;
				gap: var(--a4);
			}
			.smileys button {
				width: 64px;
				height: 64px;
				border: 2px solid var(--linie);
				border-radius: 50%;
				background: var(--seite);
				font-size: 2rem;
			}
			.smileys button.gewaehlt {
				border-color: var(--tm);
				background: var(--tm-flaeche);
			}
			.feld textarea {
				resize: vertical;
			}
			.liste {
				display: grid;
				gap: var(--a2);
				margin: 0;
				padding: 0;
				list-style: none;
			}
			.liste li {
				display: flex;
				gap: var(--a2);
				padding: var(--a2);
				border-radius: var(--radius-klein);
			}
			.liste li.aktuell {
				background: var(--tm-flaeche);
				font-weight: 600;
			}
			.status {
				flex: none;
				width: 1.5em;
				text-align: center;
			}
			.tm-knopf.gefahr {
				background: var(--fehler);
				border-color: var(--fehler);
			}
		`,
	],
})
export class TestmodusDialoge {
	protected readonly testmodus = inject(TestmodusService);
	protected readonly store = inject(EntwurfStore);
	private readonly router = inject(Router);
	private readonly meldung = inject(MeldungService);
	protected readonly pfad = aktuellerPfad();

	protected readonly smileys = SMILEYS;
	protected readonly smiley = signal<Ergebnis['smiley']>(undefined);
	protected notiz = '';
	protected readonly aufgabenAn = computed(() => this.testmodus.zustand().mitAufgaben);

	constructor() {
		const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
		// Neuer Dialog: Fokus auf den ersten Knopf (Tastatur, Vorleser). Nicht ins Textfeld,
		// sonst schiebt am Handy sofort die Tastatur den Dialog zu.
		afterRenderEffect(() => {
			if (!this.testmodus.dialog()) return;
			host.querySelector<HTMLElement>('.karte button')?.focus();
		});
	}

	protected status(i: number): string {
		const e = this.ergebnis(i);
		if (e) return STATUS[e.ausgang][0];
		return i === this.testmodus.index() && this.aufgabenAn() ? '▶' : '○';
	}

	protected statusText(i: number): string {
		const e = this.ergebnis(i);
		if (e) return STATUS[e.ausgang][1];
		return i === this.testmodus.index() ? 'aktuell' : 'offen';
	}

	protected weiter(): void {
		this.testmodus.bewerten(this.smiley(), this.notiz);
		this.leeren();
	}

	protected nichtWeiter(): void {
		this.testmodus.nichtWeiter(this.notiz);
		this.leeren();
	}

	protected starten(): void {
		this.testmodus.aufgabenStarten();
		this.abbrechen();
	}

	protected seiteMerken(): void {
		if (!this.notiz.trim()) {
			this.meldung.zeige('Schreib kurz, was dir auffällt');
			return;
		}
		this.testmodus.seitenNotiz(this.pfad(), this.notiz);
		this.meldung.zeige('Notiz gemerkt – sie kommt mit der Rückmeldung');
		this.abbrechen();
	}

	protected zuruecksetzen(): void {
		this.testmodus.allesZuruecksetzen();
		this.leeren();
		void this.router.navigateByUrl(`/${this.store.stand().verein.slug}/willkommen`);
	}

	/** Escape und Klick daneben: bei "Geschafft" ohne Bewertung weiter, sonst schliessen. */
	protected abbrechen(): void {
		const d = this.testmodus.dialog();
		if (!d) return;
		if (d.art === 'geschafft') {
			this.weiter();
			return;
		}
		this.testmodus.dialog.set(null);
		this.leeren();
	}

	private ergebnis(i: number): Ergebnis | undefined {
		const z = this.testmodus.zustand();
		const id = this.testmodus.aufgaben()[i]?.id;
		return z.person ? z.ergebnisse[z.person].find((e) => e.aufgabeId === id) : undefined;
	}

	private leeren(): void {
		this.smiley.set(undefined);
		this.notiz = '';
	}
}
