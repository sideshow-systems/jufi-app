import type { Bezug, ThreadPerson } from './typen.js';
import { baueUmfeld, kinderVon } from './umfeld.js';
import { bowlingUmfeld, MIA } from './testhilfe.js';

describe('baueUmfeld', () => {
	const basis = bowlingUmfeld();
	const sandra = basis.personen.get('sandra')!;
	const bezug = (erwachsenerId: string, jungfischerId: string): Bezug => ({
		erwachsenerId,
		jungfischerId,
		erziehungsberechtigt: true,
		beziehung: 'MUTTER',
		beziehungFreitext: null,
	});

	it('laesst Zuordnungen und Mitgliedschaften Entfernter an beiden Enden weg', () => {
		const sandraWeg = { ...sandra, entferntAm: new Date('2026-10-01T00:00:00Z') };
		const lena = basis.personen.get('lena')!;
		const umfeld = baueUmfeld(
			[sandraWeg, lena, MIA],
			[bezug('sandra', 'lena'), bezug('sandra', 'mia')],
			[
				{ personId: 'mia', untergruppeId: 'gross' },
				{ personId: 'lena', untergruppeId: 'gross' },
			],
		);
		expect([...umfeld.personen.keys()]).toEqual(['lena']);
		expect(umfeld.zuordnungen).toEqual([]);
		expect([...umfeld.untergruppenVon.keys()]).toEqual(['lena']);

		const kindWeg = baueUmfeld([sandra, lena, MIA], [bezug('sandra', 'lena'), bezug('sandra', 'mia')], []);
		expect(kindWeg.zuordnungen.map((z) => z.jungfischerId)).toEqual(['lena']);
	});

	it('liefert die Kinder einer Bezugsperson nach Vorname', () => {
		expect(kinderVon(basis, 'sandra').map((k) => k.vorname)).toEqual(['Lena', 'Max']);
		expect(kinderVon(basis, 'lena')).toEqual([]);
	});

	it('veraendert seine Eingaben nicht', () => {
		const personen: ThreadPerson[] = [sandra, MIA, basis.personen.get('max')!];
		const zuordnungen = [bezug('sandra', 'mia'), bezug('sandra', 'max')];
		const mitgliedschaften = [{ personId: 'mia', untergruppeId: 'gross' }];
		const vorher = structuredClone({ personen, zuordnungen, mitgliedschaften });
		baueUmfeld(personen, zuordnungen, mitgliedschaften);
		expect({ personen, zuordnungen, mitgliedschaften }).toEqual(vorher);
	});
});
