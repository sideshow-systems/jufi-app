import type { TerminDaten } from '../module/termin/termin.js';
import type { Auswertung, AuswertungsName } from './antworten.js';
import {
	threadAnsicht,
	type AnsichtEingabe,
	type ModulAnsicht,
	type ModulDaten,
	type ThreadAnsicht,
	type UmfrageAnsicht,
} from './ansicht.js';
import { ohneFormat, teilenText } from './teilen.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';
import type { UmfrageDaten } from './typen.js';

const BASIS = 'https://test.jufi-app.de';
const SLUG = 'glonntal';
const FREITAG = new Date('2026-10-23T16:30:00Z');

const name = (n: string): AuswertungsName => ({ fuerId: n, name: n, eingetragenVon: null });
const namen = (...n: string[]) => n.map(name);

const TERMIN: TerminDaten = {
	modulId: 't1',
	startDatum: '2026-10-24',
	endDatum: null,
	beginn: '14:00',
	ende: '17:00',
	ort: 'Bowlingcenter',
	treffpunkt: 'Vor der Halle',
};

function teilnahme(ergebnis: Auswertung | null): UmfrageAnsicht {
	return {
		typ: 'UMFRAGE',
		id: 'u1',
		titel: null,
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		frist: null,
		fristAbgelaufen: false,
		optionen: [
			{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
			{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
			{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		zeilen: [],
		ergebnis,
	};
}

const NAMEN_ERGEBNIS: Auswertung = {
	ansicht: 'NAMEN',
	optionen: [
		{ optionId: 'o-dabei', anzahl: 2, namen: namen('Lena M.', 'Max M.') },
		{ optionId: 'o-vielleicht', anzahl: 0, namen: [] },
		{ optionId: 'o-abgesagt', anzahl: 1, namen: namen('Tim S.') },
	],
	offen: { anzahl: 1, namen: namen('Jonas K.') },
};

const SUMME_ERGEBNIS: Auswertung = {
	ansicht: 'SUMME',
	optionen: [
		{ optionId: 'o-dabei', anzahl: 2, namen: null },
		{ optionId: 'o-vielleicht', anzahl: 0, namen: null },
		{ optionId: 'o-abgesagt', anzahl: 1, namen: null },
	],
	offen: { anzahl: 1, namen: null },
};

function ansicht(module: ModulAnsicht[], titel = '🎳 Bowling'): ThreadAnsicht {
	return {
		id: 'bowling',
		titel,
		art: 'NORMAL',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		angepinnt: false,
		entwurf: false,
		archiviert: false,
		stand: 1,
		schreibSperre: null,
		darfBearbeiten: false,
		darfArchivieren: false,
		verlauf: { eintraege: 0, ungelesen: 0 },
		module,
	};
}

const terminModul = (termin: Partial<TerminDaten> = {}): ModulAnsicht => ({
	typ: 'TERMIN',
	id: 't1',
	titel: null,
	termin: { ...TERMIN, ...termin },
});

const text = (a: ThreadAnsicht, jetzt = FREITAG) => teilenText({ ansicht: a, basisUrl: BASIS, slug: SLUG, jetzt });
const zeilen = (a: ThreadAnsicht, jetzt = FREITAG) => text(a, jetzt).split('\n');

describe('teilenText', () => {
	it('setzt den ganzen Text aus Titel, Termin, Umfrage und Link zusammen', () => {
		expect(text(ansicht([terminModul(), teilnahme(NAMEN_ERGEBNIS)]))).toBe(
			[
				'🎳 *Bowling* – Stand Fr 18:30',
				'📅 Sa 24.10. · 14:00–17:00 · Bowlingcenter',
				'✅ Dabei (2): Lena M., Max M.',
				'🤔 Vielleicht (0)',
				'❌ Abgesagt (1): Tim S.',
				'❓ Offen (1): Jonas K.',
				'👉 Antworten: https://test.jufi-app.de/glonntal/t/bowling-bowling',
			].join('\n'),
		);
	});

	it('laesst den Ort weg, wenn es keinen gibt, und nennt Info, Treffpunkt und Frist nicht', () => {
		const info: ModulAnsicht = { typ: 'INFO', id: 'i1', titel: 'Wichtig', text: 'Bitte Socken mitbringen' };
		const u = { ...teilnahme(null), frist: '2026-10-24T10:00:00.000Z' };
		const z = zeilen(ansicht([info, terminModul({ ort: null }), u]));
		expect(z).toEqual([
			'🎳 *Bowling* – Stand Fr 18:30',
			'📅 Sa 24.10. · 14:00–17:00',
			'👉 Antworten: https://test.jufi-app.de/glonntal/t/bowling-bowling',
		]);
	});

	it('kuerzt nach zehn Namen mit einem Auslassungszeichen, die Zahl bleibt', () => {
		const elf = Array.from({ length: 11 }, (_, i) => `K${i + 1}`);
		const e: Auswertung = {
			...NAMEN_ERGEBNIS,
			optionen: [{ optionId: 'o-dabei', anzahl: 11, namen: namen(...elf) }, ...NAMEN_ERGEBNIS.optionen.slice(1)],
		};
		expect(zeilen(ansicht([teilnahme(e)]))[1]).toBe(`✅ Dabei (11): ${elf.slice(0, 10).join(', ')}, …`);
	});

	it('nennt genau zehn Namen ohne Auslassungszeichen', () => {
		const zehn = Array.from({ length: 10 }, (_, i) => `K${i + 1}`);
		const e: Auswertung = {
			...NAMEN_ERGEBNIS,
			optionen: [{ optionId: 'o-dabei', anzahl: 10, namen: namen(...zehn) }, ...NAMEN_ERGEBNIS.optionen.slice(1)],
		};
		expect(zeilen(ansicht([teilnahme(e)]))[1]).toBe(`✅ Dabei (10): ${zehn.join(', ')}`);
	});

	it('zeigt bei SUMME nur Zahlen und keinen Namen', () => {
		const z = zeilen(ansicht([teilnahme(SUMME_ERGEBNIS)]));
		expect(z.slice(1, 5)).toEqual(['✅ Dabei: 2', '🤔 Vielleicht: 0', '❌ Abgesagt: 1', '❓ Offen: 1']);
	});

	it('laesst die Umfrage ohne Ergebnis weg, Termin und Link bleiben', () => {
		expect(zeilen(ansicht([terminModul(), teilnahme(null)]))).toEqual([
			'🎳 *Bowling* – Stand Fr 18:30',
			'📅 Sa 24.10. · 14:00–17:00 · Bowlingcenter',
			'👉 Antworten: https://test.jufi-app.de/glonntal/t/bowling-bowling',
		]);
	});

	it('gibt eine freie Umfrage mit Punkten und ohne Offen-Zeile aus', () => {
		const frei: UmfrageAnsicht = {
			...teilnahme(null),
			frage: 'Welche Pizza?',
			teilnahme: false,
			optionen: [
				{ id: 'o-s', schluessel: 'o1', text: 'Salami' },
				{ id: 'o-f', schluessel: 'o2', text: 'Funghi' },
			],
			ergebnis: {
				ansicht: 'NAMEN',
				optionen: [
					{ optionId: 'o-s', anzahl: 1, namen: namen('Lena M.') },
					{ optionId: 'o-f', anzahl: 0, namen: [] },
				],
				offen: { anzahl: 3, namen: namen('A', 'B', 'C') },
			},
		};
		expect(zeilen(ansicht([frei])).slice(1, -1)).toEqual(['📊 Welche Pizza?', '• Salami (1): Lena M.', '• Funghi (0)']);
	});

	it('gibt eine freie Umfrage bei SUMME ohne Namen aus', () => {
		const frei: UmfrageAnsicht = {
			...teilnahme(null),
			frage: 'Welche Pizza?',
			teilnahme: false,
			optionen: [{ id: 'o-s', schluessel: 'o1', text: 'Salami' }],
			ergebnis: {
				ansicht: 'SUMME',
				optionen: [{ optionId: 'o-s', anzahl: 4, namen: null }],
				offen: { anzahl: 0, namen: null },
			},
		};
		expect(zeilen(ansicht([frei])).slice(1, -1)).toEqual(['📊 Welche Pizza?', '• Salami: 4']);
	});

	it('ersetzt Formatzeichen in Titel, Ort und Namen', () => {
		const e: Auswertung = {
			...NAMEN_ERGEBNIS,
			optionen: [{ optionId: 'o-dabei', anzahl: 1, namen: namen('Li~sa M.') }, ...NAMEN_ERGEBNIS.optionen.slice(1)],
		};
		const z = zeilen(ansicht([terminModul({ ort: 'See_Ufer' }), teilnahme(e)], 'Bowling *neu*'));
		expect(z[0]).toBe('*Bowling ∗neu∗* – Stand Fr 18:30');
		expect(z[1]).toBe('📅 Sa 24.10. · 14:00–17:00 · SeeˍUfer');
		expect(z[2]).toBe('✅ Dabei (1): Li∼sa M.');
	});

	it('ersetzt Formatzeichen auch in Frage und Optionstext', () => {
		const frei: UmfrageAnsicht = {
			...teilnahme(null),
			frage: '*Was* _jetzt_?',
			teilnahme: false,
			optionen: [{ id: 'o-s', schluessel: 'o1', text: '`A`~B' }],
			ergebnis: {
				ansicht: 'SUMME',
				optionen: [{ optionId: 'o-s', anzahl: 1, namen: null }],
				offen: { anzahl: 0, namen: null },
			},
		};
		expect(zeilen(ansicht([frei])).slice(1, -1)).toEqual(['📊 ∗Was∗ ˍjetztˍ?', '• ˋAˋ∼B: 1']);
	});

	it('macht aus einem Titel nur aus Emoji eine gueltige Zeile', () => {
		expect(zeilen(ansicht([], '🎳'))[0]).toBe('*🎳* – Stand Fr 18:30');
	});

	it('stellt das Emoji vor die Sternchen, auch mit Variantenselektor', () => {
		expect(zeilen(ansicht([], '🏕️ Zeltlager 2027'))[0]).toBe('🏕️ *Zeltlager 2027* – Stand Fr 18:30');
	});

	it('rechnet die Stand-Zeit in Berliner Zeit, auch ueber Mitternacht und die Zeitumstellung', () => {
		expect(zeilen(ansicht([]), new Date('2026-10-23T22:30:00Z'))[0]).toBe('🎳 *Bowling* – Stand Sa 00:30');
		expect(zeilen(ansicht([]), new Date('2026-10-25T01:30:00Z'))[0]).toBe('🎳 *Bowling* – Stand So 02:30');
	});
});

describe('teilenText: Datei- und Foto-Module', () => {
	it('gibt fuer beide Typen keine Zeile (Spec 11)', () => {
		const dateien: ModulAnsicht = {
			typ: 'DATEIEN',
			id: 'd1',
			titel: 'Packliste',
			dateien: [],
			darfAendern: false,
		};
		const fotos: ModulAnsicht = {
			typ: 'FOTOS',
			id: 'f1',
			titel: null,
			hochladen: 'ALLE',
			fotos: [],
			darfHochladen: true,
			hinweis: 'Von Tim S. dürfen keine Fotos gezeigt werden',
		};
		expect(zeilen(ansicht([terminModul(), dateien, fotos]))).toEqual(zeilen(ansicht([terminModul()])));
	});

	it('gibt fuer eine Helferliste vorerst keine Zeile (Etappe 6)', () => {
		const helfer: ModulAnsicht = {
			typ: 'HELFER',
			id: 'h1',
			titel: 'Mitbringen',
			einheit: 'ERWACHSENER',
			frist: null,
			fristAbgelaufen: false,
			positionen: [{ id: 'p1', text: 'Kuchen', anzahl: 4, belegt: 0, eintraege: [] }],
			zeilen: [],
		};
		expect(zeilen(ansicht([terminModul(), helfer]))).toEqual(zeilen(ansicht([terminModul()])));
	});
});

describe('ohneFormat', () => {
	it('ersetzt alle vier Formatzeichen', () => {
		expect(ohneFormat('*a* _b_ ~c~ `d`')).toBe('∗a∗ ˍbˍ ∼c∼ ˋdˋ');
	});
});

describe('teilenText gegen die echten Regeln', () => {
	const umfeld = bowlingUmfeld();

	function umfrageDaten(ergebnisse: UmfrageDaten['ergebnisse']): UmfrageDaten {
		return {
			modulId: 'u1',
			frage: 'Kommst du mit?',
			einheit: 'JUNGFISCHER',
			mehrfach: false,
			teilnahme: true,
			vielleicht: true,
			frist: null,
			ergebnisse,
			optionen: [
				{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
				{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
				{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
			],
			antworten: [
				{ fuerId: 'lena', vonId: 'lena', optionIds: ['o-dabei'], abgegebenAm: JETZT },
				{ fuerId: 'max', vonId: 'sandra', optionIds: ['o-abgesagt'], abgegebenAm: JETZT },
			],
		};
	}

	function textFuer(ich: string, ergebnisse: UmfrageDaten['ergebnisse']): string {
		const module: ModulDaten[] = [{ typ: 'UMFRAGE', id: 'u1', titel: null, umfrage: umfrageDaten(ergebnisse) }];
		const e: AnsichtEingabe = {
			ich: umfeld.personen.get(ich)!,
			kopf: kopf(),
			module,
			umfeld,
			stand: 1,
			verlaufEintraege: 0,
			nachrichten: [],
			zugangSeit: new Date('2026-01-01T00:00:00Z'),
			verlaufGelesenBis: null,
			fotoEinwilligungen: new Map(),
			jetzt: JETZT,
		};
		return teilenText({ ansicht: threadAnsicht(e)!, basisUrl: BASIS, slug: SLUG, jetzt: JETZT });
	}

	it('nennt bei SUMME fuer die Familie keinen antwortenden Kurznamen', () => {
		const t = textFuer('sandra', 'SUMME');
		expect(t).toContain('✅ Dabei: 1');
		expect(t).toContain('❌ Abgesagt: 1');
		expect(t).not.toMatch(/Lena|Max/);
	});

	it('hat bei JUGENDLEITER fuer die Familie keine Zeile mit Haken', () => {
		const t = textFuer('sandra', 'JUGENDLEITER');
		expect(t).not.toContain('✅');
		expect(t).not.toContain('❓');
	});

	it('nennt bei ALLE die Namen', () => {
		expect(textFuer('sandra', 'ALLE')).toContain('✅ Dabei (1): Lena M.');
	});
});
