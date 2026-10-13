import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PASSWORT_HINWEIS, pruefePasswort } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { KarteComponent, PilleComponent } from '../gestaltung/ui';
import { AdminApi, alsAdminFehler, fehlertext } from './admin-api';
import { wertVon } from './formular';
import { PasskeyBrowser } from './passkey-browser';
import { TotpEinrichtungComponent } from './totp-einrichtung';

type Schritt = 'laedt' | 'ungueltig' | 'netzfehler' | 'passwort' | 'totp' | 'passkey' | 'fertig';

/**
 * Erste Anmeldung eines neuen Admins ueber den Einmal-Link
 * /admin/einrichten#<token>: Passwort festlegen, dann zweiter Faktor und
 * Passkey (beides ueberspringbar), dann zu den Vereinen.
 */
@Component({
	selector: 'jf-admin-einrichten',
	imports: [KarteComponent, PilleComponent, RouterLink, TotpEinrichtungComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<h1>JuFi Admin</h1>
			<jf-karte>
				@switch (schritt()) {
					@case ('laedt') {
						<p class="gedaempft">Link wird geprüft …</p>
					}
					@case ('ungueltig') {
						<p>Dieser Link gilt nicht mehr – lass dir mit <code>admin zuruecksetzen</code> einen neuen geben.</p>
					}
					@case ('netzfehler') {
						<p>Keine Verbindung – nochmal versuchen</p>
						<button type="button" class="knopf primaer" (click)="pruefe()">Nochmal versuchen</button>
					}
					@case ('passwort') {
						<h2>Willkommen, {{ benutzername() }}</h2>
						<p class="gedaempft">Lege ein Passwort für dein Konto fest.</p>
						<form (submit)="abschliessen($event)">
							<label class="feld">
								Passwort
								<input
									type="password"
									name="passwort"
									autocomplete="new-password"
									[value]="passwort()"
									(input)="passwort.set(wert($event))"
								/>
							</label>
							<label class="feld">
								Passwort wiederholen
								<input
									type="password"
									name="wiederholung"
									autocomplete="new-password"
									[value]="wiederholung()"
									(input)="wiederholung.set(wert($event))"
								/>
							</label>
							<p class="klein regel" [class.verletzt]="regelHinweis() !== null && passwort() !== ''">
								{{ regelHinweis() ?? 'Das Passwort erfüllt die Regel.' }}
							</p>
							@if (weichtAb()) {
								<p class="klein fehler">Die beiden Passwörter sind nicht gleich.</p>
							}
							<button type="submit" class="knopf primaer" [disabled]="!kannAbschliessen()">Passwort festlegen</button>
						</form>
						@if (fehler(); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
					}
					@case ('totp') {
						<h2>Zweiter Faktor <jf-pille art="offen">Dringend empfohlen</jf-pille></h2>
						<p class="gedaempft">
							Mit einer Authenticator-App schützt du das Konto auch dann, wenn jemand dein Passwort kennt.
						</p>
						<jf-totp-einrichtung (eingerichtet)="zumPasskey()" />
						<button type="button" class="knopf" (click)="zumPasskey()">Überspringen</button>
					}
					@case ('passkey') {
						<h2>Passkey</h2>
						<p class="gedaempft">
							Mit einem Passkey meldest du dich künftig mit der Entsperrung dieses Geräts an, ohne Passwort.
						</p>
						<div class="reihe">
							<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="passkeyHinzufuegen()">
								Passkey hinzufügen
							</button>
							<button type="button" class="knopf" (click)="schritt.set('fertig')">Überspringen</button>
						</div>
						@if (fehler(); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
					}
					@case ('fertig') {
						<h2>Fertig</h2>
						<p class="gedaempft">Dein Konto ist eingerichtet.</p>
						<a class="knopf primaer" routerLink="/admin/vereine">Zu den Vereinen</a>
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
			max-width: 40rem;
			margin: 0 auto;
			padding: var(--a6) var(--a4);
		}
		h1 {
			margin: 0 0 var(--a4);
			font-size: var(--schrift-titel);
		}
		h2 {
			display: flex;
			align-items: center;
			gap: var(--a2);
			margin: 0 0 var(--a2);
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0 0 var(--a3);
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
			gap: var(--a2);
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
export class AdminEinrichtenComponent implements OnInit {
	private readonly api = inject(AdminApi);
	private readonly route = inject(ActivatedRoute);
	private readonly passkeys = inject(PasskeyBrowser);

	protected readonly schritt = signal<Schritt>('laedt');
	protected readonly benutzername = signal('');
	protected readonly passwort = signal('');
	protected readonly wiederholung = signal('');
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<string | null>(null);

	protected readonly wert = wertVon;

	// Dieselbe Regel wie der Server (libs/domain), damit Hinweis und Ablehnung nie auseinanderlaufen.
	protected readonly regelHinweis = computed(() => {
		const pruefung = pruefePasswort(this.passwort());
		return pruefung.ok ? null : PASSWORT_HINWEIS[pruefung.grund];
	});
	protected readonly weichtAb = computed(() => this.wiederholung() !== '' && this.wiederholung() !== this.passwort());
	protected readonly kannAbschliessen = computed(
		() => this.regelHinweis() === null && this.passwort() === this.wiederholung() && !this.laeuft(),
	);

	/** Nur im Speicher: Nach dem Lesen steht das Token nicht mehr in der Adresse. */
	private token = '';

	ngOnInit(): void {
		// Vom Router statt aus location.hash gelesen: gleiche Quelle, aber im Test
		// ohne echte Adressleiste verfuegbar.
		this.token = this.route.snapshot.fragment ?? '';
		// Das Fragment wandert nicht zum Server, steht aber im Verlauf und in der
		// Adressleiste. Ersetzt statt neu navigiert, damit der Router-Stand in
		// history.state erhalten bleibt und kein zweiter Eintrag entsteht.
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
			this.benutzername.set((await firstValueFrom(this.api.pruefeEinrichtung(this.token))).benutzername);
			this.schritt.set('passwort');
		} catch (ursache) {
			this.schritt.set(alsAdminFehler(ursache).status === 404 ? 'ungueltig' : 'netzfehler');
		}
	}

	protected async abschliessen(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		if (!this.kannAbschliessen()) return;
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			await firstValueFrom(this.api.schliesseEinrichtungAb(this.token, this.passwort()));
			// Weder Passwort noch Token werden weiter gebraucht.
			this.passwort.set('');
			this.wiederholung.set('');
			this.token = '';
			this.schritt.set('totp');
		} catch (ursache) {
			const f = alsAdminFehler(ursache);
			if (f.status === 404) this.schritt.set('ungueltig');
			else this.fehler.set(fehlertext(f));
		} finally {
			this.laeuft.set(false);
		}
	}

	protected zumPasskey(): void {
		// Ohne WebAuthn gaebe es hier nur einen Knopf, der nicht funktioniert.
		this.schritt.set(this.passkeys.unterstuetzt() ? 'passkey' : 'fertig');
	}

	protected async passkeyHinzufuegen(): Promise<void> {
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			const ausgang = await this.passkeys.hinzufuegen();
			if (ausgang === 'fertig') this.schritt.set('fertig');
			else if (ausgang === 'abgelehnt') {
				this.fehler.set('Der Browser hat sofort abgelehnt. Du kannst den Passkey später im Konto hinzufügen.');
			}
		} catch (ursache) {
			this.fehler.set(fehlertext(alsAdminFehler(ursache)));
		} finally {
			this.laeuft.set(false);
		}
	}
}
