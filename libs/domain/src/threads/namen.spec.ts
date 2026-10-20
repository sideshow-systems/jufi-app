import type { Bezug, Umfeld } from './typen.js';
import { absenderName, eingetragenVon, kurzname } from './namen.js';
import { baueUmfeld } from './umfeld.js';
import { bowlingUmfeld } from './testhilfe.js';

const umfeld = bowlingUmfeld();

describe('kurzname', () => {
	it('kuerzt den Nachnamen auf den Anfangsbuchstaben', () => {
		expect(kurzname({ vorname: 'Lena', nachname: 'Maier' })).toBe('Lena M.');
	});

	it('nennt ohne Nachnamen nur den Vornamen', () => {
		expect(kurzname({ vorname: 'Lena', nachname: '' })).toBe('Lena');
		expect(kurzname({ vorname: 'Lena', nachname: '  ' })).toBe('Lena');
	});

	it('schreibt den Buchstaben gross, auch bei Umlaut', () => {
		expect(kurzname({ vorname: 'Eva', nachname: 'österreicher' })).toBe('Eva Ö.');
	});
});

// Eine Bezugsperson mit beliebig vielen Kindern, um die Aufzaehlung zu pruefen.
function umfeldMitKindern(beziehungen: Partial<Bezug>[], kinderNamen: string[]): Umfeld {
	const basis = bowlingUmfeld();
	const sandra = basis.personen.get('sandra')!;
	const kinder = kinderNamen.map((n) => ({
		...basis.personen.get('max')!,
		id: n.toLowerCase(),
		vorname: n,
	}));
	return baueUmfeld(
		[sandra, ...kinder],
		kinder.map((k, i) => ({
			erwachsenerId: 'sandra',
			jungfischerId: k.id,
			erziehungsberechtigt: true,
			beziehung: 'MUTTER',
			beziehungFreitext: null,
			...beziehungen[i],
		})),
		[],
	);
}

describe('absenderName', () => {
	it('nennt Jugendleiter als Jugendleiter, auch wenn sie Eltern sind', () => {
		expect(absenderName('thomas', umfeld)).toBe('Thomas K. (Jugendleiter)');
		expect(absenderName('bea', umfeld)).toBe('Bea R. (Jugendleiter)');
	});

	it('nennt Bezugspersonen mit Beziehung und Kindern', () => {
		expect(absenderName('sandra', umfeld)).toBe('Sandra M. (Mutter von Lena und Max)');
		expect(absenderName('hans', umfeld)).toBe('Hans M. (Großvater von Max)');
		expect(absenderName('peter', umfeld)).toBe('Peter V. (Vater von Paul)');
	});

	it('nennt Jungfischer beim Kurznamen', () => {
		expect(absenderName('lena', umfeld)).toBe('Lena M.');
	});

	it('nennt Entfernte, Unbekannte und fehlende Autoren ehemaliges Mitglied', () => {
		expect(absenderName('mia', umfeld)).toBe('ehemaliges Mitglied');
		expect(absenderName('gibtsnicht', umfeld)).toBe('ehemaliges Mitglied');
		expect(absenderName(null, umfeld)).toBe('ehemaliges Mitglied');
	});

	it('zaehlt ab drei Kindern weitere auf', () => {
		const drei = umfeldMitKindern([], ['Max', 'Anna', 'Berta']);
		expect(absenderName('sandra', drei)).toBe('Sandra M. (Mutter von Anna, Berta und 1 weiteren)');
		const vier = umfeldMitKindern([], ['Max', 'Anna', 'Berta', 'Carl']);
		expect(absenderName('sandra', vier)).toBe('Sandra M. (Mutter von Anna, Berta und 2 weiteren)');
	});

	it('nimmt die Beziehung zum ersten Kind nach Vorname', () => {
		const gemischt = umfeldMitKindern([{ beziehung: 'MUTTER' }, { beziehung: 'TANTE' }], ['Zoe', 'Anna']);
		// Reihenfolge der Zuordnungen ist Zoe, Anna; nach Vorname ist Anna das erste Kind.
		expect(absenderName('sandra', gemischt)).toBe('Sandra M. (Tante von Anna und Zoe)');
	});

	it('nimmt bei Andere den Freitext', () => {
		const andere = umfeldMitKindern([{ beziehung: 'ANDERE', beziehungFreitext: 'Nachbarin' }], ['Max']);
		expect(absenderName('sandra', andere)).toBe('Sandra M. (Nachbarin von Max)');
	});

	it('sagt bei Andere ohne Freitext Bezugsperson', () => {
		const andere = umfeldMitKindern([{ beziehung: 'ANDERE', beziehungFreitext: ' ' }], ['Max']);
		expect(absenderName('sandra', andere)).toBe('Sandra M. (Bezugsperson von Max)');
	});

	it('nennt einen Erwachsenen ohne Kinder beim Kurznamen', () => {
		const ohne = baueUmfeld([bowlingUmfeld().personen.get('sandra')!], [], []);
		expect(absenderName('sandra', ohne)).toBe('Sandra M.');
	});

	it('uebergeht entfernte Kinder', () => {
		const basis = bowlingUmfeld();
		const lena = { ...basis.personen.get('lena')!, entferntAm: new Date('2026-10-01T00:00:00Z') };
		const ohneLena = baueUmfeld(
			[basis.personen.get('sandra')!, lena, basis.personen.get('max')!],
			basis.zuordnungen,
			[],
		);
		expect(absenderName('sandra', ohneLena)).toBe('Sandra M. (Mutter von Max)');
	});
});

describe('eingetragenVon', () => {
	it('sagt von dir, wenn der Betrachter selbst eingetragen hat', () => {
		expect(eingetragenVon('sandra', 'max', 'sandra', umfeld)).toBe('von dir eingetragen');
	});

	it('nennt eine zugeordnete Bezugsperson mit Beziehung und Vornamen', () => {
		expect(eingetragenVon('sandra', 'max', 'hans', umfeld)).toBe('eingetragen von Mutter Sandra');
		expect(eingetragenVon('hans', 'max', 'sandra', umfeld)).toBe('eingetragen von Großvater Hans');
	});

	it('nennt Nicht-Zugeordnete beim Kurznamen', () => {
		expect(eingetragenVon('thomas', 'max', 'sandra', umfeld)).toBe('eingetragen von Thomas K.');
	});

	it('liefert null, wenn jemand fuer sich selbst eingetragen hat', () => {
		expect(eingetragenVon('lena', 'lena', 'sandra', umfeld)).toBeNull();
		expect(eingetragenVon('lena', 'lena', 'lena', umfeld)).toBeNull();
	});

	it('nennt Entfernte ehemaliges Mitglied', () => {
		expect(eingetragenVon('mia', 'max', 'sandra', umfeld)).toBe('eingetragen von ehemaligem Mitglied');
		expect(eingetragenVon('gibtsnicht', 'max', 'sandra', umfeld)).toBe('eingetragen von ehemaligem Mitglied');
	});

	it('nimmt bei Andere den Freitext', () => {
		const andere = umfeldMitKindern([{ beziehung: 'ANDERE', beziehungFreitext: 'Nachbarin' }], ['Max']);
		expect(eingetragenVon('sandra', 'max', 'x', andere)).toBe('eingetragen von Nachbarin Sandra');
	});
});
