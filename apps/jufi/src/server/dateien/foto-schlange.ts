/**
 * Reihe fuer die Fotoverarbeitung (TP4 Etappe 2, Entscheidung 16).
 *
 * Eine Arbeit laeuft, bis zu `wartend` weitere warten, jede darueber hinaus
 * lehnt `reihe` ab. Der Container hat 256 MiB und dekodiert ein grosses Foto mit
 * mehreren Hundert MB Spitze; zwei gleichzeitig liessen den Kernel den Prozess
 * beenden. Verworfen: eine unbegrenzte Reihe, denn wartende Uploads
 * halten ihre Verbindung und ihre Temp-Datei; wer mehr schickt, als die Reihe
 * fasst, soll es nach Antwort 503 spaeter noch einmal versuchen.
 */
export class FotoSchlange {
	/** Laufende plus wartende Arbeiten. */
	private offen = 0;
	/** Ende der letzten angenommenen Arbeit; wer sich anstellt, haengt sich daran. */
	private ende: Promise<unknown> = Promise.resolve();

	constructor(private readonly wartend = 8) {}

	voll(): boolean {
		return this.offen >= 1 + this.wartend;
	}

	/** `null` heisst voll: die Arbeit wird nicht gestartet und nicht gemerkt. */
	reihe<T>(arbeit: () => Promise<T>): Promise<T> | null {
		if (this.voll()) return null;
		this.offen++;
		const lauf = this.ende.then(arbeit);
		// Eine abgelehnte Arbeit gehoert ihrem Aufrufer; die Reihe laeuft ueber eine
		// Kette weiter, die nie ablehnt, sonst bliebe sie nach dem ersten Fehler stehen.
		this.ende = lauf.then(
			() => this.fertig(),
			() => this.fertig(),
		);
		return lauf;
	}

	private fertig(): void {
		this.offen--;
	}
}
