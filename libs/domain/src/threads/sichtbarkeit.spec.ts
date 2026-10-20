import { kinderImThread, siehtThread } from './sichtbarkeit.js';
import { bowlingUmfeld, kopf, MIA } from './testhilfe.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;
const sieht = (id: string, k = kopf()) => siehtThread(person(id), k, umfeld);

describe('siehtThread', () => {
	it('zeigt Jugendleitern Entwuerfe und Threads nur fuer Jugendleiter, auch Bea', () => {
		const entwurf = kopf({ veroeffentlichtAm: null });
		const intern = kopf({ rollenfilter: 'NUR_JUGENDLEITER' });
		for (const id of ['thomas', 'petra', 'bea']) {
			expect(sieht(id, entwurf), id).toBe(true);
			expect(sieht(id, intern), id).toBe(true);
		}
	});

	it('zeigt Sandra den Bowling-Thread, nicht den Entwurf', () => {
		expect(sieht('sandra')).toBe(true);
		expect(sieht('sandra', kopf({ veroeffentlichtAm: null }))).toBe(false);
	});

	it('zeigt Lena und Max den Bowling-Thread', () => {
		expect(sieht('lena')).toBe(true);
		expect(sieht('max')).toBe(true);
	});

	it('zeigt Familie und Kinder nichts, wenn der Thread nur fuer Jugendleiter ist', () => {
		const intern = kopf({ rollenfilter: 'NUR_JUGENDLEITER' });
		for (const id of ['sandra', 'lena', 'peter', 'hans']) expect(sieht(id, intern), id).toBe(false);
	});

	it('richtet sich bei einer Untergruppe nach den Kindern: Lena nicht, Sandra ueber Max schon, Hans auch', () => {
		const klein = kopf({ alleUntergruppen: false, untergruppenIds: ['klein'] });
		expect(sieht('lena', klein)).toBe(false);
		expect(sieht('max', klein)).toBe(true);
		expect(sieht('sandra', klein)).toBe(true);
		expect(sieht('hans', klein)).toBe(true);
		expect(sieht('peter', klein)).toBe(false);
	});

	it('zeigt Nur-Familie den Bezugspersonen, nicht den Kindern', () => {
		const familie = kopf({ rollenfilter: 'NUR_FAMILIE' });
		expect(sieht('sandra', familie)).toBe(true);
		expect(sieht('lena', familie)).toBe(false);
		expect(sieht('max', familie)).toBe(false);
	});

	it('zeigt Jugendleiter + Jugendsprecher nur der Jugendsprecherin', () => {
		const austausch = kopf({ rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' });
		expect(sieht('lena', austausch)).toBe(true);
		expect(sieht('jonas', austausch)).toBe(false);
		expect(sieht('sandra', austausch)).toBe(false);
		expect(sieht('thomas', austausch)).toBe(true);
	});

	it('ignoert bei Jugendleiter + Jugendsprecher die Untergruppen', () => {
		const austausch = kopf({
			rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
			alleUntergruppen: false,
			untergruppenIds: ['klein'],
		});
		expect(sieht('lena', austausch)).toBe(true);
	});

	it('zeigt Peter den Bowling-Thread ueber den volljaehrigen Paul', () => {
		expect(sieht('peter')).toBe(true);
	});

	it('zeigt bei leerer Auswahl nur Jugendleitern etwas', () => {
		const leer = kopf({ alleUntergruppen: false, untergruppenIds: [] });
		for (const id of ['sandra', 'lena', 'max', 'hans', 'peter', 'jonas', 'tim'])
			expect(sieht(id, leer), id).toBe(false);
		expect(sieht('thomas', leer)).toBe(true);
		expect(sieht('bea', leer)).toBe(true);
	});

	it('zeigt der entfernten Mia nichts', () => {
		expect(siehtThread(MIA, kopf(), umfeld)).toBe(false);
		expect(siehtThread({ ...MIA, rechte: ['ANTWORTEN_DETAIL'] }, kopf(), umfeld)).toBe(false);
	});

	it('zeigt einer entfernten Bezugsperson nichts, auch wenn ihre Zuordnung noch bestuende', () => {
		const sandra = { ...person('sandra'), entferntAm: new Date('2026-10-01T00:00:00Z') };
		expect(siehtThread(sandra, kopf(), umfeld)).toBe(false);
	});
});

describe('kinderImThread', () => {
	const namen = (k: ReturnType<typeof kopf>) => kinderImThread(k, umfeld).map((p) => p.vorname);

	it('liefert bei Untergruppe gross Jonas, Lena, Paul, Tim', () => {
		expect(namen(kopf({ alleUntergruppen: false, untergruppenIds: ['gross'] }))).toEqual([
			'Jonas',
			'Lena',
			'Paul',
			'Tim',
		]);
	});

	it('liefert bei allen Untergruppen alle Jungfischer ausser den entfernten', () => {
		expect(namen(kopf())).toEqual(['Jonas', 'Lena', 'Max', 'Paul', 'Tim']);
	});

	it('liefert beim Austausch-Filter nur die Jugendsprecherin, auch ohne Untergruppe', () => {
		expect(namen(kopf({ rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' }))).toEqual(['Lena']);
		expect(
			namen(kopf({ rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER', alleUntergruppen: false, untergruppenIds: [] })),
		).toEqual(['Lena']);
	});

	it('liefert nichts bei Nur-Jugendleiter und bei leerer Auswahl', () => {
		expect(namen(kopf({ rollenfilter: 'NUR_JUGENDLEITER' }))).toEqual([]);
		expect(namen(kopf({ alleUntergruppen: false, untergruppenIds: [] }))).toEqual([]);
	});

	it('kennt Mia nie', () => {
		for (const k of [kopf(), kopf({ alleUntergruppen: false, untergruppenIds: ['gross'] })]) {
			expect(namen(k)).not.toContain('Mia');
		}
	});

	it('ignoert unbekannte Untergruppen', () => {
		expect(namen(kopf({ alleUntergruppen: false, untergruppenIds: ['gibtsnicht'] }))).toEqual([]);
	});
});
