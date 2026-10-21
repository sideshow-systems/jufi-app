import { fastVoll, kontingentReicht, MB, speicherText } from './kontingent.js';

describe('kontingentReicht', () => {
	it('laesst die Grenze selbst noch zu', () => {
		expect(kontingentReicht({ verbrauchBytes: MB - 10, grenzeMb: 1, zusatzBytes: 10 })).toBe(true);
		expect(kontingentReicht({ verbrauchBytes: MB - 10, grenzeMb: 1, zusatzBytes: 11 })).toBe(false);
	});

	it('rechnet ueber 2 GiB ohne Ueberlauf', () => {
		const verbrauch = 100 * 26214400;
		expect(kontingentReicht({ verbrauchBytes: verbrauch, grenzeMb: 5120, zusatzBytes: 26214400 })).toBe(true);
		expect(kontingentReicht({ verbrauchBytes: verbrauch, grenzeMb: 2500, zusatzBytes: 1 })).toBe(false);
	});
});

describe('speicherText', () => {
	it('schreibt deutsch mit Komma und einer Nachkommastelle', () => {
		expect(speicherText(0)).toBe('0 MB');
		expect(speicherText(52428800)).toBe('50,0 MB');
		expect(speicherText(1288490189)).toBe('1,2 GB');
		expect(speicherText(5 * 1024 ** 3)).toBe('5,0 GB');
	});

	it('springt nicht auf 1024,0 MB', () => {
		expect(speicherText(1024 ** 3 - 1)).toBe('1,0 GB');
	});
});

describe('fastVoll', () => {
	it('schlaegt ab genau 90 Prozent an', () => {
		expect(fastVoll(9 * MB, 10)).toBe(true);
		expect(fastVoll(9 * MB - 1, 10)).toBe(false);
		expect(fastVoll(10 * MB, 10)).toBe(true);
		expect(fastVoll(0, 5120)).toBe(false);
	});
});
