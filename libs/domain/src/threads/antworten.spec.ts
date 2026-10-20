import { antwortZeilen, auswertung, darfAntworten, ergebnisAnsicht, gefragte, type AntwortZeile } from './antworten.js';
import type { AntwortDaten, ThreadKopf, UmfrageDaten } from './typen.js';
import { bowlingUmfeld, JETZT, kopf, MIA } from './testhilfe.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;
const ids = (liste: readonly { id: string }[]) => liste.map((p) => p.id);

const FRIST = new Date('2026-10-23T16:00:00Z');

// Die Teilnahme-Umfrage des Bowling-Threads; nur die Felder, die ein Test aendert, werden
// uebergeben.
function umfrage(daten: Partial<UmfrageDaten> = {}): UmfrageDaten {
	return {
		modulId: 'm1',
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: true,
		frist: FRIST,
		ergebnisse: 'ALLE',
		optionen: [
			{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
			{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
			{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		antworten: [],
		...daten,
	};
}

function antwort(fuerId: string, vonId: string, optionId: string): AntwortDaten {
	return { fuerId, vonId, optionIds: [optionId], abgegebenAm: new Date('2026-10-21T12:00:00Z') };
}

const NUR_KLEIN: Partial<ThreadKopf> = { alleUntergruppen: false, untergruppenIds: ['klein'] };
const NUR_GROSS: Partial<ThreadKopf> = { alleUntergruppen: false, untergruppenIds: ['gross'] };

describe('gefragte', () => {
	const fuer = (einheit: UmfrageDaten['einheit'], k: ThreadKopf = kopf()) =>
		ids(gefragte(umfrage({ einheit }), k, umfeld));

	it('fragt pro Jungfischer die Kinder im Thread', () => {
		expect(fuer('JUNGFISCHER')).toEqual(['jonas', 'lena', 'max', 'paul', 'tim']);
		expect(fuer('JUNGFISCHER', kopf(NUR_KLEIN))).toEqual(['max']);
	});

	it('fragt pro Jungfischer im Austausch die Jugendsprecher', () => {
		expect(fuer('JUNGFISCHER', kopf({ rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' }))).toEqual(['lena']);
	});

	it('fragt pro Jungfischer bei Nur Familie und Nur Jugendleiter niemanden', () => {
		expect(fuer('JUNGFISCHER', kopf({ rollenfilter: 'NUR_FAMILIE' }))).toEqual([]);
		expect(fuer('JUNGFISCHER', kopf({ rollenfilter: 'NUR_JUGENDLEITER' }))).toEqual([]);
	});

	it('fragt pro Jungfischer bei leerer Auswahl niemanden', () => {
		expect(fuer('JUNGFISCHER', kopf({ alleUntergruppen: false, untergruppenIds: [] }))).toEqual([]);
	});

	it('fragt pro Erwachsenem Bezugspersonen und Jugendleiter, Thomas nur einmal', () => {
		expect(fuer('ERWACHSENER')).toEqual(['bea', 'hans', 'peter', 'petra', 'sandra', 'thomas']);
	});

	it('fragt pro Erwachsenem nur die Familien der Kinder in der Zielgruppe', () => {
		expect(fuer('ERWACHSENER', kopf(NUR_KLEIN))).toEqual(['bea', 'hans', 'petra', 'sandra', 'thomas']);
	});

	it('fragt pro Erwachsenem bei Nur Jugendleiter und im Austausch nur die Jugendleiter', () => {
		expect(fuer('ERWACHSENER', kopf({ rollenfilter: 'NUR_JUGENDLEITER' }))).toEqual(['bea', 'petra', 'thomas']);
		expect(fuer('ERWACHSENER', kopf({ rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' }))).toEqual([
			'bea',
			'petra',
			'thomas',
		]);
	});

	it('fragt pro Erwachsenem bei leerer Auswahl nur die Jugendleiter', () => {
		expect(fuer('ERWACHSENER', kopf({ alleUntergruppen: false, untergruppenIds: [] }))).toEqual([
			'bea',
			'petra',
			'thomas',
		]);
	});

	it('fragt pro Person beide Gruppen zusammen', () => {
		const liste = fuer('PERSON');
		expect(liste).toHaveLength(11);
		expect(liste).toEqual(['bea', 'hans', 'jonas', 'lena', 'max', 'paul', 'peter', 'petra', 'sandra', 'thomas', 'tim']);
	});

	it('fragt pro Person bei Nur Familie ohne die Kinder', () => {
		expect(fuer('PERSON', kopf({ rollenfilter: 'NUR_FAMILIE' }))).toEqual([
			'bea',
			'hans',
			'peter',
			'petra',
			'sandra',
			'thomas',
		]);
	});

	it('fragt pro Person im Austausch die Jugendsprecher und die Jugendleiter', () => {
		expect(fuer('PERSON', kopf({ rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' }))).toEqual([
			'bea',
			'lena',
			'petra',
			'thomas',
		]);
	});

	it('fragt keine Entfernten und keine Kinder, die nicht im Umfeld stehen', () => {
		expect(fuer('PERSON')).not.toContain(MIA.id);
	});

	it('zaehlt als Jugendleiter nur Erwachsene mit Rechten', () => {
		const mitRecht = new Map(umfeld.personen);
		mitRecht.set('paul', { ...person('paul'), rechte: ['ANTWORTEN_DETAIL'] });
		const liste = gefragte(umfrage({ einheit: 'ERWACHSENER' }), kopf(), { ...umfeld, personen: mitRecht });
		expect(ids(liste)).not.toContain('paul');
	});
});

describe('antwortZeilen', () => {
	const zeilen = (id: string, einheit: UmfrageDaten['einheit'], k: ThreadKopf = kopf()): AntwortZeile[] =>
		antwortZeilen(person(id), umfrage({ einheit }), k, umfeld);

	it('gibt Sandra pro Jungfischer eine Zeile je Kind', () => {
		expect(zeilen('sandra', 'JUNGFISCHER')).toEqual([
			{ fuerId: 'lena', vorname: 'Lena', selbst: false },
			{ fuerId: 'max', vorname: 'Max', selbst: false },
		]);
	});

	it('gibt Sandra pro Person zuerst die eigene Zeile, dann die der Kinder', () => {
		expect(zeilen('sandra', 'PERSON')).toEqual([
			{ fuerId: 'sandra', vorname: 'Sandra', selbst: true },
			{ fuerId: 'lena', vorname: 'Lena', selbst: false },
			{ fuerId: 'max', vorname: 'Max', selbst: false },
		]);
	});

	it('gibt Sandra pro Erwachsenem nur die eigene Zeile', () => {
		expect(zeilen('sandra', 'ERWACHSENER')).toEqual([{ fuerId: 'sandra', vorname: 'Sandra', selbst: true }]);
	});

	it('gibt Lena pro Jungfischer die eigene Zeile', () => {
		expect(zeilen('lena', 'JUNGFISCHER')).toEqual([{ fuerId: 'lena', vorname: 'Lena', selbst: true }]);
	});

	it('gibt Thomas pro Jungfischer Jonas, pro Person sich selbst und Jonas', () => {
		expect(zeilen('thomas', 'JUNGFISCHER')).toEqual([{ fuerId: 'jonas', vorname: 'Jonas', selbst: false }]);
		expect(zeilen('thomas', 'PERSON')).toEqual([
			{ fuerId: 'thomas', vorname: 'Thomas', selbst: true },
			{ fuerId: 'jonas', vorname: 'Jonas', selbst: false },
		]);
	});

	it('gibt nur die Kinder der Zielgruppe, auch bei Grosseltern', () => {
		expect(zeilen('hans', 'JUNGFISCHER', kopf(NUR_KLEIN))).toEqual([{ fuerId: 'max', vorname: 'Max', selbst: false }]);
		expect(zeilen('sandra', 'JUNGFISCHER', kopf(NUR_KLEIN))).toEqual([
			{ fuerId: 'max', vorname: 'Max', selbst: false },
		]);
	});

	it('gibt Bea pro Jungfischer keine Zeile', () => {
		expect(zeilen('bea', 'JUNGFISCHER')).toEqual([]);
	});

	it('gibt wer den Thread nicht sieht keine Zeile', () => {
		expect(zeilen('sandra', 'JUNGFISCHER', kopf({ veroeffentlichtAm: null }))).toEqual([]);
		expect(zeilen('sandra', 'JUNGFISCHER', kopf(NUR_GROSS))).toEqual([
			{ fuerId: 'lena', vorname: 'Lena', selbst: false },
		]);
		expect(zeilen('peter', 'JUNGFISCHER', kopf(NUR_KLEIN))).toEqual([]);
	});
});

describe('darfAntworten', () => {
	const darf = (
		id: string,
		fuerId: string,
		k: ThreadKopf = kopf(),
		u: Pick<UmfrageDaten, 'einheit' | 'frist'> = umfrage(),
		jetzt: Date = JETZT,
	) => darfAntworten(person(id), fuerId, u, k, umfeld, jetzt);

	it('erlaubt Sandra fuer Max vor der Frist, um genau die Frist nicht mehr', () => {
		expect(darf('sandra', 'max')).toBe('ERLAUBT');
		expect(darf('sandra', 'max', kopf(), umfrage(), new Date(FRIST.getTime() - 1))).toBe('ERLAUBT');
		expect(darf('sandra', 'max', kopf(), umfrage(), FRIST)).toBe('FRIST_ABGELAUFEN');
	});

	it('erlaubt ohne Frist immer', () => {
		const spaet = new Date('2030-01-01T00:00:00Z');
		expect(darf('sandra', 'max', kopf(), umfrage({ frist: null }), spaet)).toBe('ERLAUBT');
	});

	it('erlaubt Thomas fuer Tim auch nach der Frist', () => {
		const danach = new Date(FRIST.getTime() + 3_600_000);
		expect(darf('thomas', 'tim', kopf(), umfrage(), danach)).toBe('ERLAUBT');
	});

	it('findet Sandra fuer Tim und Lena fuer Max nicht', () => {
		expect(darf('sandra', 'tim')).toBe('NICHT_GEFUNDEN');
		expect(darf('lena', 'max')).toBe('NICHT_GEFUNDEN');
	});

	it('erlaubt Kindern und Erwachsenen die Antwort fuer sich selbst', () => {
		expect(darf('lena', 'lena')).toBe('ERLAUBT');
		expect(darf('lena', 'lena', kopf(), umfrage(), FRIST)).toBe('FRIST_ABGELAUFEN');
		const erwachsen = umfrage({ einheit: 'ERWACHSENER' });
		expect(darf('sandra', 'sandra', kopf(), erwachsen)).toBe('ERLAUBT');
	});

	it('findet Petra als Nicht-Ersteller fuer Tim nicht, als Ersteller ja', () => {
		expect(darf('petra', 'tim')).toBe('NICHT_GEFUNDEN');
		expect(darf('petra', 'tim', kopf({ erstelltVonId: 'petra' }))).toBe('ERLAUBT');
	});

	it('meldet den Entwurf, wenn er gesehen wird', () => {
		expect(darf('thomas', 'tim', kopf({ veroeffentlichtAm: null }))).toBe('ENTWURF');
		expect(darf('sandra', 'max', kopf({ veroeffentlichtAm: null }))).toBe('NICHT_GEFUNDEN');
	});

	it('findet nicht Gefragte nicht, auch fuer Jugendleiter', () => {
		expect(darf('sandra', 'lena', kopf(NUR_KLEIN))).toBe('NICHT_GEFUNDEN');
		expect(darf('thomas', 'lena', kopf(NUR_KLEIN))).toBe('NICHT_GEFUNDEN');
		expect(darf('thomas', 'mia')).toBe('NICHT_GEFUNDEN');
		expect(darf('thomas', 'unbekannt')).toBe('NICHT_GEFUNDEN');
	});

	it('erlaubt Peter die Antwort fuer den volljaehrigen Paul', () => {
		expect(darf('peter', 'paul')).toBe('ERLAUBT');
	});

	it('laesst Entfernte nichts sehen', () => {
		expect(darfAntworten(MIA, 'mia', umfrage(), kopf(), umfeld, JETZT)).toBe('NICHT_GEFUNDEN');
	});
});

describe('ergebnisAnsicht', () => {
	// Spalten der Tabelle 3.4: Antworten im Detail (Thomas, Bea), andere Jugendleiter
	// (Petra ohne Ersteller), Familien und Jungfischer (Sandra).
	const ansichten = (ergebnisse: UmfrageDaten['ergebnisse']) =>
		['thomas', 'bea', 'petra', 'sandra'].map((id) => ergebnisAnsicht(person(id), { ergebnisse }, kopf()));

	it('zeigt bei "Fuer alle" allen die Namen', () => {
		expect(ansichten('ALLE')).toEqual(['NAMEN', 'NAMEN', 'NAMEN', 'NAMEN']);
	});

	it('zeigt bei "Nur als Summe" nur Berechtigten die Namen', () => {
		expect(ansichten('SUMME')).toEqual(['NAMEN', 'NAMEN', 'SUMME', 'SUMME']);
	});

	it('zeigt bei "Nur Jugendleiter" Familien nichts', () => {
		expect(ansichten('JUGENDLEITER')).toEqual(['NAMEN', 'NAMEN', 'SUMME', 'NICHTS']);
	});

	it('zeigt Namen auch dem, der den Thread bearbeiten darf (Entscheidung 5)', () => {
		const vonPetra = kopf({ erstelltVonId: 'petra' });
		expect(ergebnisAnsicht(person('petra'), { ergebnisse: 'SUMME' }, vonPetra)).toBe('NAMEN');
		expect(ergebnisAnsicht(person('petra'), { ergebnisse: 'JUGENDLEITER' }, vonPetra)).toBe('NAMEN');
	});

	it('zeigt Entfernten nichts', () => {
		const entfernt = { ...person('bea'), entferntAm: new Date('2026-09-01T00:00:00Z') };
		expect(ergebnisAnsicht(entfernt, { ergebnisse: 'ALLE' }, kopf())).toBe('NICHTS');
	});
});

describe('auswertung', () => {
	const antworten = [
		antwort('lena', 'lena', 'o-dabei'),
		antwort('max', 'sandra', 'o-dabei'),
		antwort('tim', 'thomas', 'o-abgesagt'),
	];
	const von = (id: string, u: UmfrageDaten, k: ThreadKopf = kopf()) => auswertung(person(id), u, k, umfeld);

	it('zaehlt und benennt fuer Sandra bei "Fuer alle" ohne Vermerk', () => {
		expect(von('sandra', umfrage({ antworten }))).toEqual({
			ansicht: 'NAMEN',
			optionen: [
				{
					optionId: 'o-dabei',
					anzahl: 2,
					namen: [
						{ fuerId: 'lena', name: 'Lena M.', eingetragenVon: null },
						{ fuerId: 'max', name: 'Max M.', eingetragenVon: null },
					],
				},
				{ optionId: 'o-vielleicht', anzahl: 0, namen: [] },
				{
					optionId: 'o-abgesagt',
					anzahl: 1,
					namen: [{ fuerId: 'tim', name: 'Tim S.', eingetragenVon: null }],
				},
			],
			offen: {
				anzahl: 2,
				namen: [
					{ fuerId: 'jonas', name: 'Jonas K.', eingetragenVon: null },
					{ fuerId: 'paul', name: 'Paul V.', eingetragenVon: null },
				],
			},
		});
	});

	it('zeigt Jugendleitern, wer fuer wen eingetragen hat, aber nur bei von ungleich fuer', () => {
		const a = von('thomas', umfrage({ antworten }))!;
		expect(a.optionen[0].namen).toEqual([
			{ fuerId: 'lena', name: 'Lena M.', eingetragenVon: null },
			{ fuerId: 'max', name: 'Max M.', eingetragenVon: 'Sandra M.' },
		]);
		expect(a.optionen[2].namen).toEqual([{ fuerId: 'tim', name: 'Tim S.', eingetragenVon: 'Thomas K.' }]);
	});

	it('nennt einen entfernten Eintragenden "ehemaliges Mitglied"', () => {
		const u = umfrage({ antworten: [antwort('max', 'mia', 'o-dabei')] });
		expect(von('thomas', u)!.optionen[0].namen).toEqual([
			{ fuerId: 'max', name: 'Max M.', eingetragenVon: 'ehemaliges Mitglied' },
		]);
	});

	it('zaehlt Antworten Entfernter und nicht mehr Gefragter nicht', () => {
		const mitMia = umfrage({ antworten: [...antworten, antwort('mia', 'sandra', 'o-dabei')] });
		const a = von('sandra', mitMia)!;
		expect(a.optionen[0].anzahl).toBe(2);
		expect(a.offen.anzahl).toBe(2);

		const nurGross = von('sandra', umfrage({ antworten }), kopf(NUR_GROSS))!;
		expect(nurGross.optionen[0].namen).toEqual([{ fuerId: 'lena', name: 'Lena M.', eingetragenVon: null }]);
		expect(nurGross.offen.namen!.map((n) => n.fuerId)).toEqual(['jonas', 'paul']);
	});

	it('gibt bei "Nur als Summe" Sandra nur Zahlen', () => {
		const a = von('sandra', umfrage({ antworten, ergebnisse: 'SUMME' }))!;
		expect(a.ansicht).toBe('SUMME');
		expect(a.optionen.map((o) => o.anzahl)).toEqual([2, 0, 1]);
		expect(a.optionen.every((o) => o.namen === null)).toBe(true);
		expect(a.offen).toEqual({ anzahl: 2, namen: null });
	});

	it('gibt Sandra bei "Nur Jugendleiter" nichts', () => {
		expect(von('sandra', umfrage({ antworten, ergebnisse: 'JUGENDLEITER' }))).toBeNull();
	});

	it('zaehlt bei mehrfach jede gewaehlte Option und ordnet nach gegebener Reihenfolge', () => {
		const zwei: AntwortDaten = {
			fuerId: 'lena',
			vonId: 'lena',
			optionIds: ['o-abgesagt', 'o-dabei'],
			abgegebenAm: new Date('2026-10-21T12:00:00Z'),
		};
		const a = von('sandra', umfrage({ mehrfach: true, antworten: [zwei] }))!;
		expect(a.optionen.map((o) => [o.optionId, o.anzahl])).toEqual([
			['o-dabei', 1],
			['o-vielleicht', 0],
			['o-abgesagt', 1],
		]);
		expect(a.offen.anzahl).toBe(4);
	});
});
