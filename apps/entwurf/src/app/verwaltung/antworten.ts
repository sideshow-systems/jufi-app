import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import type { Datenstand, Person, Thread, UmfrageModul } from '../daten/typen';
import { IconComponent } from '../gestaltung/icon';
import { ThreadTeilen } from '../gestaltung/teilen-aktion';
import { KarteComponent } from '../gestaltung/ui';
import { NichtGefunden } from '../mitglieder/nicht-gefunden';
import { elternVon, person } from '../regeln/personen';
import { kinderImThread } from '../regeln/sichtbarkeit';
import { VERWALTUNG_STIL } from './ansichten';

interface Zeile {
	wer: Person;
	antwort: string | null;
	von: string;
}

/** Wer bei einer Umfrage gefragt ist, je nach Einheit (Rahmen 6.3). */
function befragte(stand: Datenstand, t: Thread, m: UmfrageModul): Person[] {
	const kinder = kinderImThread(stand, t);
	const eltern = [...new Map(kinder.flatMap((k) => elternVon(stand, k.id)).map((p) => [p.id, p])).values()];
	if (m.einheit === 'jungfischer') return kinder;
	if (m.einheit === 'erwachsener') return eltern;
	return [...kinder.filter((k) => k.hatZugang), ...eltern];
}

/** Antwort-Uebersicht eines Threads fuer die Verwaltung (Spec TP1 4.3). */
@Component({
	selector: 'jf-verwaltung-antworten',
	imports: [RouterLink, IconComponent, KarteComponent, NichtGefunden],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (thread(); as t) {
			<div class="titelzeile">
				<h1>Antworten · {{ t.titel }}</h1>
				<div class="aktionen">
					<a class="knopf leise" routerLink="/glonntal/verwaltung/threads">Zurück</a>
					<button type="button" class="knopf primaer" (click)="teilen(t)">
						<jf-icon name="teilen" /> Stand teilen
					</button>
				</div>
			</div>
			@for (u of umfragen(); track u.modul.id) {
				<jf-karte>
					<h2>{{ u.modul.frage }}</h2>
					<div class="tabelle">
						<table>
							<thead>
								<tr>
									<th>{{ u.modul.einheit === 'jungfischer' ? 'Kind' : 'Person' }}</th>
									<th>Antwort</th>
									<th>Eingetragen von</th>
								</tr>
							</thead>
							<tbody>
								@for (z of u.zeilen; track z.wer.id) {
									<tr>
										<td>{{ z.wer.vorname }} {{ z.wer.nachname }}</td>
										<td [class.gedaempft]="!z.antwort">{{ z.antwort ?? '—' }}</td>
										<td>{{ z.von }}</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
					<h3>Fehlt noch · {{ u.fehlt.length }}</h3>
					<p>{{ u.fehlt.length ? u.fehlt.join(', ') : 'Alle haben geantwortet.' }}</p>
				</jf-karte>
			} @empty {
				<p class="gedaempft">Dieser Thread hat keine Umfrage.</p>
			}
		} @else {
			<jf-nicht-gefunden />
		}
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			h3 {
				margin: var(--a3) 0 var(--a1);
				font-size: var(--schrift);
			}
			p {
				margin: 0;
			}
			a.knopf {
				text-decoration: none;
			}
		`,
	],
})
export class VerwaltungAntworten {
	readonly nr = input<string>('');

	private readonly store = inject(EntwurfStore);
	private readonly teiler = inject(ThreadTeilen);

	protected readonly thread = computed(() => this.store.stand().threads.find((t) => t.nr === Number(this.nr())));
	protected readonly umfragen = computed(() => {
		const t = this.thread();
		if (!t) return [];
		const stand = this.store.stand();
		return t.module
			.filter((m): m is UmfrageModul => m.typ === 'umfrage')
			.map((modul) => {
				const zeilen: Zeile[] = befragte(stand, t, modul).map((wer) => {
					const a = modul.antworten.find((x) => x.fuer === wer.id);
					const texte = a ? modul.optionen.filter((o) => a.optionen.includes(o.id)).map((o) => o.text) : [];
					return {
						wer,
						antwort: a ? texte.join(', ') : null,
						von: !a ? '' : a.von === a.fuer ? 'selbst' : (person(stand, a.von)?.vorname ?? '?'),
					};
				});
				return { modul, zeilen, fehlt: zeilen.filter((z) => !z.antwort).map((z) => z.wer.vorname) };
			});
	});

	protected teilen(t: Thread): void {
		void this.teiler.teilen(t);
	}
}
