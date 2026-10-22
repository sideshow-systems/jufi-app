import type { EinwilligungZeile } from '../einwilligung.js';
import type { Bezug, ThreadDaten, Umfeld, UmfrageDaten } from './typen.js';
import { absenderName, dabeiKinder, eingetragenVon, fotoHinweis, kurzname, ohneFotoEinwilligung } from './namen.js';
import { baueUmfeld } from './umfeld.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';

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

	// Entscheidung R9: Die Zuordnung entscheidet, nicht die Rolle; auch ein Jugendleiter,
	// der dem Kind zugeordnet ist, erscheint mit seiner Beziehung.
	it('nennt einen zugeordneten Jugendleiter mit Beziehung', () => {
		expect(eingetragenVon('thomas', 'jonas', 'sandra', umfeld)).toBe('eingetragen von Vater Thomas');
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

describe('Foto-Einwilligung im Thread', () => {
	const eltern = (erteiltVon: string): EinwilligungZeile[] => [{ erteiltVon, widerrufenAm: null }];
	// Alle bis auf Tim (ohne Zuordnung, ohne Zeile); Paul ist volljaehrig und willigt selbst ein.
	const fast = () =>
		new Map<string, readonly EinwilligungZeile[]>([
			['lena', eltern('sandra')],
			['max', eltern('sandra')],
			['jonas', eltern('thomas')],
			['paul', eltern('paul')],
		]);
	const teilnahme = (dabei: string[], schluesselDabei = 'dabei'): UmfrageDaten => ({
		modulId: 'u1',
		frage: 'Kommst du?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: false,
		frist: null,
		ergebnisse: 'ALLE',
		optionen: [
			{ id: 'o-dabei', schluessel: schluesselDabei, text: 'Dabei' },
			{ id: 'o-nein', schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		antworten: [
			...dabei.map((id) => ({ fuerId: id, vonId: id, optionIds: ['o-dabei'], abgegebenAm: JETZT })),
			{ fuerId: 'tim', vonId: 'tim', optionIds: ['o-nein'], abgegebenAm: JETZT },
		],
	});
	const daten = (umfragen: UmfrageDaten[]): ThreadDaten => ({
		kopf: kopf(),
		termine: [],
		umfragen,
		helfer: [],
		fahrt: null,
	});

	describe('ohneFotoEinwilligung', () => {
		it('nennt nur Tim, wenn Lena eine Einwilligung hat', () => {
			const r = ohneFotoEinwilligung(kopf(), umfeld, { fotoEinwilligungen: fast(), dabei: null }, JETZT);
			expect(r.map((p) => p.id)).toEqual(['tim']);
		});

		it('sortiert nach Kurzname', () => {
			const e = fast();
			e.delete('max');
			const r = ohneFotoEinwilligung(kopf(), umfeld, { fotoEinwilligungen: e, dabei: null }, JETZT);
			expect(r.map((p) => p.id)).toEqual(['max', 'tim']);
		});

		it('zaehlt die Eltern eines Volljaehrigen nicht mehr', () => {
			const e = fast();
			e.set('paul', eltern('peter'));
			const r = ohneFotoEinwilligung(kopf(), umfeld, { fotoEinwilligungen: e, dabei: null }, JETZT);
			expect(r.map((p) => p.id)).toEqual(['paul', 'tim']);
		});

		it('beschraenkt sich auf die, die dabei sind', () => {
			const r = ohneFotoEinwilligung(
				kopf(),
				umfeld,
				{ fotoEinwilligungen: fast(), dabei: new Set(['lena', 'tim']) },
				JETZT,
			);
			expect(r.map((p) => p.id)).toEqual(['tim']);
			expect(
				ohneFotoEinwilligung(kopf(), umfeld, { fotoEinwilligungen: fast(), dabei: new Set(['lena']) }, JETZT),
			).toEqual([]);
			expect(ohneFotoEinwilligung(kopf(), umfeld, { fotoEinwilligungen: fast(), dabei: new Set() }, JETZT)).toEqual([]);
		});

		it('ist bei Nur Jugendleiter leer', () => {
			const k = kopf({ rollenfilter: 'NUR_JUGENDLEITER' });
			expect(ohneFotoEinwilligung(k, umfeld, { fotoEinwilligungen: new Map(), dabei: null }, JETZT)).toEqual([]);
		});
	});

	describe('dabeiKinder', () => {
		it('liefert die, die in der Teilnahme-Umfrage zusagen', () => {
			expect(dabeiKinder(daten([teilnahme(['lena', 'max'])]))).toEqual(new Set(['lena', 'max']));
		});

		it('ist null ohne Teilnahme-Umfrage', () => {
			expect(dabeiKinder(daten([]))).toBeNull();
			expect(dabeiKinder(daten([{ ...teilnahme(['lena']), teilnahme: false }]))).toBeNull();
		});

		it('ist leer, wenn niemand zusagt, und null, wenn die Option fehlt', () => {
			expect(dabeiKinder(daten([teilnahme([])]))).toEqual(new Set());
			expect(dabeiKinder(daten([teilnahme(['lena'], 'komme')]))).toBeNull();
		});
	});

	describe('fotoHinweis', () => {
		const p = (id: string) => umfeld.personen.get(id)!;

		it('ist null ohne Namen', () => {
			expect(fotoHinweis([])).toBeNull();
		});

		it('nennt die Namen, sortiert und verbunden', () => {
			expect(fotoHinweis([p('tim'), p('max')])).toBe('Von Max M. und Tim S. dürfen keine Fotos gezeigt werden');
			expect(fotoHinweis([p('tim')])).toBe('Von Tim S. dürfen keine Fotos gezeigt werden');
			expect(fotoHinweis([p('tim'), p('max'), p('jonas')])).toBe(
				'Von Jonas K., Max M. und Tim S. dürfen keine Fotos gezeigt werden',
			);
		});
	});
});
