import { idAusSegment, threadSegment } from './pfad.js';

describe('threadSegment', () => {
	it('haengt den Titel als Slug an die ID und laesst Emojis weg', () => {
		expect(threadSegment('ck1', '🎳 Bowling')).toBe('ck1-bowling');
	});

	it('schreibt Umlaute und Eszett aus und faltet Sonderzeichen zu einem Bindestrich', () => {
		expect(threadSegment('ck1', 'Größe & Übermut!')).toBe('ck1-groesse-uebermut');
		expect(threadSegment('ck1', 'Äpfel Öl Ünd Straße')).toBe('ck1-aepfel-oel-uend-strasse');
	});

	it('liefert nur die ID, wenn vom Titel kein Slug bleibt', () => {
		expect(threadSegment('ck1', '🎳')).toBe('ck1');
		expect(threadSegment('ck1', '')).toBe('ck1');
	});

	it('kuerzt den Slug auf 40 Zeichen', () => {
		const segment = threadSegment('ck1', 'a'.repeat(120));
		expect(segment).toBe(`ck1-${'a'.repeat(40)}`);
	});

	it('endet nach dem Kuerzen nicht auf einem Bindestrich', () => {
		// Zeichen 40 ist ein Bindestrich: 39 mal a, dann Leerraum, dann weiter.
		const segment = threadSegment('ck1', `${'a'.repeat(39)} bbb`);
		expect(segment).toBe(`ck1-${'a'.repeat(39)}`);
	});
});

describe('idAusSegment', () => {
	const UUID = '3f2c9a1e-8b7d-4c6e-9f00-1234567890ab';

	it('liest eine cuid mit und ohne Titel', () => {
		expect(idAusSegment('clx9abc-bowling')).toBe('clx9abc');
		expect(idAusSegment('clx9abc')).toBe('clx9abc');
	});

	it('liest eine UUID mit und ohne Titel, obwohl sie selbst Bindestriche enthaelt', () => {
		expect(idAusSegment(`${UUID}-jugendsprecher-austausch`)).toBe(UUID);
		expect(idAusSegment(UUID)).toBe(UUID);
	});

	it('lehnt Leeres, fuehrende Bindestriche und Grossbuchstaben ab', () => {
		expect(idAusSegment('')).toBeNull();
		expect(idAusSegment('-bowling')).toBeNull();
		expect(idAusSegment('ABC')).toBeNull();
	});

	it('findet nach einer Rundreise dieselbe ID', () => {
		for (const id of ['clx9abc0001', UUID]) {
			expect(idAusSegment(threadSegment(id, 'Jugendsprecher-Austausch'))).toBe(id);
		}
	});
});
