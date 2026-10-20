import type { TerminDaten } from '../module/termin/termin.js';
import { threadDatenAus, type ModulDaten } from './ansicht.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';
import type { AntwortDaten, ThreadKopf, UmfrageDaten } from './typen.js';
import { antwortenUebersicht, siehtAntworten, verwaltungThread, zielgruppeText } from './verwaltung.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;

const UNTERGRUPPEN = new Map([
	['gross', 'Wölflinge'],
	['klein', 'Biber'],
]);

describe('zielgruppeText', () => {
	it('nennt bei allen Untergruppen nur Alle und den Rollenfilter', () => {
		expect(zielgruppeText(kopf(), UNTERGRUPPEN)).toBe('Alle · Jungfischer + Familie');
	});

	it('sortiert die gewaehlten Namen nach Alphabet, nicht nach Auswahl', () => {
		const k = kopf({ alleUntergruppen: false, untergruppenIds: ['gross', 'klein'], rollenfilter: 'NUR_FAMILIE' });
		expect(zielgruppeText(k, UNTERGRUPPEN)).toBe('Biber, Wölflinge · Nur Familie');
	});

	it('uebergeht Untergruppen, die es nicht mehr gibt', () => {
		const k = kopf({ alleUntergruppen: false, untergruppenIds: ['klein', 'weg'] });
		expect(zielgruppeText(k, UNTERGRUPPEN)).toBe('Biber · Jungfischer + Familie');
	});

	it('sagt Keine Zielgruppe mehr, wenn keine gewaehlte Untergruppe bekannt ist', () => {
		const unbekannt = kopf({ alleUntergruppen: false, untergruppenIds: ['weg'] });
		expect(zielgruppeText(unbekannt, UNTERGRUPPEN)).toBe('Keine Zielgruppe mehr');
		const leer = kopf({ alleUntergruppen: false, untergruppenIds: [] });
		expect(zielgruppeText(leer, UNTERGRUPPEN)).toBe('Keine Zielgruppe mehr');
	});
});

const termin = (startDatum: string, modulId = 't1'): TerminDaten => ({
	modulId,
	startDatum,
	endDatum: null,
	beginn: '18:00',
	ende: null,
	ort: null,
	treffpunkt: null,
});

