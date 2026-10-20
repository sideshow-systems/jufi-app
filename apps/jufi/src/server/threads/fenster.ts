/**
 * Gleitendes Fenster je Schluessel: hoechstens `grenze` Ereignisse in `fensterMs`.
 * Begrenzt Nachrichten und Antworten je Person (TP3-Spec 4.4), damit ein
 * Ausrutscher des Clients oder ein boeswilliges Skript den Verlauf nicht flutet.
 *
 * Im Speicher des Prozesses, wie AttemptTracker: es gibt einen Prozess, und ein
 * Neustart setzt die Zaehler zurueck, was bei 30 Nachrichten pro Minute nichts
 * kostet. Verworfen: eine Tabelle -- jede Nachricht braeuchte einen Schreibzugriff
 * mehr, nur um etwas zu begrenzen, das nach einer Minute verfallen ist.
 *
 * Gleitend statt in festen Minuten: bei festen Fenstern gingen an der Grenze
 * doppelt so viele Ereignisse durch (30 um :59, 30 um :00).
 */
export class Fensterzaehler {
	private readonly zeiten = new Map<string, number[]>();

	constructor(
		private readonly grenze: number,
		private readonly fensterMs: number,
		private readonly jetzt: () => number,
		private readonly maxSchluessel = 10_000,
	) {}

	/**
	 * 0 = erlaubt und gezaehlt; sonst die Millisekunden, bis der aelteste Eintrag
	 * aus dem Fenster faellt und wieder ein Platz frei ist. Abgelehnte Anfragen
	 * zaehlen nicht mit: wer weiter drueckt, verlaengert seine Wartezeit nicht.
	 */
	pruefe(schluessel: string): number {
		const jetzt = this.jetzt();
		const bisher = this.aktuell(schluessel, jetzt);

		if (bisher === undefined) {
			// Fail-closed wie AttemptTracker.platzFuer: ist der Speicher auch nach dem
			// Verwerfen abgelaufener Schluessel voll, wird der neue abgelehnt, statt einen
			// fremden zu verdraengen oder ungezaehlt durchzulassen. Verworfen: den aeltesten
			// Schluessel verdraengen -- wer den Speicher mit erfundenen Schluesseln fuellt,
			// loeschte damit den Zaehler eines echten Absenders. Schluessel sind aber
			// Personen-IDs aus einer angemeldeten Sitzung, ein Angreifer kann sie nicht
			// erfinden; die Grenze ist ein Netz, kein erwarteter Fall.
			if (this.zeiten.size >= this.maxSchluessel) {
				this.verwirfAbgelaufene(jetzt);
				if (this.zeiten.size >= this.maxSchluessel) return this.fensterMs;
			}
			this.zeiten.set(schluessel, [jetzt]);
			return 0;
		}

		if (bisher.length >= this.grenze) return bisher[0] + this.fensterMs - jetzt;
		bisher.push(jetzt);
		return 0;
	}

	/** Die Zeiten innerhalb des Fensters; ein Schluessel ohne solche wird vergessen. */
	private aktuell(schluessel: string, jetzt: number): number[] | undefined {
		const zeiten = this.zeiten.get(schluessel);
		if (!zeiten) return undefined;
		const frisch = zeiten.filter((z) => jetzt - z < this.fensterMs);
		if (frisch.length === 0) {
			this.zeiten.delete(schluessel);
			return undefined;
		}
		// Immer das gespeicherte Feld zurueckgeben: pruefe haengt den neuen Zeitpunkt daran,
		// an einer Kopie ginge er verloren und nichts wuerde gezaehlt.
		if (frisch.length !== zeiten.length) this.zeiten.set(schluessel, frisch);
		return this.zeiten.get(schluessel);
	}

	private verwirfAbgelaufene(jetzt: number): void {
		// Loeschen waehrend der Iteration einer Map ist in JavaScript erlaubt.
		for (const schluessel of this.zeiten.keys()) this.aktuell(schluessel, jetzt);
	}
}
