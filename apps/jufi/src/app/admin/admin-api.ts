import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { catchError, type Observable, throwError } from 'rxjs';

/** Wie jeder Fehler der Admin-API bei der Seite ankommt (statt HttpErrorResponse). */
export interface AdminFehler {
	/** 0 heisst: keine Antwort bekommen (Netz). */
	status: number;
	fehler: string;
	feld?: string;
	wartenSekunden?: number;
}

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

const KEINE_VERBINDUNG = 'Keine Verbindung – nochmal versuchen';

/**
 * Macht aus allem, was ein HTTP-Aufruf werfen kann, einen AdminFehler. Ein
 * Netzfehler hat keinen Koerper; ein Koerper ohne fehler-Feld (etwa die
 * HTML-Fehlerseite eines Proxys) bekommt denselben Allgemeintext.
 */
export function alsAdminFehler(ursache: unknown): AdminFehler {
	if (ursache instanceof HttpErrorResponse) {
		const koerper: unknown = ursache.error;
		const feldweise = koerper && typeof koerper === 'object' ? (koerper as Record<string, unknown>) : {};
		return {
			status: ursache.status,
			fehler:
				typeof feldweise['fehler'] === 'string'
					? feldweise['fehler']
					: ursache.status === 0
						? KEINE_VERBINDUNG
						: 'Unerwarteter Fehler',
			...(typeof feldweise['feld'] === 'string' ? { feld: feldweise['feld'] } : {}),
			...(typeof feldweise['wartenSekunden'] === 'number' ? { wartenSekunden: feldweise['wartenSekunden'] } : {}),
		};
	}
	if (istAdminFehler(ursache)) return ursache;
	return { status: 0, fehler: ursache instanceof Error ? ursache.message : 'Unerwarteter Fehler' };
}

export function istAdminFehler(wert: unknown): wert is AdminFehler {
	return (
		!!wert &&
		typeof wert === 'object' &&
		typeof (wert as AdminFehler).status === 'number' &&
		typeof (wert as AdminFehler).fehler === 'string'
	);
}

/** Der Satz unter dem Formular: bei 429 mit Wartezeit, sonst der Text des Servers. */
export function fehlertext(fehler: AdminFehler): string {
	if (fehler.status === 429 && fehler.wartenSekunden !== undefined) {
		return `Zu viele Versuche – bitte in ${fehler.wartenSekunden} Sekunden erneut`;
	}
	return fehler.fehler;
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
			.pipe(catchError((e: unknown) => throwError(() => alsAdminFehler(e))));
	}

	ich(): Observable<AdminIch> {
		return this.http
			.get<AdminIch>('/admin/api/v1/ich')
			.pipe(catchError((e: unknown) => throwError(() => alsAdminFehler(e))));
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
}
