import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { catchError, type Observable, throwError } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';

/** Was GET /ich ueber die angemeldete Person und ihren Zugang sagt (Server: profil.ts). */
export interface MitgliedIch {
	person: { id: string; vorname: string; nachname: string; art: 'ERWACHSENER' | 'JUNGFISCHER'; rechte: string[] };
	/** Adresse (Erwachsene) oder Anmeldename (Jungfischer). */
	kennung: string | null;
	passkeys: { id: string; label: string; erstelltAm: string; zuletztGenutztAm: string | null }[];
	hatPasswort: boolean;
	totp: { moeglich: boolean; aktiv: boolean; wiederherstellungscodesUebrig: number };
}

export type MitgliedAnmeldeSchritt = { schritt: 'fertig' } | { schritt: 'totp'; zwischenmarke: string };

/** Was POST /einladung/pruefen ueber den Link verraet, ohne ihn zu verbrauchen. */
export interface EinladungInfo {
	vorname: string;
	art: string;
	vereinsname: string;
	personArt: 'ERWACHSENER' | 'JUNGFISCHER';
	kennung: { fest: boolean; wert: string | null };
	hatZugang: boolean;
	einwilligungFehlt: boolean;
}

export interface EinloesenDaten {
	token: string;
	kennung?: string;
	passwort?: string;
	/** Antwort der Passkey-Zeremonie, wenn statt eines Passworts ein Passkey eingerichtet wird. */
	passkey?: unknown;
}

export interface MitgliedTotpStart {
	marke: string;
	geheimnis: string;
	uri: string;
	wiederherstellungscodes: string[];
}

/**
 * Alle Aufrufe der Mitglieder-API, einer je Endpunkt, der Slug stets als erster
 * Parameter. Der Slug ist Teil des Pfads und nicht im Dienst gemerkt: Ein
 * Dienst mit Zustand haette bei einem Wechsel zwischen Vereinen den alten Slug
 * noch in der Hand. Absolute Pfade, weil base href "/" ist (wie VereinApi).
 */
@Injectable({ providedIn: 'root' })
export class MitgliederApi {
	private readonly http = inject(HttpClient);

	private basis(slug: string): string {
		return `/${encodeURIComponent(slug)}/api/v1`;
	}

	private holen<T>(slug: string, pfad: string): Observable<T> {
		return this.http
			.get<T>(`${this.basis(slug)}${pfad}`)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	private senden<T>(methode: 'POST' | 'PATCH' | 'DELETE', slug: string, pfad: string, koerper?: object): Observable<T> {
		return this.http
			.request<T>(methode, `${this.basis(slug)}${pfad}`, koerper === undefined ? {} : { body: koerper })
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	ich(slug: string): Observable<MitgliedIch> {
		return this.holen(slug, '/ich');
	}

	abmelden(slug: string): Observable<void> {
		return this.senden('POST', slug, '/abmelden', {});
	}

	abmeldenAlle(slug: string): Observable<void> {
		return this.senden('POST', slug, '/abmelden/alle', {});
	}

	einladungPruefen(slug: string, token: string): Observable<EinladungInfo> {
		return this.senden('POST', slug, '/einladung/pruefen', { token });
	}

	einladungPasskeyOptionen(
		slug: string,
		token: string,
	): Observable<{ optionen: PublicKeyCredentialCreationOptionsJSON }> {
		return this.senden('POST', slug, '/einladung/passkey-optionen', { token });
	}

	einladungEinloesen(slug: string, daten: EinloesenDaten): Observable<{ vorname: string }> {
		return this.senden('POST', slug, '/einladung/einloesen', daten);
	}

	anmelden(slug: string, kennung: string, passwort: string): Observable<MitgliedAnmeldeSchritt> {
		return this.senden('POST', slug, '/anmelden', { kennung, passwort });
	}

	anmeldenTotp(
		slug: string,
		zwischenmarke: string,
		pruefung: { code: string } | { wiederherstellungscode: string },
	): Observable<{ schritt: 'fertig'; wiederherstellungscodesUebrig: number }> {
		return this.senden('POST', slug, '/anmelden/totp', { zwischenmarke, ...pruefung });
	}

	passkeyOptionen(slug: string): Observable<{ optionen: PublicKeyCredentialRequestOptionsJSON }> {
		return this.senden('POST', slug, '/anmelden/passkey-optionen');
	}

	anmeldenPasskey(slug: string, antwort: unknown): Observable<{ schritt: 'fertig' }> {
		return this.senden('POST', slug, '/anmelden/passkey', { antwort });
	}

	zugangVerloren(slug: string, email: string): Observable<{ ok: true }> {
		return this.senden('POST', slug, '/zugang-verloren', { email });
	}

	passwortAendern(slug: string, alt: string, neu: string): Observable<{ ok: true }> {
		return this.senden('POST', slug, '/profil/passwort', { alt, neu });
	}

	passkeyHinzufuegenOptionen(slug: string): Observable<{ optionen: PublicKeyCredentialCreationOptionsJSON }> {
		return this.senden('POST', slug, '/profil/passkeys/optionen');
	}

	passkeyHinzufuegen(slug: string, name: string, antwort: unknown): Observable<{ id: string; label: string }> {
		return this.senden('POST', slug, '/profil/passkeys', { name, antwort });
	}

	passkeyUmbenennen(slug: string, id: string, label: string): Observable<{ id: string; label: string }> {
		return this.senden('PATCH', slug, `/profil/passkeys/${encodeURIComponent(id)}`, { label });
	}

	passkeyEntfernen(slug: string, id: string): Observable<{ ok: true }> {
		return this.senden('DELETE', slug, `/profil/passkeys/${encodeURIComponent(id)}`);
	}

	totpStart(slug: string): Observable<MitgliedTotpStart> {
		return this.senden('POST', slug, '/profil/totp/start');
	}

	totpBestaetigen(slug: string, marke: string, code: string): Observable<{ ok: true }> {
		return this.senden('POST', slug, '/profil/totp/bestaetigen', { marke, code });
	}
}
