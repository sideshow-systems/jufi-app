import { ChangeDetectionStrategy, Component, computed, inject, input, type OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
	normalisiereBenutzername,
	normalisiereEmail,
	PASSWORT_HINWEIS,
	pruefeAnmeldename,
	pruefeEmail,
	pruefePasswort,
} from '@jufi/domain';
import { firstValueFrom, map } from 'rxjs';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { wertVon } from '../gemeinsam/formular';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';
import { KarteComponent } from '../gestaltung/ui';
import type { EinladungInfo, Einwilligungswunsch } from './mitglieder-api';
import { MitgliederApi } from './mitglieder-api';
import { VereinKopfComponent } from './verein-kopf';

type Schritt = 'laedt' | 'ungueltig' | 'netzfehler' | 'begruessung' | 'einwilligung' | 'kennung' | 'zugang' | 'fertig';

/** Dieselben Texte wie der Server (einladung.ts), damit die Seite vorab nichts anderes sagt als er danach. */
const KENNUNG_UNGUELTIG = {
	ERWACHSENER: 'Bitte eine gültige E-Mail-Adresse angeben',
	JUNGFISCHER: '3 bis 30 Zeichen: Kleinbuchstaben, Ziffern, Punkt, Binde- oder Unterstrich',
} as const;

/**
 * Einladung annehmen (/:slug/einladung#<token>): Begruessung, Einwilligung (nur wenn
 * der Link Kinder nennt), Kennung, Zugang einrichten, Fertig. Gesendet wird erst am
 * Ende von Zugang einrichten; die Schritte davor sammeln nur.
 */
