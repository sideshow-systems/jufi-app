import type { Antwortkoerper } from './fehler.js';

// Buchstaben, Ziffern und Bindestrich decken randomUUID und cuid ab. Verworfen: jede
// Zeichenkette zulassen -- die clientId landet im Unique-Index und in Fehlerberichten, ein
// Client soll dort weder Leerraum noch Steuerzeichen ablegen koennen.
const CLIENT_ID = /^[A-Za-z0-9-]{1,100}$/;

/** Die clientId eines Koerpers, mit der ein Client das Senden wiederholbar macht; null, wenn sie fehlt oder nicht passt. */
export function liesClientId(wert: unknown): string | null {
	return typeof wert === 'string' && CLIENT_ID.test(wert) ? wert : null;
}

/** 400 mit dem Feld, an dem es lag; der Client markiert damit das Eingabefeld. */
export function ungueltigesFeld(feld: string): Antwortkoerper {
	return { fehler: 'Ungültige Anfrage', feld };
}
