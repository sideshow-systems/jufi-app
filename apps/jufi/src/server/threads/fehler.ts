import type { Response } from 'express';

/** Der JSON-Koerper jeder Fehlerantwort der Thread-Routen; `code` und `feld` sind fuer den Client, `fehler` fuer Menschen. */
export interface Antwortkoerper {
	fehler: string;
	code?: string;
	feld?: string;
}

/**
 * Eine Antwort fuer "unsichtbar", "unbekannt" und "nicht gefragt" (Rahmen-Spec 8): Jede
 * Abweichung im Text verriete, dass es das Objekt gibt. Dieselbe Konstante an allen
 * Stellen, damit die Antworten byte-gleich bleiben.
 */
export const NICHT_GEFUNDEN: Antwortkoerper = { fehler: 'nicht gefunden' };
export const ENTWURF: Antwortkoerper = { fehler: 'Der Thread ist noch ein Entwurf', code: 'ENTWURF' };
export const NUR_AUSHANG: Antwortkoerper = { fehler: 'In diesem Thread kann niemand schreiben', code: 'NUR_AUSHANG' };
export const ARCHIVIERT: Antwortkoerper = { fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' };
export const FRIST_ABGELAUFEN: Antwortkoerper = { fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' };
/** Bewusst nichtssagend: Wem die clientId gehoert, darf der Anfragende nicht erfahren. */
export const CLIENT_ID_VERGEBEN: Antwortkoerper = { fehler: 'Ungültige Anfrage', code: 'CLIENT_ID_VERGEBEN' };

/**
 * Ende einer Entscheidung innerhalb der Transaktion, geworfen statt zurueckgegeben:
 * Sie rollt die Transaktion mit zurueck, und mit ihr den Aenderungsstand, den
 * mitAenderung schon vergeben hat. Ein Abbruch verbraucht so keinen Stand.
 */
export class ThreadAbbruch extends Error {
	constructor(
		readonly status: number,
		readonly antwort: Antwortkoerper,
	) {
		super('Thread abgebrochen');
	}
}

/**
 * Ende einer Wiederholung (gleiche clientId, gleicher Absender): Die Arbeit in
 * mitAenderung wirft sie, damit auch der gerade vergebene Stand zurueckgerollt wird;
 * die Route liefert das vorhandene Ergebnis. Verworfen: die clientId nur vor der
 * Transaktion suchen -- zwei gleichzeitige Anfragen liefen beide an der Suche vorbei.
 *
 * DELETE /verlauf/:eintragId nutzt sie ohne clientId: Findet das Loeschen unter der
 * Sperre nichts mehr, war ein gleichzeitiges Loeschen schneller; die Wiederholung rollt
 * den Stand zurueck, und die Route antwortet trotzdem 204 (vorhanden ist dann null).
 */
export class Wiederholung<T> extends Error {
	constructor(readonly vorhanden: T) {
		super('Wiederholte Anfrage');
	}
}

/**
 * Bildet einen Fehler aus der Transaktion auf die Antwort ab; alles andere wirft
 * weiter und landet in der Fehlerbehandlung.
 *
 * P2003 (Fremdschluessel) und P2025 (Zeile fehlt): Ein Objekt verschwand zwischen
 * Pruefung und Schreiben -- nur ueber einen Weg an den Sperren vorbei moeglich. Fuer
 * den Aufrufer ist es dann schlicht nicht mehr da, also 404 und nicht 500.
 */
export function antworteThreadFehler(res: Response, error: unknown): void {
	if (error instanceof ThreadAbbruch) return void res.status(error.status).json(error.antwort);
	const code = (error as { code?: unknown } | null)?.code;
	if (code === 'P2003' || code === 'P2025') return void res.status(404).json(NICHT_GEFUNDEN);
	throw error;
}
