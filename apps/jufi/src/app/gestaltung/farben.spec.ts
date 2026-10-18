import { AUSGANGSFARBE, FLAECHEN, farbeAngepasst, kontrast, vereinsfarben } from './farben';

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

describe('farbeAngepasst', () => {
	it('meldet Gelb im hellen Modus als angepasst (auf Weiss erreicht es AA nie)', () => {
		expect(farbeAngepasst('#ffff00').hell).toBe(true);
	});

	it('laesst die Ausgangsfarbe im hellen Modus unveraendert', () => {
		expect(farbeAngepasst(AUSGANGSFARBE).hell).toBe(false);
	});

	// Ein Fixpunkt: Die Farbe, die vereinsfarben fuer einen Modus liefert, erreicht in diesem Modus schon AA
	// und bleibt deshalb unveraendert. Daran laesst sich pruefen, dass "angepasst" nicht immer wahr ist.
	for (const modus of ['hell', 'dunkel'] as const) {
		it(`meldet den fertigen Ton fuer ${modus} nicht noch einmal als angepasst`, () => {
			const ton = vereinsfarben(AUSGANGSFARBE)[modus].akzent;
			expect(farbeAngepasst(ton)[modus]).toBe(false);
		});
	}

	it('vergleicht mit der normalisierten Eingabe, nicht mit der Schreibweise', () => {
		expect(farbeAngepasst('#0F766E').hell).toBe(false);
		expect(farbeAngepasst('0f766e').hell).toBe(false);
		expect(farbeAngepasst('#FFFF00').hell).toBe(true);
	});
});
