import { TestBed } from '@angular/core/testing';
import { erzeugeBeispieldaten, M, P, T } from '../daten/beispieldaten';
import type { Testereignis } from '../daten/ereignisse';
import { EntwurfStore } from '../daten/store';
import type { Modul } from '../daten/typen';
import { testProvider } from '../testhilfe';
import { AUFGABEN } from './aufgaben';
import { istErfuellt } from './pruefung';
import type { PersonKey, Suche } from './typen';

function store(ich: string = P.sandra): EntwurfStore {
	TestBed.configureTestingModule({ providers: testProvider() });
	const s = TestBed.inject(EntwurfStore);
	s.setzeIch(ich);
	return s;
}

const aufgabe = (k: PersonKey, nr: number) => AUFGABEN[k][nr - 1];

/** Prueft die Aufgabe vor und nach der Aktion; Ereignisse kommen dazu. */
function vorherNachher(s: EntwurfStore, k: PersonKey, nr: number, aktion: () => Testereignis[] | void) {
	const vorher = istErfuellt(aufgabe(k, nr), s.stand(), []);
	const ereignisse = aktion() ?? [];
	return { vorher, nachher: istErfuellt(aufgabe(k, nr), s.stand(), ereignisse) };
}

describe('AUFGABEN', () => {
	it('hat 6 Aufgaben fuer Sandra, 4 fuer Lena und 5 fuer Thomas mit den Texten der Spec', () => {
		expect(AUFGABEN.sandra).toHaveLength(6);
		expect(AUFGABEN.lena).toHaveLength(4);
		expect(AUFGABEN.thomas).toHaveLength(5);
		expect(aufgabe('sandra', 1).text).toBe('Melde Max fürs Bowling an.');
		expect(aufgabe('lena', 2).text).toBe('Finde heraus, mit wem du zum Bowling fährst.');
		expect(aufgabe('thomas', 5).text).toBe('Setz Max in ein anderes Auto, weil Familie Maier ausfällt.');
		const ids = Object.values(AUFGABEN).flatMap((l) => l.map((a) => a.id));
		expect(new Set(ids).size).toBe(15);
	});
});

describe('Pruefregeln Sandra', () => {
	it('1: Max sagt fuers Bowling zu', () => {
		const s = store();
		expect(vorherNachher(s, 'sandra', 1, () => s.antworten(T.bowling, M.bowlingUmfrage, P.max, ['ja']))).toEqual({
			vorher: false,
			nachher: true,
		});
	});

	it('1: eine Absage reicht nicht', () => {
		const s = store();
		s.antworten(T.bowling, M.bowlingUmfrage, P.max, ['nein']);
		expect(istErfuellt(aufgabe('sandra', 1), s.stand(), [])).toBe(false);
	});

	it('2: Sandra steht beim Kuchen', () => {
		const s = store();
		expect(
			vorherNachher(s, 'sandra', 2, () => {
				s.helferEintragen(T.herbstfest, M.herbstHelfer, 'h-kuchen', P.sandra);
			}),
		).toEqual({ vorher: false, nachher: true });
	});

	it('3: Max sitzt auf der Hinfahrt in einem Auto', () => {
		const s = store();
		expect(
			vorherNachher(s, 'sandra', 3, () => {
				s.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.max, 'a-huber-hin', 'hin');
			}),
		).toEqual({ vorher: false, nachher: true });
	});

	it('4: Lenas Zahlung ist gemeldet', () => {
		const s = store();
		expect(vorherNachher(s, 'sandra', 4, () => s.kostenSetzen(T.bowling, M.bowlingKosten, P.lena, 'gemeldet'))).toEqual(
			{ vorher: false, nachher: true },
		);
	});

	it('6: die Jugendfischereiordnung wurde geoeffnet, ein anderes Dokument zaehlt nicht', () => {
		const s = store();
		const a = aufgabe('sandra', 6);
		expect(istErfuellt(a, s.stand(), [{ art: 'dokumentGeoeffnet', id: 'g-verhalten' }])).toBe(false);
		expect(istErfuellt(a, s.stand(), [{ art: 'dokumentGeoeffnet', id: 'g-jfo' }])).toBe(true);
	});
});

describe('Pruefregeln Lena', () => {
	it('1: Lena hat eine Pizza gewaehlt', () => {
		const s = store(P.lena);
		expect(vorherNachher(s, 'lena', 1, () => s.antworten(T.zeltlager, M.pizzaUmfrage, P.lena, ['salami']))).toEqual({
			vorher: false,
			nachher: true,
		});
	});

	it('3: ein Foto vom Hegefischen wurde gross geoeffnet, Koenigsfischen zaehlt nicht', () => {
		const s = store(P.lena);
		const a = aufgabe('lena', 3);
		expect(istErfuellt(a, s.stand(), [{ art: 'fotoGeoeffnet', threadId: T.koenigsfischen, fotoId: 'x' }])).toBe(false);
		expect(istErfuellt(a, s.stand(), [{ art: 'fotoGeoeffnet', threadId: T.hegefischen, fotoId: 'x' }])).toBe(true);
	});

	it('4: neue Nachricht von Lena im Zeltlager; eine von Sandra zaehlt nicht', () => {
		const s = store(P.sandra);
		s.nachrichtSchreiben(T.zeltlager, 'Ich bringe Kuchen mit');
		expect(istErfuellt(aufgabe('lena', 4), s.stand(), [])).toBe(false);
		s.setzeIch(P.lena);
		s.nachrichtSchreiben(T.zeltlager, 'Was muss ich mitbringen?');
		expect(istErfuellt(aufgabe('lena', 4), s.stand(), [])).toBe(true);
	});
});

