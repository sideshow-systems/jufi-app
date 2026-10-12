import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import { EntwurfStore } from '../daten/store';
import type { Id, Person } from '../daten/typen';
import { IconComponent } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';
import { teileText } from '../gestaltung/teilen-aktion';
import { rolleText } from '../gestaltung/texte';
import { KarteComponent, PilleComponent } from '../gestaltung/ui';
import { NichtGefunden } from '../mitglieder/nicht-gefunden';
import { elternVon, istJugendleiter, kinderVon, person } from '../regeln/personen';
import { einladungsLink } from '../regeln/teilen';
import { VERWALTUNG_STIL } from './ansichten';
import { EinladungVorschau } from './einladung';

type Filter = 'alle' | 'jungfischer' | 'erwachsener';

interface Einladung {
	personId: Id;
	link: string;
	text: string;
}

/**
 * Einladungstext fuer WhatsApp. Der Link fuehrt in diesen Entwurf, nicht zu
 * einem echten Zugang; "So sieht die Einladung aus" zeigt die Schritte.
 */
function einladungFuer(p: Person, vereinsname: string, basisUrl: string, slug: string): Einladung {
	const zufall = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('');
	const link = einladungsLink(basisUrl, slug, zufall);
	return {
		personId: p.id,
		link,
		text: `Hallo ${p.vorname}! Du bist zur JuFi App der ${vereinsname} eingeladen. Hier geht's los:\n${link}`,
	};
}

