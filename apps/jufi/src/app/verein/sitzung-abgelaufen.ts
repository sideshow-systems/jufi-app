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
 * Gebraucht, weil der Waechter nur beim Betreten der Huelle laeuft: Wer in der Huelle von Seite
 * zu Seite wechselt, wird nicht mehr gefragt. Verworfen: runGuardsAndResolvers 'always' an der
 * Huelle, das kostete bei jedem Wechsel ein GET /ich, obwohl die Seite ihre Daten ohnehin
 * gleich selbst holt und dabei dasselbe 401 bekommt.
 */
export async function beiAbgelaufenerSitzung(router: Router, slug: string, fehler: ApiFehler): Promise<boolean> {
	if (!istNichtAngemeldet(fehler)) return false;
	await router.navigateByUrl(`/${encodeURIComponent(slug)}/anmelden?weiter=${encodeURIComponent(router.url)}`);
	return true;
}
