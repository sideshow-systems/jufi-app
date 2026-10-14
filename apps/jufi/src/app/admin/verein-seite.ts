import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { pruefeNeuenSlug, SLUG_HINWEIS } from '@jufi/domain';
import { firstValueFrom, type Observable } from 'rxjs';
import { datumDeutsch, zeitpunktBerlin } from '../gestaltung/format';
import { AbschnittComponent, KarteComponent, PilleComponent } from '../gestaltung/ui';
import { AdminApi, type AdminAktion, type Einladung, type VereinDetails } from './admin-api';
import { alsApiFehler, fehlertext, type ApiFehler } from '../gemeinsam/api-fehler';
import { BestaetigungComponent } from './bestaetigung';
import { EinladungAnzeigeComponent } from './einladung-anzeige';
import { wertVon } from '../gemeinsam/formular';

const AKTION_TEXT: Record<AdminAktion, string> = {
	VEREIN_ANGELEGT: 'Verein angelegt',
	GESPERRT: 'gesperrt',
	ENTSPERRT: 'entsperrt',
	SLUG_KORRIGIERT: 'Slug korrigiert',
	NOTFALL_LINK: 'Notfall-Link erzeugt',
	ERSTE_EINLADUNG_ERNEUERT: 'Einladung der ersten Leitung erneuert',
};

interface Frage {
	text: string;
	bestaetigung: string;
	aktion: () => Promise<void>;
}

/**
 * Ein Verein im Ueberblick und die Handlungen des Admins daran (Spec 7.3, 7.5):
 * Kennzahlen und Ansprechpartner, nie Kinder oder Familien (7.4). Jede Handlung
 * laedt danach die Seite neu, damit Status, Slug und Protokoll stimmen; liefert
 * sie eine Einladung, bleibt der Text darueber stehen.
 */