/** Erzeugen, Teilen und Vorschau einer Einladung; geteilt von Liste und Detail. */
@Component({
	selector: 'jf-einladung-erzeugen',
	imports: [IconComponent, EinladungVorschau],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (einladung(); as e) {
			<div class="einladung">
				<p class="link">{{ e.link }}</p>
				<p class="text">{{ e.text }}</p>
				<div class="aktionen">
					<button type="button" class="knopf primaer" (click)="teilen(e)">
						<jf-icon name="teilen" /> Teilen/Kopieren
					</button>
					<button type="button" class="knopf leise" (click)="vorschau.set(true)">So sieht die Einladung aus</button>
				</div>
			</div>
		} @else {
			<button type="button" class="knopf primaer" (click)="erzeugen()">
				<jf-icon name="link" /> Einladungslink erzeugen
			</button>
		}
		@if (vorschau()) {
			<jf-einladung-vorschau [personId]="personId()" (schliessen)="vorschau.set(false)" />
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a2);
		}
		.einladung {
			display: grid;
			gap: var(--a2);
			padding: var(--a3);
			border-radius: var(--radius-klein);
			background: var(--akzent-flaeche);
		}
		p {
			margin: 0;
			overflow-wrap: anywhere;
		}
		.link {
			font-weight: 600;
			color: var(--akzent);
		}
		.text {
			white-space: pre-line;
			font-size: var(--schrift-klein);
		}
		.aktionen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
		:host > .knopf {
			justify-self: start;
		}
	`,
})
export class EinladungErzeugen {
	readonly personId = input.required<Id>();

	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	private readonly ereignisse = inject(TESTEREIGNISSE);
	private readonly dokument = inject(DOCUMENT);
	protected readonly einladung = signal<Einladung | null>(null);
	protected readonly vorschau = signal(false);

	protected erzeugen(): void {
		const stand = this.store.stand();
		const p = person(stand, this.personId());
		if (!p) return;
		this.einladung.set(
			einladungFuer(p, stand.verein.name, `${this.dokument.location.origin}/entwurf`, stand.verein.slug),
		);
		this.ereignisse.next({ art: 'einladungErzeugt', personId: p.id });
	}

	protected async teilen(e: Einladung): Promise<void> {
		const ergebnis = await teileText(e.text);
		if (ergebnis === 'kopiert') this.meldung.zeige('Text kopiert');
		if (ergebnis === 'fehler') this.meldung.zeige('Teilen nicht möglich');
	}
}

/** Personenliste mit Filter und Formular "Person anlegen". */
@Component({
	selector: 'jf-verwaltung-personen',
	imports: [RouterLink, IconComponent, KarteComponent, PilleComponent, EinladungErzeugen],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile">
			<h1>Personen</h1>
			<button type="button" class="knopf primaer" (click)="formular.set(!formular())">
				<jf-icon name="einladen" /> Person anlegen
			</button>
		</div>

		@if (formular()) {
			<jf-karte>
				<form class="anlegen" (submit)="anlegen($event)">
					<h2>Neue Person</h2>
					<div class="reihe">
						<label class="feld"
							>Vorname <input name="vorname" required [value]="neu().vorname" (input)="neuSetzen('vorname', $event)"
						/></label>
						<label class="feld"
							>Nachname
							<input name="nachname" required [value]="neu().nachname" (input)="neuSetzen('nachname', $event)"
						/></label>
						<label class="feld">
							Art
							<select name="art" [value]="neu().art" (change)="neuSetzen('art', $event)">
								<option value="erwachsener">Erwachsener</option>
								<option value="jungfischer">Jungfischer</option>
							</select>
						</label>
						@if (neu().art === 'jungfischer') {
							<label class="feld"
								>Alter
								<input
									name="alter"
									type="number"
									min="6"
									max="18"
									[value]="neu().alter"
									(input)="neuSetzen('alter', $event)"
							/></label>
						}
					</div>
					@if (neu().art === 'erwachsener') {
						<fieldset>
							<legend>Kinder zuordnen</legend>
							<div class="kinder">
								@for (k of jungfischer(); track k.id) {
									<label class="haken">
										<input type="checkbox" [checked]="neu().kinder.includes(k.id)" (change)="kindUmschalten(k.id)" />
										{{ k.vorname }} {{ k.nachname }}
									</label>
								}
							</div>
						</fieldset>
					}
					<div class="aktionen">
						<button type="submit" class="knopf primaer">Anlegen</button>
						<button type="button" class="knopf leise" (click)="formular.set(false)">Abbrechen</button>
					</div>
				</form>
			</jf-karte>
		}

		@if (angelegt(); as id) {
			<jf-karte class="angelegt">
				<h2>{{ name(id) }} ist angelegt</h2>
				<jf-einladung-erzeugen [personId]="id" />
			</jf-karte>
		}

		<div class="filter" role="group" aria-label="Filter">
			@for (f of filterListe; track f.wert) {
				<button
					type="button"
					class="knopf klein"
					[class.primaer]="filter() === f.wert"
					[attr.aria-pressed]="filter() === f.wert"
					(click)="filter.set(f.wert)"
				>
					{{ f.text }}
				</button>
			}
		</div>
		<div class="tabelle">
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Rolle</th>
						<th>Zugang</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					@for (p of liste(); track p.id) {
						<tr>
							<td>
								<strong>{{ p.vorname }} {{ p.nachname }}</strong
								>{{ p.alter ? ', ' + p.alter : '' }}
							</td>
							<td>{{ rolle(p.id) }}</td>
							<td>
								<jf-pille [art]="p.hatZugang ? 'ok' : 'offen'">{{ p.hatZugang ? 'ja' : 'nein' }}</jf-pille>
							</td>
							<td><a class="knopf leise klein" [routerLink]="[p.id]">Details</a></td>
						</tr>
					}
				</tbody>
			</table>
		</div>
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			.anlegen {
				display: grid;
				gap: var(--a3);
			}
			.reihe {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
				gap: var(--a3);
			}
			fieldset {
				margin: 0;
				padding: var(--a3);
				border: 1px solid var(--linie);
				border-radius: var(--radius-klein);
			}
			legend {
				font-weight: 600;
				font-size: var(--schrift-klein);
				color: var(--text-gedaempft);
			}
			.kinder {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
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
			.angelegt {
				display: grid;
				gap: var(--a2);
				border-color: var(--akzent);
			}
			.filter {
				display: flex;
				gap: var(--a2);
			}
			a.knopf {
				text-decoration: none;
			}
		`,
	],
})
export class VerwaltungPersonen {
	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);

	protected readonly filterListe: { wert: Filter; text: string }[] = [
		{ wert: 'alle', text: 'Alle' },
		{ wert: 'jungfischer', text: 'Jungfischer' },
		{ wert: 'erwachsener', text: 'Erwachsene' },
	];
	protected readonly filter = signal<Filter>('alle');
	protected readonly formular = signal(false);
	protected readonly angelegt = signal<Id | null>(null);
	protected readonly neu = signal({ vorname: '', nachname: '', art: 'erwachsener', alter: '12', kinder: [] as Id[] });

	protected readonly jungfischer = computed(() => this.store.stand().personen.filter((p) => p.art === 'jungfischer'));
	protected readonly liste = computed(() =>
		this.store
			.stand()
			.personen.filter((p) => this.filter() === 'alle' || p.art === this.filter())
			.sort((a, b) => a.nachname.localeCompare(b.nachname) || a.vorname.localeCompare(b.vorname)),
	);

	protected rolle(id: Id): string {
		return rolleText(this.store.stand(), id);
	}

	protected name(id: Id): string {
		const p = person(this.store.stand(), id);
		return p ? `${p.vorname} ${p.nachname}` : '';
	}

	protected neuSetzen(feld: 'vorname' | 'nachname' | 'art' | 'alter', e: Event): void {
		const wert = (e.target as HTMLInputElement).value;
		this.neu.update((n) => ({ ...n, [feld]: wert }));
	}

	protected kindUmschalten(id: Id): void {
		this.neu.update((n) => ({
			...n,
			kinder: n.kinder.includes(id) ? n.kinder.filter((k) => k !== id) : [...n.kinder, id],
		}));
	}

	protected anlegen(e: Event): void {
		e.preventDefault();
		const n = this.neu();
		const vorname = n.vorname.trim();
		const nachname = n.nachname.trim();
		if (!vorname || !nachname) {
			this.meldung.zeige('Bitte Vor- und Nachname eingeben');
			return;
		}
		const jungfischer = n.art === 'jungfischer';
		const alter = Math.round(Number(n.alter)) || 12;
		const id = this.store.personAnlegen(
			{
				vorname,
				nachname,
				art: jungfischer ? 'jungfischer' : 'erwachsener',
				...(jungfischer ? { alter, fotoEinwilligung: false } : {}),
				// Kinder ab 12 bekommen einen eigenen Zugang (Rahmen 3.2).
				hatZugang: !jungfischer || alter >= 12,
				rechte: [],
			},
			jungfischer ? [] : n.kinder,
		);
		this.angelegt.set(id);
		this.formular.set(false);
		this.neu.set({ vorname: '', nachname: '', art: 'erwachsener', alter: '12', kinder: [] });
	}
}

