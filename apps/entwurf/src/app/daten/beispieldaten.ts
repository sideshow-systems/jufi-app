import type { Datenstand, Dokument, Elternschaft, Person, Recht, Thread, Untergruppe, VerlaufEintrag } from './typen';
import { wochentag } from '../gestaltung/format';
import { naechsterWochentag, relativ } from './zeit';

/**
 * Beispieldaten nach Spec TP1 Abschnitt 3. Alle Namen sind erfunden.
 *
 * Die festen IDs sind exportiert, damit Regeln, Tests und Pruefregeln des
 * Testmodus dieselben Personen und Threads ansprechen, ohne nach Namen zu suchen.
 */
export const P = {
	sandra: 'p-sandra',
	lena: 'p-lena',
	max: 'p-max',
	thomas: 'p-thomas',
	jonas: 'p-jonas',
	katrin: 'p-katrin',
	michael: 'p-michael',
} as const;

export const T = {
	infos: 't-infos',
	bowling: 't-bowling',
	herbstfest: 't-herbstfest',
	zeltlager: 't-zeltlager',
	hegefischen: 't-hegefischen',
	pruefung: 't-pruefung',
	orga: 't-orga',
	koenigsfischen: 't-koenigsfischen',
} as const;

export const M = {
	gruppenstunde: 'm-gruppenstunde',
	bowlingTermin: 'm-bowling-termin',
	bowlingUmfrage: 'm-bowling-umfrage',
	bowlingFahrt: 'm-bowling-fahrt',
	bowlingKosten: 'm-bowling-kosten',
	bowlingDatei: 'm-bowling-datei',
	herbstHelfer: 'm-herbst-helfer',
	pizzaUmfrage: 'm-pizza-umfrage',
	hegeFotos: 'm-hege-fotos',
} as const;

export const UG = { aeltere: 'u-aeltere', zeltlager: 'u-zeltlager' } as const;

const ALLE_RECHTE: Recht[] = [
	'mitglieder',
	'threadsErstellen',
	'alleThreads',
	'dokumente',
	'antwortenDetail',
	'rechteVerwalten',
	'einstellungen',
];

const erwachsen = (id: string, vorname: string, nachname: string, rechte: Recht[] = []): Person => ({
	id,
	vorname,
	nachname,
	art: 'erwachsener',
	hatZugang: true,
	rechte,
});

const kind = (id: string, vorname: string, nachname: string, alter: number, extra: Partial<Person> = {}): Person => ({
	id,
	vorname,
	nachname,
	art: 'jungfischer',
	alter,
	// Ab 12 haben die Kinder im Beispiel einen eigenen Zugang; juengere handeln
	// ueber die Eltern (Rahmen 3.3).
	hatZugang: alter >= 12,
	fotoEinwilligung: true,
	rechte: [],
	...extra,
});

/** Die weiteren Familien: [Kind-ID, Vorname, Alter, Eltern-ID, Elternvorname, Nachname]. */
const FAMILIEN: [string, string, number, string, string, string][] = [
	['k-paul', 'Paul', 12, 'e-petra', 'Petra', 'Maier'],
	['k-anna', 'Anna', 11, 'e-stefan', 'Stefan', 'Huber'],
	['k-tim', 'Tim', 14, 'e-julia', 'Julia', 'Berger'],
	['k-mia', 'Mia', 13, 'e-andrea', 'Andrea', 'Schuster'],
	['k-felix', 'Felix', 15, 'e-martin', 'Martin', 'Lang'],
	['k-sophie', 'Sophie', 11, 'e-martin', 'Martin', 'Lang'],
	['k-leon', 'Leon', 16, 'e-claudia', 'Claudia', 'Fischer'],
	['k-emma', 'Emma', 9, 'e-daniel', 'Daniel', 'Kraus'],
	['k-noah', 'Noah', 14, 'e-sabine', 'Sabine', 'Weber'],
	['k-lukas', 'Lukas', 12, 'e-andreas', 'Andreas', 'Bauer'],
	['k-hannah', 'Hannah', 10, 'e-nicole', 'Nicole', 'Wolf'],
	['k-ben', 'Ben', 13, 'e-markus', 'Markus', 'Zimmer'],
];

