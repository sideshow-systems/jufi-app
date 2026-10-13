import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
	normalisiereEmail,
	pruefeAnzeigename,
	pruefeEmail,
	pruefeNeuenSlug,
	slugVorschlag,
	SLUG_HINWEIS,
} from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { KarteComponent } from '../gestaltung/ui';
import { AdminApi, alsAdminFehler, fehlertext, type Einladung } from './admin-api';
import { EinladungAnzeigeComponent } from './einladung-anzeige';
import { wertVon } from './formular';

type Feld = 'name' | 'anzeigename' | 'slug' | 'farbe' | 'vorname' | 'nachname' | 'email';
type Fehler = Partial<Record<Feld, string>>;

/** Startfarbe: das Teal des Stils "Am Wasser". Der Verein stellt sie spaeter selbst um (Etappe 5). */
const STARTFARBE = '#0f766e';
const FELDER: readonly Feld[] = ['name', 'anzeigename', 'slug', 'farbe', 'vorname', 'nachname', 'email'];
const BITTE_AUSFUELLEN = 'Bitte ausfüllen';

/**
 * Neuen Verein anlegen und die erste Leitung einladen (Spec 7.3). Nach dem Anlegen
 * ersetzt der Einladungstext das Formular: Der Link steht nur in dieser Antwort,
 * er ist nirgends sonst abrufbar.
 */
