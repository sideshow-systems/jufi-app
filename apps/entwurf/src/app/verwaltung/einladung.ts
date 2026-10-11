import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { EntwurfStore } from '../daten/store';
import type { Id } from '../daten/typen';
import { IconComponent } from '../gestaltung/icon';
import { kinderVon, person } from '../regeln/personen';

/**
 * "So sieht die Einladung aus": die vier Schritte, die eine eingeladene Person
 * in der echten App durchlaeuft (Rahmen 7). Alles simuliert, nichts wird gespeichert.
 */
@Component({
	selector: 'jf-einladung-vorschau',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown.escape)': 'schliessen.emit()' },
	template: `
		<div class="ueberlagerung" (click)="schliessen.emit()">
			<div
				class="handy"
				role="dialog"
				aria-modal="true"
				aria-label="Vorschau der Einladung"
				(click)="$event.stopPropagation()"
			>
				<button type="button" class="knopf leise nur-icon zu" aria-label="Schließen" (click)="schliessen.emit()">
					<jf-icon name="schliessen" />
				</button>
				<ol class="schritte" aria-label="Fortschritt">
					@for (s of [1, 2, 3, 4]; track s) {
						<li [class.erreicht]="s <= schritt()"></li>
					}
				</ol>
				@switch (schritt()) {
					@case (1) {
						<img [src]="stand().verein.logo" alt="" width="64" height="64" />
						<h2>Willkommen, {{ name() }}!</h2>
						<p>
							{{ stand().verein.name }} lädt dich in die JuFi App ein. Hier findest du Termine, Umfragen und alles rund
							um die Jugendgruppe.
						</p>
						<button type="button" class="knopf primaer" (click)="weiter()">Los geht's</button>
					}
					@case (2) {
						<jf-icon class="gross" name="schluessel" />
						<h2>Passkey einrichten</h2>
						<p>Statt eines Passworts meldest du dich mit Fingerabdruck, Gesicht oder Geräte-PIN an.</p>
						<p class="gedaempft klein">Im Entwurf nur simuliert.</p>
						<button type="button" class="knopf primaer" (click)="weiter()">Passkey erstellen</button>
					}
					@case (3) {
						<jf-icon class="gross" name="foto" />
						<h2>Einwilligung</h2>
						@if (kinder().length) {
							<p>Dürfen Fotos deiner Kinder in der App gezeigt werden?</p>
							@for (k of kinder(); track k.id) {
								<label class="haken">
									<input type="checkbox" [checked]="haken().has(k.id)" (change)="umschalten(k.id)" />
									Fotos von {{ k.vorname }} dürfen gezeigt werden
								</label>
							}
						} @else {
							<p>Für diese Person sind keine Kinder hinterlegt; der Schritt entfällt in der echten App.</p>
						}
						<button type="button" class="knopf primaer" (click)="weiter()">Weiter</button>
					}
					@default {
						<jf-icon class="gross fertig" name="haken" />
						<h2>Fertig!</h2>
						<p>{{ name() }} ist jetzt dabei und sieht alle Threads der Jugendgruppe.</p>
						<button type="button" class="knopf primaer" (click)="schliessen.emit()">Schließen</button>
					}
				}
			</div>
		</div>
	`,
	styles: `
		.ueberlagerung {
			position: fixed;
			inset: 0;
			z-index: 200;
			display: grid;
			place-items: center;
			padding: var(--a4);
			background: rgb(0 0 0 / 0.6);
		}
		.handy {
			position: relative;
			display: grid;
			justify-items: center;
			gap: var(--a3);
			width: min(340px, 100%);
			padding: var(--a6) var(--a5) var(--a5);
			border-radius: 28px;
			background: var(--seite);
			text-align: center;
		}
		.zu {
			position: absolute;
			top: var(--a2);
			right: var(--a2);
		}
		.schritte {
			display: flex;
			gap: 6px;
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.schritte li {
			width: 28px;
			height: 4px;
			border-radius: 2px;
			background: var(--linie);
		}
		.schritte li.erreicht {
			background: var(--akzent);
		}
		h2 {
			margin: 0;
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0;
		}
		img {
			border-radius: 16px;
		}
		.gross {
			font-size: 3rem;
			color: var(--akzent);
		}
		.fertig {
			color: var(--erfolg);
		}
		.haken {
			display: flex;
			align-items: center;
			gap: var(--a2);
			min-height: var(--tippflaeche);
			text-align: left;
		}
		.haken input {
			width: 20px;
			height: 20px;
			accent-color: var(--akzent);
		}
		.knopf.primaer {
			width: 100%;
		}
	`,
})
export class EinladungVorschau {
	readonly personId = input.required<Id>();
	readonly schliessen = output<void>();

	protected readonly stand = inject(EntwurfStore).stand;
	protected readonly schritt = signal(1);
	protected readonly haken = signal<ReadonlySet<Id>>(new Set());
	protected readonly name = computed(() => person(this.stand(), this.personId())?.vorname ?? '');
	protected readonly kinder = computed(() => kinderVon(this.stand(), this.personId()));

	protected weiter(): void {
		this.schritt.update((s) => Math.min(4, s + 1));
	}

	protected umschalten(id: Id): void {
		this.haken.update((alt) => {
			const neu = new Set(alt);
			if (!neu.delete(id)) neu.add(id);
			return neu;
		});
	}
}
