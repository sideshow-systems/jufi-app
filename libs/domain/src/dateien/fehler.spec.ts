import { FEHLER_TEXT } from './fehler.js';
import { FOTO_MAX_PIXEL, GRENZE_ANZAHL } from './typ.js';

describe('FEHLER_TEXT', () => {
	it('hat die woertlichen Texte je Art', () => {
		expect(FEHLER_TEXT.GROESSE.DATEI).toBe('Die Datei ist zu groß (höchstens 25 MB)');
		expect(FEHLER_TEXT.GROESSE.FOTO).toBe('Das Foto ist zu groß (höchstens 20 MB)');
		expect(FEHLER_TEXT.PIXEL).toBe('Das Foto hat zu viele Pixel (höchstens 50 Megapixel)');
		expect(FEHLER_TEXT.KONTINGENT('4,9 GB', '5,0 GB')).toBe(
			'Der Speicher des Vereins ist voll (4,9 GB von 5,0 GB belegt). Bitte wende dich an den Betreiber der Plattform.',
		);
		expect(FEHLER_TEXT.TYP.DATEI).toBe(
			'Diese Dateiart geht nicht. Erlaubt sind PDF, Word, Excel, PowerPoint, OpenDocument, JPEG und PNG.',
		);
		expect(FEHLER_TEXT.TYP.FOTO).toBe('Diese Bildart geht nicht. Erlaubt sind JPEG, PNG und WebP.');
		expect(FEHLER_TEXT.HEIC).toBe('HEIC-Bilder gehen nicht. Bitte als JPEG senden.');
		expect(FEHLER_TEXT.BESCHAEFTIGT).toBe('Gerade werden viele Fotos verarbeitet. Bitte gleich noch einmal versuchen.');
		expect(FEHLER_TEXT.VOLL.DATEI).toBe('Hier passen höchstens 20 Dateien hinein');
		expect(FEHLER_TEXT.VOLL.FOTO).toBe('Hier passen höchstens 500 Fotos hinein');
	});
});

describe('Grenzen', () => {
	it('stimmen mit den Texten ueberein', () => {
		expect(GRENZE_ANZAHL).toEqual({ DATEI: 20, FOTO: 500 });
		expect(FOTO_MAX_PIXEL).toBe(50_000_000);
	});
});