@Component({
	selector: 'jf-admin-verein-seite',
	imports: [
		AbschnittComponent,
		BestaetigungComponent,
		EinladungAnzeigeComponent,
		KarteComponent,
		PilleComponent,
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<a class="zurueck" routerLink="/admin/vereine">← Alle Vereine</a>
		@if (ladefehler(); as text) {
			<jf-karte>
				<p>{{ text }}</p>
				@if (!nichtGefunden()) {
					<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
				}
			</jf-karte>
		} @else if (verein(); as v) {
			<div class="kopf">
				<h1>{{ v.anzeigename }}</h1>
				@if (v.status === 'AKTIV') {
					<jf-pille art="ok">Aktiv</jf-pille>
				} @else {
					<jf-pille art="offen">Gesperrt</jf-pille>
				}
			</div>
			<p class="gedaempft unter-kopf">
				{{ v.name }} · <code>{{ v.slug }}</code>
			</p>

			@if (aktionsfehler(); as text) {
				<p class="fehler" role="alert">{{ text }}</p>
			}
			@if (ergebnis(); as e) {
				<section class="ergebnis" aria-label="Neue Einladung">
					<h2>{{ e.titel }}</h2>
					<jf-einladung-anzeige [einladung]="e.einladung" />
				</section>
			}

			<div class="stapel">
				<jf-abschnitt titel="Kennzahlen">
					<jf-karte>
						<dl class="zahlen">
							<div>
								<dt>Jungfischer</dt>
								<dd>{{ v.kennzahlen.jungfischer }}</dd>
							</div>
							<div>
								<dt>Erwachsene</dt>
								<dd>{{ v.kennzahlen.erwachsene }}</dd>
							</div>
							<div>
								<dt>Zugänge</dt>
								<dd>{{ v.kennzahlen.zugaenge }}</dd>
							</div>
							<div>
								<dt>Offene Einladungen</dt>
								<dd>{{ v.kennzahlen.offeneEinladungen }}</dd>
							</div>
							<div>
								<dt>Letzte Anmeldung</dt>
								<dd>{{ v.kennzahlen.letzteAnmeldung ? datum(v.kennzahlen.letzteAnmeldung) : '—' }}</dd>
							</div>
						</dl>
					</jf-karte>
				</jf-abschnitt>

				<jf-abschnitt titel="Ansprechpartner">
					<jf-karte>
						@for (a of v.ansprechpartner; track a.personId) {
							<div class="person">
								<div>
									<strong>{{ a.vorname }} {{ a.nachname }}</strong>
									<div class="gedaempft klein">{{ a.email ?? 'Keine E-Mail-Adresse' }}</div>
								</div>
								<button
									type="button"
									class="knopf klein"
									[disabled]="laeuft()"
									[attr.aria-label]="'Notfall-Link für ' + a.vorname + ' erzeugen'"
									(click)="frageNotfallLink(a.personId, a.vorname)"
								>
									Notfall-Link erzeugen
								</button>
							</div>
						} @empty {
							<p class="gedaempft leer">Noch kein Ansprechpartner.</p>
						}
					</jf-karte>
				</jf-abschnitt>

				<jf-abschnitt titel="Aktionen">
					<jf-karte>
						<div class="aktion">
							<div>
								<strong>{{ v.status === 'AKTIV' ? 'Verein sperren' : 'Verein entsperren' }}</strong>
								<div class="gedaempft klein">
									{{
										v.status === 'AKTIV'
											? 'Gesperrt zeigen alle Seiten des Vereins „nicht gefunden“.'
											: 'Der Verein ist gesperrt; bestehende Anmeldungen wirken nach dem Entsperren wieder.'
									}}
								</div>
							</div>
							<button type="button" class="knopf" [disabled]="laeuft()" (click)="frageStatus(v)">
								{{ v.status === 'AKTIV' ? 'Sperren' : 'Entsperren' }}
							</button>
						</div>

						@if (v.slugAenderbar) {
							<form class="aktion" (submit)="korrigiereSlug($event)" novalidate>
								<label class="feld">
									Slug korrigieren
									<input
										name="slug"
										autocomplete="off"
										autocapitalize="none"
										spellcheck="false"
										[value]="slugEingabe()"
										[attr.aria-invalid]="slugFehler() ? 'true' : null"
										[attr.aria-describedby]="slugFehler() ? 'fehler-slug' : 'slug-hinweis'"
										(input)="slugGeaendert(wert($event))"
									/>
									@if (slugFehler(); as text) {
										<span class="fehler" id="fehler-slug">{{ text }}</span>
									}
									<span class="hinweis" id="slug-hinweis">
										Möglich, solange niemand die erste Einladung angenommen hat. Es entsteht ein neuer Einladungslink.
									</span>
								</label>
								<button type="submit" class="knopf" [disabled]="laeuft() || !slugAenderbar()">Slug ändern</button>
							</form>
						}

						@if (v.ersteLeitung; as l) {
							<div class="aktion">
								<div>
									<strong>Erste Einladung</strong>
									<div class="gedaempft klein">Noch nicht angenommen. Der bisherige Link gilt danach nicht mehr.</div>
								</div>
								<button type="button" class="knopf" [disabled]="laeuft()" (click)="erneuereEinladung(l.vorname)">
									Einladung für {{ l.vorname }} erneuern
								</button>
							</div>
						}
					</jf-karte>
				</jf-abschnitt>

				<jf-abschnitt titel="Protokoll">
					<jf-karte class="protokoll">
						<table>
							<thead>
								<tr>
									<th scope="col">Zeitpunkt</th>
									<th scope="col">Aktion</th>
									<th scope="col">Admin</th>
								</tr>
							</thead>
							<tbody>
								@for (p of v.protokoll; track $index) {
									<tr>
										<td>{{ zeitpunkt(p.zeitpunkt) }}</td>
										<td>{{ aktionText(p.aktion) }}</td>
										<td>{{ p.admin }}</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="3" class="gedaempft">Noch keine Einträge.</td>
									</tr>
								}
							</tbody>
						</table>
					</jf-karte>
				</jf-abschnitt>
			</div>
		} @else {
			<p class="gedaempft">Wird geladen …</p>
		}

		@if (frage(); as f) {
			<jf-bestaetigung
				[text]="f.text"
				[bestaetigung]="f.bestaetigung"
				(bestaetigt)="bestaetigt()"
				(abgebrochen)="frage.set(null)"
			/>
		}
	`,
	styles: `
		:host {
			display: block;
		}
		.zurueck {
			display: inline-block;
			margin: 0 0 var(--a3);
		}
		.kopf {
			display: flex;
			align-items: center;
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
		.unter-kopf {
			margin: var(--a1) 0 var(--a4);
		}
		.stapel {
			display: grid;
			gap: var(--a4);
		}
		.ergebnis {
			margin: 0 0 var(--a4);
		}
		.fehler {
			color: var(--fehler);
			font-weight: 400;
		}
		[aria-invalid='true'] {
			border-color: var(--fehler);
		}
		p {
			margin: 0 0 var(--a3);
		}
		.zahlen {
			display: grid;
			grid-template-columns: repeat(5, 1fr);
			gap: var(--a4);
			margin: 0;
		}
		.zahlen dt {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		.zahlen dd {
			margin: 0;
			font-size: var(--schrift-gross);
			font-weight: 700;
			font-variant-numeric: tabular-nums;
		}
		.person,
		.aktion {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--a4);
			padding: var(--a3) 0;
			border-bottom: 1px solid var(--linie);
		}
		.person:first-child,
		.aktion:first-child {
			padding-top: 0;
		}
		.person:last-child,
		.aktion:last-child {
			padding-bottom: 0;
			border-bottom: 0;
		}
		.leer {
			margin: 0;
		}
		form.aktion {
			align-items: flex-end;
		}
		form.aktion .feld {
			flex: 1;
			max-width: 28rem;
		}
		.hinweis {
			font-weight: 400;
		}
		jf-karte.protokoll {
			padding: 0;
			overflow-x: auto;
		}
		table {
			width: 100%;
			border-collapse: collapse;
		}
		th,
		td {
			padding: var(--a2) var(--a4);
			border-bottom: 1px solid var(--linie);
			text-align: start;
		}
		th {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		tbody tr:last-child td {
			border-bottom: 0;
		}
		td:first-child {
			white-space: nowrap;
			font-variant-numeric: tabular-nums;
		}
	`,
})
export class AdminVereinSeiteComponent {
	private readonly api = inject(AdminApi);
	private readonly router = inject(Router);

	/** Aus dem Pfad (withComponentInputBinding). */
	readonly id = input.required<string>();

	protected readonly verein = signal<VereinDetails | null>(null);
	protected readonly ladefehler = signal<string | null>(null);
	protected readonly nichtGefunden = signal(false);
	protected readonly aktionsfehler = signal<string | null>(null);
	protected readonly laeuft = signal(false);
	protected readonly frage = signal<Frage | null>(null);
	protected readonly ergebnis = signal<{ titel: string; einladung: Einladung } | null>(null);

	protected readonly slugEingabe = signal('');
	private readonly serverSlugFehler = signal<string | null>(null);
	protected readonly slugFehler = computed(() => {
		if (this.serverSlugFehler()) return this.serverSlugFehler();
		const slug = this.slugEingabe();
		if (slug === this.verein()?.slug) return null;
		const pruefung = pruefeNeuenSlug(slug);
		return pruefung.ok ? null : SLUG_HINWEIS[pruefung.grund];
	});
	/** Nur ein anderer, gueltiger Slug ist eine Korrektur. */
	protected readonly slugAenderbar = computed(
		() => this.slugEingabe() !== this.verein()?.slug && pruefeNeuenSlug(this.slugEingabe()).ok,
	);

	protected readonly wert = wertVon;
	protected readonly datum = datumDeutsch;
	protected readonly zeitpunkt = zeitpunktBerlin;
	protected readonly aktionText = (aktion: AdminAktion) => AKTION_TEXT[aktion];

	constructor() {
		// Bei jeder neuen id laden, auch wenn der Router das Bauteil wiederverwendet.
		effect(() => {
			this.id();
			void this.lade();
		});
	}

	protected async lade(): Promise<void> {
		this.ladefehler.set(null);
		this.nichtGefunden.set(false);
		try {
			await this.hole();
		} catch (ursache) {
			const fehler = await this.pruefeSitzung(ursache);
			if (!fehler) return;
			this.nichtGefunden.set(fehler.status === 404);
			this.ladefehler.set(
				fehler.status === 404
					? 'Verein nicht gefunden.'
					: fehler.status === 0
						? fehlertext(fehler)
						: `Der Verein konnte nicht geladen werden: ${fehlertext(fehler)}`,
			);
		}
	}

	private async hole(): Promise<void> {
		const v = await firstValueFrom(this.api.verein(this.id()));
		this.verein.set(v);
		this.slugEingabe.set(v.slug);
		this.serverSlugFehler.set(null);
	}

	/** 401 heisst: Sitzung abgelaufen (siehe Konto). Dann zur Anmeldung; sonst kommt der Fehler zurueck. */
	private async pruefeSitzung(ursache: unknown): Promise<ApiFehler | null> {
		const fehler = alsApiFehler(ursache);
		if (fehler.status !== 401) return fehler;
		await this.router.navigateByUrl('/admin/anmelden');
		return null;
	}

	/**
	 * Fuehrt eine Handlung aus und laedt die Seite neu. Scheitert das Neuladen
	 * nach gelungener Handlung, bleibt die alte Ansicht mit einer Fehlermeldung
	 * stehen statt der Fehlerseite: Die Handlung ist ja geschehen.
	 */
	private async ausfuehren<T>(aufruf: Observable<T>, danach: (antwort: T) => void = () => undefined): Promise<void> {
		this.laeuft.set(true);
		this.aktionsfehler.set(null);
		this.serverSlugFehler.set(null);
		try {
			danach(await firstValueFrom(aufruf));
			await this.hole();
		} catch (ursache) {
			const fehler = await this.pruefeSitzung(ursache);
			if (!fehler) return;
			if (fehler.feld === 'slug') this.serverSlugFehler.set(fehler.fehler);
			else this.aktionsfehler.set(fehlertext(fehler));
		} finally {
			this.laeuft.set(false);
		}
	}

	protected bestaetigt(): void {
		const f = this.frage();
		this.frage.set(null);
		if (f) void f.aktion();
	}

	protected frageStatus(v: VereinDetails): void {
		const sperren = v.status === 'AKTIV';
		this.frage.set({
			text: sperren
				? `„${v.anzeigename}“ sperren? Alle Seiten des Vereins zeigen dann „nicht gefunden“, bis du ihn wieder entsperrst.`
				: `„${v.anzeigename}“ wieder entsperren?`,
			bestaetigung: sperren ? 'Sperren' : 'Entsperren',
			aktion: () => this.ausfuehren(sperren ? this.api.sperren(v.id) : this.api.entsperren(v.id)),
		});
	}

	protected frageNotfallLink(personId: string, vorname: string): void {
		this.frage.set({
			text: `Neuen Einladungslink für ${vorname} erzeugen? Der Verein sieht das in seiner Verwaltung.`,
			bestaetigung: 'Link erzeugen',
			aktion: () =>
				this.ausfuehren(this.api.notfallLink(this.id(), personId), (a) =>
					this.ergebnis.set({ titel: `Notfall-Link für ${vorname}`, einladung: a.einladung }),
				),
		});
	}

	protected erneuereEinladung(vorname: string): Promise<void> {
		return this.ausfuehren(this.api.erneuereErsteEinladung(this.id()), (a) =>
			this.ergebnis.set({ titel: `Neue Einladung für ${vorname}`, einladung: a.einladung }),
		);
	}

	protected slugGeaendert(wert: string): void {
		this.slugEingabe.set(wert);
		this.serverSlugFehler.set(null);
	}

	protected async korrigiereSlug(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		if (this.laeuft() || !this.slugAenderbar()) return;
		await this.ausfuehren(this.api.korrigiereSlug(this.id(), this.slugEingabe()), (a) =>
			this.ergebnis.set({ titel: 'Slug korrigiert – neuer Einladungslink', einladung: a.einladung }),
		);
	}
}
