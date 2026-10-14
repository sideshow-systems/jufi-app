import { ChangeDetectionStrategy, Component, computed, inject, input, type OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PASSWORT_HINWEIS, pruefePasswort } from '@jufi/domain';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { alsApiFehler, fehlertext, type ApiFehler } from '../gemeinsam/api-fehler';
import { wertVon } from '../gemeinsam/formular';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';
import { TotpEinrichtungComponent } from '../gemeinsam/totp-einrichtung';
import { zeitpunktBerlin } from '../gestaltung/format';
import { KarteComponent } from '../gestaltung/ui';
import type { MitgliedIch } from './mitglieder-api';
import { MitgliederApi } from './mitglieder-api';
import { VereinKopfComponent } from './verein-kopf';

/** Dieselbe Grenze wie der Server (profil.ts), damit ein Tippfehler keinen Weg ueber das Netz braucht. */
const NAME_UNGUELTIG = 'Der Name braucht 1 bis 40 Zeichen';
const MAX_NAME = 40;

/** 401 mit diesem Text heisst abgelaufene Sitzung; ein falsches altes Passwort ist ebenfalls 401, aber mit anderem Text. */
const NICHT_ANGEMELDET = 'nicht angemeldet';

const nameGueltig = (name: string): boolean => name.length >= 1 && name.length <= MAX_NAME;

/**
 * Das eigene Profil: Name und Kennung zum Lesen, Passkeys, Passwort, zweiter
 * Faktor, Abmelden. Schlicht gehalten; die Huelle mit Navigation baut Etappe 5.
 *
 * Nach jeder Aenderung wird der Stand neu geholt statt lokal nachgefuehrt: Der
 * Server entscheidet, was gilt (etwa dass andere Sitzungen nach einer
 * Passwortaenderung enden), und die Seite zeigt es dann so, wie es ist.
 */
