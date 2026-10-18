import { HttpErrorResponse } from '@angular/common/http';
import { computed, type Signal } from '@angular/core';

/** Wie jeder Fehler der API bei der Seite ankommt (statt HttpErrorResponse). */
export interface ApiFehler {
	/** 0 heisst: keine Antwort bekommen (Netz). */
	status: number;
	fehler: string;
	feld?: string;
	/** Maschinenlesbarer Grund (etwa DOPPELT, EINWILLIGUNG_FEHLT); die Seite entscheidet daran, nicht am Text. */
	code?: string;
	/** Bei DOPPELT die gefundene Person. */
	person?: { id: string; vorname: string; nachname: string };
	wartenSekunden?: number;
}

const KEINE_VERBINDUNG = 'Keine Verbindung – nochmal versuchen';

/**
 * Macht aus allem, was ein HTTP-Aufruf werfen kann, einen ApiFehler. Ein
 * Netzfehler hat keinen Koerper; ein Koerper ohne fehler-Feld (etwa die
 * HTML-Fehlerseite eines Proxys) bekommt denselben Allgemeintext.
 */
export function alsApiFehler(ursache: unknown): ApiFehler {
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
			...(typeof feldweise['code'] === 'string' ? { code: feldweise['code'] } : {}),
			...(istPerson(feldweise['person']) ? { person: feldweise['person'] } : {}),
			...(typeof feldweise['wartenSekunden'] === 'number' ? { wartenSekunden: feldweise['wartenSekunden'] } : {}),
		};
	}
	if (istApiFehler(ursache)) return ursache;
	return { status: 0, fehler: ursache instanceof Error ? ursache.message : 'Unerwarteter Fehler' };
}

function istPerson(wert: unknown): wert is NonNullable<ApiFehler['person']> {
	const p = wert as Record<string, unknown> | null;
	return (
		!!p &&
		typeof p === 'object' &&
		typeof p['id'] === 'string' &&
		typeof p['vorname'] === 'string' &&
		typeof p['nachname'] === 'string'
	);
}

export function istApiFehler(wert: unknown): wert is ApiFehler {
	return (
		!!wert &&
		typeof wert === 'object' &&
		typeof (wert as ApiFehler).status === 'number' &&
		typeof (wert as ApiFehler).fehler === 'string'
	);
}

/** Der Satz unter dem Formular: bei 429 mit Wartezeit, sonst der Text des Servers. */
export function fehlertext(fehler: ApiFehler): string {
	if (fehler.status === 429 && fehler.wartenSekunden !== undefined) {
		return `Zu viele Versuche – bitte in ${fehler.wartenSekunden} Sekunden erneut`;
	}
	return fehler.fehler;
}

/**
 * Was eine Ressource im Fehlerfall geworfen hat, als ApiFehler. Angular verpackt alles, was
 * kein Error ist, in einen Error mit dem Original als cause; der ApiFehler steckt dort.
 */
export function fehlerVon(ressource: { error: Signal<Error | undefined> }): Signal<ApiFehler | null> {
	return computed(() => {
		const e = ressource.error();
		if (e === undefined) return null;
		return alsApiFehler(e.cause !== undefined ? e.cause : e);
	});
}
