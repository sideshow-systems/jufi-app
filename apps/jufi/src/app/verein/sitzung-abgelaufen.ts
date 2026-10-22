import type { Router } from '@angular/router';
import type { ApiFehler } from '../gemeinsam/api-fehler';

/** 401 mit diesem Text heisst abgelaufene Sitzung; ein falsches altes Passwort ist ebenfalls 401, aber mit anderem Text. */
const NICHT_ANGEMELDET = 'nicht angemeldet';

/** Ob die Antwort "abgelaufene Sitzung" heisst; Seiten mit mehreren Anfragen fragen das vor dem Umleiten. */
export function istNichtAngemeldet(fehler: ApiFehler): boolean {
	return fehler.status === 401 && fehler.fehler === NICHT_ANGEMELDET;
}

/**
 * Schickt eine Seite der Mitglieder zur Anmeldung, wenn die Antwort der API "nicht angemeldet"
 * sagt, und meldet, ob sie das getan hat (dann soll die Seite keinen Fehler mehr zeigen).
 * Die aufgerufene Seite geht als weiter mit, wie beim Waechter; ob sie sicher ist, prueft die
 * Anmeldeseite (sichererWeiterPfad).
 *
 * Gebraucht, weil der Waechter nur beim Betreten einer Huelle laeuft: Wer in der Huelle von Seite
 * zu Seite wechselt, wird nicht mehr gefragt. Das gilt fuer die Mitglieder-Huelle wie fuer die
 * Verwaltung, und jede Seite darunter ruft den Helfer in jedem Lade- und Aktionspfad auf, der
 * einen Fehler setzt. Verworfen: runGuardsAndResolvers 'always' an der Huelle (fuer die
 * Verwaltung wegen der einen Stelle erwogen). Das kostete bei jedem Wechsel ein GET /ich, obwohl
 * die Seite ihre Daten ohnehin gleich selbst holt und dabei dasselbe 401 bekommt, und die
 * Verwaltung verhielte sich anders als die Mitglieder-Huelle.
 */
export async function beiAbgelaufenerSitzung(router: Router, slug: string, fehler: ApiFehler): Promise<boolean> {
	if (!istNichtAngemeldet(fehler)) return false;
	await zurAnmeldung(router, slug);
	return true;
}

/**
 * Der Weg selbst, fuer Aufrufer, die das 401 nicht als ApiFehler sehen (der Upload meldet es als
 * Code, siehe hochladen.ts). Ein Weg fuer alle, damit "weiter" ueberall dieselbe Seite meint.
 */
export async function zurAnmeldung(router: Router, slug: string): Promise<void> {
	await router.navigateByUrl(`/${encodeURIComponent(slug)}/anmelden?weiter=${encodeURIComponent(router.url)}`);
}
