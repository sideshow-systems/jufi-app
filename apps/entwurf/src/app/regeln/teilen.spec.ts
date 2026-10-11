import { erzeugeBeispieldaten, T } from '../daten/beispieldaten';
import { jetzt as jetztVon } from '../daten/zeit';
import { teilenText, threadPfad } from './teilen';
import { threadVon } from './testhilfe';

const stand = erzeugeBeispieldaten('2026-10-11');
const jetzt = jetztVon('2026-10-11', new Date(2026, 9, 11, 10, 5));

describe('threadPfad', () => {
	it('bildet den Pfad aus Nummer und Titel', () => {
		expect(threadPfad(threadVon(stand, T.bowling), 'glonntal')).toBe('/glonntal/t/2-bowling');
		expect(threadPfad(threadVon(stand, T.herbstfest), 'glonntal')).toBe('/glonntal/t/3-herbstfest-helfer');
		expect(threadPfad(threadVon(stand, T.koenigsfischen), 'glonntal')).toBe('/glonntal/t/8-koenigsfischen-2026');
		expect(threadPfad(threadVon(stand, T.pruefung), 'glonntal')).toBe('/glonntal/t/6-fischerpruefung-2027');
	});
});

describe('teilenText', () => {
	const text = teilenText(stand, threadVon(stand, T.bowling), 'https://x/entwurf', jetzt);

	it('beginnt mit fettem Titel und Stand', () => {
		expect(text.split('\n')[0]).toBe('🎳 *Bowling* – Stand So 10:05');
	});

	it('fasst die Teilnahme zusammen', () => {
		expect(text).toContain('✅ Dabei (2): Lena, Paul');
		expect(text).toContain('❌ Abgesagt (2): Mia, Hannah');
		expect(text).toMatch(/❓ Offen \(11\): /);
	});

	it('nennt Fahrer mit freien Plaetzen', () => {
		expect(text).toContain('🚗 Fahrer: Fam. Maier (1 Platz), Fam. Huber (2 Plätze)');
		expect(text).toContain('↩️ Rückfahrt: Fam. Huber (2 Plätze)');
	});

	it('endet mit dem Link zurueck', () => {
		expect(text.split('\n').at(-1)).toBe('👉 Antworten: https://x/entwurf/glonntal/t/2-bowling');
	});

	it('listet bei anderen Umfragen die Optionen', () => {
		const zelt = teilenText(stand, threadVon(stand, T.zeltlager), 'https://x/entwurf', jetzt);
		expect(zelt).toContain('📊 Welche Pizza beim Vortreffen?');
		expect(zelt).toContain('• Salami (1): Jonas');
	});
});
