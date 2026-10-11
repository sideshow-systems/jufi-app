import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { EntwurfStore } from '../daten/store';
import type { Antwort, Id, Thread, UmfrageModul } from '../daten/typen';
import { zeitpunkt } from '../daten/zeit';
import { uhrzeit, wochentag } from '../gestaltung/format';
import { vorname } from '../gestaltung/texte';
import { PilleComponent } from '../gestaltung/ui';
import { antwortZeilen } from '../regeln/antworten';
import { darf } from '../regeln/personen';

interface Ergebnis {
	text: string;
	anzahl: number;
	namen: string;
}

/**
 * Umfrage nach Rahmen 6.3: je Zeile (ich selbst oder je Kind) eine Antwort.
 * Wer fuer wen eingetragen hat, steht unter der Zeile, damit Kind und Eltern
 * sehen, dass die andere Seite schon geantwortet hat.
 */
@Component({
	selector: 'jf-umfrage',
	imports: [PilleComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h3>{{ modul().frage }}</h3>
		@if (modul().frist; as frist) {
			<p class="frist" [class.vorbei]="abgelaufen()">
				{{ abgelaufen() ? 'Frist abgelaufen' : 'Frist ' + fristText(frist) }}
			</p>
		}

		@for (z of zeilen(); track z.fuer) {
			<div class="zeile">
				<div class="oben">
					<span class="label">{{ z.label }}</span>
					@if (z.antwort && aendert() !== z.fuer) {
						<span class="antwort">
							<jf-pille [art]="istAbsage(z.antwort) ? 'offen' : 'ok'">{{ antwortText(z.antwort) }}</jf-pille>
							@if (bedienbar()) {
								<button type="button" class="knopf leise klein" (click)="aendern(z.fuer, z.antwort)">ändern</button>
							}
						</span>
					} @else if (bedienbar()) {
						<span class="optionen" role="group" [attr.aria-label]="'Antwort für ' + z.label">
							@for (o of modul().optionen; track o.id) {
								<button
									type="button"
									class="knopf klein"
									[class.primaer]="gewaehlt(z.fuer, o.id)"
									[attr.aria-pressed]="modul().mehrfach ? gewaehlt(z.fuer, o.id) : null"
									(click)="waehlen(z.fuer, o.id)"
								>
									{{ o.text }}
								</button>
							}
							@if (modul().mehrfach) {
								<button
									type="button"
									class="knopf primaer klein"
									[disabled]="!auswahl()[z.fuer]?.length"
									(click)="speichern(z.fuer)"
								>
									Antworten
								</button>
							}
						</span>
					} @else {
						<span class="gedaempft klein">keine Antwort</span>
					}
				</div>
				@if (z.antwort && z.antwort.von !== z.fuer) {
					<p class="von gedaempft klein">
						{{ z.antwort.von === ich() ? 'von dir eingetragen' : 'eingetragen von ' + name(z.antwort.von) }}
					</p>
				}
			</div>
		}

		@if (ergebnisse().length) {
			<ul class="ergebnisse">
				@for (e of ergebnisse(); track e.text) {
					<li>
						<strong>{{ e.text }} ({{ e.anzahl }})</strong>
						@if (mitNamen() && e.namen) {
							<span class="gedaempft">{{ e.namen }}</span>
						}
					</li>
				}
			</ul>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a2);
		}
		h3 {
			margin: 0;
			font-size: var(--schrift);
		}
		.frist {
			margin: 0;
			font-size: var(--schrift-klein);
			color: var(--text-gedaempft);
		}
		.frist.vorbei {
			color: var(--warnung);
			font-weight: 600;
		}
		.zeile {
			padding: var(--a2) 0;
			border-top: 1px solid var(--linie);
		}
		.oben {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: var(--a2);
		}
		.label {
			font-weight: 600;
		}
		.antwort,
		.optionen {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		.optionen .knopf {
			min-height: var(--tippflaeche);
		}
		.von {
			margin: 2px 0 0;
		}
		.ergebnisse {
			display: grid;
			gap: var(--a1);
			margin: 0;
			padding: var(--a2) 0 0;
			border-top: 1px solid var(--linie);
			list-style: none;
			font-size: var(--schrift-klein);
		}
		.ergebnisse li {
			display: flex;
			flex-wrap: wrap;
			gap: 0 var(--a2);
		}
	`,
})
export class UmfrageBauteil {
	readonly thread = input.required<Thread>();
	readonly modul = input.required<UmfrageModul>();
	readonly vorschau = input(false);

	private readonly store = inject(EntwurfStore);
	protected readonly ich = this.store.ich;
	/** Zeile, deren Antwort gerade geaendert wird. */
	protected readonly aendert = signal<Id | null>(null);
	/** Vorlaeufige Auswahl bei Mehrfachwahl, je Zeile. */
	protected readonly auswahl = signal<Record<Id, Id[]>>({});

	protected readonly zeilen = computed(() =>
		antwortZeilen(this.store.stand(), this.ich(), this.thread(), this.modul()),
	);
	protected readonly abgelaufen = computed(() => {
		const f = this.modul().frist;
		return !!f && zeitpunkt(f) <= this.store.jetzt();
	});
	protected readonly bedienbar = computed(() => !this.vorschau() && !this.abgelaufen());
	private readonly detail = computed(() => darf(this.store.person(), 'antwortenDetail'));
	protected readonly mitNamen = computed(() => this.modul().ergebnisse === 'alle' || this.detail());

	protected readonly ergebnisse = computed<Ergebnis[]>(() => {
		const m = this.modul();
		if (m.ergebnisse === 'jugendleiter' && !this.detail()) return [];
		const stand = this.store.stand();
		return m.optionen.map((o) => {
			const fuer = m.antworten.filter((a) => a.optionen.includes(o.id)).map((a) => a.fuer);
			return { text: o.text, anzahl: fuer.length, namen: fuer.map((id) => vorname(stand, id)).join(', ') };
		});
	});

	protected fristText(frist: string): string {
		return `${wochentag(frist)} ${uhrzeit(frist)}`;
	}

	protected name(id: Id): string {
		return vorname(this.store.stand(), id);
	}

	protected istAbsage(a: Antwort): boolean {
		return this.modul().teilnahme && a.optionen.includes('nein');
	}

	protected antwortText(a: Antwort): string {
		const m = this.modul();
		if (m.teilnahme) return a.optionen.includes('ja') ? '✓ Dabei' : '✗ Abgesagt';
		const texte = m.optionen.filter((o) => a.optionen.includes(o.id)).map((o) => o.text);
		return `✓ ${texte.join(', ')}`;
	}

	protected gewaehlt(fuer: Id, option: Id): boolean {
		return this.auswahl()[fuer]?.includes(option) ?? false;
	}

	protected aendern(fuer: Id, a: Antwort): void {
		this.auswahl.update((x) => ({ ...x, [fuer]: [...a.optionen] }));
		this.aendert.set(fuer);
	}

	protected waehlen(fuer: Id, option: Id): void {
		if (!this.modul().mehrfach) {
			this.antworten(fuer, [option]);
			return;
		}
		this.auswahl.update((x) => {
			const bisher = x[fuer] ?? [];
			return { ...x, [fuer]: bisher.includes(option) ? bisher.filter((o) => o !== option) : [...bisher, option] };
		});
	}

	protected speichern(fuer: Id): void {
		const optionen = this.auswahl()[fuer] ?? [];
		if (optionen.length) this.antworten(fuer, optionen);
	}

	private antworten(fuer: Id, optionen: Id[]): void {
		this.store.antworten(this.thread().id, this.modul().id, fuer, optionen);
		this.aendert.set(null);
	}
}
