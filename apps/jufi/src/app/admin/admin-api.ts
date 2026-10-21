import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { catchError, type Observable, throwError } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';

export interface AdminIch {
	benutzername: string;
	totpAktiv: boolean;
	passkeys: number;
	wiederherstellungscodesUebrig: number;
}

export type AnmeldeSchritt = { schritt: 'fertig' } | { schritt: 'totp'; zwischenmarke: string };

export interface TotpStart {
	zwischenmarke: string;
	geheimnis: string;
	uri: string;
	wiederherstellungscodes: string[];
}

/** Link und fertiger Text zum Kopieren, wie der Server sie nach jeder Einladung liefert. */
export interface Einladung {
	link: string;
	text: string;
	/** ISO-Zeitpunkt; die Verwaltungs-Endpunkte liefern ihn noch nicht. */
	ablauf?: string;
}

export type VereinStatus = 'AKTIV' | 'GESPERRT';

export type AdminAktion =
	| 'VEREIN_ANGELEGT'
	| 'GESPERRT'
	| 'ENTSPERRT'
	| 'SLUG_KORRIGIERT'
	| 'NOTFALL_LINK'
	| 'ERSTE_EINLADUNG_ERNEUERT'
	| 'SPEICHERGRENZE';

export interface Kennzahlen {
	jungfischer: number;
	erwachsene: number;
	zugaenge: number;
	offeneEinladungen: number;
	/** JJJJ-MM-TT, nur das Datum. */
	letzteAnmeldung: string | null;
	speicherBytes: number;
	speicherGrenzeMb: number;
}

export interface VereinZeile {
	id: string;
	slug: string;
	anzeigename: string;
	status: VereinStatus;
	kennzahlen: Kennzahlen;
}

export interface Ansprechpartner {
	personId: string;
	vorname: string;
	nachname: string;
	email: string | null;
}

export interface VereinDetails {
	id: string;
	slug: string;
	name: string;
	anzeigename: string;
	farbe: string;
	status: VereinStatus;
	angelegtAm: string;
	kennzahlen: Kennzahlen;
	ansprechpartner: Ansprechpartner[];
	ersteLeitung: { personId: string; vorname: string; nachname: string } | null;
	slugAenderbar: boolean;
	protokoll: { zeitpunkt: string; aktion: AdminAktion; admin: string }[];
}

export interface NeuerVerein {
	name: string;
	anzeigename: string;
	slug: string;
	farbe: string;
	leitung: { vorname: string; nachname: string; email: string };
	/** Nur true oder gar nicht: Der Server wertet nichts anderes als true. */
	perMail?: true;
}

/** Jede Antwort, die eine Einladung liefert, sagt auch, ob eine Mail dazu eingereiht ist. */
export interface EinladungAntwort {
	einladung: Einladung;
	mailEingereiht: boolean;
}

/**
 * Alle Aufrufe der Admin-API, einer je Endpunkt. Absolute Pfade, weil base href
 * "/" ist und der Router-Stand sonst im Pfad landete (wie VereinApi).
 */
@Injectable({ providedIn: 'root' })
export class AdminApi {
	private readonly http = inject(HttpClient);

	private post<T>(pfad: string, koerper: object = {}): Observable<T> {
		return this.http
			.post<T>(`/admin/api/v1${pfad}`, koerper)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	ich(): Observable<AdminIch> {
		return this.http
			.get<AdminIch>('/admin/api/v1/ich')
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	abmelden(): Observable<void> {
		return this.post<void>('/abmelden');
	}

	pruefeEinrichtung(token: string): Observable<{ benutzername: string }> {
		return this.post('/einrichtung/pruefen', { token });
	}

	schliesseEinrichtungAb(token: string, passwort: string): Observable<{ benutzername: string }> {
		return this.post('/einrichtung/abschliessen', { token, passwort });
	}

	anmelden(benutzername: string, passwort: string): Observable<AnmeldeSchritt> {
		return this.post('/anmelden', { benutzername, passwort });
	}

	anmeldenMitTotp(
		zwischenmarke: string,
		pruefung: { code: string } | { wiederherstellungscode: string },
	): Observable<{ schritt: 'fertig'; wiederherstellungscodesUebrig: number }> {
		return this.post('/anmelden/totp', { zwischenmarke, ...pruefung });
	}

	totpStart(): Observable<TotpStart> {
		return this.post('/konto/totp/start');
	}

	totpBestaetigen(zwischenmarke: string, code: string): Observable<{ ok: true }> {
		return this.post('/konto/totp/bestaetigen', { zwischenmarke, code });
	}

	passkeyAnmeldeOptionen(): Observable<PublicKeyCredentialRequestOptionsJSON> {
		return this.post('/anmelden/passkey/optionen');
	}

	passkeyAnmelden(antwort: unknown): Observable<{ schritt: 'fertig' }> {
		return this.post('/anmelden/passkey', { antwort });
	}

	passkeyHinzufuegenOptionen(): Observable<PublicKeyCredentialCreationOptionsJSON> {
		return this.post('/konto/passkey/optionen');
	}

	passkeyHinzufuegen(antwort: unknown): Observable<{ label: string }> {
		return this.post('/konto/passkey', { antwort });
	}

	vereine(): Observable<{ vereine: VereinZeile[] }> {
		return this.http
			.get<{ vereine: VereinZeile[] }>('/admin/api/v1/vereine')
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	legeVereinAn(verein: NeuerVerein): Observable<{ id: string; slug: string } & EinladungAntwort> {
		return this.post('/vereine', verein);
	}

	verein(id: string): Observable<VereinDetails> {
		return this.http
			.get<VereinDetails>(`/admin/api/v1/vereine/${encodeURIComponent(id)}`)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	sperren(id: string): Observable<{ status: VereinStatus }> {
		return this.post(`/vereine/${encodeURIComponent(id)}/sperren`);
	}

	entsperren(id: string): Observable<{ status: VereinStatus }> {
		return this.post(`/vereine/${encodeURIComponent(id)}/entsperren`);
	}

	korrigiereSlug(id: string, slug: string): Observable<{ slug: string; einladung: Einladung }> {
		return this.post(`/vereine/${encodeURIComponent(id)}/slug`, { slug });
	}

	setzeSpeichergrenze(id: string, grenzeMb: number): Observable<void> {
		return this.http
			.put<void>(`/admin/api/v1/vereine/${encodeURIComponent(id)}/speichergrenze`, { grenzeMb })
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	erneuereErsteEinladung(id: string, perMail = false): Observable<EinladungAntwort> {
		// Ohne Kaestchen bleibt der Body leer wie bisher: perMail fehlt, statt false zu sein.
		return this.post(`/vereine/${encodeURIComponent(id)}/einladung-erneuern`, perMail ? { perMail: true } : {});
	}

	notfallLink(id: string, personId: string, perMail = false): Observable<EinladungAntwort> {
		return this.post(`/vereine/${encodeURIComponent(id)}/notfall-link`, {
			personId,
			...(perMail ? { perMail: true } : {}),
		});
	}
}