@Component({
	selector: 'jf-admin-verein-neu',
	imports: [EinladungAnzeigeComponent, KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Verein anlegen</h1>
		@if (angelegt(); as a) {
			<div class="stapel">
				<jf-karte>
					<h2>Verein angelegt</h2>
					<p class="gedaempft">
						Schick der ersten Leitung diesen Text. Er enthält den Link, mit dem sie die Vereinsverwaltung einrichtet.
					</p>
				</jf-karte>
				<jf-einladung-anzeige [einladung]="a.einladung" />
				<div class="reihe">
					<a class="knopf primaer" [routerLink]="['/admin/vereine', a.id]">Zur Vereinsseite</a>
					<a class="knopf" routerLink="/admin/vereine">Zu allen Vereinen</a>
				</div>
			</div>
		} @else {
			<form class="stapel" (submit)="anlegen($event)" novalidate>
				<jf-karte>
					<h2>Verein</h2>
					<div class="felder">
						<label class="feld">
							Offizieller Name
							<input
								name="name"
								autocomplete="off"
								[value]="name()"
								[attr.aria-invalid]="fehler().name ? 'true' : null"
								[attr.aria-describedby]="fehler().name ? 'fehler-name' : null"
								(input)="name.set(wert($event)); loescheFehler('name')"
							/>
							@if (fehler().name; as text) {
								<span class="fehler" id="fehler-name">{{ text }}</span>
							}
						</label>
						<label class="feld">
							<span class="mit-zaehler">
								Anzeigename
								<span class="zaehler" [class.voll]="anzeigename().length >= 24">{{ anzeigename().length }}/24</span>
							</span>
							<input
								name="anzeigename"
								autocomplete="off"
								maxlength="24"
								[value]="anzeigename()"
								[attr.aria-invalid]="fehler().anzeigename ? 'true' : null"
								[attr.aria-describedby]="fehler().anzeigename ? 'fehler-anzeigename' : null"
								(input)="anzeigenameGeaendert(wert($event))"
							/>
							@if (fehler().anzeigename; as text) {
								<span class="fehler" id="fehler-anzeigename">{{ text }}</span>
							}
						</label>
						<label class="feld">
							Slug
							<input
								name="slug"
								autocomplete="off"
								autocapitalize="none"
								spellcheck="false"
								[value]="slug()"
								[attr.aria-invalid]="slugFehler() ? 'true' : null"
								[attr.aria-describedby]="slugFehler() ? 'fehler-slug' : 'vorschau'"
								(input)="slugGeaendert(wert($event))"
							/>
							@if (slugFehler(); as text) {
								<span class="fehler" id="fehler-slug">{{ text }}</span>
							}
							<span class="vorschau" id="vorschau">Adresse: {{ ursprung }}/{{ slug() || '…' }}/</span>
						</label>
						<label class="feld farbe">
							Farbe
							<input
								type="color"
								name="farbe"
								[value]="farbe()"
								[attr.aria-invalid]="fehler().farbe ? 'true' : null"
								[attr.aria-describedby]="fehler().farbe ? 'fehler-farbe' : null"
								(input)="farbe.set(wert($event)); loescheFehler('farbe')"
							/>
							@if (fehler().farbe; as text) {
								<span class="fehler" id="fehler-farbe">{{ text }}</span>
							}
						</label>
					</div>
				</jf-karte>

				<jf-karte>
					<h2>Erste Leitung</h2>
					<div class="felder">
						<label class="feld">
							Vorname
							<input
								name="vorname"
								autocomplete="off"
								[value]="vorname()"
								[attr.aria-invalid]="fehler().vorname ? 'true' : null"
								[attr.aria-describedby]="fehler().vorname ? 'fehler-vorname' : null"
								(input)="vorname.set(wert($event)); loescheFehler('vorname')"
							/>
							@if (fehler().vorname; as text) {
								<span class="fehler" id="fehler-vorname">{{ text }}</span>
							}
						</label>
						<label class="feld">
							Nachname
							<input
								name="nachname"
								autocomplete="off"
								[value]="nachname()"
								[attr.aria-invalid]="fehler().nachname ? 'true' : null"
								[attr.aria-describedby]="fehler().nachname ? 'fehler-nachname' : null"
								(input)="nachname.set(wert($event)); loescheFehler('nachname')"
							/>
							@if (fehler().nachname; as text) {
								<span class="fehler" id="fehler-nachname">{{ text }}</span>
							}
						</label>
						<label class="feld breit">
							E-Mail
							<input
								type="email"
								name="email"
								autocomplete="off"
								[value]="email()"
								[attr.aria-invalid]="fehler().email ? 'true' : null"
								[attr.aria-describedby]="fehler().email ? 'fehler-email' : null"
								(input)="email.set(wert($event)); loescheFehler('email')"
							/>
							@if (fehler().email; as text) {
								<span class="fehler" id="fehler-email">{{ text }}</span>
							}
						</label>
					</div>
				</jf-karte>

				@if (allgemeinerFehler(); as text) {
					<p class="fehler" role="alert">{{ text }}</p>
				}
				<div class="reihe">
					<button type="submit" class="knopf primaer" [disabled]="laeuft()">Verein anlegen</button>
					<a class="knopf" routerLink="/admin/vereine">Abbrechen</a>
				</div>
			</form>
		}
	`,
	styles: `
		:host {
			display: block;
		}
		h1 {
			margin: 0 0 var(--a4);
			font-size: var(--schrift-titel);
		}
		h2 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-gross);
		}
		.stapel {
			display: grid;
			gap: var(--a4);
			max-width: 40rem;
		}
		.felder {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--a3) var(--a4);
		}
		.breit {
			grid-column: 1 / -1;
		}
		.mit-zaehler {
			display: flex;
			justify-content: space-between;
		}
		.zaehler {
			font-weight: 400;
			font-variant-numeric: tabular-nums;
		}
		.zaehler.voll {
			color: var(--warnung);
		}
		.vorschau {
			font-weight: 400;
			overflow-wrap: anywhere;
		}
		.feld.farbe input {
			width: 4.5rem;
			padding: var(--a1);
		}
		.fehler {
			color: var(--fehler);
			font-weight: 400;
		}
		[aria-invalid='true'] {
			border-color: var(--fehler);
		}
		p {
			margin: 0;
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
	`,
})
export class AdminVereinNeuComponent {
	private readonly api = inject(AdminApi);
	private readonly router = inject(Router);
	/** Die Vorschau zeigt die Adresse, unter der der Verein wirklich erreichbar ist (BASIS_URL = diese Seite). */
	protected readonly ursprung = inject(DOCUMENT).location.origin;

	protected readonly name = signal('');
	protected readonly anzeigename = signal('');
	protected readonly slug = signal('');
	protected readonly farbe = signal(STARTFARBE);
	protected readonly vorname = signal('');
	protected readonly nachname = signal('');
	protected readonly email = signal('');

	/**
	 * Solange die Person den Slug nicht selbst angefasst hat, folgt er dem Anzeigenamen.
	 * Leert sie das Feld wieder, folgt er erneut: ein leerer Slug ist nie gewollt.
	 */
	private readonly slugVonHand = signal(false);

	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<Fehler>({});
	protected readonly allgemeinerFehler = signal<string | null>(null);
	protected readonly angelegt = signal<{ id: string; slug: string; einladung: Einladung } | null>(null);

	protected readonly wert = wertVon;

	/**
	 * Schon beim Tippen: Ein reservierter Slug (demo) oder ein falsches Zeichen soll
	 * nicht erst nach dem Absenden auffallen. Ein Fehler vom Server (vergeben) am
	 * selben Feld geht vor, bis der Slug wieder geaendert wird.
	 */
	protected readonly slugFehler = computed(() => {
		const serverText = this.fehler().slug;
		if (serverText) return serverText;
		const slug = this.slug();
		if (slug === '') return null;
		const pruefung = pruefeNeuenSlug(slug);
		return pruefung.ok ? null : SLUG_HINWEIS[pruefung.grund];
	});

	protected anzeigenameGeaendert(wert: string): void {
		this.anzeigename.set(wert);
		this.loescheFehler('anzeigename');
		if (!this.slugVonHand()) {
			this.slug.set(slugVorschlag(wert.trim()));
			this.loescheFehler('slug');
		}
	}

	protected slugGeaendert(wert: string): void {
		this.slug.set(wert);
		this.slugVonHand.set(wert !== '');
		this.loescheFehler('slug');
	}

	protected async anlegen(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		if (this.laeuft()) return;
		const eingabe = {
			name: this.name().trim(),
			anzeigename: this.anzeigename().trim(),
			slug: this.slug(),
			farbe: this.farbe(),
			leitung: {
				vorname: this.vorname().trim(),
				nachname: this.nachname().trim(),
				email: normalisiereEmail(this.email()),
			},
		};
		// Dieselben Regeln wie der Server (vereine.ts), damit ein Tippfehler keinen Weg ueber das Netz braucht.
		const fehler: Fehler = {};
		if (eingabe.name === '') fehler.name = 'Bitte den offiziellen Namen angeben';
		if (!pruefeAnzeigename(eingabe.anzeigename)) fehler.anzeigename = 'Höchstens 24 Zeichen, nicht leer';
		const slug = pruefeNeuenSlug(eingabe.slug);
		if (!slug.ok) fehler.slug = SLUG_HINWEIS[slug.grund];
		if (eingabe.leitung.vorname === '') fehler.vorname = BITTE_AUSFUELLEN;
		if (eingabe.leitung.nachname === '') fehler.nachname = BITTE_AUSFUELLEN;
		if (!pruefeEmail(eingabe.leitung.email)) fehler.email = 'Keine gültige E-Mail-Adresse';
		this.fehler.set(fehler);
		this.allgemeinerFehler.set(null);
		if (Object.keys(fehler).length > 0) return;

		this.laeuft.set(true);
		try {
			this.angelegt.set(await firstValueFrom(this.api.legeVereinAn(eingabe)));
		} catch (ursache) {
			const f = alsAdminFehler(ursache);
			if (f.status === 401) await this.router.navigateByUrl('/admin/anmelden');
			else if (f.feld && FELDER.includes(f.feld as Feld)) this.fehler.set({ [f.feld]: f.fehler });
			else this.allgemeinerFehler.set(fehlertext(f));
		} finally {
			this.laeuft.set(false);
		}
	}

	protected loescheFehler(...felder: Feld[]): void {
		this.fehler.update((alt) => {
			const neu = { ...alt };
			for (const f of felder) delete neu[f];
			return neu;
		});
	}
}
