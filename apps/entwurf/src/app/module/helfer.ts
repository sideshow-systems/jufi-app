import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { EntwurfStore } from '../daten/store';
import type { HelferModul, HelferPlatz, Id, Thread } from '../daten/typen';
import { zeitpunkt } from '../daten/zeit';
import { uhrzeit, wochentag } from '../gestaltung/format';
import { MeldungService } from '../gestaltung/meldung';
import { vorname } from '../gestaltung/texte';
import { type AntwortZeile, antwortZeilen } from '../regeln/antworten';

/** Helferliste: je Platz Fuellstand, Namen und Eintragen/Austragen je Zeile. */
@Component({
	selector: 'jf-helfer',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h3>{{ modul().titel }}</h3>
		@if (modul().frist; as frist) {
			<p class="frist" [class.vorbei]="abgelaufen()">
				{{ abgelaufen() ? 'Frist abgelaufen' : 'Frist ' + fristText(frist) }}
			</p>
		}
		@for (p of modul().plaetze; track p.id) {
			<div class="platz">
				<div class="oben">
					<strong>{{ p.text }}</strong>
					<span class="stand" [class.voll]="voll(p)">{{ p.eintraege.length }}/{{ p.anzahl }}</span>
				</div>
				<div
					class="balken"
					role="progressbar"
					[attr.aria-label]="p.text"
					[attr.aria-valuenow]="p.eintraege.length"
					aria-valuemin="0"
					[attr.aria-valuemax]="p.anzahl"
				>
					<span [style.width.%]="(100 * p.eintraege.length) / p.anzahl"></span>
				</div>
				@if (p.eintraege.length) {
					<p class="namen gedaempft klein">{{ namen(p) }}</p>
				}
				@if (bedienbar()) {
					<div class="knoepfe">
						@for (z of zeilen(); track z.fuer) {
							@if (steht(p, z.fuer)) {
								<button type="button" class="knopf leise klein" (click)="austragen(p, z)">
									Austragen{{ mehrere() ? ' · ' + z.label : '' }}
								</button>
							} @else {
								<button type="button" class="knopf primaer klein" [disabled]="voll(p)" (click)="eintragen(p, z)">
									{{ voll(p) ? 'voll' : 'Eintragen' }}{{ mehrere() ? ' · ' + z.label : '' }}
								</button>
							}
						}
					</div>
				}
			</div>
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
		.frist {
			margin: -6px 0 0;
			font-size: var(--schrift-klein);
			color: var(--text-gedaempft);
		}
		.frist.vorbei {
			color: var(--warnung);
			font-weight: 600;
		}
		.platz {
			display: grid;
			gap: var(--a1);
		}
		.oben {
			display: flex;
			justify-content: space-between;
			align-items: baseline;
		}
		.stand {
			font-variant-numeric: tabular-nums;
			color: var(--text-gedaempft);
			font-weight: 600;
		}
		.stand.voll {
			color: var(--erfolg);
		}
		.balken {
			height: 6px;
			border-radius: var(--radius-pille);
			background: var(--linie);
			overflow: hidden;
		}
		.balken span {
			display: block;
			height: 100%;
			background: var(--akzent);
		}
		.namen {
			margin: 0;
		}
		.knoepfe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
		.knoepfe .knopf {
			min-height: var(--tippflaeche);
		}
	`,
})
export class HelferBauteil {
	readonly thread = input.required<Thread>();
	readonly modul = input.required<HelferModul>();
	readonly vorschau = input(false);

	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);

	protected readonly zeilen = computed(() =>
		antwortZeilen(this.store.stand(), this.store.ich(), this.thread(), this.modul()),
	);
	protected readonly mehrere = computed(() => this.zeilen().length > 1);
	protected readonly abgelaufen = computed(() => {
		const f = this.modul().frist;
		return !!f && zeitpunkt(f) <= this.store.jetzt();
	});
	protected readonly bedienbar = computed(() => !this.vorschau() && !this.abgelaufen());

	protected fristText(frist: string): string {
		return `${wochentag(frist)} ${uhrzeit(frist)}`;
	}

	protected voll(p: HelferPlatz): boolean {
		return p.eintraege.length >= p.anzahl;
	}

	protected steht(p: HelferPlatz, fuer: Id): boolean {
		return p.eintraege.some((e) => e.fuer === fuer);
	}

	protected namen(p: HelferPlatz): string {
		const stand = this.store.stand();
		return p.eintraege.map((e) => vorname(stand, e.fuer)).join(', ');
	}

	protected eintragen(p: HelferPlatz, z: AntwortZeile): void {
		if (!this.store.helferEintragen(this.thread().id, this.modul().id, p.id, z.fuer)) {
			this.meldung.zeige('Leider schon voll');
		}
	}

	protected austragen(p: HelferPlatz, z: AntwortZeile): void {
		this.store.helferAustragen(this.thread().id, this.modul().id, p.id, z.fuer);
	}
}
