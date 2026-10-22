import type { EinwilligungZeile } from '../einwilligung.js';
import type { TerminDaten } from '../module/termin/termin.js';
import {
	threadAnsicht,
	threadDatenAus,
	umfrageAnsicht,
	type AnsichtEingabe,
	type ModulDaten,
	type UmfrageAnsicht,
} from './ansicht.js';
import type { DateienModulAnsicht, FotosModulAnsicht } from '../dateien/module.js';
import { absenderName } from './namen.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';
import type { FahrtModulAnsicht } from '../module/fahrt/fahrt.js';
import type { HelferModulAnsicht } from '../module/helfer/helfer.js';
import type {
	AutoDaten,
	FahrtDaten,
	HelferDaten,
	HelferEintragDaten,
	HelferPositionDaten,
	MitfahrtDaten,
	Richtung,
	ThreadKopf,
	UmfrageDaten,
} from './typen.js';

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
		fotoEinwilligungen: new Map(),
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

describe('threadAnsicht: Bearbeitungsrechte', () => {
	it('laesst Thomas bearbeiten und archivieren, Sandra nicht', () => {
		expect(ansichtVon('thomas', kopf(), [])).toMatchObject({ darfBearbeiten: true, darfArchivieren: true });
		expect(ansichtVon('sandra', kopf(), [])).toMatchObject({ darfBearbeiten: false, darfArchivieren: false });
	});

	it('laesst Petra mit nur Threads erstellen den Thread eines anderen nicht bearbeiten', () => {
		expect(ansichtVon('petra', kopf(), [])).toMatchObject({ darfBearbeiten: false, darfArchivieren: false });
		expect(ansichtVon('petra', kopf({ erstelltVonId: 'petra' }), [])).toMatchObject({
			darfBearbeiten: true,
			darfArchivieren: true,
		});
	});

	it('laesst am Austausch einen Inhaber von Alle Threads bearbeiten, aber nicht archivieren', () => {
		const austausch = kopf({
			id: 'austausch',
			art: 'JUGENDSPRECHER_AUSTAUSCH',
			rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
		});
		expect(ansichtVon('thomas', austausch, [])).toMatchObject({ darfBearbeiten: true, darfArchivieren: false });
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

describe('threadAnsicht: Datei- und Foto-Module', () => {
	const am = (stunde: number) => new Date(`2026-10-21T${String(stunde).padStart(2, '0')}:00:00Z`);
	const foto = (id: string, vonId: string, stunde: number) => ({
		id,
		breite: 2560,
		hoehe: 1440,
		vonId,
		hochgeladenAm: am(stunde),
	});
	const fotoModul = (
		hochladen: 'JUGENDLEITER' | 'ALLE' = 'JUGENDLEITER',
		fotos = [foto('f1', 'sandra', 8)],
	): ModulDaten => ({
		typ: 'FOTOS',
		id: 'fm',
		titel: 'Bilder',
		hochladen,
		fotos,
	});
	const dateiModul: ModulDaten = {
		typ: 'DATEIEN',
		id: 'dm',
		titel: null,
		dateien: [
			{ id: 'd1', name: 'Packliste.pdf', typ: 'application/pdf', groesse: 1234, vonId: 'thomas', hochgeladenAm: am(7) },
			{ id: 'd2', name: 'Plan.png', typ: 'image/png', groesse: 99, vonId: 'thomas', hochgeladenAm: am(9) },
		],
	};
	const eltern = (erteiltVon: string): EinwilligungZeile[] => [{ erteiltVon, widerrufenAm: null }];
	// Alle bis auf Tim: Paul ist volljaehrig und willigt selbst ein.
	const fast = () =>
		new Map<string, readonly EinwilligungZeile[]>([
			['lena', eltern('sandra')],
			['max', eltern('sandra')],
			['jonas', eltern('thomas')],
			['paul', eltern('paul')],
		]);
	const fotosVon = (ich: string, m: ModulDaten, rest: Partial<AnsichtEingabe> = {}) =>
		ansichtVon(ich, kopf(), [m], rest).module[0] as FotosModulAnsicht;

	it('zeigt Dateien in der gespeicherten Reihenfolge mit ISO-Zeit und ohne Absender', () => {
		const m = ansichtVon('sandra', kopf(), [dateiModul]).module[0] as DateienModulAnsicht;
		expect(m).toEqual({
			typ: 'DATEIEN',
			id: 'dm',
			titel: null,
			darfAendern: false,
			dateien: [
				{
					id: 'd1',
					name: 'Packliste.pdf',
					typ: 'application/pdf',
					groesse: 1234,
					hochgeladenAm: '2026-10-21T07:00:00.000Z',
				},
				{ id: 'd2', name: 'Plan.png', typ: 'image/png', groesse: 99, hochgeladenAm: '2026-10-21T09:00:00.000Z' },
			],
		});
	});

	it('laesst nur den Bearbeiter Dateien aendern', () => {
		const darf = (ich: string) => (ansichtVon(ich, kopf(), [dateiModul]).module[0] as DateienModulAnsicht).darfAendern;
		expect(darf('thomas')).toBe(true);
		expect(darf('sandra')).toBe(false);
	});

	it('laesst Foto-Loeschen je Person zu: das eigene, Bearbeiter alle', () => {
		const fotos = [foto('f1', 'sandra', 8), foto('f2', 'lena', 9)];
		const loeschen = (ich: string) => fotosVon(ich, fotoModul('ALLE', fotos)).fotos.map((f) => [f.id, f.darfLoeschen]);
		expect(loeschen('sandra')).toEqual([
			['f1', true],
			['f2', false],
		]);
		expect(loeschen('thomas')).toEqual([
			['f1', true],
			['f2', true],
		]);
	});

	it('uebernimmt Masse, ISO-Zeit und den Namen der hochladenden Person', () => {
		const m = fotosVon('thomas', fotoModul());
		expect(m).toMatchObject({ typ: 'FOTOS', id: 'fm', titel: 'Bilder', hochladen: 'JUGENDLEITER' });
		expect(m.fotos).toEqual([
			{
				id: 'f1',
				breite: 2560,
				hoehe: 1440,
				von: absenderName('sandra', umfeld),
				hochgeladenAm: '2026-10-21T08:00:00.000Z',
				darfLoeschen: true,
			},
		]);
	});

	it('nennt eine entfernte hochladende Person ehemaliges Mitglied', () => {
		const m = fotosVon('sandra', fotoModul('ALLE', [foto('f1', 'mia', 8)]));
		expect(m.fotos[0]).toMatchObject({ von: 'ehemaliges Mitglied', darfLoeschen: false });
		expect(fotosVon('thomas', fotoModul('ALLE', [foto('f1', 'mia', 8)])).fotos[0].darfLoeschen).toBe(true);
	});

	it('laesst einen Leser bei JUGENDLEITER nicht hochladen und zeigt ihm keinen Hinweis', () => {
		const m = fotosVon('sandra', fotoModul('JUGENDLEITER'), { fotoEinwilligungen: fast() });
		expect(m).toMatchObject({ darfHochladen: false, hinweis: null });
	});

	it('zeigt dem Bearbeiter den Hinweis mit Tim', () => {
		const m = fotosVon('thomas', fotoModul('JUGENDLEITER'), { fotoEinwilligungen: fast() });
		expect(m).toMatchObject({ darfHochladen: true, hinweis: 'Von Tim S. dürfen keine Fotos gezeigt werden' });
	});

	it('zeigt einem Leser bei ALLE Upload und Hinweis, im Archiv nicht', () => {
		const lebend = fotosVon('sandra', fotoModul('ALLE'), { fotoEinwilligungen: fast() });
		expect(lebend).toMatchObject({ darfHochladen: true, hinweis: 'Von Tim S. dürfen keine Fotos gezeigt werden' });
		const alt = ansichtVon('sandra', kopf(), [terminModul('2026-10-10'), fotoModul('ALLE')], {
			fotoEinwilligungen: fast(),
		}).module[1] as FotosModulAnsicht;
		expect(alt).toMatchObject({ darfHochladen: false, hinweis: null });
	});

	it('hat keinen Hinweis, wenn alle, die dabei sind, eingewilligt haben', () => {
		const dabei = umfrageModul({
			antworten: [{ fuerId: 'lena', vonId: 'sandra', optionIds: ['o-dabei'], abgegebenAm: JETZT }],
		});
		const a = ansichtVon('thomas', kopf(), [dabei, fotoModul()], { fotoEinwilligungen: fast() });
		expect((a.module[1] as FotosModulAnsicht).hinweis).toBeNull();
	});

	it('nennt mit Teilnahme-Umfrage nur die, die dabei sind', () => {
		const dabei = umfrageModul({
			antworten: [{ fuerId: 'lena', vonId: 'sandra', optionIds: ['o-dabei'], abgegebenAm: JETZT }],
		});
		const a = ansichtVon('thomas', kopf(), [dabei, fotoModul()], { fotoEinwilligungen: new Map() });
		expect((a.module[1] as FotosModulAnsicht).hinweis).toBe('Von Lena M. dürfen keine Fotos gezeigt werden');
	});
});

describe('threadAnsicht: Helferliste', () => {
	const FRIST = new Date('2026-10-23T10:00:00Z');
	const eintrag = (fuerId: string, vonId = fuerId, notiz: string | null = null): HelferEintragDaten => ({
		fuerId,
		vonId,
		notiz,
		eingetragenAm: JETZT,
	});
	const kuchen = (...eintraege: HelferEintragDaten[]): HelferPositionDaten => ({
		id: 'p-kuchen',
		schluessel: 'pkuchen01',
		text: 'Kuchen',
		anzahl: 4,
		eintraege,
	});
	const grill = (...eintraege: HelferEintragDaten[]): HelferPositionDaten => ({
		id: 'p-grill',
		schluessel: 'pgrill001',
		text: 'Grill',
		anzahl: 2,
		eintraege,
	});
	const helferModul = (
		positionen: HelferPositionDaten[],
		h: Partial<HelferDaten> = {},
	): Extract<ModulDaten, { typ: 'HELFER' }> => ({
		typ: 'HELFER',
		id: 'h1',
		titel: 'Mitbringen',
		helfer: { modulId: 'h1', titel: 'Mitbringen', einheit: 'ERWACHSENER', frist: FRIST, positionen, ...h },
	});
	const helferVon = (ich: string, modul: ModulDaten, k: ThreadKopf = kopf(), jetzt: Date = JETZT): HelferModulAnsicht =>
		ansichtVon(ich, k, [modul], { jetzt }).module[0] as HelferModulAnsicht;
	const eintraegeVon = (h: HelferModulAnsicht, positionId: string) =>
		h.positionen.find((p) => p.id === positionId)!.eintraege;

	it('zeigt Kopf, Frist und je Position den Fuellstand', () => {
		const h = helferVon('peter', helferModul([kuchen(eintrag('sandra')), grill()]));
		expect(h).toMatchObject({
			typ: 'HELFER',
			id: 'h1',
			titel: 'Mitbringen',
			einheit: 'ERWACHSENER',
			frist: '2026-10-23T10:00:00.000Z',
			fristAbgelaufen: false,
		});
		expect(h.positionen.map((p) => [p.id, p.text, p.anzahl, p.belegt])).toEqual([
			['p-kuchen', 'Kuchen', 4, 1],
			['p-grill', 'Grill', 2, 0],
		]);
		expect(eintraegeVon(h, 'p-grill')).toEqual([]);
	});

	it('nennt Eingetragene mit Absendername und Notiz', () => {
		const h = helferVon('peter', helferModul([kuchen(eintrag('sandra', 'sandra', 'Marmorkuchen'))]));
		expect(eintraegeVon(h, 'p-kuchen')).toEqual([
			{ fuerId: 'sandra', name: absenderName('sandra', umfeld), notiz: 'Marmorkuchen', eingetragenVon: null },
		]);
		expect(eintraegeVon(h, 'p-kuchen')[0].name).toBe('Sandra M. (Mutter von Lena und Max)');
	});

	it('zeigt den Eintrag einer Entfernten als ehemaliges Mitglied, der Platz bleibt belegt', () => {
		const h = helferVon('thomas', helferModul([kuchen(eintrag('sandra'), eintrag('mia'))]));
		expect(eintraegeVon(h, 'p-kuchen').map((e) => e.name)).toEqual([
			'Sandra M. (Mutter von Lena und Max)',
			'ehemaliges Mitglied',
		]);
		expect(h.positionen[0].belegt).toBe(2);
	});

	it('sagt nur Betroffenen und der Leitung, wer eingetragen hat', () => {
		const modul = helferModul([kuchen(eintrag('sandra', 'thomas'))]);
		expect(eintraegeVon(helferVon('sandra', modul), 'p-kuchen')[0].eingetragenVon).toBe('eingetragen von Thomas K.');
		expect(eintraegeVon(helferVon('thomas', modul), 'p-kuchen')[0].eingetragenVon).toBe('von dir eingetragen');
		expect(eintraegeVon(helferVon('peter', modul), 'p-kuchen')[0].eingetragenVon).toBeNull();
		expect(eintraegeVon(helferVon('bea', modul), 'p-kuchen')[0].eingetragenVon).toBeNull();
	});

	it('sagt es der Familie auch fuer das eigene Kind', () => {
		const modul = helferModul([kuchen(eintrag('lena', 'thomas'))], { einheit: 'JUNGFISCHER' });
		expect(eintraegeVon(helferVon('sandra', modul), 'p-kuchen')[0].eingetragenVon).toBe('eingetragen von Thomas K.');
		expect(eintraegeVon(helferVon('peter', modul), 'p-kuchen')[0].eingetragenVon).toBeNull();
	});

	it('gibt die eigenen Zeilen wie bei der Umfrage, bei pro Jungfischer je Kind', () => {
		expect(helferVon('sandra', helferModul([kuchen()])).zeilen).toEqual([
			{ fuerId: 'sandra', vorname: 'Sandra', selbst: true, darfEintragen: true },
		]);
		const kinder = helferModul([kuchen()], { einheit: 'JUNGFISCHER' });
		expect(helferVon('sandra', kinder).zeilen).toEqual([
			{ fuerId: 'lena', vorname: 'Lena', selbst: false, darfEintragen: true },
			{ fuerId: 'max', vorname: 'Max', selbst: false, darfEintragen: true },
		]);
	});

	it('sperrt nach der Frist die Mutter, nicht aber die Leitung', () => {
		const modul = helferModul([kuchen()]);
		const sandra = helferVon('sandra', modul, kopf(), FRIST);
		expect(sandra.fristAbgelaufen).toBe(true);
		expect(sandra.zeilen).toMatchObject([{ fuerId: 'sandra', darfEintragen: false }]);
		expect(helferVon('thomas', modul, kopf(), FRIST).zeilen).toMatchObject([{ fuerId: 'thomas', darfEintragen: true }]);
	});

	it('sperrt im Archiv die Mutter, nicht aber die Leitung', () => {
		const archiv = kopf({ archivModus: 'ARCHIVIERT' });
		const modul = helferModul([kuchen()]);
		expect(helferVon('sandra', modul, archiv).zeilen).toMatchObject([{ darfEintragen: false }]);
		expect(helferVon('thomas', modul, archiv).zeilen).toMatchObject([{ darfEintragen: true }]);
	});

	it('hat ohne Frist weder Frist noch Ablauf', () => {
		const h = helferVon('sandra', helferModul([kuchen()], { frist: null }));
		expect(h).toMatchObject({ frist: null, fristAbgelaufen: false });
	});

	it('gibt die Liste an die Threaddaten', () => {
		const modul = helferModul([kuchen()]);
		expect(threadDatenAus(kopf(), [infoModul, modul]).helfer).toEqual([modul.helfer]);
	});
});

describe('threadAnsicht: Fahrgemeinschaft', () => {
	const gestern = new Date('2026-10-21T12:00:00Z');
	const auto = (daten: Partial<AutoDaten> = {}): AutoDaten => ({
		id: 'a1',
		fahrerId: 'sandra',
		richtung: 'HIN',
		plaetze: 3,
		abfahrtTag: '2026-10-23',
		abfahrtZeit: '15:30',
		ort: 'Vereinsheim',
		notiz: 'Kindersitze vorhanden',
		angelegtAm: gestern,
		...daten,
	});
	const mitfahrt = (kindId: string, autoId: string | null, richtung: Richtung = 'HIN'): MitfahrtDaten => ({
		richtung,
		kindId,
		autoId,
		vonId: 'sandra',
		eingetragenAm: gestern,
	});
	const fahrtModul = (
		f: Partial<FahrtDaten> = {},
		titel: string | null = null,
	): Extract<ModulDaten, { typ: 'FAHRT' }> => ({
		typ: 'FAHRT',
		id: 'f1',
		titel,
		fahrt: { modulId: 'f1', titel, hin: true, rueck: true, autos: [], mitfahrten: [], ...f },
	});
	// Lena dabei, Max wie angegeben beantwortet.
	const teilnahme = (max: 'o-dabei' | 'o-vielleicht' | 'o-abgesagt' | null): ModulDaten =>
		umfrageModul({
			antworten: [
				{ fuerId: 'lena', vonId: 'sandra', optionIds: ['o-dabei'], abgegebenAm: gestern },
				...(max ? [{ fuerId: 'max', vonId: 'sandra', optionIds: [max], abgegebenAm: gestern }] : []),
			],
		});
	const fahrtVon = (ich: string, module: ModulDaten[], k: ThreadKopf = kopf()): FahrtModulAnsicht =>
		ansichtVon(ich, k, module).module.find((m) => m.typ === 'FAHRT') as FahrtModulAnsicht;
	const hin = (a: FahrtModulAnsicht) => a.richtungen.find((r) => r.richtung === 'HIN')!;
	const rueck = (a: FahrtModulAnsicht) => a.richtungen.find((r) => r.richtung === 'RUECK')!;
	const sandrasAuto = fahrtModul({ autos: [auto()], mitfahrten: [mitfahrt('lena', 'a1')] });
	const KEIN_ZIEL = { autoIds: [], selbst: false };

	it('zeigt Kopf und je eingeschalteter Richtung einen Eintrag, Hinfahrt zuerst', () => {
		const a = fahrtVon('thomas', [fahrtModul({}, 'Fahrten')]);
		expect(a).toMatchObject({ typ: 'FAHRT', id: 'f1', titel: 'Fahrten' });
		expect(a.richtungen.map((r) => r.richtung)).toEqual(['HIN', 'RUECK']);
		expect(fahrtVon('sandra', [fahrtModul({ hin: false })]).richtungen.map((r) => r.richtung)).toEqual(['RUECK']);
		expect(fahrtVon('sandra', [fahrtModul({ rueck: false })]).richtungen.map((r) => r.richtung)).toEqual(['HIN']);
	});

	it('beschreibt Sandras Auto mit Fahrer, freien Plaetzen und dem Kurznamen des Mitfahrers', () => {
		const [a] = hin(fahrtVon('peter', [sandrasAuto])).autos;
		expect(a).toMatchObject({
			id: 'a1',
			fahrerId: 'sandra',
			fahrer: 'Sandra M. (Mutter von Lena und Max)',
			plaetze: 3,
			frei: 2,
			abfahrtTag: '2026-10-23',
			abfahrtZeit: '15:30',
			ort: 'Vereinsheim',
			notiz: 'Kindersitze vorhanden',
		});
		expect(a.mitfahrer).toEqual([
			{ kindId: 'lena', name: 'Lena M.', nichtMehrDabei: false, darfHerausnehmen: false, umsetzen: KEIN_ZIEL },
		]);
		expect(rueck(fahrtVon('peter', [sandrasAuto])).autos).toEqual([]);
	});

	it('ordnet Autos und Mitfahrer in der Reihenfolge der Daten und zaehlt nur das eigene Auto', () => {
		const modul = fahrtModul({
			autos: [auto(), auto({ id: 'a2', fahrerId: 'peter', plaetze: 2 })],
			mitfahrten: [mitfahrt('tim', 'a1'), mitfahrt('lena', 'a1'), mitfahrt('paul', 'a2')],
		});
		const autos = hin(fahrtVon('thomas', [modul])).autos;
		expect(autos.map((a) => [a.id, a.frei, a.mitfahrer.map((m) => m.kindId)])).toEqual([
			['a1', 1, ['tim', 'lena']],
			['a2', 1, ['paul']],
		]);
	});

	it('laesst nie weniger als 0 frei', () => {
		const modul = fahrtModul({
			autos: [auto({ plaetze: 1 })],
			mitfahrten: [mitfahrt('lena', 'a1'), mitfahrt('max', 'a1')],
		});
		expect(hin(fahrtVon('thomas', [modul])).autos[0].frei).toBe(0);
	});

	it('zeigt ein Kind, das abgesagt hat, mit Zusatz und laesst den Platz belegt', () => {
		const modul = fahrtModul({
			autos: [auto()],
			mitfahrten: [mitfahrt('lena', 'a1'), mitfahrt('max', 'a1')],
		});
		const dabei = hin(fahrtVon('sandra', [teilnahme('o-dabei'), modul])).autos[0];
		expect(dabei.mitfahrer.map((m) => [m.name, m.nichtMehrDabei])).toEqual([
			['Lena M.', false],
			['Max M.', false],
		]);
		expect(dabei.frei).toBe(1);
		const abgesagt = hin(fahrtVon('sandra', [teilnahme('o-abgesagt'), modul])).autos[0];
		expect(abgesagt.mitfahrer.map((m) => [m.name, m.nichtMehrDabei, m.darfHerausnehmen])).toEqual([
			['Lena M.', false, true],
			['Max M.', true, true],
		]);
		expect(abgesagt.frei).toBe(1);
	});

	it('nennt eine entfernte Person ehemaliges Mitglied, als Fahrer wie als Kind', () => {
		const modul = fahrtModul({
			autos: [auto({ fahrerId: 'mia' })],
			mitfahrten: [mitfahrt('mia', 'a1')],
		});
		const [a] = hin(fahrtVon('thomas', [modul])).autos;
		expect(a.fahrer).toBe('ehemaliges Mitglied');
		expect(a.mitfahrer).toEqual([
			{ kindId: 'mia', name: 'ehemaliges Mitglied', nichtMehrDabei: true, darfHerausnehmen: true, umsetzen: KEIN_ZIEL },
		]);
	});

	it('trennt "Braucht noch Mitfahrt" und "Kommt selbst" je Richtung, nach Kurzname', () => {
		const modul = fahrtModul({
			autos: [auto()],
			mitfahrten: [mitfahrt('lena', 'a1'), mitfahrt('max', null), mitfahrt('tim', null, 'RUECK')],
		});
		const a = fahrtVon('thomas', [modul]);
		expect(hin(a).brauchtMitfahrt).toEqual([
			{ kindId: 'jonas', name: 'Jonas K.', umsetzen: { autoIds: ['a1'], selbst: true } },
			{ kindId: 'paul', name: 'Paul V.', umsetzen: { autoIds: ['a1'], selbst: true } },
			{ kindId: 'tim', name: 'Tim S.', umsetzen: { autoIds: ['a1'], selbst: true } },
		]);
		expect(hin(a).kommtSelbst).toEqual([
			{
				kindId: 'max',
				name: 'Max M.',
				nichtMehrDabei: false,
				darfHerausnehmen: true,
				umsetzen: { autoIds: ['a1'], selbst: false },
			},
		]);
		expect(rueck(a).brauchtMitfahrt.map((k) => k.kindId)).toEqual(['jonas', 'lena', 'max', 'paul']);
		expect(rueck(a).kommtSelbst.map((k) => k.kindId)).toEqual(['tim']);
	});

	it('zaehlt in "Braucht noch Mitfahrt" nur, wer dabei ist', () => {
		const a = fahrtVon('thomas', [teilnahme('o-vielleicht'), fahrtModul()]);
		expect(hin(a).brauchtMitfahrt).toEqual([
			{ kindId: 'lena', name: 'Lena M.', umsetzen: { autoIds: [], selbst: true } },
		]);
	});

	it('sagt dem Fahrer: eigenes Auto, aendern erlaubt, kein zweites Auto in dieser Richtung', () => {
		const a = fahrtVon('sandra', [sandrasAuto]);
		expect(hin(a).autos[0]).toMatchObject({ eigenes: true, darfAendern: true });
		expect(hin(a).darfAnbieten).toBe(false);
		expect(rueck(a).darfAnbieten).toBe(true);
	});

	it('laesst die Leitung jedes Auto aendern, eine fremde Person nicht', () => {
		expect(hin(fahrtVon('thomas', [sandrasAuto])).autos[0]).toMatchObject({ eigenes: false, darfAendern: true });
		expect(hin(fahrtVon('thomas', [sandrasAuto])).darfAnbieten).toBe(true);
		expect(hin(fahrtVon('peter', [sandrasAuto])).autos[0]).toMatchObject({ eigenes: false, darfAendern: false });
		expect(hin(fahrtVon('peter', [sandrasAuto])).darfAnbieten).toBe(true);
	});

	it('laesst Kinder kein Auto anbieten', () => {
		expect(hin(fahrtVon('lena', [sandrasAuto])).darfAnbieten).toBe(false);
	});

	it('laesst die Familie ihr Kind herausnehmen, die Leitung und den Fahrer jedes', () => {
		const modul = fahrtModul({
			autos: [auto({ fahrerId: 'peter' })],
			mitfahrten: [mitfahrt('lena', 'a1'), mitfahrt('paul', 'a1')],
		});
		const kann = (ich: string) => hin(fahrtVon(ich, [modul])).autos[0].mitfahrer.map((m) => m.darfHerausnehmen);
		expect(kann('sandra')).toEqual([true, false]);
		expect(kann('peter')).toEqual([true, true]);
		expect(kann('thomas')).toEqual([true, true]);
		expect(kann('hans')).toEqual([false, false]);
	});

	it('rechnet die Umsetzen-Ziele je Kind mit den Regeln des Servers, nicht nach der Rolle', () => {
		// Max hat abgesagt und sitzt noch in Sandras Auto: Die Leitung nimmt ihn heraus, setzt ihn aber nicht um.
		const modul = fahrtModul({
			autos: [auto()],
			mitfahrten: [mitfahrt('lena', 'a1'), mitfahrt('max', 'a1')],
		});
		const leitung = hin(fahrtVon('thomas', [teilnahme('o-abgesagt'), modul]));
		expect(leitung.autos[0].mitfahrer.map((m) => [m.kindId, m.darfHerausnehmen, m.umsetzen])).toEqual([
			['lena', true, { autoIds: [], selbst: true }],
			['max', true, KEIN_ZIEL],
		]);
		// Im Entwurf (Antworten-Uebersicht) lehnte der Server jedes Ziel mit ENTWURF ab.
		const entwurf = hin(fahrtVon('thomas', [teilnahme('o-dabei'), modul], kopf({ veroeffentlichtAm: null })));
		expect(entwurf.autos[0].mitfahrer.map((m) => m.umsetzen)).toEqual([KEIN_ZIEL, KEIN_ZIEL]);
		// Die Mutter setzt ueber Einsteigen ein, nicht ueber Umsetzen.
		const mutter = hin(fahrtVon('sandra', [teilnahme('o-dabei'), modul]));
		expect(mutter.autos[0].mitfahrer.map((m) => m.umsetzen)).toEqual([KEIN_ZIEL, KEIN_ZIEL]);
	});

	describe('kinder', () => {
		const kinder = (ich: string, module: ModulDaten[], k: ThreadKopf = kopf()) => fahrtVon(ich, module, k).kinder;

		it('nennt der Mutter ihre Kinder in Vornamen-Reihenfolge', () => {
			expect(kinder('sandra', [fahrtModul()])).toEqual([
				{ kindId: 'lena', vorname: 'Lena', selbst: false },
				{ kindId: 'max', vorname: 'Max', selbst: false },
			]);
		});

		it('nennt bei Lena dabei und Max vielleicht nur Lena', () => {
			expect(kinder('sandra', [teilnahme('o-vielleicht'), fahrtModul()])).toEqual([
				{ kindId: 'lena', vorname: 'Lena', selbst: false },
			]);
		});

		it('nennt dem Kind sich selbst', () => {
			expect(kinder('lena', [fahrtModul()])).toEqual([{ kindId: 'lena', vorname: 'Lena', selbst: true }]);
		});

		it('nennt der Leitung nur ihre eigenen Kinder, nicht alle', () => {
			expect(kinder('thomas', [fahrtModul()])).toEqual([{ kindId: 'jonas', vorname: 'Jonas', selbst: false }]);
		});

		it('nennt einem Jugendleiter ohne Bearbeitungsrecht und ohne eigenes Kind keines', () => {
			expect(kinder('bea', [fahrtModul()])).toEqual([]);
		});

		it('nennt einer Mutter bei Nur Familie ihre Kinder, obwohl dort niemand als Kind gefragt ist', () => {
			const familie = kopf({ rollenfilter: 'NUR_FAMILIE' });
			expect(kinder('sandra', [fahrtModul()], familie).map((k) => k.kindId)).toEqual(['lena', 'max']);
		});

		it('nennt im Archiv der Familie keines mehr, der Leitung ihre', () => {
			const archiv = kopf({ archivModus: 'ARCHIVIERT' });
			const a = fahrtVon('sandra', [fahrtModul()], archiv);
			expect(a.kinder).toEqual([]);
			expect(hin(a).darfAnbieten).toBe(false);
			expect(fahrtVon('thomas', [fahrtModul()], archiv).kinder.map((k) => k.kindId)).toEqual(['jonas']);
		});
	});

	describe('vorschlagTag', () => {
		const termin = (startDatum: string, endDatum: string | null, modulId = 't1'): ModulDaten => ({
			typ: 'TERMIN',
			id: modulId,
			titel: null,
			termin: { ...termin0, modulId, startDatum, endDatum },
		});
		const termin0 = {
			modulId: 't1',
			startDatum: '',
			endDatum: null,
			beginn: null,
			ende: null,
			ort: null,
			treffpunkt: null,
		};

		it('schlaegt hin den ersten und rueck den letzten Tag des Termins vor', () => {
			const a = fahrtVon('sandra', [termin('2026-10-23', '2026-10-25'), fahrtModul()]);
			expect(hin(a).vorschlagTag).toBe('2026-10-23');
			expect(rueck(a).vorschlagTag).toBe('2026-10-25');
		});

		it('nimmt bei einem eintaegigen Termin fuer beide denselben Tag', () => {
			const a = fahrtVon('sandra', [termin('2026-10-24', null), fahrtModul()]);
			expect([hin(a).vorschlagTag, rueck(a).vorschlagTag]).toEqual(['2026-10-24', '2026-10-24']);
		});

		it('nimmt den ersten Termin in Modulreihenfolge, nicht den fruehesten', () => {
			const a = fahrtVon('sandra', [
				termin('2026-10-30', '2026-11-01', 't2'),
				termin('2026-10-23', null, 't1'),
				fahrtModul(),
			]);
			expect(hin(a).vorschlagTag).toBe('2026-10-30');
			expect(rueck(a).vorschlagTag).toBe('2026-11-01');
		});

		it('hat ohne Termin keinen Vorschlag', () => {
			const a = fahrtVon('sandra', [fahrtModul()]);
			expect([hin(a).vorschlagTag, rueck(a).vorschlagTag]).toEqual([null, null]);
		});
	});

	it('gibt die Fahrgemeinschaft an die Threaddaten', () => {
		const modul = fahrtModul();
		expect(threadDatenAus(kopf(), [infoModul, modul]).fahrt).toBe(modul.fahrt);
		expect(threadDatenAus(kopf(), [infoModul]).fahrt).toBeNull();
	});
});
