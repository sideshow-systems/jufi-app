import {
	betrag,
	datumBerlin,
	datumDeutsch,
	datumLang,
	monatKurz,
	relativeZeit,
	uhrzeit,
	wochentagKurz,
	zeitpunktBerlin,
} from './format';

const jetzt = new Date(2026, 9, 11, 10, 0);

describe('format', () => {
	it('formatiert Datum und Uhrzeit deutsch', () => {
		expect(uhrzeit('2026-10-17T14:00')).toBe('14:00');
		expect(wochentagKurz('2026-10-17T14:00')).toBe('Sa');
		expect(monatKurz('2026-10-17T14:00')).toBe('Okt');
		expect(datumLang('2026-10-17T14:00')).toBe('Samstag, 17. Oktober');
	});

	it('nennt Zeiten relativ zu jetzt', () => {
		expect(relativeZeit('2026-10-11T08:30', jetzt)).toBe('heute 08:30');
		expect(relativeZeit('2026-10-10T19:12', jetzt)).toBe('gestern');
		expect(relativeZeit('2026-10-07T18:00', jetzt)).toBe('Mi');
		expect(relativeZeit('2026-08-30T09:30', jetzt)).toBe('30.08.');
	});

	it('formatiert Betraege in Euro', () => {
		expect(betrag(1200)).toBe('12,00 €');
		expect(betrag(1250)).toBe('12,50 €');
	});

	it('schreibt Berliner Datum und Zeitpunkt deutsch', () => {
		expect(datumDeutsch('2026-10-13')).toBe('13.10.2026');
		// Sommerzeit: 12:05 UTC sind 14:05 in Berlin, egal in welcher Zeitzone der Test laeuft.
		expect(zeitpunktBerlin('2026-10-13T12:05:00.000Z')).toBe('13.10.2026 14:05');
		// Winterzeit, und Mitternacht ohne "24".
		expect(zeitpunktBerlin('2026-12-31T23:30:00.000Z')).toBe('01.01.2027 00:30');
	});

	it('schreibt nur das Berliner Datum, auch wenn UTC noch beim Vortag steht', () => {
		expect(datumBerlin('2026-10-12T10:00:00.000Z')).toBe('12.10.2026');
		expect(datumBerlin('2026-10-09T23:30:00.000Z')).toBe('10.10.2026');
	});
});
