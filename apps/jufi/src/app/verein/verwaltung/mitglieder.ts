import { ChangeDetectionStrategy, Component, computed, inject, input, type OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { KarteComponent, PilleComponent } from '../../gestaltung/ui';
import { MitgliedSitzung } from '../mitglied-waechter';
import { MitgliederApi, type PersonListe, type Untergruppe } from '../mitglieder-api';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { warnhinweisText } from './texte';

type ArtFilter = 'alle' | 'JUNGFISCHER' | 'ERWACHSENER';

/**
 * Die Mitgliederliste der Verwaltung. Gefiltert wird im Browser: Der Verein hat wenige
 * hundert Personen, die Liste kommt ohnehin ganz (Server: personen.ts); eine Anfrage je
 * Tastendruck waere langsamer und braeuchte Serverfilter, die es nicht gibt.
 *
 * Was die Person nicht sehen darf, fehlt schon in der Antwort. Die Seite blendet die
 * E-Mail-Spalte und das Anlegen nur nach dem Recht MITGLIEDER ein, damit Betreuer keine
 * leere Spalte und keinen Knopf sehen, der mit 404 antwortete.
 */
@Component({
	selector: 'jf-mitglieder',
	imports: [KarteComponent, PilleComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Mitglieder</h1>
		@if (darfVerwalten()) {
			<div class="leiste">
				<a class="knopf primaer" [routerLink]="['/', slug(), 'verwaltung', 'neu']">Person anlegen</a>
			</div>
		}
		@if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (personen(); as alle) {
			<jf-karte>
				<form class="filter" role="search" (submit)="$event.preventDefault()">
					<label class="feld breit">
						Name suchen
						<input type="search" name="suche" autocomplete="off" [value]="suche()" (input)="suche.set(wert($event))" />
					</label>
					<label class="feld">
						Art
						<select name="art" [value]="art()" (change)="art.set(artVon($event))">
							<option value="alle">Alle</option>
							<option value="JUNGFISCHER">Jungfischer</option>
							<option value="ERWACHSENER">Erwachsene</option>
						</select>
					</label>
					@if (untergruppen().length > 0) {
						<label class="feld">
							Untergruppe
							<select name="untergruppe" [value]="untergruppe()" (change)="untergruppe.set(wert($event))">
								<option value="">Alle</option>
								@for (u of untergruppen(); track u.id) {
									<option [value]="u.id">{{ u.name }}</option>
								}
							</select>
						</label>
					}
					<label class="haken">
						<input
							type="checkbox"
							name="nurHinweise"
							[checked]="nurHinweise()"
							(change)="nurHinweise.set(angehakt($event))"
						/>
						Nur mit Warnhinweis
					</label>
				</form>
			</jf-karte>

			<p class="zaehler gedaempft klein" role="status">{{ gefiltert().length }} von {{ alle.length }} Personen</p>

			<div class="tabelle" role="table" aria-label="Mitglieder">
				<div class="kopf" role="row" [class.mit-mail]="darfVerwalten()">
					<span role="columnheader">Name</span>
					<span role="columnheader">Art</span>
					<span role="columnheader">Untergruppen</span>
					<span role="columnheader">Hinweise</span>
					@if (darfVerwalten()) {
						<span role="columnheader">E-Mail</span>
					}
				</div>
				@for (p of gefiltert(); track p.id) {
					<div class="zeile" role="row" [attr.data-person]="p.id" [class.mit-mail]="darfVerwalten()">
						<span role="cell" class="zelle-name">
							<a class="name" [routerLink]="['/', slug(), 'verwaltung', 'personen', p.id]"
								>{{ p.vorname }} {{ p.nachname }}</a
							>
						</span>
						<span role="cell" data-label="Art">{{ p.art === 'JUNGFISCHER' ? 'Jungfischer' : 'Erwachsene' }}</span>
						<span role="cell" data-label="Untergruppen">{{ gruppenText(p) }}</span>
						<span role="cell" class="hinweise">
							@for (h of p.warnhinweise ?? []; track $index) {
								<jf-pille art="offen">{{ hinweis(h) }}</jf-pille>
							}
						</span>
						@if (darfVerwalten()) {
							<span role="cell" data-label="E-Mail" class="mail">{{ p.email ?? '' }}</span>
						}
					</div>
				} @empty {
					<p class="gedaempft leer">Keine Person passt zu diesen Filtern.</p>
				}
			</div>
		}
	`,
	styles: `
		:host {
			display: block;
			max-width: 64rem;
		}
		h1 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-titel);
		}
		.leiste {
			display: flex;
			justify-content: flex-end;
			margin: 0 0 var(--a3);
		}
		.filter {
			display: grid;
			gap: var(--a3);
		}
		.zaehler {
			margin: var(--a3) 0;
		}
		.fehler {
			margin: 0 0 var(--a3);
			color: var(--fehler);
		}
		.tabelle {
			display: grid;
			gap: var(--a3);
		}
		.kopf {
			display: none;
		}
		.zeile {
			display: grid;
			gap: var(--a1);
			padding: var(--a3) var(--a4);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			background: var(--karte);
			overflow-wrap: anywhere;
		}
		.zeile [data-label]::before {
			content: attr(data-label) ': ';
			color: var(--text-gedaempft);
		}
		.zelle-name {
			font-weight: 600;
		}
		.name {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
		}
		.hinweise {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a1);
		}
		.hinweise:empty {
			display: none;
		}
		.leer {
			margin: 0;
		}
		@media (min-width: 768px) {
			.filter {
				grid-template-columns: 1fr 1fr 1fr;
				align-items: end;
			}
			.filter .breit {
				grid-column: 1 / -1;
			}
			.tabelle {
				gap: 0;
				border: 1px solid var(--linie);
				border-radius: var(--radius);
				background: var(--karte);
			}
			.kopf,
			.zeile {
				display: grid;
				grid-template-columns: 1.4fr 0.9fr 1.1fr 2fr;
				gap: var(--a3);
				align-items: center;
			}
			.kopf.mit-mail,
			.zeile.mit-mail {
				grid-template-columns: 1.4fr 0.9fr 1.1fr 2fr 1.6fr;
			}
			.kopf {
				padding: var(--a2) var(--a4);
				color: var(--text-gedaempft);
				font-size: var(--schrift-klein);
				font-weight: 600;
			}
			.zeile {
				border: 0;
				border-top: 1px solid var(--linie);
				border-radius: 0;
				background: transparent;
			}
			.zeile [data-label]::before {
				content: none;
			}
			.leer {
				padding: var(--a4);
			}
		}
	`,
})
export class MitgliederComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly sitzung = inject(MitgliedSitzung);
	private readonly router = inject(Router);

	protected readonly personen = signal<PersonListe[] | null>(null);
	protected readonly untergruppen = signal<Untergruppe[]>([]);
	protected readonly ladefehler = signal<string | null>(null);

	protected readonly suche = signal('');
	protected readonly art = signal<ArtFilter>('alle');
	protected readonly untergruppe = signal('');
	protected readonly nurHinweise = signal(false);

	protected readonly darfVerwalten = computed(() => this.sitzung.ich()?.person.rechte.includes('MITGLIEDER') ?? false);

	protected readonly gefiltert = computed(() => {
		const teile = this.suche().toLowerCase().split(/\s+/).filter(Boolean);
		const art = this.art();
		const gruppe = this.untergruppe();
		const nurHinweise = this.nurHinweise();
		return (this.personen() ?? []).filter((p) => {
			const name = `${p.vorname} ${p.nachname}`.toLowerCase();
			if (!teile.every((t) => name.includes(t))) return false;
			if (art !== 'alle' && p.art !== art) return false;
			if (gruppe && !p.untergruppen?.some((u) => u.id === gruppe)) return false;
			if (nurHinweise && (p.warnhinweise?.length ?? 0) === 0) return false;
			return true;
		});
	});

	protected readonly wert = wertVon;
	protected readonly hinweis = warnhinweisText;

	ngOnInit(): void {
		void this.lade();
	}

	protected async lade(): Promise<void> {
		this.ladefehler.set(null);
		// Die Untergruppen sind nur der Filter: Fehlen sie, bleibt die Liste benutzbar.
		const gruppen = firstValueFrom(this.api.untergruppen(this.slug())).then(
			(a) => this.untergruppen.set(a.untergruppen),
			() => this.untergruppen.set([]),
		);
		try {
			this.personen.set((await firstValueFrom(this.api.personen(this.slug()))).personen);
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), f)) return;
			this.ladefehler.set(fehlertext(f));
		}
		await gruppen;
	}

	protected artVon(ereignis: Event): ArtFilter {
		return wertVon(ereignis) as ArtFilter;
	}

	protected angehakt(ereignis: Event): boolean {
		return (ereignis.target as HTMLInputElement).checked;
	}

	protected gruppenText(p: PersonListe): string {
		return p.untergruppen && p.untergruppen.length > 0 ? p.untergruppen.map((u) => u.name).join(', ') : '–';
	}
}