export function erzeugeBeispieldaten(bezugstag: string): Datenstand {
	const r = (tage: number, uhrzeit: string) => relativ(bezugstag, tage, uhrzeit);
	const samstag = naechsterWochentag(bezugstag, 6);

	const personen: Person[] = [
		erwachsen(P.sandra, 'Sandra', 'Wagner'),
		kind(P.lena, 'Lena', 'Wagner', 13),
		kind(P.max, 'Max', 'Wagner', 10, { fotoEinwilligung: false }),
		erwachsen(P.thomas, 'Thomas', 'Schmid', [...ALLE_RECHTE]),
		kind(P.jonas, 'Jonas', 'Schmid', 12),
		erwachsen(
			P.katrin,
			'Katrin',
			'Hofmann',
			ALLE_RECHTE.filter((x) => x !== 'rechteVerwalten' && x !== 'einstellungen'),
		),
		erwachsen(P.michael, 'Michael', 'Brandl', ['antwortenDetail']),
	];
	const elternschaften: Elternschaft[] = [
		{ elternteil: P.sandra, kind: P.lena },
		{ elternteil: P.sandra, kind: P.max },
		{ elternteil: P.thomas, kind: P.jonas },
	];
	for (const [kid, vorname, alter, eid, evorname, nachname] of FAMILIEN) {
		personen.push(kind(kid, vorname, nachname, alter));
		if (!personen.some((p) => p.id === eid)) personen.push(erwachsen(eid, evorname, nachname));
		elternschaften.push({ elternteil: eid, kind: kid });
	}

	const untergruppen: Untergruppe[] = [
		{ id: UG.aeltere, name: 'Ältere', mitglieder: ['k-tim', 'k-felix', 'k-leon', 'k-noah'] },
		{
			id: UG.zeltlager,
			name: 'Zeltlager-Teilnehmer',
			mitglieder: [P.lena, P.jonas, 'k-paul', 'k-mia', 'k-tim', 'k-felix', 'k-leon', 'k-ben'],
		},
	];

	let n = 0;
	const msg = (von: string, text: string, zeit: string): VerlaufEintrag => ({
		id: `v-${++n}`,
		art: 'nachricht',
		von,
		text,
		zeit,
	});
	const alle = { untergruppen: 'alle' as const, rollen: 'jungfischerUndEltern' as const };
	const basis = { angepinnt: false, archiviert: false, veroeffentlicht: true, erstelltVon: P.thomas, verlauf: [] };

	const threads: Thread[] = [
		{
			...basis,
			id: T.infos,
			nr: 1,
			titel: '📌 Wichtige Infos',
			zielgruppe: alle,
			modus: 'aushang',
			angepinnt: true,
			letzteAktivitaet: r(-3, '19:00'),
			module: [
				{
					id: 'm-infos-text',
					typ: 'info',
					// Der Wochentag folgt dem Termin, sonst widerspraeche der Text der
					// Suchaufgabe "naechstes Treffen" an jedem Bezugstag ausser Sonntag.
					text: `Hier findet ihr alles, was dauerhaft gilt.\n\nDie Gruppenstunde ist jeden ${wochentag(r(2, '18:00'))} im Vereinsheim. Bitte wetterfeste Kleidung mitbringen.`,
				},
				{
					id: M.gruppenstunde,
					typ: 'termin',
					titel: 'Nächste Gruppenstunde',
					beginn: r(2, '18:00'),
					ende: r(2, '19:30'),
					ort: 'Vereinsheim',
				},
			],
		},
		{
			...basis,
			id: T.bowling,
			nr: 2,
			titel: '🎳 Bowling',
			zielgruppe: alle,
			modus: 'kommentare',
			letzteAktivitaet: r(-1, '19:12'),
			module: [
				{
					id: M.bowlingTermin,
					typ: 'termin',
					beginn: r(samstag, '14:00'),
					ende: r(samstag, '17:00'),
					ort: 'Bowlingcenter Dachau',
					treffpunkt: '13:30 am Vereinsheim',
				},
				{
					id: M.bowlingUmfrage,
					typ: 'umfrage',
					frage: 'Kommst du mit?',
					mehrfach: false,
					optionen: [
						{ id: 'ja', text: 'Ja' },
						{ id: 'nein', text: 'Nein' },
					],
					einheit: 'jungfischer',
					frist: r(3, '20:00'),
					ergebnisse: 'alle',
					teilnahme: true,
					antworten: [
						{ fuer: P.lena, von: P.lena, optionen: ['ja'], zeit: r(-2, '17:40') },
						{ fuer: 'k-paul', von: 'e-petra', optionen: ['ja'], zeit: r(-2, '20:05') },
						{ fuer: 'k-mia', von: 'e-andrea', optionen: ['nein'], zeit: r(-1, '07:15') },
						{ fuer: 'k-hannah', von: 'e-nicole', optionen: ['nein'], zeit: r(-1, '19:12') },
					],
				},
				{
					id: M.bowlingFahrt,
					typ: 'fahrt',
					autos: [
						{
							id: 'a-maier',
							fahrer: 'e-petra',
							richtung: 'hin',
							plaetze: 3,
							abfahrt: '13:30',
							ort: 'Kirchplatz',
							mitfahrer: [P.lena, 'k-paul'],
						},
						{
							id: 'a-huber-hin',
							fahrer: 'e-stefan',
							richtung: 'hin',
							plaetze: 2,
							abfahrt: '13:30',
							ort: 'Vereinsheim',
							mitfahrer: [],
						},
						{
							id: 'a-huber-rueck',
							fahrer: 'e-stefan',
							richtung: 'rueck',
							plaetze: 2,
							abfahrt: '17:15',
							ort: 'Bowlingcenter',
							mitfahrer: [],
						},
					],
				},
				{
					id: M.bowlingKosten,
					typ: 'kosten',
					titel: 'Bowling',
					betragCent: 1200,
					hinweis: 'Zwei Spiele, Schuhe und ein Getränk. Bitte bis Freitag überweisen.',
					iban: 'DE00 1234 5678 9000 0000 00',
					// Erkennbar erfunden: ein echt wirkender Name koennte einem Fremden gehoeren.
					paypal: 'beispiel@example.org',
					status: {},
				},
				{
					id: M.bowlingDatei,
					typ: 'dateien',
					dateien: [{ id: 'd-bowling', name: 'Einverständniserklärung Bowling.pdf', groesse: '84 KB' }],
				},
			],
			verlauf: [
				msg('e-petra', 'Paul ist dabei! Ich kann noch ein Kind mitnehmen.', r(-2, '20:06')),
				msg(P.katrin, 'Danke Petra! Bitte bis Mittwoch zu- oder absagen.', r(-1, '08:30')),
			],
		},
		{
			...basis,
			id: T.herbstfest,
			nr: 3,
			titel: '🍂 Herbstfest – Helfer',
			zielgruppe: { untergruppen: 'alle', rollen: 'nurEltern' },
			modus: 'kommentare',
			letzteAktivitaet: r(-2, '21:10'),
			module: [
				{
					id: 'm-herbst-text',
					typ: 'info',
					text: 'Beim Herbstfest des Vereins betreut die Jugend den Kuchenstand. Wir brauchen eure Hilfe!',
				},
				{
					id: M.herbstHelfer,
					typ: 'helfer',
					titel: 'Wer hilft mit?',
					einheit: 'erwachsener',
					frist: r(14, '20:00'),
					plaetze: [
						{
							id: 'h-kuchen',
							text: 'Kuchen',
							anzahl: 5,
							eintraege: ['e-petra', 'e-julia', 'e-andrea'].map((id) => ({ fuer: id, von: id })),
						},
						{ id: 'h-salat', text: 'Salat', anzahl: 4, eintraege: [{ fuer: 'e-martin', von: 'e-martin' }] },
						{
							id: 'h-aufbau',
							text: 'Aufbau Sa',
							anzahl: 4,
							eintraege: ['e-stefan', 'e-daniel'].map((id) => ({ fuer: id, von: id })),
						},
						{ id: 'h-abbau', text: 'Abbau', anzahl: 4, eintraege: [] },
					],
				},
				{ id: 'm-herbst-termin', typ: 'termin', beginn: r(21, '11:00'), ende: r(21, '17:00'), ort: 'Vereinsgelände' },
			],
		},
		{
			...basis,
			id: T.zeltlager,
			nr: 4,
			titel: '⛺ Zeltlager 2027',
			zielgruppe: { untergruppen: [UG.zeltlager], rollen: 'jungfischerUndEltern' },
			modus: 'chat',
			erstelltVon: P.katrin,
			letzteAktivitaet: r(0, '08:30'),
			module: [
				{
					id: 'm-zelt-text',
					typ: 'info',
					text: 'Das Zeltlager 2027 geht an den Chiemsee. Beim Vortreffen besprechen wir Packliste und Anreise.',
				},
				{
					id: 'm-zelt-termin',
					typ: 'termin',
					titel: 'Vortreffen',
					beginn: r(14, '17:00'),
					ende: r(14, '19:00'),
					ort: 'Vereinsheim',
				},
				{
					id: M.pizzaUmfrage,
					typ: 'umfrage',
					frage: 'Welche Pizza beim Vortreffen?',
					mehrfach: false,
					optionen: [
						{ id: 'margherita', text: 'Margherita' },
						{ id: 'salami', text: 'Salami' },
						{ id: 'schinken', text: 'Schinken' },
						{ id: 'vegetarisch', text: 'Vegetarisch' },
					],
					einheit: 'person',
					frist: r(10, '20:00'),
					ergebnisse: 'alle',
					teilnahme: false,
					antworten: [
						{ fuer: P.jonas, von: P.jonas, optionen: ['salami'], zeit: r(-1, '16:00') },
						{ fuer: 'k-tim', von: 'k-tim', optionen: ['margherita'], zeit: r(-1, '17:20') },
						{ fuer: 'e-petra', von: 'e-petra', optionen: ['vegetarisch'], zeit: r(0, '08:10') },
					],
				},
			],
			verlauf: [
				msg(P.katrin, 'Hallo zusammen! Hier können wir alles rund ums Zeltlager besprechen.', r(-3, '18:00')),
				msg('k-tim', 'Dürfen wir wieder Kanu fahren?', r(-1, '17:22')),
				msg(P.katrin, 'Ja, Kanus sind schon reserviert 🛶', r(-1, '18:05')),
				msg('e-petra', 'Gibt es eine Packliste?', r(0, '08:30')),
			],
		},
		{
			...basis,
			id: T.hegefischen,
			nr: 5,
			titel: '🎣 Hegefischen',
			zielgruppe: alle,
			modus: 'kommentare',
			letzteAktivitaet: r(-4, '20:00'),
			module: [
				{
					id: 'm-hege-text',
					typ: 'info',
					text: 'Danke an alle fürs Mitmachen! Ergebnisse: 1. Leon (4 Brachsen), 2. Mia (3 Rotaugen), 3. Paul (2 Barsche).',
				},
				{
					id: M.hegeFotos,
					typ: 'fotos',
					fotos: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `f-hege-${i}`, bild: `fotos/f${i}.svg`, von: P.katrin })),
				},
				{
					id: 'm-hege-termin',
					typ: 'termin',
					beginn: r(-5, '07:00'),
					ende: r(-5, '12:00'),
					ort: 'Glonn bei Petershausen',
				},
			],
			verlauf: [msg('e-claudia', 'Leon ist immer noch ganz stolz 😄', r(-4, '20:00'))],
		},
		{
			...basis,
			id: T.pruefung,
			nr: 6,
			titel: '📝 Fischerprüfung 2027',
			zielgruppe: { untergruppen: [UG.aeltere], rollen: 'jungfischerUndEltern' },
			modus: 'kommentare',
			letzteAktivitaet: r(-6, '18:00'),
			module: [
				{
					id: 'm-pruefung-text',
					typ: 'info',
					text: 'Wer ab 14 die Fischerprüfung machen will: Der Vorbereitungskurs startet im Januar.',
				},
				{
					id: 'm-pruefung-datei',
					typ: 'dateien',
					dateien: [{ id: 'd-pruefung', name: 'Lernunterlagen Fischerprüfung.pdf', groesse: '2,1 MB' }],
				},
			],
		},
		{
			...basis,
			id: T.orga,
			nr: 7,
			titel: '🔧 Orga Jugendleiter',
			zielgruppe: { untergruppen: 'alle', rollen: 'nurJugendleiter' },
			modus: 'chat',
			letzteAktivitaet: r(-1, '21:30'),
			module: [{ id: 'm-orga-text', typ: 'info', text: 'Interne Absprachen der Jugendleitung.' }],
			verlauf: [
				msg(P.katrin, 'Wer kümmert sich um die Bowling-Reservierung?', r(-1, '21:00')),
				msg(P.thomas, 'Mach ich morgen.', r(-1, '21:30')),
			],
		},
		{
			...basis,
			id: T.koenigsfischen,
			nr: 8,
			titel: '🏆 Königsfischen 2026',
			zielgruppe: alle,
			modus: 'aushang',
			archiviert: true,
			letzteAktivitaet: r(-40, '18:00'),
			module: [
				{ id: 'm-koenig-termin', typ: 'termin', beginn: r(-42, '06:30'), ende: r(-42, '13:00'), ort: 'Vereinsweiher' },
				{
					id: 'm-koenig-fotos',
					typ: 'fotos',
					fotos: [7, 8].map((i) => ({ id: `f-koenig-${i}`, bild: `fotos/f${i}.svg`, von: P.thomas })),
				},
			],
		},
	];

	const dokumente: Dokument[] = [
		{ id: 'g-jfo', kategorie: 'Ordnungen', name: 'Jugendfischereiordnung', groesse: '320 KB' },
		{ id: 'g-mindestmasse', kategorie: 'Merkblätter', name: 'Mindestmaße und Schonzeiten', groesse: '150 KB' },
		{ id: 'g-verhalten', kategorie: 'Merkblätter', name: 'Verhalten am Wasser', groesse: '95 KB' },
		{ id: 'g-fragebogen', kategorie: 'Formulare', name: 'Fragebogen für Erziehungsberechtigte', groesse: '60 KB' },
	];

	// Der letzte Besuch liegt zwei Tage zurueck, damit "Neu seit deinem letzten
	// Besuch" beim ersten Oeffnen etwas zeigt.
	const vorZweiTagen = r(-2, '12:00');
	const letzterBesuch = Object.fromEntries(personen.map((p) => [p.id, vorZweiTagen]));

	return {
		version: 1,
		bezugstag,
		verein: { name: 'Jungfischer Glonntal', slug: 'glonntal', farbe: '#0f766e', logo: 'logo.svg' },
		personen,
		elternschaften,
		untergruppen,
		threads,
		dokumente,
		letzterBesuch,
	};
}
