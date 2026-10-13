import { inject, Injectable } from '@angular/core';
import {
	browserSupportsWebAuthn,
	startAuthentication,
	startRegistration,
	WebAuthnError,
} from '@simplewebauthn/browser';
import { firstValueFrom } from 'rxjs';
import { AdminApi } from './admin-api';

/**
 * Wie eine Zeremonie ausgegangen ist, ohne dass die Seite Fehlerklassen kennen muss.
 * Ein Fehler im eigentlichen Sinn (Server lehnt ab, Netz weg) ist kein Ausgang,
 * sondern eine Ausnahme.
 *
 * - fertig: der Server hat angenommen.
 * - abgebrochen: die Person hat den Dialog weggewischt. Kein Fehler, keine Meldung.
 * - abgelehnt: der Browser hat sofort abgelehnt, ohne zu fragen (meist liegt hier
 *   kein Passkey). Das sagt die Seite, denn Schweigen sieht aus wie ein kaputter Knopf.
 */
export type PasskeyAusgang = 'fertig' | 'abgebrochen' | 'abgelehnt';

/**
 * Unter dieser Grenze kann die Ablehnung nicht von einem Menschen kommen: Der
 * Systemdialog braucht allein zum Erscheinen laenger. WebAuthn meldet Abbruch und
 * "nichts Passendes" absichtlich gleich (NotAllowedError); nur die Zeit trennt sie.
 * Uebernommen aus hwyd (core/passkeys.ts), wo ein stiller Knopf am Mac genau so
 * aufgefallen ist.
 */
const MENSCH_MS = 600;

/**
 * Passkeys im Browser fuer den Admin-Bereich. Die Zeremonie selbst kapselt
 * @simplewebauthn/browser; dieser Dienst holt die Optionen, sendet die Antwort
 * und uebersetzt die Browser-Fehler. In Tests per Angular-DI ersetzbar, damit
 * keine Seite echtes WebAuthn aufruft.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyBrowser {
	private readonly api = inject(AdminApi);

	/** Ob dieser Browser WebAuthn kennt; ohne bleibt der Passkey-Knopf weg. */
	unterstuetzt(): boolean {
		return browserSupportsWebAuthn();
	}

	/** Anmelden ohne Benutzernamen: das Geraet weiss selbst, welche Passkeys es fuer diese Domain hat. */
	async anmelden(): Promise<PasskeyAusgang> {
		const optionen = await firstValueFrom(this.api.passkeyAnmeldeOptionen());
		const antwort = await this.zeremonie(() => startAuthentication({ optionsJSON: optionen }));
		if (antwort === 'abgebrochen' || antwort === 'abgelehnt') return antwort;
		await firstValueFrom(this.api.passkeyAnmelden(antwort));
		return 'fertig';
	}

	/** Einen Passkey fuer das angemeldete Konto hinzufuegen. */
	async hinzufuegen(): Promise<PasskeyAusgang> {
		const optionen = await firstValueFrom(this.api.passkeyHinzufuegenOptionen());
		const antwort = await this.zeremonie(() => startRegistration({ optionsJSON: optionen }));
		if (antwort === 'abgebrochen' || antwort === 'abgelehnt') return antwort;
		await firstValueFrom(this.api.passkeyHinzufuegen(antwort));
		return 'fertig';
	}

	private async zeremonie<T>(ablauf: () => Promise<T>): Promise<T | 'abgebrochen' | 'abgelehnt'> {
		const begonnen = Date.now();
		try {
			return await ablauf();
		} catch (fehler) {
			const nichtErlaubt =
				(fehler instanceof WebAuthnError &&
					(fehler.name === 'NotAllowedError' || fehler.code === 'ERROR_CEREMONY_ABORTED')) ||
				(fehler instanceof DOMException && fehler.name === 'NotAllowedError');
			if (nichtErlaubt) return Date.now() - begonnen < MENSCH_MS ? 'abgelehnt' : 'abgebrochen';
			if (fehler instanceof WebAuthnError && fehler.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
				throw new Error('Dieses Gerät hat schon einen Passkey für den Admin-Bereich.');
			}
			throw fehler;
		}
	}
}
