import { describe, expect, it } from 'vitest';
import { Fensterzaehler } from './fenster.js';

describe('Fensterzaehler', () => {
	function zaehler(grenze = 3, maxSchluessel?: number) {
		const uhr = { ms: 1_000_000 };
		return { uhr, z: new Fensterzaehler(grenze, 60_000, () => uhr.ms, maxSchluessel) };
	}

	it('erlaubt die Grenze und nennt beim naechsten die Restzeit bis der aelteste Eintrag 60 000 ms alt ist', () => {
		const { uhr, z } = zaehler();
		expect(z.pruefe('a')).toBe(0);
		uhr.ms += 10_000;
		expect(z.pruefe('a')).toBe(0);
		uhr.ms += 10_000;
		expect(z.pruefe('a')).toBe(0);
		uhr.ms += 5_000;
		// Der erste Eintrag ist 25 000 ms alt.
		expect(z.pruefe('a')).toBe(35_000);
	});

	it('zaehlt abgelehnte Anfragen nicht mit', () => {
		const { uhr, z } = zaehler(1);
		expect(z.pruefe('a')).toBe(0);
		uhr.ms += 20_000;
		expect(z.pruefe('a')).toBe(40_000);
		uhr.ms += 20_000;
		expect(z.pruefe('a')).toBe(20_000);
		uhr.ms += 20_000;
		expect(z.pruefe('a')).toBe(0);
	});

	it('erlaubt nach Ablauf wieder, genau mit dem Ende des Fensters', () => {
		const { uhr, z } = zaehler();
		for (let i = 0; i < 3; i++) z.pruefe('a');
		uhr.ms += 59_999;
		expect(z.pruefe('a')).toBe(1);
		uhr.ms += 1;
		expect(z.pruefe('a')).toBe(0);
	});

	it('haelt die Schluessel getrennt', () => {
		const { z } = zaehler();
		for (let i = 0; i < 3; i++) z.pruefe('a');
		expect(z.pruefe('a')).toBeGreaterThan(0);
		expect(z.pruefe('b')).toBe(0);
	});

	it('verwirft bei vollem Speicher zuerst abgelaufene Schluessel', () => {
		const { uhr, z } = zaehler(3, 2);
		z.pruefe('a');
		z.pruefe('b');
		uhr.ms += 60_000;
		expect(z.pruefe('c')).toBe(0);
	});

	it('lehnt bei vollem Speicher voller aktiver Schluessel einen neuen ab, ohne einen fremden zu verdraengen', () => {
		const { uhr, z } = zaehler(3, 2);
		z.pruefe('a');
		z.pruefe('b');
		expect(z.pruefe('c')).toBe(60_000);
		// Auch der Versuch zaehlt nicht: c ist nach Ablauf von a und b sofort frei.
		uhr.ms += 60_000;
		expect(z.pruefe('c')).toBe(0);
		// b war abgelaufen und ist verworfen, a ebenfalls; die Zaehler von c sind die einzigen.
		expect(z.pruefe('a')).toBe(0);
	});

	it('behaelt die Zaehler vorhandener Schluessel bei vollem Speicher', () => {
		const { z } = zaehler(1, 2);
		z.pruefe('a');
		z.pruefe('b');
		expect(z.pruefe('c')).toBe(60_000);
		// a ist weiterhin gezaehlt.
		expect(z.pruefe('a')).toBe(60_000);
	});
});
