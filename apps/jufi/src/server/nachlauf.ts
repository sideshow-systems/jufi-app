/**
 * Arbeit, die eine Route erst nach ihrer Antwort erledigt. Gebraucht fuer
 * "Passwort vergessen?": Die Antwort darf weder in Inhalt noch in Dauer davon
 * abhaengen, ob es die Adresse gibt (Spec 3.4/4.4). Verworfen: erst suchen und
 * schreiben, dann antworten -- die Antwortzeit verriete jede bekannte Adresse.
 * Verworfen auch: die Arbeit einfach ohne await laufen lassen -- ein Fehler
 * waere eine unbehandelte Ablehnung, die Node beendet, und beim Herunterfahren
 * brache die Arbeit mitten in der Transaktion ab.
 */
export class Nachlauf {
	private readonly laufend = new Set<Promise<void>>();

	/**
	 * Startet die Arbeit, ohne auf sie zu warten. Jeder Fehler endet hier, auch
	 * ein synchroner Wurf (darum ueber Promise.resolve().then). Geloggt wird nur
	 * ein fester Satz: error.message kann Adressen oder SMTP-Antworten mit
	 * Adressen enthalten, und wer das Log liest, soll daraus nicht erfahren,
	 * welche Adresse jemand angefragt hat.
	 */
	starte(arbeit: () => Promise<void>): void {
		const lauf: Promise<void> = Promise.resolve()
			.then(arbeit)
			.catch(() => {
				console.error('Nachlauf fehlgeschlagen');
			})
			.finally(() => {
				this.laufend.delete(lauf);
			});
		this.laufend.add(lauf);
	}

	/**
	 * Wartet, bis keine Arbeit mehr laeuft, auch auf solche, die waehrend des
	 * Wartens dazukommt (daher die Schleife statt eines einzigen Promise.all).
	 * Fuer das Herunterfahren (server.ts) und fuer Tests, die das Ergebnis der
	 * Arbeit pruefen.
	 */
	async warteAufAlle(): Promise<void> {
		while (this.laufend.size > 0) {
			await Promise.all(this.laufend);
		}
	}
}
