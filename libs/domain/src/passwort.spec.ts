import { HAEUFIGE_PASSWOERTER } from './haeufige-passwoerter.js';
import { PASSWORT_HINWEIS, PASSWORT_MIN, pruefePasswort } from './passwort.js';

describe('pruefePasswort', () => {
	it('verlangt mindestens 10 Zeichen', () => {
		expect(PASSWORT_MIN).toBe(10);
		expect(pruefePasswort('abc')).toEqual({ ok: false, grund: 'zu-kurz' });
		expect(pruefePasswort('123456789')).toEqual({ ok: false, grund: 'zu-kurz' });
	});

	it('lehnt ein verbreitetes Passwort ab', () => {
		expect(pruefePasswort('1234567890')).toEqual({ ok: false, grund: 'zu-haeufig' });
	});

	it('ignoriert Gross- und Kleinschreibung bei der Sperrliste', () => {
		expect(pruefePasswort('Passwort123')).toEqual({ ok: false, grund: 'zu-haeufig' });
	});

	it('lehnt ein einzelnes wiederholtes Zeichen ab', () => {
		expect(pruefePasswort('aaaaaaaaaaaa')).toEqual({ ok: false, grund: 'zu-haeufig' });
	});

	it('nimmt eine ungewoehnliche Passphrase an', () => {
		expect(pruefePasswort('Forelle am Glonnbach')).toEqual({ ok: true });
	});

	it('zaehlt Code-Points, nicht UTF-16-Einheiten', () => {
		// Fuenf Fische sind zehn UTF-16-Einheiten, aber nur fuenf Zeichen; mit "abcde" genau 10.
		expect(pruefePasswort('🐟🐟🐟🐟🐟abcde')).toEqual({ ok: true });
		expect(pruefePasswort('🐟🐟🐟🐟🐟')).toEqual({ ok: false, grund: 'zu-kurz' });
	});

	it('hat zu jedem Grund einen Hinweis', () => {
		expect(PASSWORT_HINWEIS).toEqual({
			'zu-kurz': 'Mindestens 10 Zeichen',
			'zu-haeufig': 'Dieses Passwort ist zu verbreitet',
		});
	});
});

describe('HAEUFIGE_PASSWOERTER', () => {
	it('enthaelt mindestens 100 Eintraege', () => {
		expect(HAEUFIGE_PASSWOERTER.size).toBeGreaterThanOrEqual(100);
	});

	it('jeder Eintrag der Liste ist klein und hat mindestens 10 Zeichen', () => {
		for (const eintrag of HAEUFIGE_PASSWOERTER) {
			expect(eintrag, eintrag).toBe(eintrag.toLowerCase());
			expect([...eintrag].length, eintrag).toBeGreaterThanOrEqual(10);
		}
	});
});
