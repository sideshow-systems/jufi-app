import {
	DEMO_SLUG,
	initialen,
	KONTAKT_MAX,
	normalisiereFarbe,
	pruefeAnzeigename,
	pruefeFarbe,
	pruefeKontakt,
	pruefeNeuenSlug,
	pruefeVereinsname,
	SLUG_HINWEIS,
	slugVorschlag,
} from './verein.js';
import { pruefeSlug } from './slug.js';

describe('pruefeNeuenSlug', () => {
	it('sperrt den Demo-Slug fuer neue Vereine', () => {
		expect(DEMO_SLUG).toBe('demo');
		expect(pruefeNeuenSlug('demo')).toEqual({ ok: false, grund: 'reserviert' });
	});

	it('nimmt einen gewoehnlichen Slug an', () => {
		expect(pruefeNeuenSlug('glonntal')).toEqual({ ok: true });
	});

	it('gibt die Gruende von pruefeSlug unveraendert weiter', () => {
		expect(pruefeNeuenSlug('admin')).toEqual({ ok: false, grund: 'reserviert' });
		expect(pruefeNeuenSlug('Glonntal')).toEqual({ ok: false, grund: 'format' });
		expect(pruefeNeuenSlug('ab')).toEqual({ ok: false, grund: 'laenge' });
	});

	it('laesst pruefeSlug den Demo-Slug weiter annehmen', () => {
		expect(pruefeSlug('demo')).toEqual({ ok: true });
	});

	it('hat zu jedem Grund einen Hinweis', () => {
		expect(SLUG_HINWEIS).toEqual({
			format: 'Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche',
			laenge: '3 bis 30 Zeichen',
			reserviert: 'Dieser Slug ist reserviert',
		});
	});
});

describe('slugVorschlag', () => {
	it.each([
		['Jungfischer Glonntal', 'jungfischer-glonntal'],
		['Jungfischer Über-Österreich!', 'jungfischer-ueber-oesterreich'],
		['Straße & Söhne', 'strasse-soehne'],
		['Café Élan', 'cafe-elan'],
		['  --Fischer--  ', 'fischer'],
	])('macht aus %j den Slug %j', (name, erwartet) => {
		expect(slugVorschlag(name)).toBe(erwartet);
	});

	it.each(['ab', 'Admin', 'Demo', '', '!!!'])('liefert fuer %j nichts', (name) => {
		expect(slugVorschlag(name)).toBe('');
	});

	it('kuerzt auf 30 Zeichen und endet nicht auf einem Bindestrich', () => {
		// Langer Name: Der Schnitt bei 30 darf keinen Slug mit Bindestrich am Ende hinterlassen.
		const lang = slugVorschlag('Fischereiverein Glonntal Petershausen und Umgebung');
		expect(lang.length).toBeLessThanOrEqual(30);
		expect(lang.endsWith('-')).toBe(false);
		expect(pruefeNeuenSlug(lang)).toEqual({ ok: true });

		// Bindestrich genau an Position 30: Er muss nach dem Kuerzen entfallen.
		const anGrenze = slugVorschlag('a'.repeat(29) + ' bbbbbbbbbb');
		expect(anGrenze).toBe('a'.repeat(29));
	});
});

describe('Farbe', () => {
	it('nimmt sechsstellige Kleinbuchstaben-Hexwerte mit Raute an', () => {
		expect(pruefeFarbe('#0f766e')).toBe(true);
	});

	it.each(['#0F766E', '0f766e', '#0f766', '#0f766e0', '#gggggg'])('lehnt %j ab', (s) => {
		expect(pruefeFarbe(s)).toBe(false);
	});

	it('normalisiert zu getrimmt und klein', () => {
		expect(normalisiereFarbe(' #0F766E ')).toBe('#0f766e');
	});
});

describe('Namen', () => {
	it('Anzeigename: 1 bis 24 Code-Points nach dem Trimmen', () => {
		expect(pruefeAnzeigename('Jungfischer Glonntal')).toBe(true);
		expect(pruefeAnzeigename('a'.repeat(24))).toBe(true);
		expect(pruefeAnzeigename('🐟'.repeat(24))).toBe(true);
		expect(pruefeAnzeigename('')).toBe(false);
		expect(pruefeAnzeigename('   ')).toBe(false);
		expect(pruefeAnzeigename('a'.repeat(25))).toBe(false);
	});

	it('Vereinsname: 1 bis 120 Code-Points nach dem Trimmen', () => {
		expect(pruefeVereinsname('Glonntal Fischereiverein 1889 e.V. Petershausen')).toBe(true);
		expect(pruefeVereinsname('a'.repeat(120))).toBe(true);
		expect(pruefeVereinsname('a'.repeat(121))).toBe(false);
		expect(pruefeVereinsname('  ')).toBe(false);
	});
});

describe('initialen', () => {
	it.each([
		['Jungfischer Glonntal', 'JG'],
		['jungfischer demo', 'JD'],
		['Ötztaler Fischer', 'ÖF'],
		['Petershausen', 'P'],
		['Fischer-Jugend Nord', 'FJ'],
		['  ', '?'],
		['1889 Verein', '1V'],
	])('macht aus %j die Initialen %j', (name, erwartet) => {
		expect(initialen(name)).toBe(erwartet);
	});

	it('nimmt ein ganzes Graphem statt eines halben Code-Points', () => {
		expect(initialen('🐟 Fischer')).toBe('🐟F');
		expect(initialen('e\u0301cole Nord')).toBe('E\u0301N');
	});

	it('liefert fuer einen Namen aus lauter Trennern ein Fragezeichen', () => {
		expect(initialen('- -')).toBe('?');
	});
});

describe('Kontakt', () => {
	it('erlaubt leer und bis zu 500 Zeichen', () => {
		expect(KONTAKT_MAX).toBe(500);
		expect(pruefeKontakt('')).toBe(true);
		expect(pruefeKontakt('   ')).toBe(true);
		expect(pruefeKontakt('a'.repeat(500))).toBe(true);
		expect(pruefeKontakt('a'.repeat(501))).toBe(false);
	});

	it('zaehlt nach dem Trimmen und in Code-Points', () => {
		expect(pruefeKontakt(' ' + 'a'.repeat(500) + ' ')).toBe(true);
		expect(pruefeKontakt('🐟'.repeat(500))).toBe(true);
	});
});
