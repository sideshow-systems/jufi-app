import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EntwurfStore } from '../daten/store';
import type { Id, Person, Recht } from '../daten/typen';
import { KarteComponent } from '../gestaltung/ui';
import { darf, istJugendleiter, kannRechtEntziehen, ROLLEN_VORLAGEN } from '../regeln/personen';
import { VERWALTUNG_STIL } from './ansichten';

type Vorlage = keyof typeof ROLLEN_VORLAGEN;

const RECHTE: { recht: Recht; text: string }[] = [
	{ recht: 'mitglieder', text: 'Mitglieder verwalten' },
	{ recht: 'threadsErstellen', text: 'Threads erstellen' },
	{ recht: 'alleThreads', text: 'Alle Threads bearbeiten' },
	{ recht: 'dokumente', text: 'Dokumente verwalten' },
	{ recht: 'antwortenDetail', text: 'Antworten im Detail sehen' },
	{ recht: 'rechteVerwalten', text: 'Rechte verwalten' },
	{ recht: 'einstellungen', text: 'Vereinseinstellungen' },
];

const VORLAGEN: { wert: Vorlage; text: string }[] = [
	{ wert: 'leitung', text: 'Leitung' },
	{ wert: 'jugendleiter', text: 'Jugendleiter' },
	{ wert: 'betreuer', text: 'Betreuer' },
];

/** Jugendleiter & Rechte (Rahmen 4.2): Vorlage waehlen, Haekchen anpassen. */
@Component({
	selector: 'jf-verwaltung-rechte',
	imports: [KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile">
			<h1>Jugendleiter & Rechte</h1>
			<label class="feld neu">
				Weitere Person zum Jugendleiter machen
				<select (change)="ernennen($event)">
					<option value="">Person wählen …</option>
					@for (p of andere(); track p.id) {
						<option [value]="p.id">{{ p.vorname }} {{ p.nachname }}</option>
					}
				</select>
			</label>
		</div>
		@for (p of jugendleiter(); track p.id) {
			<jf-karte>
				<div class="kopf">
					<h2>{{ p.vorname }} {{ p.nachname }}</h2>
					<label class="feld">
						Vorlage
						<select [value]="vorlage(p)" (change)="vorlageSetzen(p, $event)">
							@for (v of vorlagen; track v.wert) {
								<option [value]="v.wert">{{ v.text }}</option>
							}
							<option value="eigene" disabled>Angepasst</option>
						</select>
					</label>
				</div>
				<div class="rechte">
					@for (r of rechte; track r.recht) {
						<label class="haken">
							<input
								type="checkbox"
								[attr.data-person]="p.id"
								[attr.data-recht]="r.recht"
								[checked]="hat(p, r.recht)"
								[disabled]="gesperrt(p, r.recht)"
								(change)="umschalten(p, r.recht)"
							/>
							{{ r.text }}
						</label>
					}
				</div>
				@if (gesperrt(p, 'rechteVerwalten')) {
					<p class="gedaempft klein">Mindestens eine Person muss Rechte verwalten können.</p>
				}
			</jf-karte>
		}
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			.kopf {
				display: flex;
				flex-wrap: wrap;
				align-items: end;
				justify-content: space-between;
				gap: var(--a3);
				margin-bottom: var(--a2);
			}
			.kopf h2 {
				margin: 0;
			}
			.rechte {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
			}
			.haken {
				display: flex;
				align-items: center;
				gap: var(--a2);
				min-height: var(--tippflaeche);
			}
			.haken input {
				width: 20px;
				height: 20px;
				accent-color: var(--akzent);
			}
			.haken:has(input:disabled) {
				color: var(--text-gedaempft);
			}
			p {
				margin: var(--a2) 0 0;
			}
			.neu {
				min-width: 260px;
			}
		`,
	],
})
export class VerwaltungRechte {
	private readonly store = inject(EntwurfStore);
	protected readonly rechte = RECHTE;
	protected readonly vorlagen = VORLAGEN;

	protected readonly jugendleiter = computed(() => this.store.stand().personen.filter(istJugendleiter));
	protected readonly andere = computed(() =>
		this.store.stand().personen.filter((p) => p.art === 'erwachsener' && !istJugendleiter(p)),
	);

	protected hat(p: Person, r: Recht): boolean {
		return darf(p, r);
	}

	protected gesperrt(p: Person, r: Recht): boolean {
		return darf(p, r) && !kannRechtEntziehen(this.store.stand(), p.id, r);
	}

	protected vorlage(p: Person): Vorlage | 'eigene' {
		const passt = VORLAGEN.find(
			(v) => ROLLEN_VORLAGEN[v.wert].length === p.rechte.length && ROLLEN_VORLAGEN[v.wert].every((r) => darf(p, r)),
		);
		return passt?.wert ?? 'eigene';
	}

	protected vorlageSetzen(p: Person, e: Event): void {
		const v = (e.target as HTMLSelectElement).value as Vorlage;
		this.store.rechteSetzen(p.id, ROLLEN_VORLAGEN[v]);
	}

	protected umschalten(p: Person, r: Recht): void {
		this.store.rechteSetzen(p.id, darf(p, r) ? p.rechte.filter((x) => x !== r) : [...p.rechte, r]);
	}

	protected ernennen(e: Event): void {
		const auswahl = e.target as HTMLSelectElement;
		const id: Id = auswahl.value;
		if (id) this.store.rechteSetzen(id, ROLLEN_VORLAGEN.betreuer);
		auswahl.value = '';
	}
}
