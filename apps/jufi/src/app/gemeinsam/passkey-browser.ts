import { Injectable } from '@angular/core';
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
	browserSupportsWebAuthn,
	startAuthentication,
	startRegistration,
	WebAuthnError,
} from '@simplewebauthn/browser';
import { firstValueFrom, type Observable } from 'rxjs';

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
 * Die Aufrufe der jeweiligen API: Admin und Mitglieder haben verschiedene
 * Endpunkte. Verworfen: der Dienst injiziert beide APIs -- er muesste dann
 * wissen, in welchem Bereich er gerade laeuft.
 */
export interface AnmeldeWege {
	optionen: () => Observable<PublicKeyCredentialRequestOptionsJSON>;
	senden: (antwort: unknown) => Observable<unknown>;
}

export interface HinzufuegeWege {
	optionen: () => Observable<PublicKeyCredentialCreationOptionsJSON>;
	senden: (antwort: unknown) => Observable<unknown>;
	/** Text, wenn das Geraet den Passkey schon hat; er nennt den Bereich. */
	schonVorhanden: string;
}

/**
 * Passkeys im Browser fuer Admin und Mitglieder. Die Zeremonie selbst kapselt
 * @simplewebauthn/browser; dieser Dienst holt die Optionen, sendet die Antwort
 * und uebersetzt die Browser-Fehler. In Tests per Angular-DI ersetzbar, damit
 * keine Seite echtes WebAuthn aufruft.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyBrowser {
	/** Ob dieser Browser WebAuthn kennt; ohne bleibt der Passkey-Knopf weg. */
	unterstuetzt(): boolean {
		return browserSupportsWebAuthn();
	}

	/** Anmelden ohne Benutzernamen: das Geraet weiss selbst, welche Passkeys es fuer diese Domain hat. */
	async anmelden(wege: AnmeldeWege): Promise<PasskeyAusgang> {
		const optionen = await firstValueFrom(wege.optionen());
		const antwort = await this.zeremonie(() => startAuthentication({ optionsJSON: optionen }));
		if (antwort === 'abgebrochen' || antwort === 'abgelehnt') return antwort;
		await firstValueFrom(wege.senden(antwort));
		return 'fertig';
	}

	/** Einen Passkey fuer das angemeldete Konto hinzufuegen. */
	async hinzufuegen(wege: HinzufuegeWege): Promise<PasskeyAusgang> {
		const optionen = await firstValueFrom(wege.optionen());
		const antwort = await this.zeremonie(() => startRegistration({ optionsJSON: optionen }), wege.schonVorhanden);
		if (antwort === 'abgebrochen' || antwort === 'abgelehnt') return antwort;
		await firstValueFrom(wege.senden(antwort));
		return 'fertig';
	}

	private async zeremonie<T>(ablauf: () => Promise<T>, schonVorhanden = ''): Promise<T | 'abgebrochen' | 'abgelehnt'> {
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
				throw new Error(schonVorhanden);
			}
			throw fehler;
		}
	}
}
