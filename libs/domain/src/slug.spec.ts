import { pruefeSlug, RESERVIERTE_SLUGS } from './slug.js';

describe('pruefeSlug', () => {
	it.each(['glonntal', 'fv-glonntal', 'abc', 'a1-b2', 'x'.repeat(30)])('nimmt %s an', (s) => {
		expect(pruefeSlug(s)).toEqual({ ok: true });
	});
	it.each(['Glonntal', 'dämo', 'fv_glonntal', '-glonntal', 'glonntal-', 'fv--glonntal', 'glonn tal', ''])(
		'lehnt %j wegen des Formats ab',
		(s) => expect(pruefeSlug(s)).toEqual({ ok: false, grund: 'format' }),
	);
	it.each(['ab', 'x'.repeat(31)])('lehnt %s wegen der Laenge ab', (s) => {
		expect(pruefeSlug(s)).toEqual({ ok: false, grund: 'laenge' });
	});
	it('lehnt jeden reservierten Namen ab', () => {
		for (const s of ['admin', 'api', 'entwurf', 'assets', 'impressum', 'datenschutz', 'healthz']) {
			expect(pruefeSlug(s)).toEqual({ ok: false, grund: 'reserviert' });
		}
		expect(RESERVIERTE_SLUGS).toEqual(
			expect.arrayContaining([
				'admin',
				'api',
				'entwurf',
				'assets',
				'impressum',
				'datenschutz',
				'healthz',
				'favicon.ico',
				'robots.txt',
			]),
		);
	});
});
