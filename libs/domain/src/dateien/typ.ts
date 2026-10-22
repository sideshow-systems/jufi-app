import { MB } from './kontingent.js';

export type DateiArt = 'FOTO' | 'DATEI';

export const GRENZE_BYTES: Record<DateiArt, number> = { FOTO: 20 * MB, DATEI: 25 * MB };

// Je Modul, nicht je Verein: Die Grenze haelt eine Seite lesbar und eine Wiederherstellung
// uebersichtlich; der Speicher des Vereins ist durch sein Kontingent begrenzt.
export const GRENZE_ANZAHL: Record<DateiArt, number> = { DATEI: 20, FOTO: 500 };

// Pixel, nicht Bytes: Ein stark komprimiertes PNG bleibt weit unter 20 MB und wird beim
// Dekodieren trotzdem zu hunderten MB Rohdaten (Dekompressionsbombe).
export const FOTO_MAX_PIXEL = 50_000_000;

// Soviel vom Anfang genuegt fuer jede Erkennung unten (laengste: 12 Bytes bei WebP und ftyp).
export const KOPF_BYTES = 16;

const MINDESTLAENGE = 12;

// Map statt Objekt-Literal: Die Endung kommt vom Absender, und ein Literal liesse
// "constructor" oder "__proto__" als Schluessel durch.
const ZIP_TYPEN = new Map<string, string>([
	['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
	['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
	['odt', 'application/vnd.oasis.opendocument.text'],
	['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
]);

// Die Endungen, die zu einem erkannten Typ passen (passendeEndung in name.ts). Die erste
// ist die, die angehaengt wird. JPEG hat zwei, weil beide ueblich sind und eine Person
// "Foto.jpeg" nicht zu "Foto.jpg" umbenannt haben will.
export const ENDUNGEN: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
	['image/jpeg', ['jpg', 'jpeg']],
	['image/png', ['png']],
	['image/webp', ['webp']],
	['application/pdf', ['pdf']],
	...Array.from(ZIP_TYPEN, ([endung, typ]): [string, readonly string[]] => [typ, [endung]]),
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
