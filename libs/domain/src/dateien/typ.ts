import { MB } from './kontingent.js';

export type DateiArt = 'FOTO' | 'DATEI';

export const GRENZE_BYTES: Record<DateiArt, number> = { FOTO: 20 * MB, DATEI: 25 * MB };

// Soviel vom Anfang genuegt fuer jede Erkennung unten (laengste: 12 Bytes bei WebP und ftyp).
export const KOPF_BYTES = 16;

const MINDESTLAENGE = 12;

// Ein Fehler hat neben dem Text einen Code (Plan, Entscheidung 2): Der Client zeigt den
// Text an, Tests und Skripte pruefen den Code. KONTINGENT ist eine Funktion, weil Belegung
// und Grenze erst zur Laufzeit feststehen.
export const FEHLER_TEXT = {
	GROESSE: 'Die Datei ist zu groß (höchstens 25 MB)',
	KONTINGENT: (belegt: string, grenze: string) =>
		`Der Speicher des Vereins ist voll (${belegt} von ${grenze} belegt). Bitte wende dich an den Betreiber der Plattform.`,
	TYP: 'Diese Dateiart geht nicht. Erlaubt sind PDF, Word, Excel, PowerPoint, OpenDocument, JPEG und PNG.',
	HEIC: 'HEIC-Bilder gehen nicht. Bitte als JPEG senden.',
} as const;

// Map statt Objekt-Literal: Die Endung kommt vom Absender, und ein Literal liesse
// "constructor" oder "__proto__" als Schluessel durch.
const ZIP_TYPEN = new Map<string, string>([
	['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
	['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
	['odt', 'application/vnd.oasis.opendocument.text'],
	['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
]);

const HEIC_MARKEN = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

function beginntMit(kopf: Uint8Array, bytes: readonly number[], ab = 0): boolean {
	return bytes.every((b, i) => kopf[ab + i] === b);
}

const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

function ascii(kopf: Uint8Array, von: number, bis: number): string {
	return String.fromCharCode(...kopf.subarray(von, bis));
}

// Der Typ zaehlt nur am Inhalt, nie am Namen oder am vom Browser gemeldeten Typ: beides
// sagt der Absender, und die Auslieferung setzt den hier erkannten Typ. Die Endung
// entscheidet allein bei ZIP, weil eine Office-Datei vom Inhalt her ein ZIP ist und
// sich von einem beliebigen Archiv ohne Entpacken nicht trennen laesst; verworfen:
// Entpacken und [Content_Types].xml lesen — zu viel Aufwand und Angriffsflaeche.
// HEIC wird vor allem anderen erkannt, damit die Person den Hinweis "als JPEG senden"
// bekommt statt der allgemeinen Typmeldung.
export function erkenneTyp(
	kopf: Uint8Array,
	dateiname: string | null,
	art: DateiArt,
): { ok: true; typ: string } | { ok: false; grund: 'TYP' | 'HEIC' } {
	if (kopf.length < MINDESTLAENGE) return { ok: false, grund: 'TYP' };
	if (ascii(kopf, 4, 8) === 'ftyp' && HEIC_MARKEN.has(ascii(kopf, 8, 12))) return { ok: false, grund: 'HEIC' };
	if (beginntMit(kopf, [0xff, 0xd8, 0xff])) return { ok: true, typ: 'image/jpeg' };
	if (beginntMit(kopf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, typ: 'image/png' };
	if (art === 'FOTO') {
		if (beginntMit(kopf, text('RIFF')) && beginntMit(kopf, text('WEBP'), 8)) return { ok: true, typ: 'image/webp' };
		return { ok: false, grund: 'TYP' };
	}
	if (beginntMit(kopf, text('%PDF-'))) return { ok: true, typ: 'application/pdf' };
	if (beginntMit(kopf, [0x50, 0x4b, 0x03, 0x04]) && dateiname !== null) {
		const endung = /\.([^.]+)$/u.exec(dateiname)?.[1]?.toLowerCase();
		const typ = endung === undefined ? undefined : ZIP_TYPEN.get(endung);
		if (typ !== undefined) return { ok: true, typ };
	}
	return { ok: false, grund: 'TYP' };
}
