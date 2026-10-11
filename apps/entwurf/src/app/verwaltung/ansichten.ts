import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import type { Dokument } from '../daten/typen';
import { datumKurz, uhrzeit, wochentagKurz } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';
import { KarteComponent } from '../gestaltung/ui';
import { pfadZuThread } from '../mitglieder/pfade';
import { brauchtAntwort } from '../regeln/antworten';
import { istArchiviert, naechsteTermine, termineVon } from '../regeln/termine';

/** Gemeinsame Optik der Verwaltungsseiten: Titelzeile mit Aktion, Karten, Tabellen. */
export const VERWALTUNG_STIL = `
	:host {
		display: grid;
		gap: var(--a4);
		max-width: 1100px;
	}
	.titelzeile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--a3);
	}
	h1 {
		margin: 0;
		font-size: var(--schrift-titel);
	}
	h2 {
		margin: 0 0 var(--a2);
		font-size: var(--schrift-gross);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--schrift-klein);
	}
	th {
		text-align: left;
		color: var(--text-gedaempft);
		font-weight: 600;
		padding: var(--a2);
		border-bottom: 1px solid var(--linie);
	}
	td {
		padding: var(--a2);
		border-bottom: 1px solid var(--linie);
		vertical-align: middle;
	}
	tr:last-child td {
		border-bottom: 0;
	}
	.tabelle {
		overflow-x: auto;
	}
	.aktionen {
		display: flex;
		flex-wrap: wrap;
		gap: var(--a2);
	}
	ul.liste {
		display: grid;
		gap: var(--a2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
`;

/** Startseite der Verwaltung: Kennzahlen und naechste Termine. */
@Component({
	selector: 'jf-verwaltung-uebersicht',
	imports: [RouterLink, IconComponent, KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile">
			<h1>Übersicht</h1>
			<a class="knopf primaer" routerLink="threads/neu"><jf-icon name="plus" /> Neuer Thread</a>
		</div>
		<div class="zahlen">
			<jf-karte>
				<strong>{{ aktiv() }}</strong>
				<span class="gedaempft">aktive Threads</span>
			</jf-karte>
			<jf-karte>
				<strong>{{ jungfischer() }}</strong>
				<span class="gedaempft">Jungfischer</span>
			</jf-karte>
			<jf-karte>
				<strong>{{ erwachsene() }}</strong>
				<span class="gedaempft">Erwachsene</span>
			</jf-karte>
		</div>
		<jf-karte>
			<h2>Als Nächstes</h2>
			<ul class="liste">
				@for (e of termine(); track e.modul.id) {
					<li>
						<a [routerLink]="pfad(e.threadId)">{{ e.threadTitel }}</a>
						<span class="gedaempft"> · {{ tag(e.modul.beginn) }} {{ zeit(e.modul.beginn) }} · {{ e.modul.ort }}</span>
					</li>
				}
			</ul>
		</jf-karte>
		<jf-karte>
			<h2>Deine offenen Punkte</h2>
			<p class="gedaempft">{{ offen() }} Antworten oder Zahlungen warten auf dich als Elternteil.</p>
		</jf-karte>
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			.zahlen {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
				gap: var(--a3);
			}
			.zahlen jf-karte {
				display: grid;
			}
			.zahlen strong {
				font-size: 2rem;
				color: var(--akzent);
			}
			a {
				color: var(--akzent);
				font-weight: 600;
			}
			a.knopf {
				color: var(--auf-akzent);
				text-decoration: none;
			}
			p {
				margin: 0;
			}
		`,
	],
})
export class VerwaltungUebersicht {
	private readonly store = inject(EntwurfStore);
	protected readonly aktiv = computed(
		() => this.store.stand().threads.filter((t) => !istArchiviert(t, this.store.jetzt())).length,
	);
	protected readonly jungfischer = computed(
		() => this.store.stand().personen.filter((p) => p.art === 'jungfischer').length,
	);
	protected readonly erwachsene = computed(
		() => this.store.stand().personen.filter((p) => p.art === 'erwachsener').length,
	);
	protected readonly termine = computed(() =>
		naechsteTermine(this.store.stand(), this.store.ich(), this.store.jetzt(), 4),
	);
	protected readonly offen = computed(
		() => brauchtAntwort(this.store.stand(), this.store.ich(), this.store.jetzt()).length,
	);

	protected pfad(id: string): string {
		return pfadZuThread(this.store.stand(), id);
	}
	protected tag(iso: string): string {
		return `${wochentagKurz(iso)} ${datumKurz(iso)}`;
	}
	protected zeit(iso: string): string {
		return uhrzeit(iso);
	}
}

/** Untergruppen als Ansicht; Anlegen gibt es erst in der echten App. */
@Component({
	selector: 'jf-verwaltung-untergruppen',
	imports: [IconComponent, KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile">
			<h1>Untergruppen</h1>
			<button type="button" class="knopf primaer" (click)="nichtMoeglich()">
				<jf-icon name="plus" /> Untergruppe anlegen
			</button>
		</div>
		@for (u of gruppen(); track u.id) {
			<jf-karte>
				<h2>
					{{ u.name }} <span class="gedaempft">· {{ u.namen.length }}</span>
				</h2>
				<p>{{ u.namen.join(', ') }}</p>
			</jf-karte>
		}
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			p {
				margin: 0;
			}
		`,
	],
})
export class VerwaltungUntergruppen {
	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	protected readonly gruppen = computed(() => {
		const stand = this.store.stand();
		return stand.untergruppen.map((u) => ({
			...u,
			namen: u.mitglieder.map((id) => {
				const p = stand.personen.find((x) => x.id === id);
				return p ? `${p.vorname} ${p.nachname}` : '?';
			}),
		}));
	});
	protected nichtMoeglich(): void {
		this.meldung.zeige('Im Entwurf nicht möglich');
	}
}

