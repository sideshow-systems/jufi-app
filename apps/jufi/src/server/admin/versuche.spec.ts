import { AttemptTracker, FREE_ATTEMPTS, MAX_SCHLUESSEL } from '@jufi/auth';
import { describe, expect, it } from 'vitest';
import { reserviere } from './versuche.js';

describe('reserviere bei vollem Speicher', () => {
	it('lehnt einen neuen Schluessel bei lauter Sperren mit Wartezeit ab, ohne zu werfen', () => {
		const t = new AttemptTracker(() => 0);
		for (let i = 0; i < MAX_SCHLUESSEL; i++) for (let j = 0; j <= FREE_ATTEMPTS; j++) t.fail(`s${i}`);
		const ergebnis = reserviere(t, ['neu-ip', 'neu-konto']);
		expect(ergebnis.wartenMs).toBeGreaterThan(0);
		expect(ergebnis.loestSperreAus).toBe(false);
		// Ganz oder gar nicht: auch der zweite Schluessel wurde nicht gezaehlt.
		expect(t.has('neu-ip')).toBe(false);
		expect(t.has('neu-konto')).toBe(false);
	});
});
