import {
	anmeldenameVorschlag,
	normalisiereBenutzername,
	normalisiereEmail,
	pruefeAnmeldename,
	pruefeBenutzername,
	pruefeEmail,
	pruefeKennung,
} from './kennung.js';

describe('Benutzername', () => {
	it('normalisiert zu getrimmt und klein', () => {
		expect(normalisiereBenutzername('  Florian ')).toBe('florian');
	});

	it.each(['florian', 'f.binder', 'admin_2', 'abc', 'a'.repeat(30)])('nimmt %s an', (s) => {
		expect(pruefeBenutzername(s)).toBe(true);
	});

	it.each(['fb', '-florian', 'flo rian', 'Florian', 'a'.repeat(31), ''])('lehnt %j ab', (s) => {
		expect(pruefeBenutzername(s)).toBe(false);
	});
});

describe('E-Mail', () => {
	it('normalisiert zu getrimmt und klein', () => {
		expect(normalisiereEmail('  Thomas@Example.ORG ')).toBe('thomas@example.org');
	});

	it('nimmt eine gueltige Adresse an', () => {
		expect(pruefeEmail('thomas@example.org')).toBe(true);
	});

	it('nimmt genau 254 Zeichen an, lehnt 255 ab', () => {
		const lang = (n: number) => 'a'.repeat(n - '@example.org'.length) + '@example.org';
		expect(pruefeEmail(lang(254))).toBe(true);
		expect(pruefeEmail(lang(255))).toBe(false);
	});

	it.each(['thomas', 'thomas@example', 'a b@example.org', '@example.org', ''])('lehnt %j ab', (s) => {
		expect(pruefeEmail(s)).toBe(false);
	});
});

describe('Anmeldename', () => {
	it('Vorschlag nimmt den Vornamen', () => {
		expect(anmeldenameVorschlag('Lena', new Set())).toBe('lena');
	});

	it('Vorschlag zaehlt hoch, wenn vergeben', () => {
		expect(anmeldenameVorschlag('Lena', new Set(['lena']))).toBe('lena2');
		expect(anmeldenameVorschlag('Lena', new Set(['lena', 'lena2']))).toBe('lena3');
	});

	it('Vorschlag schreibt Umlaute um', () => {
		expect(anmeldenameVorschlag('Jörg', new Set())).toBe('joerg');
		expect(anmeldenameVorschlag('Zoë', new Set())).toBe('zoe');
		expect(anmeldenameVorschlag('Strauß', new Set())).toBe('strauss');
	});

	it('Vorschlag fuellt zu kurze Namen auf', () => {
		expect(anmeldenameVorschlag('Jo', new Set())).toBe('jo1');
	});

	it('Anmeldename: Gross, Rand, @ und Kuerze', () => {
		expect(pruefeAnmeldename('Lena')).toBe(false);
		expect(pruefeAnmeldename('le')).toBe(false);
		expect(pruefeAnmeldename('a@b.de')).toBe(false);
		expect(pruefeAnmeldename('lena.k-2')).toBe(true);
	});
});

describe('Kennung', () => {
	it('Kennung Erwachsener ist die normalisierte E-Mail', () => {
		expect(pruefeKennung('ERWACHSENER', '  Thomas@Example.ORG ')).toEqual({ ok: true, wert: 'thomas@example.org' });
		expect(pruefeKennung('ERWACHSENER', 'thomas')).toEqual({ ok: false, grund: 'ungueltig' });
	});

	it('Kennung Jungfischer ist der normalisierte Anmeldename', () => {
		expect(pruefeKennung('JUNGFISCHER', '  Lena ')).toEqual({ ok: true, wert: 'lena' });
		expect(pruefeKennung('JUNGFISCHER', 'lena@x.de')).toEqual({ ok: false, grund: 'ungueltig' });
	});
});
