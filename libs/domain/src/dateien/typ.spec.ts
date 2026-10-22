import { erkenneTyp, GRENZE_BYTES, KOPF_BYTES } from './typ.js';

// Ein Kopf aus Bytes und Text, aufgefuellt auf KOPF_BYTES, damit die Mindestlaenge nie
// der Grund fuer ein Ergebnis ist, das der Test gar nicht pruefen will.
function kopf(...teile: (number[] | string)[]): Uint8Array {
	const bytes = teile.flatMap((t) => (typeof t === 'string' ? Array.from(t, (c) => c.charCodeAt(0)) : t));
	const ergebnis = new Uint8Array(Math.max(KOPF_BYTES, bytes.length));
	ergebnis.set(bytes);
	return ergebnis;
}

const JPEG = kopf([0xff, 0xd8, 0xff, 0xe0]);
const PNG = kopf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = kopf('RIFF', [1, 2, 3, 4], 'WEBP');
const PDF = kopf('%PDF-1.7');
const ZIP = kopf([0x50, 0x4b, 0x03, 0x04]);
const ftyp = (marke: string) => kopf([0, 0, 0, 24], 'ftyp', marke);

describe('Grenzen', () => {
	it('kennt die Grenzen je Art', () => {
		expect(GRENZE_BYTES).toEqual({ FOTO: 20 * 1024 * 1024, DATEI: 25 * 1024 * 1024 });
		expect(KOPF_BYTES).toBe(16);
	});
});

describe('erkenneTyp', () => {
	it('erkennt JPEG und PNG als Foto und als Datei', () => {
		for (const art of ['FOTO', 'DATEI'] as const) {
			expect(erkenneTyp(JPEG, null, art)).toEqual({ ok: true, typ: 'image/jpeg' });
			expect(erkenneTyp(PNG, null, art)).toEqual({ ok: true, typ: 'image/png' });
		}
	});

	it('erkennt WebP nur als Foto', () => {
		expect(erkenneTyp(WEBP, null, 'FOTO')).toEqual({ ok: true, typ: 'image/webp' });
		expect(erkenneTyp(WEBP, null, 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
	});

	it('erkennt PDF nur als Datei', () => {
		expect(erkenneTyp(PDF, 'a.pdf', 'DATEI')).toEqual({ ok: true, typ: 'application/pdf' });
		expect(erkenneTyp(PDF, 'a.pdf', 'FOTO')).toEqual({ ok: false, grund: 'TYP' });
	});

	it('erkennt Office- und OpenDocument-Dateien am ZIP-Kopf und der Endung', () => {
		const erwartet: Record<string, string> = {
			'a.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'a.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'a.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			'a.odt': 'application/vnd.oasis.opendocument.text',
			'a.ods': 'application/vnd.oasis.opendocument.spreadsheet',
		};
		for (const [name, typ] of Object.entries(erwartet)) {
			expect(erkenneTyp(ZIP, name, 'DATEI')).toEqual({ ok: true, typ });
		}
	});

	it('nimmt die Endung ohne Rücksicht auf Groß- und Kleinschreibung', () => {
		expect(erkenneTyp(ZIP, 'PLAN.DOCX', 'DATEI')).toEqual({
			ok: true,
			typ: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		});
	});

	it('lehnt ZIP mit anderer Endung, ohne Namen oder als Foto ab', () => {
		expect(erkenneTyp(ZIP, 'archiv.zip', 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(ZIP, null, 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(ZIP, 'a.docx', 'FOTO')).toEqual({ ok: false, grund: 'TYP' });
	});

	it('haelt Prototyp-Schluessel nicht fuer erlaubte Endungen', () => {
		expect(erkenneTyp(ZIP, 'a.constructor', 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(ZIP, 'a.__proto__', 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
	});

	it('meldet HEIC-Marken fuer Foto und Datei eigens', () => {
		for (const marke of ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']) {
			expect(erkenneTyp(ftyp(marke), 'a.heic', 'FOTO')).toEqual({ ok: false, grund: 'HEIC' });
			expect(erkenneTyp(ftyp(marke), 'a.heic', 'DATEI')).toEqual({ ok: false, grund: 'HEIC' });
		}
	});

	it('lehnt AVIF, SVG, GIF und zu kurze Koepfe ab', () => {
		expect(erkenneTyp(ftyp('avif'), 'a.avif', 'FOTO')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(kopf('<svg xmlns='), 'a.svg', 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(kopf('GIF89a'), 'a.gif', 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]), null, 'FOTO')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(new Uint8Array(0), null, 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
	});

	it('nimmt den Typ nur aus dem Inhalt, nie aus der Endung', () => {
		expect(erkenneTyp(kopf('MZ'), 'virus.pdf', 'DATEI')).toEqual({ ok: false, grund: 'TYP' });
		expect(erkenneTyp(JPEG, 'foto.pdf', 'DATEI')).toEqual({ ok: true, typ: 'image/jpeg' });
	});
});
