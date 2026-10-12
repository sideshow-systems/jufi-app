import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import { monatName, wochentagKurz } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { termineImMonat, type TerminEintrag } from '../regeln/termine';
import { beginnIso, terminZeit } from '../regeln/terminzeit';
import { pfadZuThread } from './pfade';

/** Tage eines Monats als 6×7-Raster ab Montag; leere Felder sind null. monat: 0 = Januar. */
export function monatsRaster(jahr: number, monat: number): (number | null)[] {
	const versatz = (new Date(jahr, monat, 1).getDay() + 6) % 7;
	const tage = new Date(jahr, monat + 1, 0).getDate();
	return Array.from({ length: 42 }, (_, i) => (i >= versatz && i < versatz + tage ? i - versatz + 1 : null));
}

/** Monatskalender mit Liste der Termine darunter (Spec TP1 4.3). */
@Component({
	selector: 'jf-termine',
	imports: [RouterLink, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="kopf">
			<button type="button" class="knopf leise nur-icon" aria-label="Voriger Monat" (click)="blaettern(-1)">
				<jf-icon name="zurueck" />
			</button>
			<h1>{{ titel() }}</h1>
			<button type="button" class="knopf leise nur-icon" aria-label="Nächster Monat" (click)="blaettern(1)">
				<jf-icon name="vor" />
			</button>
		</div>

		<div class="kalender" role="grid" [attr.aria-label]="titel()">
			@for (w of wochentage; track w) {
				<span class="wt" role="columnheader">{{ w }}</span>
			}
			@for (tag of raster(); track $index) {
				<span
					class="tag"
					role="gridcell"
					[class.leer]="tag === null"
					[class.heute]="tag !== null && tag === heute()"
					[class.mit]="tag !== null && tageMitTermin().has(tag)"
				>
					{{ tag ?? '' }}
				</span>
			}
		</div>

		<h2>Termine im {{ monatsname() }}</h2>
		@for (e of termine(); track e.modul.id) {
			<a class="eintrag" [routerLink]="link(e)">
				<span class="datum">
					<strong>{{ e.modul.von.slice(8, 10) }}</strong>
					<span>{{ wtag(beginn(e.modul)) }}</span>
				</span>
				<span class="text">
					<strong>{{ e.threadTitel }}</strong>
					<span class="gedaempft klein">
						{{ e.modul.titel ? e.modul.titel + ' · ' : '' }}{{ zeitText(e.modul) }} · {{ e.modul.ort }}
					</span>
				</span>
				<jf-icon name="vor" />
			</a>
		} @empty {
			<p class="gedaempft">Keine Termine in diesem Monat.</p>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		.kopf {
			display: flex;
			align-items: center;
			justify-content: space-between;
		}
		h1 {
			margin: 0;
			font-size: var(--schrift-gross);
		}
		h2 {
			margin: var(--a2) 0 0;
			font-size: var(--schrift-klein);
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-gedaempft);
		}
		.kalender {
			display: grid;
			grid-template-columns: repeat(7, 1fr);
			gap: 2px;
			padding: var(--a2);
			border-radius: var(--radius);
			background: var(--karte);
			border: 1px solid var(--linie);
		}
		.wt {
			text-align: center;
			font-size: var(--schrift-klein);
			font-weight: 600;
			color: var(--text-gedaempft);
			padding: var(--a1) 0;
		}
		.tag {
			position: relative;
			display: grid;
			place-items: center;
			aspect-ratio: 1;
			max-height: 44px;
			margin: 0 auto;
			width: 100%;
			max-width: 44px;
			border-radius: 50%;
			font-variant-numeric: tabular-nums;
		}
		.tag.heute {
			box-shadow: inset 0 0 0 2px var(--akzent);
			font-weight: 700;
		}
		.tag.mit::after {
			content: '';
			position: absolute;
			bottom: 4px;
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--akzent);
		}
		.eintrag {
			display: flex;
			align-items: center;
			gap: var(--a3);
			padding: var(--a3);
			border-radius: var(--radius);
			background: var(--karte);
			border: 1px solid var(--linie);
			color: var(--text);
			text-decoration: none;
		}
		.datum {
			display: grid;
			justify-items: center;
			min-width: 44px;
			padding: var(--a1);
			border-radius: var(--radius-klein);
			background: var(--akzent-flaeche);
			color: var(--akzent);
			font-size: var(--schrift-klein);
		}
		.datum strong {
			font-size: var(--schrift-gross);
		}
		.text {
			display: grid;
			flex: 1;
			min-width: 0;
		}
		.eintrag jf-icon {
			color: var(--text-gedaempft);
		}
	`,
})
export class Termine {
	private readonly store = inject(EntwurfStore);
	protected readonly wochentage = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

	/** "jetzt" statt new Date(bezugstag): ein reiner Datumstext wuerde als UTC gelesen. */
	private readonly bezug = this.store.jetzt();
	protected readonly monat = signal({ jahr: this.bezug.getFullYear(), monat: this.bezug.getMonth() });

	protected readonly monatsname = computed(() => monatName(this.monat().monat));
	protected readonly titel = computed(() => `${this.monatsname()} ${this.monat().jahr}`);
	protected readonly raster = computed(() => monatsRaster(this.monat().jahr, this.monat().monat));
	protected readonly termine = computed(() => {
		const { jahr, monat } = this.monat();
		return termineImMonat(this.store.stand(), this.store.ich(), jahr, monat).sort((a, b) =>
			beginnIso(a.modul).localeCompare(beginnIso(b.modul)),
		);
	});
	protected readonly tageMitTermin = computed(
		() => new Set(this.termine().map((e) => Number(e.modul.von.slice(8, 10)))),
	);
	protected readonly heute = computed(() => {
		const j = this.store.jetzt();
		const { jahr, monat } = this.monat();
		return j.getFullYear() === jahr && j.getMonth() === monat ? j.getDate() : null;
	});

	protected blaettern(schritt: number): void {
		this.monat.update(({ jahr, monat }) => {
			const d = new Date(jahr, monat + schritt, 1);
			return { jahr: d.getFullYear(), monat: d.getMonth() };
		});
	}

	protected link(e: TerminEintrag): string {
		return pfadZuThread(this.store.stand(), e.threadId, e.modul.id);
	}

	protected wtag(iso: string): string {
		return wochentagKurz(iso);
	}

	protected readonly beginn = beginnIso;
	protected readonly zeitText = terminZeit;
}
