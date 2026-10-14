import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { KarteComponent, PilleComponent } from '../gestaltung/ui';
import { AdminApi, type AdminIch } from './admin-api';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';
import { TotpEinrichtungComponent, type TotpStart as TotpStartBauteil } from '../gemeinsam/totp-einrichtung';

@Component({
	selector: 'jf-admin-konto',
	imports: [KarteComponent, PilleComponent, TotpEinrichtungComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Konto</h1>
		@if (ladefehler(); as text) {
			<jf-karte>
				<p>{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (ich(); as k) {
			<div class="stapel">
				<jf-karte>
					<h2>{{ k.benutzername }}</h2>
				</jf-karte>

				<jf-karte>
					<h2>
						Zweiter Faktor
						@if (k.totpAktiv) {
							<jf-pille art="ok">Aktiv</jf-pille>
						} @else {
							<jf-pille art="offen">Nicht eingerichtet</jf-pille>
						}
					</h2>
					@if (k.totpAktiv) {
						<p class="gedaempft">
							Wiederherstellungscodes übrig: {{ k.wiederherstellungscodesUebrig }}
							@if (k.wiederherstellungscodesUebrig <= 2) {
								<jf-pille art="offen">Wenige</jf-pille>
							}
						</p>
					} @else if (totpOffen()) {
						<jf-totp-einrichtung
							[starten]="totpStarten"
							[bestaetigen]="totpBestaetigen"
							(eingerichtet)="totpFertig()"
						/>
					} @else {
						<p class="gedaempft">Mit einer Authenticator-App schützt du das Konto auch bei bekanntem Passwort.</p>
						<button type="button" class="knopf primaer" (click)="totpOffen.set(true)">Einrichten</button>
					}
				</jf-karte>

				<jf-karte>
					<h2>Passkeys</h2>
					<p class="gedaempft">
						{{
							k.passkeys === 0
								? 'Noch kein Passkey eingerichtet.'
								: k.passkeys === 1
									? '1 Passkey'
									: k.passkeys + ' Passkeys'
						}}
					</p>
					@if (passkeys.unterstuetzt()) {
						<button type="button" class="knopf" [disabled]="laeuft()" (click)="passkeyHinzufuegen()">
							Passkey hinzufügen
						</button>
					}
					@if (passkeyMeldung(); as text) {
						<p class="klein" role="status">{{ text }}</p>
					}
				</jf-karte>

				<div>
					<button type="button" class="knopf" [disabled]="laeuft()" (click)="abmelden()">Abmelden</button>
				</div>
			</div>
		} @else {
			<p class="gedaempft">Wird geladen …</p>
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
		.stapel {
			display: grid;
			gap: var(--a4);
			max-width: 40rem;
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
	`,
})
export class AdminKontoComponent implements OnInit {
	private readonly api = inject(AdminApi);
	private readonly router = inject(Router);
	protected readonly passkeys = inject(PasskeyBrowser);

	/** Die Aufrufe der Admin-API fuer das gemeinsame TOTP-Bauteil; Admin nennt die Marke Zwischenmarke. */
	protected readonly totpStarten = (): Observable<TotpStartBauteil> =>
		this.api.totpStart().pipe(map((s) => ({ ...s, marke: s.zwischenmarke })));
	protected readonly totpBestaetigen = (marke: string, code: string): Observable<unknown> =>
		this.api.totpBestaetigen(marke, code);

	protected readonly ich = signal<AdminIch | null>(null);
	protected readonly ladefehler = signal<string | null>(null);
	protected readonly totpOffen = signal(false);
	protected readonly laeuft = signal(false);
	protected readonly passkeyMeldung = signal<string | null>(null);

	ngOnInit(): void {
		void this.lade();
	}

	protected async lade(): Promise<void> {
		this.ladefehler.set(null);
		try {
			this.ich.set(await firstValueFrom(this.api.ich()));
		} catch (ursache) {
			const fehler = alsApiFehler(ursache);
			// Die Sitzung laeuft nach 12 Stunden ab, auch bei offener Seite; der Waechter
			// greift nur beim Betreten des Bereichs. Dann zurueck zur Anmeldung.
			if (fehler.status === 401) await this.router.navigateByUrl('/admin/anmelden');
			else
				this.ladefehler.set(
					fehler.status === 0 ? fehlertext(fehler) : `Das Konto konnte nicht geladen werden: ${fehlertext(fehler)}`,
				);
		}
	}

	protected totpFertig(): void {
		this.totpOffen.set(false);
		void this.lade();
	}

	protected async passkeyHinzufuegen(): Promise<void> {
		this.laeuft.set(true);
		this.passkeyMeldung.set(null);
		try {
			const ausgang = await this.passkeys.hinzufuegen({
				optionen: () => this.api.passkeyHinzufuegenOptionen(),
				senden: (antwort) => this.api.passkeyHinzufuegen(antwort),
				schonVorhanden: 'Dieses Gerät hat schon einen Passkey für den Admin-Bereich.',
			});
			if (ausgang === 'fertig') {
				this.passkeyMeldung.set('Passkey hinzugefügt.');
				void this.lade();
			} else if (ausgang === 'abgelehnt') {
				this.passkeyMeldung.set(
					'Der Browser hat sofort abgelehnt. Möglich ist das, wenn er keinen Schlüsselbund erreicht.',
				);
			}
		} catch (ursache) {
			this.passkeyMeldung.set(fehlertext(alsApiFehler(ursache)));
		} finally {
			this.laeuft.set(false);
		}
	}

	protected async abmelden(): Promise<void> {
		this.laeuft.set(true);
		try {
			await firstValueFrom(this.api.abmelden());
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			// 401: keine Sitzung mehr, also abgemeldet -- wie bei Erfolg zur Anmeldung.
			if (f.status !== 401) {
				this.passkeyMeldung.set(`Abmelden fehlgeschlagen – ${fehlertext(f)}`);
				return;
			}
		} finally {
			this.laeuft.set(false);
		}
		await this.router.navigateByUrl('/admin/anmelden');
	}
}