/** Detail einer Person: Rolle, Eltern-Kind-Zuordnung, Einladung. */
@Component({
	selector: 'jf-verwaltung-person',
	imports: [RouterLink, KarteComponent, EinladungErzeugen, NichtGefunden],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (p(); as p) {
			<div class="titelzeile">
				<h1>{{ p.vorname }} {{ p.nachname }}</h1>
				<a class="knopf leise" routerLink="..">Zur Liste</a>
			</div>
			<jf-karte>
				<dl>
					<dt>Rolle</dt>
					<dd>{{ rolle() }}</dd>
					@if (p.alter) {
						<dt>Alter</dt>
						<dd>{{ p.alter }}</dd>
					}
					<dt>Eigener Zugang</dt>
					<dd>{{ p.hatZugang ? 'ja' : 'nein' }}</dd>
					@if (p.art === 'jungfischer') {
						<dt>Eltern</dt>
						<dd>
							@for (e of eltern(); track e.id; let letzte = $last) {
								<a [routerLink]="['..', e.id]">{{ e.vorname }} {{ e.nachname }}</a
								>{{ letzte ? '' : ', ' }}
							} @empty {
								—
							}
						</dd>
						<dt>Fotos</dt>
						<dd>{{ p.fotoEinwilligung ? 'Einwilligung erteilt' : 'Keine Einwilligung' }}</dd>
					} @else {
						<dt>Kinder</dt>
						<dd>
							@for (k of kinder(); track k.id; let letzte = $last) {
								<a [routerLink]="['..', k.id]">{{ k.vorname }} {{ k.nachname }}</a
								>{{ letzte ? '' : ', ' }}
							} @empty {
								—
							}
						</dd>
						@if (jugendleiter()) {
							<dt>Rechte</dt>
							<dd>
								<a routerLink="../../rechte">{{ p.rechte.length }} von 7 · bearbeiten</a>
							</dd>
						}
					}
				</dl>
			</jf-karte>
			<jf-karte>
				<h2>Einladung</h2>
				<jf-einladung-erzeugen [personId]="p.id" />
			</jf-karte>
		} @else {
			<jf-nicht-gefunden />
		}
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			dl {
				display: grid;
				grid-template-columns: max-content 1fr;
				gap: var(--a2) var(--a4);
				margin: 0;
			}
			dt {
				color: var(--text-gedaempft);
			}
			dd {
				margin: 0;
			}
			a {
				color: var(--akzent);
				font-weight: 600;
			}
			a.knopf {
				text-decoration: none;
			}
		`,
	],
})
export class VerwaltungPerson {
	readonly id = input<string>('');
	private readonly store = inject(EntwurfStore);
	protected readonly p = computed(() => person(this.store.stand(), this.id()));
	protected readonly rolle = computed(() => rolleText(this.store.stand(), this.id()));
	protected readonly eltern = computed(() => elternVon(this.store.stand(), this.id()));
	protected readonly kinder = computed(() => kinderVon(this.store.stand(), this.id()));
	protected readonly jugendleiter = computed(() => {
		const p = this.p();
		return !!p && istJugendleiter(p);
	});
}
