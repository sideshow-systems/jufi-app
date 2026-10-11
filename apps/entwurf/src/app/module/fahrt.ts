import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EntwurfStore } from '../daten/store';
import type { Auto, FahrModul, Id, Thread } from '../daten/typen';
import { MeldungService } from '../gestaltung/meldung';
import { freiePlaetze, mitfahrtOffen } from '../regeln/fahrt-kosten';
import { darf, kinderVon, person } from '../regeln/personen';
import { kinderImThread } from '../regeln/sichtbarkeit';

type Richtung = 'hin' | 'rueck';

/**
 * Fahrgemeinschaft nach Rahmen 6.4.1. Fahrer erscheinen als "Fam. <Nachname>"
 * und ohne Telefonnummer: Absprachen laufen ueber den Verlauf des Threads.
 */
@Component({
	selector: 'jf-fahrt',
	imports: [FormsModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h3>Fahrgemeinschaft</h3>
		<div class="umschalter" role="group" aria-label="Richtung">
			<button
				type="button"
				[class.aktiv]="richtung() === 'hin'"
				[attr.aria-pressed]="richtung() === 'hin'"
				(click)="richtung.set('hin')"
			>
				Hinfahrt
			</button>
			<button
				type="button"
				[class.aktiv]="richtung() === 'rueck'"
				[attr.aria-pressed]="richtung() === 'rueck'"
				(click)="richtung.set('rueck')"
			>
				Rückfahrt
			</button>
		</div>

		@for (a of autos(); track a.id) {
			<div class="auto" [attr.data-auto]="a.id">
				<div class="kopf">
					<strong>{{ familie(a.fahrer) }}</strong>
					<span class="frei" [class.voll]="frei(a) === 0">{{ frei(a) }} frei</span>
				</div>
				<p class="gedaempft klein">Abfahrt {{ a.abfahrt }} {{ a.ort }}</p>
				@if (a.mitfahrer.length) {
					<ul>
						@for (k of a.mitfahrer; track k) {
							<li class="mitfahrer">
								<span>{{ vorname(k) }}</span>
								@if (bedienbar()) {
									@if (eigene().includes(k)) {
										<button type="button" class="knopf leise klein" (click)="setzen(k, null)">
											{{ k === ich() ? 'Ich steige aus' : vorname(k) + ' austragen' }}
										</button>
									}
									@if (verwaltet()) {
										<button
											type="button"
											class="knopf leise klein"
											(click)="menue.set(menue() === a.id + k ? null : a.id + k)"
										>
											In anderes Auto
										</button>
										@if (menue() === a.id + k) {
											<div class="menue" role="group" [attr.aria-label]="'Neues Auto für ' + vorname(k)">
												@for (z of andere(a); track z.id) {
													<button
														type="button"
														class="knopf klein"
														[disabled]="frei(z) === 0"
														(click)="setzen(k, z.id)"
													>
														{{ familie(z.fahrer) }} ({{ frei(z) }} frei)
													</button>
												}
												<button type="button" class="knopf klein" (click)="setzen(k, null)">Kein Auto</button>
											</div>
										}
									}
								}
							</li>
						}
					</ul>
				}
				@if (bedienbar() && verwaltet() && frei(a) > 0 && einsetzbar().length) {
					<label class="feld">
						Kind einsetzen
						<select data-einsetzen (change)="einsetzen($event, a.id)">
							<option value="">Kind auswählen …</option>
							@for (k of einsetzbar(); track k.id) {
								<option [value]="k.id">{{ k.vorname }}</option>
							}
						</select>
					</label>
				}
				@if (bedienbar() && frei(a) > 0) {
					<div class="knoepfe">
						@for (k of ohnePlatz(); track k.id) {
							<button type="button" class="knopf primaer klein" (click)="setzen(k.id, a.id)">
								{{ k.id === ich() ? 'Ich fahre hier mit' : k.vorname + ' hier mitfahren lassen' }}
							</button>
						}
					</div>
				}
			</div>
		} @empty {
			<p class="gedaempft">Noch kein Auto für die {{ richtung() === 'hin' ? 'Hinfahrt' : 'Rückfahrt' }}.</p>
		}

		@if (offen().length) {
			<div class="offen">
				<strong>Braucht noch Mitfahrt</strong>
				<span>{{ offen().join(', ') }}</span>
			</div>
		}

		@if (bedienbar() && erwachsen()) {
			@if (formular()) {
				<form class="formular" (submit)="anbieten($event)">
					<label class="feld">
						Richtung
						<select name="richtung" [(ngModel)]="neu.richtung">
							<option value="hin">Hinfahrt</option>
							<option value="rueck">Rückfahrt</option>
						</select>
					</label>
					<label class="feld">
						Freie Plätze
						<input name="plaetze" type="number" min="1" max="8" [(ngModel)]="neu.plaetze" />
					</label>
					<label class="feld">
						Abfahrt
						<input name="abfahrt" type="time" required [(ngModel)]="neu.abfahrt" />
					</label>
					<label class="feld">
						Ort
						<input name="ort" required [(ngModel)]="neu.ort" placeholder="z. B. Kirchplatz" />
					</label>
					<div class="knoepfe">
						<button type="submit" class="knopf primaer">Anbieten</button>
						<button type="button" class="knopf leise" (click)="formular.set(false)">Abbrechen</button>
					</div>
				</form>
			} @else {
				<button type="button" class="knopf leise" (click)="formularOeffnen()">Auto anbieten</button>
			}
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		h3 {
			margin: 0;
			font-size: var(--schrift);
		}
		.umschalter {
			display: grid;
			grid-template-columns: 1fr 1fr;
			padding: 3px;
			border-radius: var(--radius-pille);
			background: var(--seite);
			border: 1px solid var(--linie);
		}
		.umschalter button {
			min-height: var(--tippflaeche);
			border: 0;
			border-radius: var(--radius-pille);
			background: transparent;
			color: var(--text-gedaempft);
			font: inherit;
			font-weight: 600;
			cursor: pointer;
		}
		.umschalter button.aktiv {
			background: var(--karte);
			color: var(--text);
			box-shadow: var(--schatten);
		}
		.auto {
			display: grid;
			gap: var(--a1);
			padding: var(--a3);
			border-radius: var(--radius-klein);
			border: 1px solid var(--linie);
		}
		.kopf {
			display: flex;
			justify-content: space-between;
			align-items: baseline;
		}
		.frei {
			color: var(--erfolg);
			font-weight: 600;
			font-size: var(--schrift-klein);
		}
		.frei.voll {
			color: var(--text-gedaempft);
		}
		p {
			margin: 0;
		}
		ul {
			display: grid;
			gap: var(--a1);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.mitfahrer {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		.mitfahrer > span::before {
			content: '• ';
			color: var(--text-gedaempft);
		}
		.menue,
		.knoepfe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
			width: 100%;
		}
		.knoepfe .knopf,
		.menue .knopf,
		.mitfahrer .knopf {
			min-height: var(--tippflaeche);
		}
		.offen {
			display: grid;
			gap: 2px;
			padding: var(--a2) var(--a3);
			border-radius: var(--radius-klein);
			background: var(--warnung-flaeche);
			color: var(--warnung);
			font-size: var(--schrift-klein);
		}
		.formular {
			display: grid;
			gap: var(--a3);
		}
		.knopf.leise {
			justify-self: start;
		}
	`,
})
export class FahrtBauteil {
	readonly thread = input.required<Thread>();
	readonly modul = input.required<FahrModul>();
	readonly vorschau = input(false);

	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	protected readonly ich = this.store.ich;
	protected readonly richtung = signal<Richtung>('hin');
	/** Offenes Menue "In anderes Auto" als Auto-Id + Kind-Id. */
	protected readonly menue = signal<string | null>(null);
	protected readonly formular = signal(false);
	protected neu = { richtung: 'hin' as Richtung, plaetze: 3, abfahrt: '', ort: '' };

	protected readonly bedienbar = computed(() => !this.vorschau());
	protected readonly erwachsen = computed(() => this.store.person().art === 'erwachsener');
	protected readonly verwaltet = computed(() => darf(this.store.person(), 'alleThreads'));
	protected readonly autos = computed(() => this.modul().autos.filter((a) => a.richtung === this.richtung()));

	/** Fuer wen ich Plaetze buche: meine Kinder, als Jungfischer mit Zugang ich selbst. */
	protected readonly eigene = computed<Id[]>(() => {
		const p = this.store.person();
		if (p.art === 'jungfischer') return p.hatZugang ? [p.id] : [];
		return kinderVon(this.store.stand(), p.id).map((k) => k.id);
	});
	private readonly offenePersonen = computed(() =>
		mitfahrtOffen(this.store.stand(), this.thread(), this.modul(), this.richtung()),
	);
	protected readonly offen = computed(() => this.offenePersonen().map((p) => p.vorname));
	/**
	 * Jugendleiter setzen jedes Kind des Threads ein, auch ohne Zusage: sie
	 * planen oft, bevor alle geantwortet haben (Spec TP1 5.3, Thomas 5).
	 */
	protected readonly einsetzbar = computed(() => {
		const sitzen = new Set(this.autos().flatMap((a) => a.mitfahrer));
		return kinderImThread(this.store.stand(), this.thread()).filter((k) => !sitzen.has(k.id));
	});
	protected readonly ohnePlatz = computed(() => this.offenePersonen().filter((p) => this.eigene().includes(p.id)));

	protected frei(a: Auto): number {
		return freiePlaetze(a);
	}

	protected familie(id: Id): string {
		return `Fam. ${person(this.store.stand(), id)?.nachname ?? '?'}`;
	}

	protected vorname(id: Id): string {
		return person(this.store.stand(), id)?.vorname ?? '?';
	}

	protected andere(a: Auto): Auto[] {
		return this.autos().filter((z) => z.id !== a.id);
	}

	protected setzen(kind: Id, autoId: Id | null): void {
		this.menue.set(null);
		if (!this.store.mitfahrerSetzen(this.thread().id, this.modul().id, kind, autoId, this.richtung())) {
			this.meldung.zeige('Das Auto ist schon voll');
		}
	}

	protected einsetzen(e: Event, autoId: Id): void {
		const auswahl = e.target as HTMLSelectElement;
		if (auswahl.value) this.setzen(auswahl.value, autoId);
		auswahl.value = '';
	}

	protected formularOeffnen(): void {
		this.neu = { richtung: this.richtung(), plaetze: 3, abfahrt: '', ort: '' };
		this.formular.set(true);
	}

	protected anbieten(e: Event): void {
		e.preventDefault();
		const { richtung, abfahrt, ort } = this.neu;
		const plaetze = Math.min(8, Math.max(1, Math.round(Number(this.neu.plaetze) || 1)));
		if (!abfahrt || !ort.trim()) {
			this.meldung.zeige('Bitte Abfahrt und Ort angeben');
			return;
		}
		this.store.autoAnbieten(this.thread().id, this.modul().id, {
			fahrer: this.ich(),
			richtung,
			plaetze,
			abfahrt,
			ort: ort.trim(),
		});
		this.richtung.set(richtung);
		this.formular.set(false);
	}
}
