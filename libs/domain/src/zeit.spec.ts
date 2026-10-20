import { berlinerTag, berlinZeitpunkt, tagPlus } from './zeit.js';

describe('berlinerTag', () => {
	it('liefert den Berliner Kalendertag, auch wenn UTC noch beim Vortag liegt', () => {
		expect(berlinerTag(new Date('2026-10-23T22:30:00Z'))).toBe('2026-10-24');
		expect(berlinerTag(new Date('2026-10-24T21:59:00Z'))).toBe('2026-10-24');
	});

	it('wechselt den Tag in der Nacht der Zeitumstellung erst um 0 Uhr Winterzeit', () => {
		expect(berlinerTag(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
		expect(berlinerTag(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
	});

	it('wechselt den Tag im Sommer schon um 22 Uhr UTC', () => {
		expect(berlinerTag(new Date('2026-07-14T21:59:00Z'))).toBe('2026-07-14');
		expect(berlinerTag(new Date('2026-07-14T22:00:00Z'))).toBe('2026-07-15');
	});
});

describe('berlinZeitpunkt', () => {
	it('rechnet Berliner Wandzeit in Sommerzeit in einen Zeitpunkt um', () => {
		expect(berlinZeitpunkt('2026-10-24', '14:00').toISOString()).toBe('2026-10-24T12:00:00.000Z');
	});

	it('rechnet Berliner Wandzeit in Winterzeit um', () => {
		expect(berlinZeitpunkt('2026-10-31', '14:00').toISOString()).toBe('2026-10-31T13:00:00.000Z');
	});

	it('nimmt ohne Uhrzeit Mitternacht Berlin', () => {
		expect(berlinZeitpunkt('2026-10-24').toISOString()).toBe('2026-10-23T22:00:00.000Z');
		expect(berlinZeitpunkt('2026-10-24', null).toISOString()).toBe('2026-10-23T22:00:00.000Z');
		expect(berlinZeitpunkt('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
	});

	it('rueckt eine Uhrzeit in der uebersprungenen Stunde um eine Stunde vor', () => {
		expect(berlinZeitpunkt('2026-03-29', '02:30').toISOString()).toBe('2026-03-29T01:30:00.000Z');
	});

	it('nimmt in der doppelten Stunde der Umstellung den fruehen Zeitpunkt (Sommerzeit)', () => {
		expect(berlinZeitpunkt('2026-10-25', '02:00').toISOString()).toBe('2026-10-25T00:00:00.000Z');
		expect(berlinZeitpunkt('2026-10-25', '02:30').toISOString()).toBe('2026-10-25T00:30:00.000Z');
		expect(berlinZeitpunkt('2026-10-25', '02:59').toISOString()).toBe('2026-10-25T00:59:00.000Z');
	});

	it('behandelt eine leere Uhrzeit wie keine', () => {
		expect(berlinZeitpunkt('2026-10-24', '').toISOString()).toBe('2026-10-23T22:00:00.000Z');
	});

	it('trifft die Stunden unmittelbar um die Umstellung', () => {
		expect(berlinZeitpunkt('2026-03-29', '01:59').toISOString()).toBe('2026-03-29T00:59:00.000Z');
		expect(berlinZeitpunkt('2026-03-29', '03:00').toISOString()).toBe('2026-03-29T01:00:00.000Z');
		expect(berlinZeitpunkt('2026-10-25', '01:59').toISOString()).toBe('2026-10-24T23:59:00.000Z');
		expect(berlinZeitpunkt('2026-10-25', '03:00').toISOString()).toBe('2026-10-25T02:00:00.000Z');
	});
});

describe('tagPlus', () => {
	it('rechnet ueber Monats- und Jahresgrenzen', () => {
		expect(tagPlus('2026-02-28', 1)).toBe('2026-03-01');
		expect(tagPlus('2026-12-31', 1)).toBe('2027-01-01');
	});

	it('rechnet rueckwaerts und ueber die Zeitumstellung', () => {
		expect(tagPlus('2026-03-01', -1)).toBe('2026-02-28');
		expect(tagPlus('2026-10-25', 1)).toBe('2026-10-26');
		expect(tagPlus('2026-10-25', 0)).toBe('2026-10-25');
	});
});
