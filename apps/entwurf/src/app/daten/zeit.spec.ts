import { bezugstagHeute, jetzt, naechsterWochentag, relativ } from './zeit';

describe('zeit', () => {
	it('friert das Datum auf den Bezugstag ein und nimmt die echte Uhrzeit', () => {
		const j = jetzt('2026-10-11', new Date(2026, 10, 30, 15, 20));
		expect([j.getFullYear(), j.getMonth(), j.getDate(), j.getHours(), j.getMinutes()]).toEqual([2026, 9, 11, 15, 20]);
	});

	it('liefert den lokalen Kalendertag als Bezugstag', () => {
		expect(bezugstagHeute(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-11');
	});

	it('zaehlt die Tage bis zum naechsten Wochentag, nie 0', () => {
		expect(naechsterWochentag('2026-10-11', 6)).toBe(6);
		expect(naechsterWochentag('2026-10-10', 6)).toBe(7);
	});

	it('rechnet relative Zeitpunkte ueber Monatsgrenzen', () => {
		expect(relativ('2026-10-11', 21, '15:00')).toBe('2026-11-01T15:00');
		expect(relativ('2026-10-11', -42, '09:30')).toBe('2026-08-30T09:30');
	});
});
