import type { Rollenfilter } from './typen.js';
import { vorschauTitel } from './vorschau.js';

const GESTERN = new Date('2026-10-21T10:00:00Z');
const thread = (rollenfilter: Rollenfilter, veroeffentlichtAm: Date | null = GESTERN) => ({
	titel: '🎳 Bowling',
	veroeffentlichtAm,
	rollenfilter,
});

describe('vorschauTitel', () => {
	it.each<Rollenfilter>(['JUNGFISCHER_FAMILIE', 'NUR_FAMILIE'])(
		'nennt den Titel eines veroeffentlichten Threads fuer %s',
		(f) => {
			expect(vorschauTitel(thread(f))).toBe('🎳 Bowling');
		},
	);

	it.each<Rollenfilter>(['NUR_JUGENDLEITER', 'JUGENDLEITER_JUGENDSPRECHER'])('verschweigt den Titel bei %s', (f) => {
		expect(vorschauTitel(thread(f))).toBeNull();
	});

	it('verschweigt den Titel eines Entwurfs, auch mit Familien-Zielgruppe', () => {
		expect(vorschauTitel(thread('JUNGFISCHER_FAMILIE', null))).toBeNull();
	});

	it('liefert null ohne Thread', () => {
		expect(vorschauTitel(null)).toBeNull();
	});
});
