import type { DateiArt } from './typ.js';

// Ein Fehler hat neben dem Text einen Code (Plan, Entscheidung 2): Der Client zeigt den
// Text an, Tests und Skripte pruefen den Code. PIXEL hat keinen eigenen Code, sondern
// meldet sich als GROESSE: fuer Helfer und Autos ist ein zu grosses Bild ein zu grosses Bild.
export type DateiFehlerCode = 'GROESSE' | 'KONTINGENT' | 'TYP' | 'HEIC' | 'BESCHAEFTIGT' | 'VOLL';

// GROESSE, TYP und VOLL je Art, weil "Die Datei ist zu gross" unter einem Foto falsch
// klaenge; verworfen: ein Text mit Platzhalter fuer das Wort, weil die Saetze sich im
// Genus ("die Datei", "das Foto") und in den Grenzen unterscheiden. KONTINGENT ist eine
// Funktion, weil Belegung und Grenze erst zur Laufzeit feststehen.
export const FEHLER_TEXT = {
	GROESSE: {
		DATEI: 'Die Datei ist zu groß (höchstens 25 MB)',
		FOTO: 'Das Foto ist zu groß (höchstens 20 MB)',
	} satisfies Record<DateiArt, string>,
	PIXEL: 'Das Foto hat zu viele Pixel (höchstens 50 Megapixel)',
	KONTINGENT: (belegt: string, grenze: string) =>
		`Der Speicher des Vereins ist voll (${belegt} von ${grenze} belegt). Bitte wende dich an den Betreiber der Plattform.`,
	TYP: {
		DATEI: 'Diese Dateiart geht nicht. Erlaubt sind PDF, Word, Excel, PowerPoint, OpenDocument, JPEG und PNG.',
		FOTO: 'Diese Bildart geht nicht. Erlaubt sind JPEG, PNG und WebP.',
	} satisfies Record<DateiArt, string>,
	HEIC: 'HEIC-Bilder gehen nicht. Bitte als JPEG senden.',
	BESCHAEFTIGT: 'Gerade werden viele Fotos verarbeitet. Bitte gleich noch einmal versuchen.',
	VOLL: {
		DATEI: 'Hier passen höchstens 20 Dateien hinein',
		FOTO: 'Hier passen höchstens 500 Fotos hinein',
	} satisfies Record<DateiArt, string>,
} as const;