@Component({
	selector: 'jf-einladung',
	imports: [KarteComponent, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-verein-kopf [slug]="slug()" untertitel="Einladung" />
			<jf-karte>
				@switch (schritt()) {
					@case ('laedt') {
						<p class="gedaempft">Link wird geprüft …</p>
					}
					@case ('ungueltig') {
						<p>Dieser Link gilt nicht mehr – frag nach einem neuen.</p>
					}
					@case ('netzfehler') {
						<p>Keine Verbindung – nochmal versuchen</p>
						<button type="button" class="knopf primaer" (click)="pruefe()">Nochmal versuchen</button>
					}
					@case ('begruessung') {
						@if (info(); as i) {
							<h2>Hallo {{ i.vorname }}, willkommen bei {{ i.vereinsname }}.</h2>
							@if (i.einwilligungFehlt) {
								<p>Eine erziehungsberechtigte Person muss erst einwilligen.</p>
							} @else {
								<p class="gedaempft">
									{{
										i.art === 'RESET'
											? 'Hier richtest du deinen Zugang neu ein.'
											: 'Gleich richtest du deinen Zugang ein.'
									}}
								</p>
								<button type="button" class="knopf primaer" (click)="weiterZurKennung()">Weiter</button>
							}
						}
					}
					@case ('einwilligung') {
						<h2>Einwilligung</h2>
						@if (info(); as i) {
							<p>{{ i.einwilligungsText.text }}</p>
							<form novalidate (submit)="einwilligungWeiter($event)">
								@for (kind of i.kinder; track kind.id) {
									<fieldset>
										<legend>{{ kind.vorname }}</legend>
										@if (kind.einwilligungVorhanden) {
											<p class="gedaempft klein">
												Für {{ kind.vorname }} hat schon jemand aus der Familie eingewilligt. Dieser Schritt ist für
												dich freiwillig.
											</p>
										}
										<label class="haken">
											<input
												type="checkbox"
												[name]="'einwilligen-' + kind.id"
												[checked]="wunsch(kind.id).einwilligen"
												(change)="setzeEinwilligen(kind.id, gesetzt($event))"
											/>
											Ich willige ein
										</label>
										@if (wunsch(kind.id).einwilligen) {
											<div role="group" [attr.aria-labelledby]="'frage-' + kind.id">
												<p class="frage" [id]="'frage-' + kind.id">
													Soll {{ kind.vorname }} einen eigenen Zugang bekommen?
												</p>
												<label class="haken">
													<input
														type="checkbox"
														[name]="'zugang-' + kind.id"
														[checked]="wunsch(kind.id).zugang"
														(change)="setzeZugang(kind.id, gesetzt($event))"
													/>
													Ja, mit eigenem Anmeldenamen
												</label>
											</div>
										} @else {
											<p class="gedaempft klein">Die Familie handelt dann in seinem Namen.</p>
										}
									</fieldset>
								}
								<button type="submit" class="knopf primaer">Weiter</button>
							</form>
						}
					}
					@case ('kennung') {
						<h2>{{ istJungfischer() ? 'Dein Anmeldename' : 'Deine E-Mail-Adresse' }}</h2>
						<p class="gedaempft">
							{{
								istJungfischer()
									? 'Damit meldest du dich später an. Den Vorschlag kannst du ändern.'
									: 'Damit meldest du dich später an. Du kannst sie hier noch ändern.'
							}}
						</p>
						<form novalidate (submit)="kennungWeiter($event)">
							<label class="feld">
								{{ istJungfischer() ? 'Anmeldename' : 'E-Mail-Adresse' }}
								<input
									name="kennung"
									[type]="istJungfischer() ? 'text' : 'email'"
									[autocomplete]="istJungfischer() ? 'username' : 'email'"
									autocapitalize="none"
									spellcheck="false"
									[value]="kennung()"
									(input)="kennung.set(wert($event))"
								/>
							</label>
							@if (kennungFehler(); as text) {
								<p class="fehler" role="alert">{{ text }}</p>
							}
							<button type="submit" class="knopf primaer">Weiter</button>
						</form>
					}
					@case ('zugang') {
						<h2>Zugang einrichten</h2>
						@if (info()?.kennung?.fest) {
							<p class="gedaempft">
								Du meldest dich an mit: <strong>{{ info()?.kennung?.wert }}</strong>
							</p>
						}
						@if (info()?.art === 'RESET') {
							<p>Alte Anmeldewege werden dabei gelöscht.</p>
						}
						@if (passkeys.unterstuetzt()) {
							<p class="gedaempft">Ein Passkey meldet dich mit der Entsperrung dieses Geräts an, ohne Passwort.</p>
							<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="mitPasskey()">
								Passkey einrichten
							</button>
							<hr />
						}
						<form novalidate (submit)="mitPasswort($event)">
							<label class="feld">
								Passwort{{ passkeys.unterstuetzt() ? ' (zusätzlich oder statt Passkey)' : '' }}
								<input
									type="password"
									name="passwort"
									autocomplete="new-password"
									[value]="passwort()"
									(input)="passwort.set(wert($event))"
								/>
							</label>
							<p class="klein regel" [class.verletzt]="passwortFehler() !== null">
								{{ passwortHinweis() ?? 'Das Passwort erfüllt die Regel.' }}
							</p>
							<button type="submit" class="knopf" [class.primaer]="!passkeys.unterstuetzt()" [disabled]="laeuft()">
								Zugang einrichten
							</button>
						</form>
						@if (fehler(); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
					}
					@case ('fertig') {
						<h2>Fertig</h2>
						<p>Dein Zugang ist eingerichtet.</p>
						<p class="gedaempft">
							Leg die App auf deinen Home-Bildschirm, dann ist sie immer zur Hand. Dort meldest du dich noch einmal an,
							danach bleibst du angemeldet.
						</p>
						<button type="button" class="knopf primaer" (click)="zurApp()">Zur App</button>
					}
				}
			</jf-karte>
		</main>
	`,
	styles: `
		:host {
			display: block;
		}
		main {
			max-width: 24rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		h2 {
			margin: 0 0 var(--a2);
			font-size: var(--schrift-gross);
			overflow-wrap: anywhere;
		}
		p {
			margin: 0 0 var(--a3);
			overflow-wrap: anywhere;
		}
		form {
			display: grid;
			gap: var(--a3);
		}
		form p {
			margin: 0;
		}
		fieldset {
			margin: 0;
			padding: 0;
			border: 0;
			min-width: 0;
		}
		legend {
			padding: 0;
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.frage {
			margin: 0;
		}
		hr {
			border: 0;
			border-top: 1px solid var(--linie);
			margin: var(--a4) 0;
		}
		jf-karte .knopf {
			width: 100%;
		}
		.regel {
			color: var(--text-gedaempft);
		}
		.regel.verletzt,
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class EinladungComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	protected readonly passkeys = inject(PasskeyBrowser);

	protected readonly schritt = signal<Schritt>('laedt');
	protected readonly info = signal<EinladungInfo | null>(null);
	protected readonly kennung = signal('');
	protected readonly passwort = signal('');
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<string | null>(null);
	protected readonly kennungFehler = signal<string | null>(null);

	/**
	 * Je Kind die Antwort der Person. Die Einwilligung beginnt immer ungesetzt: eine
	 * vorangekreuzte Einwilligung waere keine (DSGVO Art. 7). Der Zugang ist vorbelegt
	 * auf ja, weil das der Normalfall ist; er zaehlt erst mit der Einwilligung.
	 */
	protected readonly wuensche = signal<Record<string, { einwilligen: boolean; zugang: boolean }>>({});

	protected readonly wert = wertVon;
	protected readonly gesetzt = (ereignis: Event): boolean => (ereignis.target as HTMLInputElement).checked;

	protected readonly istJungfischer = computed(() => this.info()?.personArt === 'JUNGFISCHER');

	// Dieselbe Regel wie der Server (libs/domain). Ein leeres Feld ist kein Fehler: Mit Passkey braucht es kein Passwort.
	protected readonly passwortFehler = computed(() => {
		if (this.passwort() === '') return null;
		const pruefung = pruefePasswort(this.passwort());
		return pruefung.ok ? null : PASSWORT_HINWEIS[pruefung.grund];
	});
	protected readonly passwortHinweis = computed(
		() => this.passwortFehler() ?? (this.passwort() === '' ? PASSWORT_HINWEIS['zu-kurz'] : null),
	);

	/** Nur im Speicher: Nach dem Lesen steht das Token nicht mehr in der Adresse. */
	private token = '';

	ngOnInit(): void {
		// Vom Router statt aus location.hash gelesen: gleiche Quelle, im Test ohne echte Adressleiste verfuegbar.
		this.token = this.route.snapshot.fragment ?? '';
		// Das Fragment wandert nicht zum Server, steht aber im Verlauf und in der Adressleiste.
		// Ersetzt statt neu navigiert, damit kein zweiter Verlaufseintrag entsteht.
		history.replaceState(history.state, '', location.pathname + location.search);
		void this.pruefe();
	}

	protected async pruefe(): Promise<void> {
		if (this.token === '') {
			this.schritt.set('ungueltig');
			return;
		}
		this.schritt.set('laedt');
		try {
			const info = await firstValueFrom(this.api.einladungPruefen(this.slug(), this.token));
			this.info.set(info);
			this.kennung.set(info.kennung.wert ?? '');
			this.wuensche.set(Object.fromEntries(info.kinder.map((k) => [k.id, { einwilligen: false, zugang: true }])));
			this.schritt.set('begruessung');
		} catch (ursache) {
			this.schritt.set(alsApiFehler(ursache).status === 404 ? 'ungueltig' : 'netzfehler');
		}
	}

	protected weiterZurKennung(): void {
		// Der Link nennt Kinder nur, wenn die Person heute fuer sie einwilligen duerfte (Server).
		if ((this.info()?.kinder.length ?? 0) > 0) {
			this.schritt.set('einwilligung');
			return;
		}
		this.nachEinwilligung();
	}

	protected einwilligungWeiter(ereignis: Event): void {
		ereignis.preventDefault();
		// Kein Zwang: wer nicht einwilligt, richtet nur den eigenen Zugang ein; die Familie
		// kann spaeter unter "Meine Jungfischer" einwilligen.
		this.nachEinwilligung();
	}

	protected wunsch(kindId: string): { einwilligen: boolean; zugang: boolean } {
		return this.wuensche()[kindId] ?? { einwilligen: false, zugang: true };
	}

	protected setzeEinwilligen(kindId: string, an: boolean): void {
		this.wuensche.update((w) => ({ ...w, [kindId]: { ...this.wunsch(kindId), einwilligen: an } }));
	}

	protected setzeZugang(kindId: string, an: boolean): void {
		this.wuensche.update((w) => ({ ...w, [kindId]: { ...this.wunsch(kindId), zugang: an } }));
	}

	private nachEinwilligung(): void {
		// Eine feste Kennung gibt es nur zur Anzeige; ein Feld dafuer waere eine Einladung zum Irrtum.
		this.schritt.set(this.info()?.kennung.fest ? 'zugang' : 'kennung');
	}

	protected kennungWeiter(ereignis: Event): void {
		ereignis.preventDefault();
		const art = this.info()?.personArt ?? 'ERWACHSENER';
		const wert = art === 'JUNGFISCHER' ? normalisiereBenutzername(this.kennung()) : normalisiereEmail(this.kennung());
		const gueltig = art === 'JUNGFISCHER' ? pruefeAnmeldename(wert) : pruefeEmail(wert);
		if (!gueltig) {
			this.kennungFehler.set(KENNUNG_UNGUELTIG[art]);
			return;
		}
		this.kennungFehler.set(null);
		this.kennung.set(wert);
		this.schritt.set('zugang');
	}

	protected async mitPasswort(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		if (this.laeuft()) return;
		if (this.passwort() === '' || this.passwortFehler() !== null) {
			this.fehler.set(this.passwortFehler() ?? PASSWORT_HINWEIS['zu-kurz']);
			return;
		}
		await this.versuche(() => firstValueFrom(this.api.einladungEinloesen(this.slug(), this.koerper())));
	}

	protected async mitPasskey(): Promise<void> {
		if (this.laeuft()) return;
		// Ein halb getipptes Passwort wuerde der Server mit 400 abweisen, nachdem die Challenge verbraucht ist.
		if (this.passwortFehler() !== null) {
			this.fehler.set(this.passwortFehler());
			return;
		}
		await this.versuche(async () => {
			const ausgang = await this.passkeys.hinzufuegen({
				// Bei jedem Versuch frisch: Nach einem 409 ist die Challenge verbraucht.
				optionen: () => this.api.einladungPasskeyOptionen(this.slug(), this.token).pipe(map((a) => a.optionen)),
				senden: (antwort) => this.api.einladungEinloesen(this.slug(), this.koerper(antwort)),
				schonVorhanden: 'Dieses Gerät hat schon einen Passkey für diesen Verein.',
			});
			if (ausgang === 'abgelehnt') {
				this.fehler.set('Der Browser hat sofort abgelehnt. Richte stattdessen ein Passwort ein.');
			}
			return ausgang === 'fertig';
		});
	}

	protected async zurApp(): Promise<void> {
		// Ohne Schraegstrich am Ende: navigateByUrl('/demo/') ergibt ein leeres letztes Segment,
		// das keine Route trifft (Nicht gefunden, der Waechter lief gar nicht).
		await this.router.navigateByUrl(`/${encodeURIComponent(this.slug())}`);
	}

	/** Die feste Kennung gehoert nicht in den Body: Der Server kennt sie und wertet eine mitgeschickte nicht aus. */
	private koerper(passkey?: unknown) {
		const kinder = this.info()?.kinder ?? [];
		// Ohne Einwilligung zaehlt der Zugangswunsch nicht; false sagt das dem Server ausdruecklich.
		const einwilligungen: Einwilligungswunsch[] = kinder.map((k) => {
			const w = this.wunsch(k.id);
			return { kindId: k.id, einwilligen: w.einwilligen, zugang: w.einwilligen && w.zugang };
		});
		return {
			token: this.token,
			...(kinder.length > 0 ? { einwilligungen } : {}),
			...(this.info()?.kennung.fest ? {} : { kennung: this.kennung() }),
			...(this.passwort() !== '' ? { passwort: this.passwort() } : {}),
			...(passkey !== undefined ? { passkey } : {}),
		};
	}

	/**
	 * Gemeinsamer Rahmen beider Wege: sperrt die Knoepfe (ein Doppelklick liesse den
	 * zweiten Passkey mit 400 scheitern, weil die Challenge schon verbraucht ist) und
	 * uebersetzt Fehler. Ein Schritt liefert true, wenn eingeloest ist.
	 */
	private async versuche(schritt: () => Promise<unknown>): Promise<void> {
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			const ergebnis = await schritt();
			if (ergebnis === false) return;
			// Weder Passwort noch Token werden weiter gebraucht.
			this.passwort.set('');
			this.token = '';
			this.schritt.set('fertig');
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			if (f.status === 404) this.schritt.set('ungueltig');
			else if (f.status === 409 && f.feld === 'kennung') {
				this.kennungFehler.set(f.fehler);
				this.schritt.set('kennung');
			} else this.fehler.set(fehlertext(f));
		} finally {
			this.laeuft.set(false);
		}
	}
}
