import { erzeugeBeispieldaten, P } from './beispieldaten';
import { type Ablage, laden, SCHLUESSEL, speicherAblage, speichern } from './speicher';

const heute = new Date(2026, 9, 11, 9, 0);

describe('laden', () => {
	it('beginnt ohne Ablage mit frischen Beispieldaten', () => {
		const g = laden(speicherAblage(), heute);
		expect(g.stand.bezugstag).toBe('2026-10-11');
		expect(g.testmodus).toBeNull();
		expect(g.ich).toBe(P.sandra);
	});

	it('verkraftet kaputtes JSON', () => {
		const g = laden(speicherAblage({ [SCHLUESSEL]: '{kaputt' }), heute);
		expect(g.stand.threads).toHaveLength(8);
	});

	it('verwirft eine alte Version', () => {
		const g = laden(speicherAblage({ [SCHLUESSEL]: '{"stand":{"version":0}}' }), heute);
		expect(g.stand.version).toBe(1);
		expect(g.stand.threads).toHaveLength(8);
	});

	it('verwirft einen unvollstaendigen Stand', () => {
		const g = laden(speicherAblage({ [SCHLUESSEL]: '{"stand":{"version":1,"bezugstag":"2026-10-01"}}' }), heute);
		expect(g.stand.bezugstag).toBe('2026-10-11');
	});

	it('behaelt den Bezugstag ueber Wochen (eingefrorene Zeit)', () => {
		const ablage = speicherAblage();
		speichern(ablage, { stand: erzeugeBeispieldaten('2026-10-11'), testmodus: { x: 1 }, ich: P.lena });
		const g = laden(ablage, new Date(2026, 10, 2, 9, 0));
		expect(g.stand.bezugstag).toBe('2026-10-11');
		expect(g.testmodus).toEqual({ x: 1 });
		expect(g.ich).toBe(P.lena);
	});
});

describe('speichern', () => {
	it('wirft nicht, wenn die Ablage voll ist', () => {
		const voll: Ablage = {
			lesen: () => null,
			schreiben: () => {
				throw new Error('QuotaExceededError');
			},
		};
		expect(() =>
			speichern(voll, { stand: erzeugeBeispieldaten('2026-10-11'), testmodus: null, ich: P.sandra }),
		).not.toThrow();
	});
});
