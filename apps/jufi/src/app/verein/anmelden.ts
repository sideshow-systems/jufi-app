import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	Injector,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { wertVon } from '../gemeinsam/formular';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';
import { KarteComponent } from '../gestaltung/ui';
import { MitgliederApi } from './mitglieder-api';
import { VereinKopfComponent } from './verein-kopf';

/** Was der Server sagt, wenn die Zwischenmarke verfallen ist; dann beginnt die Anmeldung von vorn. */
const MARKE_ABGELAUFEN = 'Anmeldung abgelaufen, bitte neu beginnen';

/**
 * Anmeldung der Mitglieder. Ein Einspaltenformular fuer das Handy: Die Kennung
 * (Adresse oder Anmeldename) traegt autocomplete webauthn, damit der Browser dort
 * gespeicherte Passkeys vorschlagen kann.
 */
@Component({
	selector: 'jf-anmelden',
	imports: [KarteComponent, RouterLink, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-verein-kopf [slug]="slug()" untertitel="Anmelden" />
			<jf-karte>
				<form #formular (submit)="senden($event)">
					@if (zwischenmarke() === null) {
						<label class="feld">
							E-Mail oder Anmeldename
							<input
								name="kennung"
								autocomplete="username webauthn"
								autocapitalize="none"
								spellcheck="false"
								[value]="kennung()"
								(input)="kennung.set(wert($event))"
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
				@if (zwischenmarke() === null) {
					<a class="knopf leise vergessen" [routerLink]="['/', slug(), 'zugang-verloren']">Passwort vergessen?</a>
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
		.vergessen {
			margin-top: var(--a3);
		}
		.fehler {
			margin: var(--a3) 0 0;
			color: var(--fehler);
		}
	`,
})
export class AnmeldenComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly router = inject(Router);
	private readonly injector = inject(Injector);
	protected readonly passkeys = inject(PasskeyBrowser);
	private readonly formular = viewChild.required<ElementRef<HTMLFormElement>>('formular');

	protected readonly kennung = signal('');
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
				// Unveraendert senden: Kleinschreibung und Leerraum normalisiert der Server.
				const antwort = await firstValueFrom(this.api.anmelden(this.slug(), this.kennung(), this.passwort()));
				if (antwort.schritt === 'totp') {
					// Das Passwort nicht laenger im Speicher halten als noetig.
					this.passwort.set('');
					this.zwischenmarke.set(antwort.zwischenmarke);
					return false;
				}
				return true;
			}
			await firstValueFrom(
				this.api.anmeldenTotp(
					this.slug(),
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
				optionen: () => this.api.passkeyOptionen(this.slug()).pipe(map((a) => a.optionen)),
				senden: (antwort) => this.api.anmeldenPasskey(this.slug(), antwort),
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
	 * Gemeinsamer Rahmen der Wege: sperrt die Knoepfe, faengt Fehler als Text und geht
	 * bei Erfolg (true) zur Startseite des Vereins. false heisst: noch nicht fertig
	 * oder abgebrochen, ohne Meldung.
	 */
	private async versuche(schritt: () => Promise<boolean>): Promise<void> {
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			// Ohne Schraegstrich am Ende, siehe zurApp in einladung.ts.
			if (await schritt()) await this.router.navigateByUrl(`/${encodeURIComponent(this.slug())}`);
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
			// Der gesperrte Knopf hat den Fokus verloren; Tastatur und Screenreader sollen im Formular weitermachen.
			// Nach dem naechsten Rendern, weil beim Wechsel zum Codefeld das Eingabefeld erst dann das neue ist.
			afterNextRender(() => this.formular().nativeElement.querySelector('input')?.focus(), { injector: this.injector });
		}
	}
}
