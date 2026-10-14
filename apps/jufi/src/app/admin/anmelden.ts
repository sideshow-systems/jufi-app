import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { KarteComponent } from '../gestaltung/ui';
import { AdminApi } from './admin-api';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { wertVon } from '../gemeinsam/formular';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';

/** Was der Server sagt, wenn die Zwischenmarke (5 Minuten) verfallen ist; dann beginnt die Anmeldung von vorn. */
const MARKE_ABGELAUFEN = 'Anmeldung abgelaufen, bitte neu beginnen';

@Component({
	selector: 'jf-admin-anmelden',
	imports: [KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<h1>JuFi Admin</h1>
			<jf-karte>
				<form (submit)="senden($event)">
					@if (zwischenmarke() === null) {
						<label class="feld">
							Benutzername
							<input
								name="benutzername"
								autocomplete="username"
								autocapitalize="none"
								spellcheck="false"
								[value]="benutzername()"
								(input)="benutzername.set(wert($event))"
							/>
						</label>
						<label class="feld">
							Passwort
							<input
								type="password"
								name="passwort"
								autocomplete="current-password"
								[value]="passwort()"
								(input)="passwort.set(wert($event))"
							/>
						</label>
					} @else if (mitWiederherstellung()) {
						<label class="feld">
							Wiederherstellungscode
							<input
								name="wiederherstellungscode"
								autocomplete="one-time-code"
								autocapitalize="characters"
								spellcheck="false"
								[value]="wiederherstellungscode()"
								(input)="wiederherstellungscode.set(wert($event))"
							/>
						</label>
					} @else {
						<label class="feld">
							Code aus der Authenticator-App
							<input
								name="code"
								inputmode="numeric"
								autocomplete="one-time-code"
								maxlength="7"
								[value]="code()"
								(input)="code.set(wert($event))"
							/>
						</label>
					}
					<button type="submit" class="knopf primaer" [disabled]="laeuft()">Anmelden</button>
					@if (zwischenmarke() !== null) {
						<button type="button" class="knopf leise" (click)="mitWiederherstellung.set(!mitWiederherstellung())">
							{{ mitWiederherstellung() ? 'Doch Code aus der App verwenden' : 'Wiederherstellungscode verwenden' }}
						</button>
					}
				</form>
				@if (fehler(); as text) {
					<p class="fehler" role="alert">{{ text }}</p>
				}
				@if (passkeys.unterstuetzt() && zwischenmarke() === null) {
					<hr />
					<button type="button" class="knopf" [disabled]="laeuft()" (click)="mitPasskey()">Mit Passkey anmelden</button>
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
			padding: var(--a6) var(--a4);
		}
		h1 {
			margin: 0 0 var(--a4);
			font-size: var(--schrift-titel);
		}
		form {
			display: grid;
			gap: var(--a3);
		}
		hr {
			border: 0;
			border-top: 1px solid var(--linie);
			margin: var(--a4) 0;
		}
		jf-karte .knopf {
			width: 100%;
		}
		.fehler {
			margin: var(--a3) 0 0;
			color: var(--fehler);
		}
	`,
})
export class AdminAnmeldenComponent {
	private readonly api = inject(AdminApi);
	private readonly router = inject(Router);
	protected readonly passkeys = inject(PasskeyBrowser);

	protected readonly benutzername = signal('');
	protected readonly passwort = signal('');
	protected readonly code = signal('');
	protected readonly wiederherstellungscode = signal('');
	protected readonly mitWiederherstellung = signal(false);
	/** Gesetzt, sobald das Passwort stimmt und der Server den Code verlangt. */
	protected readonly zwischenmarke = signal<string | null>(null);
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<string | null>(null);

	protected readonly wert = wertVon;

	protected async senden(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		if (this.laeuft()) return;
		await this.versuche(async () => {
			const marke = this.zwischenmarke();
			if (marke === null) {
				const antwort = await firstValueFrom(this.api.anmelden(this.benutzername().trim(), this.passwort()));
				if (antwort.schritt === 'totp') {
					// Das Passwort nicht laenger im Speicher halten als noetig.
					this.passwort.set('');
					this.zwischenmarke.set(antwort.zwischenmarke);
					return false;
				}
				return true;
			}
			await firstValueFrom(
				this.api.anmeldenMitTotp(
					marke,
					this.mitWiederherstellung()
						? { wiederherstellungscode: this.wiederherstellungscode().trim() }
						: { code: this.code().trim() },
				),
			);
			return true;
		});
	}

	protected async mitPasskey(): Promise<void> {
		if (this.laeuft()) return;
		await this.versuche(async () => {
			const ausgang = await this.passkeys.anmelden({
				optionen: () => this.api.passkeyAnmeldeOptionen(),
				senden: (antwort) => this.api.passkeyAnmelden(antwort),
			});
			if (ausgang === 'abgelehnt') {
				this.fehler.set(
					'Der Browser hat sofort abgelehnt – meist liegt hier kein Passkey. Melde dich mit Passwort an.',
				);
			}
			return ausgang === 'fertig';
		});
	}

	/**
	 * Gemeinsamer Rahmen der drei Wege: sperrt den Knopf, faengt Fehler als Text
	 * und geht bei Erfolg (true) zu den Vereinen. false heisst: noch nicht fertig
	 * oder abgebrochen, ohne Meldung.
	 */
	private async versuche(schritt: () => Promise<boolean>): Promise<void> {
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			if (await schritt()) await this.router.navigateByUrl('/admin/vereine');
		} catch (ursache) {
			const fehler = alsApiFehler(ursache);
			this.fehler.set(fehlertext(fehler));
			if (this.zwischenmarke() !== null && fehler.fehler === MARKE_ABGELAUFEN) {
				// Die Marke gilt nicht mehr, ein Code allein hilft nicht: Passwort neu.
				this.zwischenmarke.set(null);
				this.code.set('');
				this.wiederherstellungscode.set('');
			}
		} finally {
			this.laeuft.set(false);
		}
	}
}