/** Alle Termine aus allen Threads; angelegt werden sie im Thread-Editor. */
@Component({
	selector: 'jf-verwaltung-termine',
	imports: [RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile">
			<h1>Termine</h1>
			<a class="knopf primaer" routerLink="../threads/neu">Termin über neuen Thread anlegen</a>
		</div>
		<div class="tabelle">
			<table>
				<thead>
					<tr>
						<th>Datum</th>
						<th>Zeit</th>
						<th>Thread</th>
						<th>Ort</th>
					</tr>
				</thead>
				<tbody>
					@for (e of termine(); track e.modul.id) {
						<tr>
							<td>{{ tag(e.modul.beginn) }}</td>
							<td>{{ zeit(e.modul.beginn) }}{{ e.modul.ende ? ' – ' + zeit(e.modul.ende) : '' }}</td>
							<td>{{ e.threadTitel }}{{ e.modul.titel ? ' · ' + e.modul.titel : '' }}</td>
							<td>{{ e.modul.ort }}</td>
						</tr>
					}
				</tbody>
			</table>
		</div>
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			a.knopf {
				text-decoration: none;
			}
		`,
	],
})
export class VerwaltungTermine {
	private readonly store = inject(EntwurfStore);
	protected readonly termine = computed(() =>
		termineVon(this.store.stand(), this.store.ich()).sort((a, b) => a.modul.beginn.localeCompare(b.modul.beginn)),
	);
	protected tag(iso: string): string {
		return `${wochentagKurz(iso)} ${datumKurz(iso)}`;
	}
	protected zeit(iso: string): string {
		return uhrzeit(iso);
	}
}

/** Globale Dokumente; Hochladen und Loeschen nur angedeutet. */
@Component({
	selector: 'jf-verwaltung-dokumente',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile">
			<h1>Globale Dokumente</h1>
			<button type="button" class="knopf primaer" (click)="nichtMoeglich()"><jf-icon name="plus" /> Hochladen</button>
		</div>
		<div class="tabelle">
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Kategorie</th>
						<th>Größe</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					@for (d of dokumente(); track d.id) {
						<tr>
							<td>{{ d.name }}</td>
							<td>{{ d.kategorie }}</td>
							<td>{{ d.groesse }}</td>
							<td class="aktionen">
								<button type="button" class="knopf leise klein" (click)="nichtMoeglich()">Ersetzen</button>
							</td>
						</tr>
					}
				</tbody>
			</table>
		</div>
	`,
	styles: [VERWALTUNG_STIL],
})
export class VerwaltungDokumente {
	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	protected readonly dokumente = computed<Dokument[]>(() => this.store.stand().dokumente);
	protected nichtMoeglich(): void {
		this.meldung.zeige('Im Entwurf nicht möglich');
	}
}