describe('Pruefregeln Thomas', () => {
	const termin: Modul = { id: 'm-x1', typ: 'termin', beginn: '2026-12-18T18:00', ort: 'Vereinsheim' };
	const umfrage: Modul = {
		id: 'm-x2',
		typ: 'umfrage',
		frage: 'Kommst du mit?',
		mehrfach: false,
		optionen: [
			{ id: 'ja', text: 'Ja' },
			{ id: 'nein', text: 'Nein' },
		],
		einheit: 'jungfischer',
		ergebnisse: 'alle',
		teilnahme: true,
		antworten: [],
	};
	const weihnachten = (veroeffentlicht: boolean, module: Modul[]) => ({
		id: '',
		nr: 0,
		titel: '🎄 Weihnachtsfeier',
		zielgruppe: { untergruppen: 'alle' as const, rollen: 'jungfischerUndEltern' as const },
		modus: 'kommentare' as const,
		angepinnt: false,
		archiviert: false,
		veroeffentlicht,
		erstelltVon: P.thomas,
		module,
		verlauf: [],
		letzteAktivitaet: '',
	});

	it('1: veroeffentlichte Weihnachtsfeier mit Termin und Umfrage', () => {
		const s = store(P.thomas);
		const a = aufgabe('thomas', 1);
		expect(istErfuellt(a, s.stand(), [])).toBe(false);
		s.threadSpeichern(weihnachten(false, [termin, umfrage]));
		expect(istErfuellt(a, s.stand(), [])).toBe(false);
		s.threadSpeichern(weihnachten(true, [termin]));
		expect(istErfuellt(a, s.stand(), [])).toBe(false);
		s.threadSpeichern(weihnachten(true, [termin, umfrage]));
		expect(istErfuellt(a, s.stand(), [])).toBe(true);
	});

	it('2: der Bowling-Stand wurde geteilt, ein anderer Thread zaehlt nicht', () => {
		const s = store(P.thomas);
		const a = aufgabe('thomas', 2);
		expect(istErfuellt(a, s.stand(), [{ art: 'geteilt', threadId: T.herbstfest }])).toBe(false);
		expect(istErfuellt(a, s.stand(), [{ art: 'geteilt', threadId: T.bowling }])).toBe(true);
	});

	it('3: Lenas Zahlung ist bestaetigt, gemeldet reicht nicht', () => {
		const s = store(P.thomas);
		const a = aufgabe('thomas', 3);
		s.kostenSetzen(T.bowling, M.bowlingKosten, P.lena, 'gemeldet');
		expect(istErfuellt(a, s.stand(), [])).toBe(false);
		s.kostenSetzen(T.bowling, M.bowlingKosten, P.lena, 'bezahlt');
		expect(istErfuellt(a, s.stand(), [])).toBe(true);
	});

	it('4: neue erwachsene Person angelegt und eingeladen', () => {
		const s = store(P.thomas);
		const a = aufgabe('thomas', 4);
		expect(istErfuellt(a, s.stand(), [{ art: 'einladungErzeugt', personId: P.sandra }])).toBe(false);
		const id = s.personAnlegen(
			{ vorname: 'Eva', nachname: 'Neumann', art: 'erwachsener', hatZugang: true, rechte: [] },
			[],
		);
		expect(istErfuellt(a, s.stand(), [])).toBe(false);
		expect(istErfuellt(a, s.stand(), [{ art: 'einladungErzeugt', personId: id }])).toBe(true);
	});

	it('4: ein neues Kind einzuladen zaehlt nicht', () => {
		const s = store(P.thomas);
		const id = s.personAnlegen(
			{ vorname: 'Ida', nachname: 'Neumann', art: 'jungfischer', alter: 13, hatZugang: true, rechte: [] },
			[],
		);
		expect(istErfuellt(aufgabe('thomas', 4), s.stand(), [{ art: 'einladungErzeugt', personId: id }])).toBe(false);
	});

	it('5: Max sitzt in einem Auto, das nicht Familie Maier gehoert', () => {
		const s = store(P.thomas);
		const a = aufgabe('thomas', 5);
		s.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.max, 'a-maier', 'hin');
		expect(istErfuellt(a, s.stand(), [])).toBe(false);
		s.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.max, 'a-huber-hin', 'hin');
		expect(istErfuellt(a, s.stand(), [])).toBe(true);
	});
});

describe('Suchaufgaben', () => {
	const suche = (k: PersonKey, nr: number) => aufgabe(k, nr) as Suche;

	it('Sandra 5: naechste Gruppenstunde am Bezugstag 11.10.2026', () => {
		const { richtig, falsch } = suche('sandra', 5).antworten(erzeugeBeispieldaten('2026-10-11'));
		expect(richtig).toBe('Dienstag 18:00 · Vereinsheim');
		expect(falsch).not.toContain(richtig);
		expect(new Set(falsch).size).toBe(2);
	});

	it('Sandra 5: die Antwort folgt dem Bezugstag statt festem Text', () => {
		const { richtig } = suche('sandra', 5).antworten(erzeugeBeispieldaten('2026-10-14'));
		expect(richtig).toBe('Freitag 18:00 · Vereinsheim');
	});

	it('Lena 2: Lena faehrt hin bei Familie Maier', () => {
		const { richtig, falsch } = suche('lena', 2).antworten(erzeugeBeispieldaten('2026-10-11'));
		expect(richtig).toBe('Familie Maier');
		expect(falsch).not.toContain(richtig);
		expect(new Set(falsch).size).toBe(2);
	});

	it('Suchaufgaben gelten nie als am Datenstand erfuellt', () => {
		const stand = erzeugeBeispieldaten('2026-10-11');
		expect(istErfuellt(aufgabe('sandra', 5), stand, [])).toBe(false);
		expect(istErfuellt(aufgabe('lena', 2), stand, [])).toBe(false);
	});
});
