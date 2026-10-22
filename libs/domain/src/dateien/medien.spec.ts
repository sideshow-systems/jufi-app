import { medienZahlText, undListe } from './medien.js';

describe('undListe', () => {
	it('verbindet null bis drei Teile', () => {
		expect(undListe([])).toBe('');
		expect(undListe(['A'])).toBe('A');
		expect(undListe(['A', 'B'])).toBe('A und B');
		expect(undListe(['A', 'B', 'C'])).toBe('A, B und C');
	});
});

describe('medienZahlText', () => {
	it('nennt Fotos mit Personen', () => {
		expect(medienZahlText({ fotos: 3, dateien: 0, personen: 2 })).toBe('3 Fotos von 2 Personen');
		expect(medienZahlText({ fotos: 1, dateien: 0, personen: 1 })).toBe('1 Foto von 1 Person');
	});

	it('haengt Dateien an', () => {
		expect(medienZahlText({ fotos: 3, dateien: 2, personen: 2 })).toBe('3 Fotos von 2 Personen und 2 Dateien');
		expect(medienZahlText({ fotos: 1, dateien: 1, personen: 1 })).toBe('1 Foto von 1 Person und 1 Datei');
	});

	it('nennt nur Dateien ohne Personen', () => {
		expect(medienZahlText({ fotos: 0, dateien: 2, personen: 0 })).toBe('2 Dateien');
		expect(medienZahlText({ fotos: 0, dateien: 1, personen: 0 })).toBe('1 Datei');
	});

	it('ist null, wenn nichts da ist', () => {
		expect(medienZahlText({ fotos: 0, dateien: 0, personen: 0 })).toBeNull();
	});
});
