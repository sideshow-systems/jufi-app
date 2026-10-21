export type TeilenErgebnis = 'GETEILT' | 'KOPIERT' | 'ABGEBROCHEN' | 'FEHLER';

/**
 * Teilt den Text am Handy ueber das Teilen-Blatt, sonst kopiert er ihn (Entscheidung 3).
 * Verworfen: immer navigator.share, wenn es vorhanden ist; Chrome unter Windows oeffnet dann
 * den Systemdialog, obwohl die Person am Rechner "Kopieren" erwartet (Spec 7.1). Der grobe
 * Zeiger trennt Handy und Rechner, ohne den Geraetetyp zu raten.
 *
 * Schliesst die Person das Blatt (AbortError), ist das kein Fehler und es wird nicht
 * kopiert; sie hat sich entschieden. Scheitert das Teilen anders, faellt es auf Kopieren
 * zurueck. Der Aufruf muss direkt im Klick stehen: Safari verlangt share innerhalb der
 * Nutzergeste.
 */
export async function teile(text: string, fenster: Window): Promise<TeilenErgebnis> {
	// Das ?. ist fuer jsdom, das matchMedia nicht kennt (die Seitentests laufen darin); dort gilt der feine Zeiger.
	const grob = fenster.matchMedia?.('(pointer: coarse)').matches ?? false;
	if (grob && typeof fenster.navigator.share === 'function') {
		try {
			await fenster.navigator.share({ text });
			return 'GETEILT';
		} catch (ursache) {
			// Am Namen erkennen, nicht mit instanceof DOMException: Das Blatt kann aus einem anderen Realm oder von einem Polyfill einen schlichten Error mit diesem Namen werfen.
			if ((ursache as { name?: unknown } | null)?.name === 'AbortError') return 'ABGEBROCHEN';
		}
	}
	try {
		await fenster.navigator.clipboard.writeText(text);
		return 'KOPIERT';
	} catch {
		// Ohne Zwischenablage (unsicherer Kontext, verweigert) bleibt das Textfeld zum Markieren.
		return 'FEHLER';
	}
}
