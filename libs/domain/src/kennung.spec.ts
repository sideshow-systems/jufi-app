import { normalisiereBenutzername, normalisiereEmail, pruefeBenutzername, pruefeEmail } from './kennung.js';

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
