import type { TerminDaten } from '../module/termin/termin.js';
import {
	threadAnsicht,
	threadDatenAus,
	umfrageAnsicht,
	type AnsichtEingabe,
	type ModulDaten,
	type UmfrageAnsicht,
} from './ansicht.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';
import type { ThreadKopf, UmfrageDaten } from './typen.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;

const termin = (startDatum: string): TerminDaten => ({
	modulId: 't1',
	startDatum,
	endDatum: null,
	beginn: null,
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
			{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
			{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		antworten: [],
		...daten,
	};
}

const umfrageModul = (daten: Partial<UmfrageDaten> = {}): Extract<ModulDaten, { typ: 'UMFRAGE' }> => ({
	typ: 'UMFRAGE',
	id: 'u1',
	titel: null,
	umfrage: umfrage(daten),
});
const infoModul: ModulDaten = { typ: 'INFO', id: 'i1', titel: 'Wichtig', text: 'Bitte Socken mitbringen' };
const terminModul = (startDatum = '2026-10-24'): ModulDaten => ({
	typ: 'TERMIN',
	id: 't1',
	titel: null,
	termin: termin(startDatum),
});

function eingabe(ich: string, k: ThreadKopf, module: ModulDaten[], rest: Partial<AnsichtEingabe> = {}): AnsichtEingabe {
	return {
		ich: person(ich),
		kopf: k,
		module,
		umfeld,
		stand: 12,
		verlaufEintraege: 0,
		nachrichten: [],
		zugangSeit: new Date('2026-01-01T00:00:00Z'),
		verlaufGelesenBis: null,
		jetzt: JETZT,
		...rest,
	};
}

const ansichtVon = (ich: string, k: ThreadKopf, module: ModulDaten[], rest: Partial<AnsichtEingabe> = {}) =>
	threadAnsicht(eingabe(ich, k, module, rest))!;
const umfrageVon = (a: ReturnType<typeof ansichtVon>, index = 0) => a.module[index] as UmfrageAnsicht;

describe('threadAnsicht: Umfragezeilen', () => {
	it('zeigt Sandra je eine Zeile fuer Lena und Max in Vornamen-Reihenfolge', () => {
		const u = umfrageVon(ansichtVon('sandra', kopf(), [umfrageModul()]));
		expect(
			u.zeilen.map((z) => ({ id: z.fuerId, vorname: z.vorname, selbst: z.selbst, darf: z.darfAntworten })),
		).toEqual([
			{ id: 'lena', vorname: 'Lena', selbst: false, darf: true },
			{ id: 'max', vorname: 'Max', selbst: false, darf: true },
		]);
		expect(u.zeilen.every((z) => z.optionIds.length === 0 && z.eingetragenVon === null)).toBe(true);
	});

	it('legt Antworten in die Zeile und sagt, wer sie eingetragen hat', () => {
		const antworten = [
			{ fuerId: 'max', vonId: 'sandra', optionIds: ['o-dabei'], abgegebenAm: JETZT },
			{ fuerId: 'lena', vonId: 'lena', optionIds: ['o-abgesagt'], abgegebenAm: JETZT },
		];
		const u = umfrageVon(ansichtVon('sandra', kopf(), [umfrageModul({ antworten })]));
		const zeile = (id: string) => u.zeilen.find((z) => z.fuerId === id)!;
		expect(zeile('max')).toMatchObject({ optionIds: ['o-dabei'], eingetragenVon: 'von dir eingetragen' });
		expect(zeile('lena')).toMatchObject({ optionIds: ['o-abgesagt'], eingetragenVon: null });
	});

	it('uebernimmt Frage, Optionen und Einstellungen der Umfrage', () => {
		const u = umfrageVon(ansichtVon('sandra', kopf(), [umfrageModul({ mehrfach: true })]));
		expect(u).toMatchObject({
			typ: 'UMFRAGE',
			id: 'u1',
			titel: null,
			frage: 'Kommst du mit?',
			einheit: 'JUNGFISCHER',
			mehrfach: true,
			teilnahme: true,
		});
		expect(u.optionen).toEqual([
			{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
			{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
			{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
		]);
	});
});

describe('threadAnsicht: Frist', () => {
	it('nennt die Frist als ISO-Zeitpunkt und laesst vor Ablauf antworten', () => {
		const u = umfrageVon(ansichtVon('sandra', kopf(), [umfrageModul()]));
		expect(u.frist).toBe('2026-10-22T16:00:00.000Z');
		expect(u.fristAbgelaufen).toBe(false);
	});

	it('sperrt in der Fristsekunde Sandra, nicht aber Thomas', () => {
		const modul = umfrageModul({ frist: JETZT });
		const sandra = umfrageVon(ansichtVon('sandra', kopf(), [modul]));
		expect(sandra.fristAbgelaufen).toBe(true);
		expect(sandra.frist).toBe('2026-10-22T10:00:00.000Z');
		expect(sandra.zeilen.map((z) => z.darfAntworten)).toEqual([false, false]);
		const thomas = umfrageVon(ansichtVon('thomas', kopf(), [modul]));
		expect(thomas.fristAbgelaufen).toBe(true);
		expect(thomas.zeilen).toMatchObject([{ fuerId: 'jonas', darfAntworten: true }]);
	});

	it('hat ohne Frist weder Text noch Ablauf', () => {
		const u = umfrageVon(ansichtVon('sandra', kopf(), [umfrageModul({ frist: null })]));
		expect(u.frist).toBeNull();
		expect(u.fristAbgelaufen).toBe(false);
	});
});

describe('threadAnsicht: Entwurf', () => {
	const entwurf = () => kopf({ veroeffentlichtAm: null });

	it('zeigt Thomas den Entwurf ohne Antwortknoepfe und mit Schreibsperre', () => {
		const a = ansichtVon('thomas', entwurf(), [umfrageModul()]);
		expect(a.entwurf).toBe(true);
		expect(a.schreibSperre).toBe('ENTWURF');
		expect(umfrageVon(a).zeilen.length).toBeGreaterThan(0);
		expect(umfrageVon(a).zeilen.every((z) => !z.darfAntworten)).toBe(true);
	});

	it('zeigt Sandra den Entwurf nicht', () => {
		expect(threadAnsicht(eingabe('sandra', entwurf(), [umfrageModul()]))).toBeNull();
	});
});

describe('threadAnsicht: Ergebnis', () => {
	it('liefert nur Berechtigten das Ergebnis', () => {
		const modul = umfrageModul({ ergebnisse: 'JUGENDLEITER' });
		expect(umfrageVon(ansichtVon('sandra', kopf(), [modul])).ergebnis).toBeNull();
		expect(umfrageVon(ansichtVon('bea', kopf(), [modul])).ergebnis?.ansicht).toBe('NAMEN');
	});
});

describe('threadAnsicht: Sichtbarkeit', () => {
	it('zeigt Lena den Austausch, Sandra nicht', () => {
		const austausch = kopf({
			id: 'austausch',
			art: 'JUGENDSPRECHER_AUSTAUSCH',
			rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
		});
		const lena = ansichtVon('lena', austausch, []);
		expect(lena).toMatchObject({ id: 'austausch', art: 'JUGENDSPRECHER_AUSTAUSCH', module: [] });
		expect(threadAnsicht(eingabe('sandra', austausch, []))).toBeNull();
	});
});

describe('threadAnsicht: Verlauf und Kopf', () => {
	const nachricht = (stand: number, daten: Partial<AnsichtEingabe['nachrichten'][number]> = {}) => ({
		art: 'NACHRICHT' as const,
		stand,
		autorId: 'sandra',
		angelegtAm: JETZT,
		geloeschtAm: null,
		...daten,
	});

	it('zaehlt fremde, nicht geloeschte Nachrichten ueber dem Gelesen-Stand', () => {
		const a = ansichtVon('thomas', kopf(), [], {
			verlaufEintraege: 6,
			verlaufGelesenBis: 5,
			nachrichten: [
				nachricht(6),
				nachricht(7, { autorId: 'hans' }),
				nachricht(8, { autorId: 'thomas' }),
				nachricht(9, { art: 'SYSTEM', autorId: null }),
				nachricht(10, { geloeschtAm: JETZT }),
				nachricht(4),
			],
		});
		expect(a.verlauf).toEqual({ eintraege: 6, ungelesen: 2 });
	});

	it('behaelt die Reihenfolge der Module und reicht den Stand durch', () => {
		const a = ansichtVon('sandra', kopf(), [terminModul(), infoModul, umfrageModul()], { stand: 42 });
		expect(a.module.map((m) => m.typ)).toEqual(['TERMIN', 'INFO', 'UMFRAGE']);
		expect(a.stand).toBe(42);
	});

	it('uebernimmt die Eigenschaften des Kopfs', () => {
		const a = ansichtVon('sandra', kopf({ angepinnt: true, titel: 'Bowling' }), []);
		expect(a).toMatchObject({
			id: 'bowling',
			titel: 'Bowling',
			art: 'NORMAL',
			modus: 'KOMMENTARE',
			rollenfilter: 'JUNGFISCHER_FAMILIE',
			angepinnt: true,
			entwurf: false,
			schreibSperre: null,
		});
	});

	it('folgt bei archiviert dem letzten Termin und sperrt das Schreiben', () => {
		const alt = ansichtVon('sandra', kopf(), [terminModul('2026-10-10')]);
		expect(alt.archiviert).toBe(true);
		expect(alt.schreibSperre).toBe('ARCHIVIERT');
		expect(ansichtVon('sandra', kopf(), [terminModul('2026-10-24')]).archiviert).toBe(false);
	});

	it('meldet Nur Aushang als Schreibsperre', () => {
		expect(ansichtVon('sandra', kopf({ modus: 'AUSHANG' }), []).schreibSperre).toBe('NUR_AUSHANG');
	});
});

describe('umfrageAnsicht', () => {
	it('liefert dieselbe Ansicht wie im Thread', () => {
		const modul = umfrageModul();
		const direkt = umfrageAnsicht(person('sandra'), modul, kopf(), umfeld, JETZT);
		expect(direkt).toEqual(umfrageVon(ansichtVon('sandra', kopf(), [modul])));
	});
});

describe('threadDatenAus', () => {
	it('sammelt Termine und Umfragen in Modulreihenfolge', () => {
		const k = kopf();
		const daten = threadDatenAus(k, [
			terminModul('2026-10-30'),
			infoModul,
			umfrageModul({ modulId: 'u1' }),
			terminModul('2026-10-24'),
			umfrageModul({ modulId: 'u2' }),
		]);
		expect(daten.kopf).toBe(k);
		expect(daten.termine.map((t) => t.startDatum)).toEqual(['2026-10-30', '2026-10-24']);
		expect(daten.umfragen.map((u) => u.modulId)).toEqual(['u1', 'u2']);
	});
});