function umfrage(daten: Partial<UmfrageDaten> = {}): UmfrageDaten {
	return {
		modulId: 'u1',
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: true,
		frist: new Date('2026-10-22T16:00:00Z'),
		ergebnisse: 'ALLE',
		optionen: [
			{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
			{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		antworten: [],
		...daten,
	};
}

const antwort = (fuerId: string, vonId: string, optionIds: string[]): AntwortDaten => ({
	fuerId,
	vonId,
	optionIds,
	abgegebenAm: JETZT,
});

const daten = (k: ThreadKopf, module: ModulDaten[] = []) => threadDatenAus(k, module);
const terminModul = (startDatum: string, id = 't1'): ModulDaten => ({
	typ: 'TERMIN',
	id,
	titel: null,
	termin: termin(startDatum, id),
});
const umfrageModul = (u: Partial<UmfrageDaten> = {}): ModulDaten => ({
	typ: 'UMFRAGE',
	id: u.modulId ?? 'u1',
	titel: null,
	umfrage: umfrage(u),
});

describe('verwaltungThread', () => {
	it('beschreibt einen veroeffentlichten Thread fuer den Ersteller', () => {
		const t = verwaltungThread(
			person('thomas'),
			daten(kopf({ titel: 'Bowling', angepinnt: true }), [
				terminModul('2026-10-30', 't2'),
				terminModul('2026-10-24'),
				umfrageModul(),
			]),
			UNTERGRUPPEN,
			JETZT,
		);
		expect(t).toEqual({
			id: 'bowling',
			segment: 'bowling-bowling',
			titel: 'Bowling',
			art: 'NORMAL',
			entwurf: false,
			archiviert: false,
			angepinnt: true,
			zielgruppe: 'Alle · Jungfischer + Familie',
			keineZielgruppe: false,
			naechsterTermin: 'Sa 24.10. · 18:00',
			darfBearbeiten: true,
			darfAntwortenSehen: true,
			hatUmfrage: true,
		});
	});

	it('kennzeichnet einen Entwurf ohne Termin und ohne Umfrage', () => {
		const t = verwaltungThread(person('thomas'), daten(kopf({ veroeffentlichtAm: null })), UNTERGRUPPEN, JETZT);
		expect(t).toMatchObject({ entwurf: true, naechsterTermin: null, hatUmfrage: false, archiviert: false });
	});

	it('meldet archiviert nach dem letzten Termin und schweigt dort ueber den naechsten', () => {
		const t = verwaltungThread(person('thomas'), daten(kopf(), [terminModul('2026-10-10')]), UNTERGRUPPEN, JETZT);
		expect(t).toMatchObject({ archiviert: true, naechsterTermin: null });
	});

	it('meldet keine Zielgruppe, wenn die letzte gewaehlte Untergruppe fehlt, und fremde Threads als nicht bearbeitbar', () => {
		const k = kopf({ alleUntergruppen: false, untergruppenIds: ['weg'], erstelltVonId: 'petra' });
		const t = verwaltungThread(person('petra'), daten(k), UNTERGRUPPEN, JETZT);
		expect(t).toMatchObject({ keineZielgruppe: true, zielgruppe: 'Keine Zielgruppe mehr', darfBearbeiten: true });
		const fremd = verwaltungThread(person('petra'), daten(kopf({ erstelltVonId: 'thomas' })), UNTERGRUPPEN, JETZT);
		expect(fremd.darfBearbeiten).toBe(false);
	});
});

describe('siehtAntworten', () => {
	it('gilt fuer Bearbeiter und fuer Antworten im Detail, nicht fuer Ersteller fremder Threads', () => {
		expect(siehtAntworten(person('thomas'), kopf())).toBe(true);
		expect(siehtAntworten(person('bea'), kopf())).toBe(true);
		// Petra darf Threads erstellen, aber nicht den von Thomas bearbeiten.
		expect(siehtAntworten(person('petra'), kopf())).toBe(false);
		expect(siehtAntworten(person('petra'), kopf({ erstelltVonId: 'petra' }))).toBe(true);
		expect(siehtAntworten(person('sandra'), kopf())).toBe(false);
	});

	it('verwaltungThread meldet es je Zeile', () => {
		const fremd = verwaltungThread(person('petra'), daten(kopf(), [umfrageModul()]), UNTERGRUPPEN, JETZT);
		expect(fremd).toMatchObject({ hatUmfrage: true, darfBearbeiten: false, darfAntwortenSehen: false });
		const betreuer = verwaltungThread(person('bea'), daten(kopf(), [umfrageModul()]), UNTERGRUPPEN, JETZT);
		expect(betreuer).toMatchObject({ darfBearbeiten: false, darfAntwortenSehen: true });
	});
});

describe('antwortenUebersicht', () => {
	const antworten = [
		antwort('lena', 'lena', ['o-abgesagt']),
		antwort('max', 'sandra', ['o-dabei']),
		antwort('tim', 'thomas', []),
		antwort('mia', 'mia', ['o-dabei']),
	];
	const thread = (u: Partial<UmfrageDaten> = {}, k: ThreadKopf = kopf()) =>
		daten(k, [umfrageModul({ antworten, ...u })]);

	it('zeigt Thomas alle Gefragten in Vornamen-Reihenfolge mit Kurznamen', () => {
		const u = antwortenUebersicht(person('thomas'), thread(), umfeld, JETZT)!;
		expect(u).toMatchObject({
			threadId: 'bowling',
			segment: 'bowling-bowling',
			titel: '🎳 Bowling',
			darfNachtragen: true,
		});
		expect(u.umfragen).toHaveLength(1);
		expect(u.umfragen[0].zeilen).toEqual([
			{ fuerId: 'jonas', name: 'Jonas K.', optionIds: [], eingetragenVon: null },
			{ fuerId: 'lena', name: 'Lena M.', optionIds: ['o-abgesagt'], eingetragenVon: null },
			{ fuerId: 'max', name: 'Max M.', optionIds: ['o-dabei'], eingetragenVon: 'Sandra M.' },
			{ fuerId: 'paul', name: 'Paul V.', optionIds: [], eingetragenVon: null },
			{ fuerId: 'tim', name: 'Tim S.', optionIds: [], eingetragenVon: 'Thomas K.' },
		]);
	});

	it('zaehlt als offen, wer keine Antwort oder keine Option hat, und laesst Entfernte weg', () => {
		const [u] = antwortenUebersicht(person('thomas'), thread(), umfeld, JETZT)!.umfragen;
		expect(u.offen).toBe(3);
		expect(u.zeilen.map((z) => z.fuerId)).not.toContain('mia');
	});

	it('uebernimmt Frage, Frist, Optionen und Einstellungen', () => {
		const [u] = antwortenUebersicht(person('thomas'), thread({ mehrfach: true }), umfeld, JETZT)!.umfragen;
		expect(u).toMatchObject({
			modulId: 'u1',
			frage: 'Kommst du mit?',
			frist: '2026-10-22T16:00:00.000Z',
			fristAbgelaufen: false,
			mehrfach: true,
			teilnahme: true,
		});
		expect(u.optionen).toEqual([
			{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
			{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
		]);
	});

	it('meldet den Fristablauf in der Fristsekunde und ohne Frist nie', () => {
		const abgelaufen = antwortenUebersicht(person('thomas'), thread({ frist: JETZT }), umfeld, JETZT)!;
		expect(abgelaufen.umfragen[0]).toMatchObject({ frist: '2026-10-22T10:00:00.000Z', fristAbgelaufen: true });
		const ohne = antwortenUebersicht(person('thomas'), thread({ frist: null }), umfeld, JETZT)!;
		expect(ohne.umfragen[0]).toMatchObject({ frist: null, fristAbgelaufen: false });
	});

	it('gibt Bea mit nur Antworten im Detail die Uebersicht ohne Nachtragen', () => {
		const u = antwortenUebersicht(person('bea'), thread(), umfeld, JETZT)!;
		expect(u.darfNachtragen).toBe(false);
		expect(u.umfragen[0].zeilen).toHaveLength(5);
	});

	it('gibt Sandra und Petra ohne Recht an diesem Thread null', () => {
		expect(antwortenUebersicht(person('sandra'), thread(), umfeld, JETZT)).toBeNull();
		// Petra darf Threads erstellen, aber nicht den von Thomas bearbeiten.
		expect(antwortenUebersicht(person('petra'), thread(), umfeld, JETZT)).toBeNull();
		const eigener = thread({}, kopf({ erstelltVonId: 'petra' }));
		expect(antwortenUebersicht(person('petra'), eigener, umfeld, JETZT)).toMatchObject({ darfNachtragen: true });
	});

	it('laesst in einem Entwurf nicht nachtragen, weil dort niemand antworten kann', () => {
		const entwurf = thread({}, kopf({ veroeffentlichtAm: null }));
		expect(antwortenUebersicht(person('thomas'), entwurf, umfeld, JETZT)).toMatchObject({ darfNachtragen: false });
	});

	it('gibt null fuer einen Entfernten mit Recht', () => {
		const entfernt = { ...person('bea'), entferntAm: new Date('2026-09-01T00:00:00Z') };
		expect(antwortenUebersicht(entfernt, thread(), umfeld, JETZT)).toBeNull();
	});

	it('hat ohne Umfrage eine leere Liste', () => {
		expect(antwortenUebersicht(person('thomas'), daten(kopf()), umfeld, JETZT)?.umfragen).toEqual([]);
	});

	it('nennt Entfernte als eintragende Person ehemaliges Mitglied', () => {
		const u = antwortenUebersicht(
			person('thomas'),
			thread({ antworten: [antwort('lena', 'mia', ['o-dabei'])] }),
			umfeld,
			JETZT,
		)!;
		expect(u.umfragen[0].zeilen.find((z) => z.fuerId === 'lena')?.eingetragenVon).toBe('ehemaliges Mitglied');
	});
});
