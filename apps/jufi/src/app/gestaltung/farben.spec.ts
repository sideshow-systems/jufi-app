import { FLAECHEN, kontrast, vereinsfarben } from './farben';

describe('kontrast', () => {
	it('rechnet nach WCAG', () => {
		expect(kontrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
		expect(kontrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
		expect(kontrast('#0f766e', '#ffffff')).toBeGreaterThan(4.5);
	});
});

describe('vereinsfarben', () => {
	it('laesst eine ausreichende Farbe im hellen Modus unveraendert', () => {
		expect(vereinsfarben('#0f766e').hell.akzent).toBe('#0f766e');
	});

	for (const farbe of ['#0f766e', '#ffff00', '#000000', '#ffffff', '#e11d48', '#3b82f6']) {
		it(`erreicht AA fuer ${farbe} in hell und dunkel`, () => {
			const satz = vereinsfarben(farbe);
			for (const modus of ['hell', 'dunkel'] as const) {
				const s = satz[modus];
				expect(kontrast(s.akzent, FLAECHEN[modus].karte)).toBeGreaterThanOrEqual(4.5);
				expect(kontrast(s.akzent, FLAECHEN[modus].seite)).toBeGreaterThanOrEqual(4.5);
				expect(kontrast(s.aufAkzent, s.akzent)).toBeGreaterThanOrEqual(4.5);
				expect(kontrast(s.akzent, s.akzentFlaeche)).toBeGreaterThanOrEqual(4.5);
				expect(s.akzentFlaeche).toMatch(/^#[0-9a-f]{6}$/);
			}
		});
	}

	it('verkraftet kaputte Eingaben mit der Ausgangsfarbe', () => {
		expect(vereinsfarben('nix').hell.akzent).toBe('#0f766e');
	});
});
