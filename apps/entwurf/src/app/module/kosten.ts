import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { EntwurfStore } from '../daten/store';
import type { Id, KostenModul, KostenStatus, Person, Thread } from '../daten/typen';
import { betrag } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';
import { kopiere } from '../gestaltung/teilen-aktion';
import { PilleComponent } from '../gestaltung/ui';
import { kostenStatus, verwendungszweck, zahlungspflichtig } from '../regeln/fahrt-kosten';
import { darf, kinderVon, person } from '../regeln/personen';

const STATUS_TEXT: Record<KostenStatus, string> = { offen: 'offen', gemeldet: 'gemeldet', bezahlt: 'bezahlt ✓' };

/**
 * Kosten nach Rahmen 6.4.2. Eltern melden "habe bezahlt", die Kasse (wer
 * Antworten im Detail sieht) bestaetigt. Bezahlt wird ausserhalb der App.
 */
@Component({
	selector: 'jf-kosten',
	imports: [IconComponent, PilleComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="kopf">
			<h3>{{ modul().titel }}</h3>
			<strong class="betrag">{{ preis() }}</strong>
		</div>
		@if (modul().hinweis) {
			<p>{{ modul().hinweis }}</p>
		}
		@if (modul().iban || modul().paypal) {
			<dl>
				@if (modul().iban) {
					<dt>IBAN</dt>
					<dd>{{ modul().iban }}</dd>
				}
				@if (modul().paypal) {
					<dt>PayPal</dt>
					<dd>{{ modul().paypal }}</dd>
				}
			</dl>
		}

		@for (k of meine(); track k.id) {
			<div class="kind">
				<div class="zeile">
					<strong>{{ k.vorname }}</strong>
					<jf-pille [art]="pillenArt(status(k.id))">{{ statusText(status(k.id)) }}</jf-pille>
				</div>
				<div class="zweck">
					<span class="gedaempft klein">Verwendungszweck: {{ zweck(k) }}</span>
					<button
						type="button"
						class="knopf leise nur-icon"
						aria-label="Verwendungszweck kopieren"
						(click)="kopieren(k)"
					>
						<jf-icon name="kopieren" />
					</button>
				</div>
				@if (bedienbar() && erwachsen() && status(k.id) === 'offen') {
					<button type="button" class="knopf primaer klein" (click)="setzen(k.id, 'gemeldet')">Habe bezahlt</button>
				}
			</div>
		}

		@if (kasse()) {
			<details class="uebersicht">
				<summary>Alle Zahlungen · {{ bezahlt() }}/{{ pflichtige().length }} bezahlt</summary>
				<ul>
					@for (k of pflichtige(); track k.id) {
						<li>
							<span class="name">{{ k.vorname }} {{ k.nachname }}</span>
							<jf-pille [art]="pillenArt(status(k.id))">{{ statusText(status(k.id)) }}</jf-pille>
							@if (bedienbar()) {
								@if (status(k.id) !== 'bezahlt') {
									<button type="button" class="knopf primaer klein" (click)="setzen(k.id, 'bezahlt')">
										Bestätigen
									</button>
								}
								@if (status(k.id) !== 'offen') {
									<button type="button" class="knopf leise klein" (click)="setzen(k.id, 'offen')">Zurücksetzen</button>
								}
							}
						</li>
					}
				</ul>
			</details>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		.kopf {
			display: flex;
			justify-content: space-between;
			align-items: baseline;
			gap: var(--a2);
		}
		h3 {
			margin: 0;
			font-size: var(--schrift);
		}
		.betrag {
			font-size: var(--schrift-gross);
			font-variant-numeric: tabular-nums;
		}
		p {
			margin: 0;
		}
		dl {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 2px var(--a3);
			margin: 0;
			font-size: var(--schrift-klein);
		}
		dt {
			color: var(--text-gedaempft);
		}
		dd {
			margin: 0;
			font-variant-numeric: tabular-nums;
			overflow-wrap: anywhere;
		}
		.kind {
			display: grid;
			gap: var(--a1);
			padding-top: var(--a2);
			border-top: 1px solid var(--linie);
		}
		.zeile,
		.zweck {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--a2);
		}
		.kind > .knopf {
			justify-self: start;
			min-height: var(--tippflaeche);
		}
		summary {
			min-height: var(--tippflaeche);
			display: flex;
			align-items: center;
			font-weight: 600;
			cursor: pointer;
		}
		ul {
			display: grid;
			gap: var(--a2);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		li {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		.name {
			flex: 1;
			min-width: 8rem;
		}
	`,
})
export class KostenBauteil {
	readonly thread = input.required<Thread>();
	readonly modul = input.required<KostenModul>();
	readonly vorschau = input(false);

	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);

	protected readonly bedienbar = computed(() => !this.vorschau());
	protected readonly preis = computed(() => betrag(this.modul().betragCent));
	protected readonly erwachsen = computed(() => this.store.person().art === 'erwachsener');
	protected readonly kasse = computed(() => darf(this.store.person(), 'antwortenDetail'));

	private readonly pflichtIds = computed(() => new Set(zahlungspflichtig(this.store.stand(), this.thread())));
	protected readonly pflichtige = computed<Person[]>(() =>
		[...this.pflichtIds()].map((id) => person(this.store.stand(), id)).filter((p): p is Person => !!p),
	);
	/** Eigene Kinder bzw. ich selbst als Jungfischer, soweit zahlungspflichtig. */
	protected readonly meine = computed<Person[]>(() => {
		const p = this.store.person();
		const kandidaten = p.art === 'jungfischer' ? [p] : kinderVon(this.store.stand(), p.id);
		return kandidaten.filter((k) => this.pflichtIds().has(k.id));
	});
	protected readonly bezahlt = computed(() => this.pflichtige().filter((k) => this.status(k.id) === 'bezahlt').length);

	protected status(id: Id): KostenStatus {
		return kostenStatus(this.modul(), id);
	}

	protected statusText(s: KostenStatus): string {
		return STATUS_TEXT[s];
	}

	protected pillenArt(s: KostenStatus): 'ok' | 'offen' | 'neutral' {
		return s === 'bezahlt' ? 'ok' : s === 'offen' ? 'offen' : 'neutral';
	}

	protected zweck(k: Person): string {
		return verwendungszweck(this.thread(), k);
	}

	protected async kopieren(k: Person): Promise<void> {
		const ok = (await kopiere(this.zweck(k))) === 'kopiert';
		this.meldung.zeige(ok ? 'Verwendungszweck kopiert' : 'Kopieren nicht möglich');
	}

	protected setzen(id: Id, s: KostenStatus): void {
		this.store.kostenSetzen(this.thread().id, this.modul().id, id, s);
	}
}
