/**
 * Erwartete Verweigerung eines Befehls (unbekannter Admin, falsche Bestaetigung,
 * geschuetzter Demo-Verein). fuehreAus gibt die Meldung aus und liefert Exit-Code 1.
 * Eigene Klasse statt Pruefung auf den Text, damit ein Datenbankfehler nie als
 * freundliche Meldung durchgeht: Der faellt durch bis starte() und landet auf stderr.
 */
export class CliFehler extends Error {
	constructor(meldung: string) {
		super(meldung);
		this.name = 'CliFehler';
	}
}
