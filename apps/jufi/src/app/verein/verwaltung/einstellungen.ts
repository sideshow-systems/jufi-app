import {
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	inject,
	input,
	type OnInit,
	signal,
	untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { initialen, LOGO_MAX_BYTES, LOGO_ZU_GROSS } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { farbeAngepasst, vereinsfarben } from '../../gestaltung/farben';
import { MeldungService } from '../../gestaltung/meldung';
import { ThemaService } from '../../gestaltung/thema';
import { KarteComponent } from '../../gestaltung/ui';
import { type Einstellungen, type EinstellungenAenderung, MitgliederApi } from '../mitglieder-api';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { logoAdresse, VereinKontext } from '../verein-kontext';

type Bereich = 'verein' | 'farbe' | 'logo';

/** Die Felder der Vereinskarte; ein Fehler zu einem anderen Feld hat dort keinen Platz und steht unter dem Formular. */
const VEREIN_FELDER = ['name', 'anzeigename', 'kontakt'];

/**
 * Die Vereinseinstellungen: Namen und Kontakt, Vereinsfarbe, Logo. Nur mit dem Recht EINSTELLUNGEN;
 * der Server antwortet allen anderen mit 404, die Seite zeigt dann den Hinweis wie bei jeder Seite,
 * die es fuer die Person nicht gibt. Verworfen: das Recht vorab am Client pruefen -- die Huelle
 * blendet den Punkt ohnehin aus, und eine zweite Entscheidung liefe vom Server auseinander.
 *
 * Jede Karte speichert fuer sich und schickt nur, was sie geaendert hat. Verworfen: ein Knopf fuer
 * alles, denn ein Fehler in einem Feld hielte dann die Farbe fest, die schon gewaehlt ist.
 *
 * Die Farbe wirkt beim Waehlen sofort in der ganzen App (ThemaService), gespeichert wird erst mit
 * dem Knopf. Wer die Seite ohne Speichern verlaesst, bekommt die gespeicherte Farbe zurueck, sonst
 * stuende die Vorschau in der App, als waere sie beschlossen.
 */
@Component({
	selector: 'jf-einstellungen',
	imports: [KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Vereinseinstellungen</h1>
		@if (nichtGefunden()) {
			<jf-karte>
				<h2>Nicht gefunden oder keine Berechtigung</h2>
			</jf-karte>
		} @else if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (gespeichert(); as g) {
			<div class="stapel">
				<jf-karte>
					<form aria-label="Verein" (submit)="speichereVerein($event)">
						<h2>Verein</h2>
						<div class="gruppe">
							<label class="feld">
								Anzeigename
								<input
									type="text"
									name="anzeigename"
									maxlength="24"
									autocomplete="off"
									[readOnly]="aktiv() === 'verein'"
									[value]="anzeigename()"
									[attr.aria-invalid]="fehlerBei('anzeigename') ? 'true' : null"
									[attr.aria-describedby]="
										fehlerBei('anzeigename') ? 'anzeigename-zaehler anzeigename-fehler' : 'anzeigename-zaehler'
									"
									(input)="anzeigename.set(wert($event))"
								/>
							</label>
							<p class="hinweis gedaempft klein">
								<span>Steht oben in der App.</span>
								<span id="anzeigename-zaehler">{{ anzeigenameLaenge() }}/24</span>
							</p>
							@if (fehlerBei('anzeigename'); as text) {
								<p id="anzeigename-fehler" class="fehler" role="alert">{{ text }}</p>
							}
						</div>
						<div class="gruppe">
							<label class="feld">
								Offizieller Name
								<input
									type="text"
									name="name"
									maxlength="120"
									autocomplete="off"
									[readOnly]="aktiv() === 'verein'"
									[value]="name()"
									[attr.aria-invalid]="fehlerBei('name') ? 'true' : null"
									[attr.aria-describedby]="fehlerBei('name') ? 'name-fehler' : null"
									(input)="name.set(wert($event))"
								/>
							</label>
							@if (fehlerBei('name'); as text) {
								<p id="name-fehler" class="fehler" role="alert">{{ text }}</p>
							}
						</div>
						<div class="gruppe">
							<label class="feld">
								Kontakt
								<textarea
									name="kontakt"
									rows="3"
									maxlength="500"
									[readOnly]="aktiv() === 'verein'"
									[value]="kontakt()"
									[attr.aria-invalid]="fehlerBei('kontakt') ? 'true' : null"
									[attr.aria-describedby]="fehlerBei('kontakt') ? 'kontakt-hinweis kontakt-fehler' : 'kontakt-hinweis'"
									(input)="kontakt.set(wert($event))"
								></textarea>
							</label>
							<p id="kontakt-hinweis" class="hinweis gedaempft klein">Wird Mitgliedern noch nicht angezeigt.</p>
							@if (fehlerBei('kontakt'); as text) {
								<p id="kontakt-fehler" class="fehler" role="alert">{{ text }}</p>
							}
						</div>
						<div class="gruppe">
							<label class="feld">
								Adresse
								<input type="text" name="slug" class="fest" readonly aria-describedby="slug-hinweis" [value]="g.slug" />
							</label>
							<p id="slug-hinweis" class="hinweis gedaempft klein">Die Adresse lässt sich nicht ändern.</p>
						</div>
						@if (allgemeinerFehler('verein'); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
						<div class="reihe">
							<button
								type="submit"
								class="knopf primaer"
								aria-label="Vereinsangaben speichern"
								[disabled]="laeuft() || !vereinGeaendert()"
							>
								Speichern
							</button>
						</div>
					</form>
				</jf-karte>

				<jf-karte>
					<form aria-label="Vereinsfarbe" (submit)="speichereFarbe($event)">
						<h2>Vereinsfarbe</h2>
						<div class="farbe">
							<input
								type="color"
								name="farbe"
								aria-label="Vereinsfarbe"
								[disabled]="aktiv() === 'farbe'"
								[attr.aria-invalid]="allgemeinerFehler('farbe') ? 'true' : null"
								[attr.aria-describedby]="farbeBeschreibung()"
								[value]="farbe()"
								(input)="waehleFarbe($event)"
							/>
							<code>{{ farbe() }}</code>
							<span class="muster hell" [style.background]="satz().hell.akzent" [style.color]="satz().hell.aufAkzent"
								>Hell</span
							>
							<span
								class="muster dunkel"
								[style.background]="satz().dunkel.akzent"
								[style.color]="satz().dunkel.aufAkzent"
								>Dunkel</span
							>
						</div>
						@if (angepasst().hell) {
							<p id="farbe-hinweis-hell" class="gedaempft klein">
								Für gute Lesbarkeit verwendet die App im hellen Modus einen angepassten Ton.
							</p>
						}
						@if (angepasst().dunkel) {
							<p id="farbe-hinweis-dunkel" class="gedaempft klein">
								Für gute Lesbarkeit verwendet die App im dunklen Modus einen angepassten Ton.
							</p>
						}
						<p id="farbe-hinweis" class="gedaempft klein">
							Die Vorschau gilt sofort in der ganzen App, bis du die Seite verlässt oder speicherst.
						</p>
						@if (allgemeinerFehler('farbe'); as text) {
							<p id="farbe-fehler" class="fehler" role="alert">{{ text }}</p>
						}
						<div class="reihe">
							<button
								type="submit"
								class="knopf primaer"
								aria-label="Vereinsfarbe speichern"
								[disabled]="laeuft() || !farbeGeaendert()"
							>
								Speichern
							</button>
						</div>
					</form>
				</jf-karte>

				<jf-karte>
					<div class="logo-karte" data-karte="logo">
						<h2>Logo</h2>
						<div class="logo-zeile">
							@if (logoUrl(); as url) {
								<img class="logo" [src]="url" alt="Vereinslogo" width="96" height="96" />
							} @else {
								<span class="abzeichen" aria-hidden="true">{{ initialen(g.anzeigename) }}</span>
							}
							@if (logoUrl()) {
								<button type="button" class="knopf" [disabled]="laeuft()" (click)="entferneLogo()">
									Logo entfernen
								</button>
							}
						</div>
						<label class="feld">
							Neues Logo wählen
							<input
								type="file"
								name="logo"
								accept="image/png,image/jpeg"
								[attr.aria-describedby]="allgemeinerFehler('logo') ? 'logo-hinweis logo-fehler' : 'logo-hinweis'"
								[attr.aria-invalid]="allgemeinerFehler('logo') ? 'true' : null"
								[disabled]="laeuft()"
								(change)="waehleLogo($event)"
							/>
						</label>
						<p id="logo-hinweis" class="hinweis gedaempft klein">PNG oder JPEG, höchstens 1 MB.</p>
						@if (allgemeinerFehler('logo'); as text) {
							<p id="logo-fehler" class="fehler" role="alert">{{ text }}</p>
						}
					</div>
				</jf-karte>
			</div>
		}
	`,
	styles: `
		:host {
			display: block;
			max-width: 40rem;
		}
		h1 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-titel);
		}
		h2 {
			margin: 0;
			font-size: var(--schrift-gross);
		}
		.stapel {
			display: grid;
			gap: var(--a4);
		}
		form,
		.logo-karte {
			display: grid;
			gap: var(--a3);
		}
		.gruppe {
			display: grid;
			gap: var(--a1);
		}
		p {
			margin: 0;
		}
		.hinweis {
			display: flex;
			justify-content: space-between;
			gap: var(--a3);
		}
		.fehler {
			color: var(--fehler);
		}
		.reihe,
		.farbe,
		.logo-zeile {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a3);
		}
		/* Die Adresse ist nur zum Lesen da. Mit Rahmen und Kartenweiss saehe sie aus wie die Felder darueber,
		   und man tippte vergeblich hinein. Abgesetzt auf der Seitenflaeche ohne Rahmen liest sie sich als
		   Angabe. Verworfen: reiner Text statt input -- das Feld bleibt per Tab erreichbar und zum Kopieren
		   markierbar, und die Beschriftung haengt wie bei den anderen Feldern daran. Die Klasse statt
		   input[readonly]: Waehrend des Speicherns sind auch die bearbeitbaren Felder readonly und sollen
		   dabei nicht ihr Aussehen wechseln. */
		.feld input.fest {
			background: var(--seite);
			border-color: transparent;
			cursor: default;
		}
		/* Chromium misst das Datei-Feld nach seinem Text, auf Deutsch Datei auswaehlen und Keine Datei
		   ausgewaehlt, samt Polster rund 360 px. Diese Breite gab das Feld als Mindestbreite an Karte und Spalte
		   weiter, und bei 375 px ragte die ganze Seite 34 px nach rechts hinaus. Eine Breite in Prozent
		   nimmt dem Feld die Mindestbreite (CSS Sizing, compressible replaced elements); der Text darin
		   wird dann abgeschnitten, der Knopf bleibt ganz. Verworfen: ein verstecktes Feld hinter einem
		   eigenen Knopf -- mehr Code, und der native Waehler sagt nach der Wahl, welche Datei es ist.
		   Die Obergrenze, weil das Feld am Desktop sonst ueber die ganze Karte liefe (606 px) und Knopf und
		   Dateiname weit auseinander stuenden; 24rem fasst beide ungekuerzt. */
		input[type='file'] {
			width: 100%;
			min-width: 0;
			max-width: 24rem;
		}
		input[type='color'] {
			width: 56px;
			height: var(--tippflaeche);
			padding: 2px;
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--karte);
			cursor: pointer;
		}
		.muster {
			padding: var(--a1) var(--a3);
			border-radius: var(--radius-pille);
			font-weight: 600;
			font-size: var(--schrift-klein);
		}
		.logo,
		.abzeichen {
			flex: none;
			width: 96px;
			height: 96px;
			border-radius: 16px;
		}
		.logo {
			object-fit: contain;
		}
		.abzeichen {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			background: var(--akzent);
			color: var(--auf-akzent);
			font-size: 2rem;
			font-weight: 700;
		}
	`,
})
export class EinstellungenComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly router = inject(Router);
	private readonly kontext = inject(VereinKontext);
	private readonly thema = inject(ThemaService);
	private readonly meldung = inject(MeldungService);

	/** Der Stand, den der Server zuletzt geliefert hat; null, solange er nicht da ist. */
	protected readonly gespeichert = signal<Einstellungen | null>(null);
	protected readonly nichtGefunden = signal(false);
	protected readonly ladefehler = signal<string | null>(null);
	/**
	 * Die Karte, die gerade speichert. Eine Handlung zur Zeit: Zwei schnelle Klicks schickten sonst zwei Anfragen,
	 * deren Antworten sich ueberholen koennten. Die Felder der Karte sind in der Zeit gesperrt; sonst ginge
	 * eine Eingabe nach dem Klick still verloren, wenn die Antwort die Felder mit dem Serverstand fuellt.
	 */
	protected readonly aktiv = signal<Bereich | null>(null);
	protected readonly laeuft = computed(() => this.aktiv() !== null);
	protected readonly fehler = signal<{ bereich: Bereich; feld: string | null; text: string } | null>(null);

	protected readonly name = signal('');
	protected readonly anzeigename = signal('');
	protected readonly kontakt = signal('');
	protected readonly farbe = signal('');

	/**
	 * Gezaehlt wie die Pruefung des Servers (libs/domain, laengeImBereich): Codepoints des getrimmten
	 * Texts. Das maxlength-Attribut zaehlt UTF-16-Einheiten und ist bei Emojis strenger; es bleibt,
	 * weil es nur zu frueh warnt und nie etwas durchlaesst, was der Server ablehnt.
	 */
	protected readonly anzeigenameLaenge = computed(() => [...this.anzeigename().trim()].length);
	/**
	 * Was der Farbwaehler beschreibt: die Hinweise zum angepassten Ton, die Vorschau-Zeile und, solange er
	 * steht, der Fehler. Ein Screenreader erfaehrt den angepassten Ton sonst nur, wenn er die Karte durchliest;
	 * die Hinweise sind keine Live-Region, weil sie sich mit jedem Ziehen im Farbwaehler aendern koennen.
	 */
	protected readonly farbeBeschreibung = computed(() =>
		[
			this.angepasst().hell ? 'farbe-hinweis-hell' : null,
			this.angepasst().dunkel ? 'farbe-hinweis-dunkel' : null,
			'farbe-hinweis',
			this.allgemeinerFehler('farbe') ? 'farbe-fehler' : null,
		]
			.filter((id) => id !== null)
			.join(' '),
	);
	protected readonly satz = computed(() => vereinsfarben(this.farbe()));
	protected readonly angepasst = computed(() => farbeAngepasst(this.farbe()));
	protected readonly vereinGeaendert = computed(() => Object.keys(this.vereinAenderung()).length > 0);
	protected readonly farbeGeaendert = computed(() => {
		const g = this.gespeichert();
		return g !== null && this.farbe() !== g.farbe;
	});
	/** Aus dem eigenen Stand statt aus dem Kontext: Der kennt ein neues Logo erst, wenn er neu geladen hat. */
	protected readonly logoUrl = computed(() => {
		const g = this.gespeichert();
		return g?.logoStand ? logoAdresse(this.slug(), g.logoStand) : null;
	});

	protected readonly wert = wertVon;
	protected readonly initialen = initialen;

	/** Zaehlt die Ladevorgaenge: Die Antwort eines veralteten darf den neueren Stand nicht ueberschreiben. */
	private ladeNr = 0;

	constructor() {
		// Der Kontext setzt die Vereinsfarbe bei jedem Neuladen auf den gespeicherten Stand. Eine Vorschau,
		// die beim Speichern des Namens noch laeuft, ginge damit verloren, obwohl das Feld sie noch zeigt.
		// Der Effekt hat nur den Kontext als Abhaengigkeit und setzt die Farbe des Felds danach neu.
		// Das traegt nur, weil Angular Root-Effekte (der des Kontexts, providedIn root) vor View-Effekten
		// (dieser hier, am Bauteil) ausfuehrt: Meiner laeuft zuletzt und gewinnt. Wanderte der Effekt des
		// Kontexts in ein Bauteil oder in afterRenderEffect, ueberschriebe er die Vorschau wieder; der Test
		// "eine ungespeicherte Farbe bleibt ..." faellt dann auf. Verworfen: ein Vorschau-Signal im
		// Kontext (vorschau() ?? v.farbe), dann gaebe es nur eine Stelle, die die Farbe setzt. Es haette
		// aber den Kontext und den ThemaService um Zustand erweitert, den allein diese Seite braucht,
		// und wuerde dieselbe Stelle anfassen wie der zurueckgestellte Fehler bei neuLaden().
		effect(() => {
			this.kontext.verein();
			untracked(() => {
				if (this.gespeichert()) this.thema.setzeVereinsfarbe(this.farbe());
			});
		});
		inject(DestroyRef).onDestroy(() => {
			// Nur bei ungespeicherter Vorschau: Sonst gilt die Farbe des Kontexts schon, und ein Setzen hier
			// liefe dem Aufraeumen beim Wechsel des Vereins in die Quere.
			const g = this.gespeichert();
			if (g && this.farbe() !== g.farbe) this.thema.setzeVereinsfarbe(g.farbe);
		});
	}

	ngOnInit(): void {
		void this.lade();
	}

	protected async lade(): Promise<void> {
		const nr = ++this.ladeNr;
		this.ladefehler.set(null);
		this.nichtGefunden.set(false);
		try {
			const stand = await firstValueFrom(this.api.einstellungen(this.slug()));
			if (nr !== this.ladeNr) return;
			this.gespeichert.set(stand);
			this.fuelleVerein(stand);
			this.farbe.set(stand.farbe);
		} catch (ursache) {
			if (nr !== this.ladeNr) return;
			const f = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), f)) return;
			if (f.status === 404) this.nichtGefunden.set(true);
			else this.ladefehler.set(fehlertext(f));
		}
	}

	protected fehlerBei(feld: string): string | null {
		const f = this.fehler();
		return f?.bereich === 'verein' && f.feld === feld ? f.text : null;
	}

	/** Der Fehler einer Karte, der zu keinem ihrer Felder gehoert (Netz, Server, unbekanntes Feld). */
	protected allgemeinerFehler(bereich: Bereich): string | null {
		const f = this.fehler();
		return f?.bereich === bereich && f.feld === null ? f.text : null;
	}

	protected waehleFarbe(ereignis: Event): void {
		const hex = wertVon(ereignis);
		this.farbe.set(hex);
		// Sofort und nicht erst ueber einen Effekt: Die Vorschau soll mit dem Ziehen im Farbwaehler laufen.
		this.thema.setzeVereinsfarbe(hex);
	}

	protected async speichereVerein(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const aenderung = this.vereinAenderung();
		if (Object.keys(aenderung).length === 0) return;
		await this.fuehreAus('verein', async () => {
			const neu = await firstValueFrom(this.api.aendereEinstellungen(this.slug(), aenderung));
			this.gespeichert.set(neu);
			this.fuelleVerein(neu);
		});
	}

	protected async speichereFarbe(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		if (!this.farbeGeaendert()) return;
		const farbe = this.farbe();
		await this.fuehreAus('farbe', async () => {
			this.gespeichert.set(await firstValueFrom(this.api.aendereEinstellungen(this.slug(), { farbe })));
		});
	}

	protected async waehleLogo(ereignis: Event): Promise<void> {
		const eingabe = ereignis.target as HTMLInputElement;
		const datei = eingabe.files?.[0];
		// Leeren, damit dieselbe Datei nach einer Korrektur noch einmal gewaehlt werden kann (sonst feuert change nicht).
		eingabe.value = '';
		if (!datei) return;
		this.fehler.set(null);
		if (datei.size > LOGO_MAX_BYTES) {
			this.fehler.set({ bereich: 'logo', feld: null, text: LOGO_ZU_GROSS });
			return;
		}
		await this.fuehreAus('logo', async () => {
			const antwort = await firstValueFrom(this.api.ladeLogoHoch(this.slug(), datei));
			this.gespeichert.update((g) => g && { ...g, logoStand: antwort.logoStand });
		});
	}

	protected async entferneLogo(): Promise<void> {
		await this.fuehreAus('logo', async () => {
			await firstValueFrom(this.api.entferneLogo(this.slug()));
			this.gespeichert.update((g) => g && { ...g, logoStand: null });
		});
	}

	/** Nur was sich gegenueber dem Server-Stand geaendert hat, ohne Rand; ein leerer Kontakt ist null. */
	private vereinAenderung(): EinstellungenAenderung {
		const g = this.gespeichert();
		if (!g) return {};
		const aenderung: EinstellungenAenderung = {};
		const name = this.name().trim();
		const anzeigename = this.anzeigename().trim();
		const kontakt = this.kontakt().trim() || null;
		if (name !== g.name) aenderung.name = name;
		if (anzeigename !== g.anzeigename) aenderung.anzeigename = anzeigename;
		if (kontakt !== g.kontakt) aenderung.kontakt = kontakt;
		return aenderung;
	}

	private fuelleVerein(stand: Einstellungen): void {
		this.name.set(stand.name);
		this.anzeigename.set(stand.anzeigename);
		this.kontakt.set(stand.kontakt ?? '');
	}

	/**
	 * Aktion, danach der Verein neu und die Meldung. Der Kontext laedt den Verein neu, weil Kopf,
	 * Titel, Farbe und Logo der ganzen App davon leben; die Seite fuehrt sie nicht selbst nach.
	 * Ein Fehler steht in der Karte der Aktion, bei einem Feld des Vereins direkt am Feld.
	 */
	private async fuehreAus(bereich: Bereich, aktion: () => Promise<void>): Promise<void> {
		if (this.laeuft()) return;
		this.aktiv.set(bereich);
		this.fehler.set(null);
		try {
			await aktion();
			this.kontext.neuLaden();
			this.meldung.zeige('Gespeichert');
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), f)) return;
			const feld = bereich === 'verein' && f.feld && VEREIN_FELDER.includes(f.feld) ? f.feld : null;
			this.fehler.set({ bereich, feld, text: fehlertext(f) });
		} finally {
			this.aktiv.set(null);
		}
	}
}