@Component({
	selector: 'jf-profil',
	imports: [KarteComponent, RouterLink, TotpEinrichtungComponent, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-verein-kopf [slug]="slug()" untertitel="Profil" />
			<a class="zurueck" [routerLink]="['/', slug()]">← Zur Startseite</a>
			@if (ladefehler(); as text) {
				<jf-karte>
					<p class="fehler" role="alert">{{ text }}</p>
					<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
				</jf-karte>
			} @else if (ich(); as i) {
				<div class="stapel">
					<jf-karte>
						<h2>Du</h2>
						<dl>
							<dt>Name</dt>
							<dd>{{ i.person.vorname }} {{ i.person.nachname }}</dd>
							<dt>{{ i.person.art === 'JUNGFISCHER' ? 'Anmeldename' : 'E-Mail-Adresse' }}</dt>
							<dd>{{ i.kennung ?? '–' }}</dd>
						</dl>
					</jf-karte>

					<jf-karte>
						<h2>Passkeys</h2>
						<p class="gedaempft klein">
							Ein Passkey meldet dich mit der Entsperrung des Geräts an, ohne Passwort. Richte einen je Gerät ein.
						</p>
						<ul class="passkeys">
							@for (p of i.passkeys; track p.id) {
								<li [attr.data-passkey]="p.id">
									@if (umbenennenId() === p.id) {
										<form novalidate (submit)="speichereName($event, p.id)">
											<label class="feld">
												Name
												<input
													name="label"
													autocomplete="off"
													maxlength="40"
													[value]="labelEingabe()"
													(input)="labelEingabe.set(wert($event))"
												/>
											</label>
											<div class="reihe">
												<button type="submit" class="knopf primaer klein" [disabled]="laeuft()">Speichern</button>
												<button type="button" class="knopf klein" (click)="umbenennenId.set(null)">Abbrechen</button>
											</div>
										</form>
									} @else {
										<div class="passkey-text">
											<strong>{{ p.label }}</strong>
											<span class="klein gedaempft">
												Eingerichtet {{ datum(p.erstelltAm) }}
												@if (p.zuletztGenutztAm; as zuletzt) {
													· zuletzt benutzt {{ datum(zuletzt) }}
												}
											</span>
										</div>
										<div class="reihe">
											<button type="button" class="knopf klein" [disabled]="laeuft()" (click)="beginneUmbenennen(p)">
												Umbenennen
											</button>
											<button type="button" class="knopf klein" [disabled]="laeuft()" (click)="entferne(p.id)">
												Löschen
											</button>
										</div>
									}
									@if (zeilenFehler()[p.id]; as text) {
										<p class="fehler klein" role="alert">{{ text }}</p>
									}
								</li>
							} @empty {
								<li class="gedaempft">Noch kein Passkey.</li>
							}
						</ul>
						@if (passkeys.unterstuetzt()) {
							<form class="neu" novalidate (submit)="fuegeHinzu($event)">
								<label class="feld">
									Name des neuen Passkeys (optional)
									<input
										name="passkey-name"
										autocomplete="off"
										maxlength="40"
										placeholder="zum Beispiel Handy"
										[value]="neuerName()"
										(input)="neuerName.set(wert($event))"
									/>
								</label>
								<button type="submit" class="knopf primaer" [disabled]="laeuft()">Passkey hinzufügen</button>
							</form>
						}
						@if (passkeyFehler(); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
					</jf-karte>

					<jf-karte>
						<h2>Passwort</h2>
						<p class="gedaempft klein">
							{{
								i.hatPasswort
									? 'Ein Passwort ist gesetzt. Wenn du es änderst, werden alle anderen Geräte abgemeldet.'
									: 'Noch kein Passwort. Mit einem Passwort kannst du dich auch ohne Passkey anmelden.'
							}}
						</p>
						<form novalidate (submit)="speicherePasswort($event)">
							@if (i.hatPasswort) {
								<label class="feld">
									Altes Passwort
									<input
										type="password"
										name="altes-passwort"
										autocomplete="current-password"
										[value]="altesPasswort()"
										(input)="altesPasswort.set(wert($event))"
									/>
								</label>
							}
							<label class="feld">
								{{ i.hatPasswort ? 'Neues Passwort' : 'Passwort' }}
								<input
									type="password"
									name="neues-passwort"
									autocomplete="new-password"
									[value]="neuesPasswort()"
									(input)="neuesPasswort.set(wert($event))"
								/>
							</label>
							<p class="klein regel" [class.verletzt]="neuesPasswortFehler() !== null">
								{{ neuesPasswortFehler() ?? 'Das Passwort erfüllt die Regel.' }}
							</p>
							<button type="submit" class="knopf primaer" [disabled]="laeuft()">Passwort speichern</button>
						</form>
						@if (passwortFehler(); as text) {
							<p class="fehler" id="passwort-fehler" role="alert">{{ text }}</p>
						}
						@if (passwortErfolg()) {
							<p class="erfolg" role="status">Passwort gespeichert.</p>
						}
					</jf-karte>

					@if (i.totp.moeglich) {
						<jf-karte>
							<h2>Zweiter Faktor</h2>
							@if (totpOffen()) {
								<jf-totp-einrichtung
									[starten]="totpStarten"
									[bestaetigen]="totpBestaetigen"
									(eingerichtet)="totpFertig()"
								/>
							} @else if (i.totp.aktiv) {
								<p>Eingerichtet. Noch {{ i.totp.wiederherstellungscodesUebrig }} Wiederherstellungscodes übrig.</p>
							} @else {
								<p class="gedaempft klein">
									Mit einer Authenticator-App schützt du deinen Zugang zusätzlich. Bei jeder Anmeldung fragt die App
									dann nach einem Code.
								</p>
								<button type="button" class="knopf" (click)="totpOffen.set(true)">Zweiten Faktor einrichten</button>
							}
						</jf-karte>
					}

					<jf-karte>
						<h2>Abmelden</h2>
						<p class="gedaempft klein">
							„Überall abmelden“ beendet die Anmeldung auf allen deinen Geräten, auch auf diesem.
						</p>
						<div class="reihe">
							<button type="button" class="knopf" [disabled]="laeuft()" (click)="abmelden(false)">Abmelden</button>
							<button type="button" class="knopf" [disabled]="laeuft()" (click)="abmelden(true)">
								Überall abmelden
							</button>
						</div>
						@if (abmeldefehler(); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
					</jf-karte>
				</div>
			} @else {
				<p class="gedaempft">Wird geladen …</p>
			}
		</main>
	`,
	styles: `
		:host {
			display: block;
		}
		main {
			max-width: 32rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		.zurueck {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			margin: 0 0 var(--a2);
		}
		.stapel {
			display: grid;
			gap: var(--a4);
		}
		h2 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0 0 var(--a3);
			overflow-wrap: anywhere;
		}
		dl {
			display: grid;
			margin: 0;
		}
		dt {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		dd {
			margin: 0 0 var(--a3);
			overflow-wrap: anywhere;
		}
		dd:last-child {
			margin-bottom: 0;
		}
		ul {
			display: grid;
			margin: 0 0 var(--a4);
			padding: 0;
			list-style: none;
		}
		li {
			display: grid;
			gap: var(--a2);
			padding: var(--a3) 0;
			border-bottom: 1px solid var(--linie);
		}
		li:first-child {
			padding-top: 0;
		}
		li:last-child {
			border-bottom: 0;
		}
		.passkey-text {
			display: grid;
			gap: var(--a1);
			overflow-wrap: anywhere;
		}
		form {
			display: grid;
			gap: var(--a3);
		}
		form p {
			margin: 0;
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		.regel {
			color: var(--text-gedaempft);
		}
		.regel.verletzt,
		.fehler {
			color: var(--fehler);
		}
		.fehler,
		.erfolg {
			margin: var(--a3) 0 0;
		}
		li .fehler {
			margin: 0;
		}
		.erfolg {
			color: var(--erfolg);
			font-weight: 600;
		}
	`,
})
export class ProfilComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly router = inject(Router);
	protected readonly passkeys = inject(PasskeyBrowser);

	protected readonly ich = signal<MitgliedIch | null>(null);
	protected readonly ladefehler = signal<string | null>(null);
	/** Eine Handlung zur Zeit: Zwei gleichzeitige Passkey-Zeremonien oder Loeschungen verbrauchten Challenges und den letzten Weg. */
	protected readonly laeuft = signal(false);

	protected readonly umbenennenId = signal<string | null>(null);
	protected readonly labelEingabe = signal('');
	protected readonly neuerName = signal('');
	protected readonly zeilenFehler = signal<Record<string, string>>({});
	protected readonly passkeyFehler = signal<string | null>(null);

	protected readonly altesPasswort = signal('');
	protected readonly neuesPasswort = signal('');
	protected readonly passwortFehler = signal<string | null>(null);
	protected readonly passwortErfolg = signal(false);

	protected readonly totpOffen = signal(false);
	protected readonly abmeldefehler = signal<string | null>(null);

	protected readonly wert = wertVon;
	protected readonly datum = (iso: string): string => zeitpunktBerlin(iso).slice(0, 10);

	// Dieselbe Regel wie der Server (libs/domain); leer ist hier noch kein Fehler, die Pflicht prueft das Absenden.
	protected readonly neuesPasswortFehler = computed(() => {
		if (this.neuesPasswort() === '') return PASSWORT_HINWEIS['zu-kurz'];
		const pruefung = pruefePasswort(this.neuesPasswort());
		return pruefung.ok ? null : PASSWORT_HINWEIS[pruefung.grund];
	});

	/** Als Pfeilfunktionen, weil die Einrichtung sie als Eingabe aufruft und der Slug erst zur Laufzeit feststeht. */
	protected readonly totpStarten = () => this.api.totpStart(this.slug());
	protected readonly totpBestaetigen = (marke: string, code: string) =>
		this.api.totpBestaetigen(this.slug(), marke, code);

	ngOnInit(): void {
		void this.lade();
	}

	protected async lade(): Promise<void> {
		this.ladefehler.set(null);
		try {
			this.ich.set(await firstValueFrom(this.api.ich(this.slug())));
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			if (await this.beiAbgelaufenerSitzung(f)) return;
			this.ladefehler.set(fehlertext(f));
		}
	}

	protected beginneUmbenennen(p: { id: string; label: string }): void {
		this.umbenennenId.set(p.id);
		this.labelEingabe.set(p.label);
		this.setzeZeilenfehler(p.id, null);
	}

	protected async speichereName(ereignis: Event, id: string): Promise<void> {
		ereignis.preventDefault();
		const label = this.labelEingabe().trim();
		if (!nameGueltig(label)) {
			this.setzeZeilenfehler(id, NAME_UNGUELTIG);
			return;
		}
		await this.versuche(
			(text) => this.setzeZeilenfehler(id, text),
			async () => {
				await firstValueFrom(this.api.passkeyUmbenennen(this.slug(), id, label));
				this.umbenennenId.set(null);
				await this.lade();
			},
		);
	}

	protected async entferne(id: string): Promise<void> {
		await this.versuche(
			(text) => this.setzeZeilenfehler(id, text),
			async () => {
				await firstValueFrom(this.api.passkeyEntfernen(this.slug(), id));
				await this.lade();
			},
		);
	}

	protected async fuegeHinzu(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const name = this.neuerName().trim();
		// Leer ist erlaubt (der Server benennt nach dem Geraet); nur zu lang ist ein Fehler.
		if (name !== '' && !nameGueltig(name)) {
			this.passkeyFehler.set(NAME_UNGUELTIG);
			return;
		}
		await this.versuche(
			(text) => this.passkeyFehler.set(text),
			async () => {
				const ausgang = await this.passkeys.hinzufuegen({
					// Bei jedem Versuch frisch: Die Challenge ist nach einem Fehlschlag verbraucht.
					optionen: () => this.api.passkeyHinzufuegenOptionen(this.slug()).pipe(map((a) => a.optionen)),
					senden: (antwort) => this.api.passkeyHinzufuegen(this.slug(), name, antwort),
					schonVorhanden: 'Dieses Gerät hat schon einen Passkey für diesen Verein.',
				});
				if (ausgang === 'abgelehnt') {
					// Schweigen sieht aus wie ein kaputter Knopf (siehe PasskeyBrowser).
					this.passkeyFehler.set('Der Browser hat sofort abgelehnt. Prüfe, ob dieses Gerät Passkeys anbietet.');
				}
				if (ausgang === 'fertig') {
					this.neuerName.set('');
					await this.lade();
				}
			},
		);
	}

	protected async speicherePasswort(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		this.passwortErfolg.set(false);
		const hatPasswort = this.ich()?.hatPasswort === true;
		if (this.neuesPasswortFehler() !== null) {
			this.passwortFehler.set(this.neuesPasswortFehler());
			return;
		}
		// Ohne altes Passwort liefe der Server trotzdem durch Argon2 und zaehlte einen Fehlversuch.
		if (hatPasswort && this.altesPasswort() === '') {
			this.passwortFehler.set('Bitte das alte Passwort angeben');
			return;
		}
		await this.versuche(
			(text) => this.passwortFehler.set(text),
			async () => {
				await firstValueFrom(
					this.api.passwortAendern(this.slug(), hatPasswort ? this.altesPasswort() : '', this.neuesPasswort()),
				);
				this.altesPasswort.set('');
				this.neuesPasswort.set('');
				this.passwortErfolg.set(true);
				await this.lade();
			},
		);
	}

	protected totpFertig(): void {
		this.totpOffen.set(false);
		void this.lade();
	}

	protected async abmelden(ueberall: boolean): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.abmeldefehler.set(null);
		try {
			const aufruf: Observable<void> = ueberall ? this.api.abmeldenAlle(this.slug()) : this.api.abmelden(this.slug());
			await firstValueFrom(aufruf);
			await this.router.navigateByUrl(`/${encodeURIComponent(this.slug())}/anmelden`);
		} catch (ursache) {
			// Die Sitzung steht dann vielleicht noch: Die Person soll es erfahren, statt auf einer toten Seite zu glauben, sie sei draussen.
			this.abmeldefehler.set(fehlertext(alsApiFehler(ursache)));
		} finally {
			this.laeuft.set(false);
		}
	}

	private setzeZeilenfehler(id: string, text: string | null): void {
		this.zeilenFehler.update((alt) => {
			const neu = { ...alt };
			if (text === null) delete neu[id];
			else neu[id] = text;
			return neu;
		});
	}

	/**
	 * Gemeinsamer Rahmen der Schreibvorgaenge: sperrt die uebrigen Knoepfe, raeumt
	 * alte Fehler weg und uebersetzt neue. Eine abgelaufene Sitzung fuehrt zur
	 * Anmeldung statt zu einer Fehlermeldung am Feld.
	 */
	private async versuche(zeigeFehler: (text: string | null) => void, arbeit: () => Promise<void>): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.zeilenFehler.set({});
		this.passkeyFehler.set(null);
		this.passwortFehler.set(null);
		zeigeFehler(null);
		try {
			await arbeit();
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			if (await this.beiAbgelaufenerSitzung(f)) return;
			zeigeFehler(fehlertext(f));
		} finally {
			this.laeuft.set(false);
		}
	}

	private async beiAbgelaufenerSitzung(f: ApiFehler): Promise<boolean> {
		if (f.status !== 401 || f.fehler !== NICHT_ANGEMELDET) return false;
		await this.router.navigateByUrl(`/${encodeURIComponent(this.slug())}/anmelden`);
		return true;
	}
}
