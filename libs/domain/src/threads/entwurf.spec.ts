import type { TerminDaten } from '../module/termin/termin.js';
import { neueUmfrageVorlage } from '../module/umfrage/umfrage.js';
import type { ModulDaten } from './ansicht.js';
import { threadDatenAus } from './ansicht.js';
import {
	entwurfAus,
	entwurfAusThread,
	entwurfFehler,
	GRENZEN,
	neuesModul,
	type ModulEntwurf,
	type ThreadEntwurf,
} from './entwurf.js';
import { JETZT, kopf } from './testhilfe.js';
import type { HelferDaten, UmfrageDaten } from './typen.js';

type Umfrage = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;
type Helfer = Extract<ModulEntwurf, { typ: 'HELFER' }>;

const GRUPPEN = new Set(['gross', 'klein']);
const zeichen = (n: number) => 'a'.repeat(n);

// Bowling aus Spec 1.1: Info, Termin und die Teilnahme-Umfrage.
function bowling(): ThreadEntwurf {
	return {
		titel: '🎳 Bowling',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		alleUntergruppen: false,
		untergruppenIds: ['gross'],
		module: [
			{ typ: 'INFO', id: null, titel: null, text: 'Wir treffen uns an der Bahn.' },
			{
				typ: 'TERMIN',
				id: null,
				titel: null,
				termin: {
					startDatum: '2026-10-24',
					endDatum: null,
					beginn: '18:00',
					ende: '20:00',
					ort: 'Bowlingcenter',
					treffpunkt: null,
				},
			},
			umfrage(),
		],
	};
}

function umfrage(aenderung: Partial<Umfrage> = {}): Umfrage {
	return {
		typ: 'UMFRAGE',
		id: null,
		titel: null,
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: true,
		frist: '2026-10-22T16:00:00.000Z',
		ergebnisse: 'ALLE',
		optionen: [
			{ schluessel: 'dabei', text: 'Dabei' },
			{ schluessel: 'vielleicht', text: 'Vielleicht' },
			{ schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		...aenderung,
	};
}

// Der Bowling-Entwurf mit einem geaenderten Modul (Index in module).
function mitModul(index: number, aenderung: Partial<ModulEntwurf>): ThreadEntwurf {
	const e = bowling();
	e.module[index] = { ...e.module[index], ...aenderung } as ModulEntwurf;
	return e;
}

function mitTermin(aenderung: Partial<Extract<ModulEntwurf, { typ: 'TERMIN' }>['termin']>): ThreadEntwurf {
	const e = bowling();
	const m = e.module[1] as Extract<ModulEntwurf, { typ: 'TERMIN' }>;
	m.termin = { ...m.termin, ...aenderung };
	return e;
}

function offeneOptionen(n: number) {
	return Array.from({ length: n }, (_, i) => ({ schluessel: null, text: `Antwort ${i}` }));
}

describe('GRENZEN', () => {
	it('nennt die festen Grenzen aus Spec 4.3', () => {
		expect(GRENZEN).toEqual({
			titel: 120,
			module: 20,
			optionen: 20,
			infoText: 10_000,
			frage: 200,
			optionText: 200,
			modulTitel: 80,
			ort: 200,
			treffpunkt: 200,
			positionen: 30,
			positionText: 80,
			anzahl: 99,
			notiz: 80,
		});
	});
});

describe('entwurfFehler', () => {
	it('meldet bei einem gueltigen Bowling-Entwurf nichts', () => {
		expect(entwurfFehler(bowling(), GRUPPEN)).toEqual([]);
	});

	describe('Titel', () => {
		it('verlangt einen Titel', () => {
			expect(entwurfFehler({ ...bowling(), titel: '' }, GRUPPEN)).toEqual([
				{ feld: 'titel', text: 'Bitte einen Titel eingeben.' },
			]);
		});

		it('erlaubt 120 und verweigert 121 Zeichen', () => {
			expect(entwurfFehler({ ...bowling(), titel: zeichen(120) }, GRUPPEN)).toEqual([]);
			expect(entwurfFehler({ ...bowling(), titel: zeichen(121) }, GRUPPEN)).toEqual([
				{ feld: 'titel', text: 'Höchstens 120 Zeichen.' },
			]);
		});

		it('liest nur Leerzeichen als leer und misst den Titel ohne Leerraum an den Enden', () => {
			expect(entwurfFehler({ ...bowling(), titel: '   ' }, GRUPPEN)).toEqual([
				{ feld: 'titel', text: 'Bitte einen Titel eingeben.' },
			]);
			expect(entwurfFehler({ ...bowling(), titel: ` ${zeichen(120)} ` }, GRUPPEN)).toEqual([]);
		});

		it('zaehlt Code-Points, nicht UTF-16-Einheiten: 120 Emojis sind erlaubt', () => {
			expect(entwurfFehler({ ...bowling(), titel: '🎳'.repeat(120) }, GRUPPEN)).toEqual([]);
			expect(entwurfFehler({ ...bowling(), titel: '🎳'.repeat(121) }, GRUPPEN)).toHaveLength(1);
		});
	});

	describe('Zielgruppe', () => {
		it('verlangt bei "nicht alle" mindestens eine Untergruppe', () => {
			expect(entwurfFehler({ ...bowling(), alleUntergruppen: false, untergruppenIds: [] }, GRUPPEN)).toEqual([
				{ feld: 'zielgruppe', text: 'Bitte mindestens eine Untergruppe wählen.' },
			]);
		});

		it('verweigert eine Untergruppe, die es nicht gibt', () => {
			expect(entwurfFehler({ ...bowling(), untergruppenIds: ['gross', 'fremd'] }, GRUPPEN)).toEqual([
				{ feld: 'zielgruppe', text: 'Diese Untergruppe gibt es nicht mehr.' },
			]);
		});

		it('fragt bei "alle Untergruppen" nicht nach IDs', () => {
			expect(entwurfFehler({ ...bowling(), alleUntergruppen: true, untergruppenIds: [] }, GRUPPEN)).toEqual([]);
		});
	});

	describe('Module', () => {
		it('erlaubt 20 und verweigert 21 Module', () => {
			const info = (i: number): ModulEntwurf => ({ typ: 'INFO', id: null, titel: null, text: `Text ${i}` });
			const e = bowling();
			e.module = Array.from({ length: 20 }, (_, i) => info(i));
			expect(entwurfFehler(e, GRUPPEN)).toEqual([]);
			e.module.push(info(20));
			expect(entwurfFehler(e, GRUPPEN)).toEqual([{ feld: 'module', text: 'Höchstens 20 Module.' }]);
		});

		it('misst den Modultitel ohne Leerraum an den Enden', () => {
			expect(entwurfFehler(mitModul(0, { titel: ` ${zeichen(80)} ` }), GRUPPEN)).toEqual([]);
		});

		it('begrenzt den Modultitel auf 80 Zeichen', () => {
			expect(entwurfFehler(mitModul(0, { titel: zeichen(80) }), GRUPPEN)).toEqual([]);
			expect(entwurfFehler(mitModul(0, { titel: zeichen(81) }), GRUPPEN)).toEqual([
				{ feld: 'module.0.titel', text: 'Höchstens 80 Zeichen.' },
			]);
		});

		it('meldet die Fehler in Formularreihenfolge', () => {
			const e = bowling();
			e.titel = '';
			e.untergruppenIds = [];
			e.module[0] = { typ: 'INFO', id: null, titel: zeichen(81), text: '' };
			expect(entwurfFehler(e, GRUPPEN).map((f) => f.feld)).toEqual([
				'titel',
				'zielgruppe',
				'module.0.titel',
				'module.0.text',
			]);
		});
	});

	describe('Info', () => {
		it('verlangt einen Text', () => {
			expect(entwurfFehler(mitModul(0, { text: '' }), GRUPPEN)).toEqual([
				{ feld: 'module.0.text', text: 'Bitte einen Text eingeben.' },
			]);
		});

		it('liest nur Leerzeichen als leer und misst ohne Leerraum an den Enden', () => {
			expect(entwurfFehler(mitModul(0, { text: '  \n ' }), GRUPPEN)).toEqual([
				{ feld: 'module.0.text', text: 'Bitte einen Text eingeben.' },
			]);
			expect(entwurfFehler(mitModul(0, { text: ` ${zeichen(10_000)} ` }), GRUPPEN)).toEqual([]);
		});

		it('erlaubt 10 000 und verweigert 10 001 Zeichen', () => {
			expect(entwurfFehler(mitModul(0, { text: zeichen(10_000) }), GRUPPEN)).toEqual([]);
			expect(entwurfFehler(mitModul(0, { text: zeichen(10_001) }), GRUPPEN)).toEqual([
				{ feld: 'module.0.text', text: 'Höchstens 10 000 Zeichen.' },
			]);
		});
	});

	describe('Termin', () => {
		it('verweigert einen Tag, den es nicht gibt', () => {
			expect(entwurfFehler(mitTermin({ startDatum: '2026-02-30' }), GRUPPEN)).toEqual([
				{ feld: 'module.1.termin', text: 'Bitte ein gültiges Datum.' },
			]);
		});

		it('verweigert ein Ende vor dem Beginn mit dem Text der Terminregel', () => {
			expect(entwurfFehler(mitTermin({ beginn: '20:00', ende: '18:00' }), GRUPPEN)).toEqual([
				{ feld: 'module.1.termin', text: 'Das Ende liegt vor dem Beginn.' },
			]);
		});

		it('trimmt wie entwurfAus: Leerraum um Datum, Ort und Treffpunkt ist kein Fehler', () => {
			expect(
				entwurfFehler(
					mitTermin({ startDatum: ' 2026-10-24 ', ort: ` ${zeichen(200)} `, treffpunkt: ` ${zeichen(200)} ` }),
					GRUPPEN,
				),
			).toEqual([]);
		});

		it('begrenzt Ort und Treffpunkt auf 200 Zeichen', () => {
			expect(entwurfFehler(mitTermin({ ort: zeichen(200), treffpunkt: zeichen(200) }), GRUPPEN)).toEqual([]);
			expect(entwurfFehler(mitTermin({ ort: zeichen(201) }), GRUPPEN)).toEqual([
				{ feld: 'module.1.ort', text: 'Höchstens 200 Zeichen.' },
			]);
			expect(entwurfFehler(mitTermin({ treffpunkt: zeichen(201) }), GRUPPEN)).toEqual([
				{ feld: 'module.1.treffpunkt', text: 'Höchstens 200 Zeichen.' },
			]);
		});
	});

	describe('Umfrage', () => {
		it('verlangt eine Frage und begrenzt sie auf 200 Zeichen', () => {
			expect(entwurfFehler(mitModul(2, { frage: '' }), GRUPPEN)).toEqual([
				{ feld: 'module.2.frage', text: 'Bitte eine Frage eingeben.' },
			]);
			expect(entwurfFehler(mitModul(2, { frage: zeichen(201) }), GRUPPEN)).toEqual([
				{ feld: 'module.2.frage', text: 'Höchstens 200 Zeichen.' },
			]);
		});

		it('liest eine Frage nur aus Leerzeichen als leer und misst sie ohne Leerraum', () => {
			expect(entwurfFehler(mitModul(2, { frage: '   ' }), GRUPPEN)).toEqual([
				{ feld: 'module.2.frage', text: 'Bitte eine Frage eingeben.' },
			]);
			expect(entwurfFehler(mitModul(2, { frage: ` ${zeichen(200)} ` }), GRUPPEN)).toEqual([]);
		});

		it('verweigert Pro Jungfischer, wenn die Zielgruppe keine Jungfischer fragt', () => {
			const e = mitModul(2, { einheit: 'JUNGFISCHER' });
			e.rollenfilter = 'NUR_FAMILIE';
			expect(entwurfFehler(e, GRUPPEN)).toEqual([
				{ feld: 'module.2.einheit', text: 'Diese Einheit fragt bei dieser Zielgruppe niemanden.' },
			]);
			expect(entwurfFehler(mitModul(2, { einheit: 'PERSON' }), GRUPPEN)).toEqual([]);
		});

		it('verlangt ohne Teilnahme mindestens zwei Antworten', () => {
			const e = mitModul(2, { teilnahme: false, optionen: [{ schluessel: null, text: 'Ja' }] });
			expect(entwurfFehler(e, GRUPPEN)).toEqual([
				{ feld: 'module.2.optionen', text: 'Bitte mindestens zwei Antworten.' },
			]);
		});

		it('verweigert doppelte Antworten, auch bei anderer Schreibweise', () => {
			const optionen = [
				{ schluessel: null, text: 'Ja' },
				{ schluessel: null, text: ' ja ' },
			];
			expect(entwurfFehler(mitModul(2, { teilnahme: false, optionen }), GRUPPEN)).toEqual([
				{ feld: 'module.2.optionen', text: 'Jede Antwort nur einmal.' },
			]);
		});

		it('erlaubt 20 und verweigert 21 Antworten', () => {
			expect(entwurfFehler(mitModul(2, { teilnahme: false, optionen: offeneOptionen(20) }), GRUPPEN)).toEqual([]);
			expect(entwurfFehler(mitModul(2, { teilnahme: false, optionen: offeneOptionen(21) }), GRUPPEN)).toEqual([
				{ feld: 'module.2.optionen', text: 'Höchstens 20 Antworten.' },
			]);
		});

		it('verlangt jeden Antworttext und begrenzt ihn auf 200 Zeichen', () => {
			const leer = [
				{ schluessel: null, text: 'Ja' },
				{ schluessel: null, text: '' },
			];
			expect(entwurfFehler(mitModul(2, { teilnahme: false, optionen: leer }), GRUPPEN)).toEqual([
				{ feld: 'module.2.optionen', text: 'Bitte jede Antwort ausfüllen.' },
			]);
			const lang = [
				{ schluessel: null, text: 'Ja' },
				{ schluessel: null, text: zeichen(201) },
			];
			expect(entwurfFehler(mitModul(2, { teilnahme: false, optionen: lang }), GRUPPEN)).toEqual([
				{ feld: 'module.2.optionen', text: 'Höchstens 200 Zeichen.' },
			]);
		});

		it('prueft die Optionen einer Teilnahme-Umfrage nicht: sie sind fest', () => {
			expect(entwurfFehler(mitModul(2, { optionen: [] }), GRUPPEN)).toEqual([]);
		});

		it('meldet die zweite Teilnahme-Umfrage als Konflikt', () => {
			const e = bowling();
			e.module.push(umfrage());
			expect(entwurfFehler(e, GRUPPEN)).toEqual([
				{ feld: 'module.3.teilnahme', text: 'Es gibt schon eine Teilnahme-Umfrage.', konflikt: true },
			]);
		});
	});
});

describe('entwurfAus', () => {
	const ungueltig = (feld: string) => ({ fehler: { feld, text: 'Ungültige Anfrage' } });

	function koerper(): Record<string, unknown> {
		return JSON.parse(JSON.stringify(bowling()));
	}

	it('liest einen gueltigen Entwurf unveraendert', () => {
		expect(entwurfAus(koerper())).toEqual({ entwurf: bowling() });
	});

	it('weist alles ab, was kein Objekt ist, mit dem Titel als erstem Feld', () => {
		expect(entwurfAus(null)).toEqual(ungueltig('titel'));
		expect(entwurfAus('text')).toEqual(ungueltig('titel'));
		expect(entwurfAus([])).toEqual(ungueltig('titel'));
	});

	it('weist falsche Typen am Kopf ab', () => {
		expect(entwurfAus({ ...koerper(), titel: 3 })).toEqual(ungueltig('titel'));
		expect(entwurfAus({ ...koerper(), modus: 'LAUT' })).toEqual(ungueltig('modus'));
		expect(entwurfAus({ ...koerper(), rollenfilter: 'ALLE' })).toEqual(ungueltig('zielgruppe'));
		expect(entwurfAus({ ...koerper(), alleUntergruppen: 'ja' })).toEqual(ungueltig('zielgruppe'));
		expect(entwurfAus({ ...koerper(), untergruppenIds: [1] })).toEqual(ungueltig('zielgruppe'));
		expect(entwurfAus({ ...koerper(), module: {} })).toEqual(ungueltig('module'));
	});

	it('ist kein Prototyp-Opfer: "toString" ist kein Modus', () => {
		expect(entwurfAus({ ...koerper(), modus: 'toString' })).toEqual(ungueltig('modus'));
	});

	it('nennt das Modul mit dem Feld, das nicht stimmt', () => {
		const k = koerper();
		const module = k['module'] as Record<string, unknown>[];
		module[0] = { typ: 'FOTO' };
		expect(entwurfAus(k)).toEqual(ungueltig('module.0.typ'));

		const k2 = koerper();
		(k2['module'] as Record<string, unknown>[])[1]['termin'] = null;
		expect(entwurfAus(k2)).toEqual(ungueltig('module.1.termin'));

		const k3 = koerper();
		(k3['module'] as Record<string, unknown>[])[2]['einheit'] = 'KLASSE';
		expect(entwurfAus(k3)).toEqual(ungueltig('module.2.einheit'));

		const k4 = koerper();
		(k4['module'] as Record<string, unknown>[])[0]['text'] = 5;
		expect(entwurfAus(k4)).toEqual(ungueltig('module.0.text'));
	});

	it('weist eine Frist ab, die kein ISO-Zeitpunkt ist', () => {
		const k = koerper();
		(k['module'] as Record<string, unknown>[])[2]['frist'] = 'morgen';
		expect(entwurfAus(k)).toEqual(ungueltig('module.2.frist'));
	});

	it('weist eine Frist ohne Zeitzone ab, weil sie je nach Prozess etwas anderes hiesse', () => {
		const k = koerper();
		(k['module'] as Record<string, unknown>[])[2]['frist'] = '2026-10-22T18:00';
		expect(entwurfAus(k)).toEqual(ungueltig('module.2.frist'));
	});

	it('weist eine Frist an einem Tag ab, den es nicht gibt, statt sie in den Maerz zu rollen', () => {
		const k = koerper();
		(k['module'] as Record<string, unknown>[])[2]['frist'] = '2026-02-30T18:00:00Z';
		expect(entwurfAus(k)).toEqual(ungueltig('module.2.frist'));
	});

	it('schreibt die Frist als UTC-ISO, damit sie sich mit der gespeicherten vergleichen laesst', () => {
		const k = koerper();
		(k['module'] as Record<string, unknown>[])[2]['frist'] = '2026-10-22T18:00:00+02:00';
		const r = entwurfAus(k);
		expect('entwurf' in r && (r.entwurf.module[2] as Umfrage).frist).toBe('2026-10-22T16:00:00.000Z');
	});

	it('schneidet Leerraum an den Enden ab', () => {
		const r = entwurfAus({ ...koerper(), titel: '  Bowling  ' });
		expect('entwurf' in r && r.entwurf.titel).toBe('Bowling');
	});

	it('macht aus leeren optionalen Feldern null', () => {
		const k = koerper();
		const module = k['module'] as Record<string, unknown>[];
		(module[1]['termin'] as Record<string, unknown>)['ort'] = '';
		module[0]['titel'] = '   ';
		(module[2] as Record<string, unknown>)['frist'] = '';
		const r = entwurfAus(k);
		if (!('entwurf' in r)) throw new Error('Fehler erwartet nicht');
		expect((r.entwurf.module[1] as Extract<ModulEntwurf, { typ: 'TERMIN' }>).termin.ort).toBeNull();
		expect(r.entwurf.module[0].titel).toBeNull();
		expect((r.entwurf.module[2] as Umfrage).frist).toBeNull();
	});

	it('laesst ein leeres Startdatum stehen, damit entwurfFehler es als Datum beanstandet', () => {
		const k = koerper();
		((k['module'] as Record<string, unknown>[])[1]['termin'] as Record<string, unknown>)['startDatum'] = '';
		const r = entwurfAus(k);
		if (!('entwurf' in r)) throw new Error('Fehler erwartet nicht');
		expect(entwurfFehler(r.entwurf, GRUPPEN)).toEqual([{ feld: 'module.1.termin', text: 'Bitte ein gültiges Datum.' }]);
	});

	it('ersetzt bei einer Teilnahme die Optionen durch dabei und abgesagt, wenn Vielleicht aus ist', () => {
		const k = koerper();
		const u = (k['module'] as Record<string, unknown>[])[2];
		u['vielleicht'] = false;
		u['optionen'] = [{ schluessel: null, text: 'Egal' }];
		const r = entwurfAus(k);
		if (!('entwurf' in r)) throw new Error('Fehler erwartet nicht');
		expect((r.entwurf.module[2] as Umfrage).optionen.map((o) => o.schluessel)).toEqual(['dabei', 'abgesagt']);
	});

	it('macht bei einer Teilnahme aus einer Mehrfachauswahl keine, bei einer Umfrage laesst es sie stehen', () => {
		const k = koerper();
		const u = (k['module'] as Record<string, unknown>[])[2];
		u['mehrfach'] = true;
		const teilnahme = entwurfAus(k);
		if (!('entwurf' in teilnahme)) throw new Error('Fehler erwartet nicht');
		expect((teilnahme.entwurf.module[2] as Umfrage).mehrfach).toBe(false);
		u['teilnahme'] = false;
		u['optionen'] = [{ text: 'Ja' }, { text: 'Nein' }];
		const umfrage = entwurfAus(k);
		if (!('entwurf' in umfrage)) throw new Error('Fehler erwartet nicht');
		expect((umfrage.entwurf.module[2] as Umfrage).mehrfach).toBe(true);
	});

	it('liest mehrfach auch bei einer Teilnahme als Wahrheitswert', () => {
		const k = koerper();
		(k['module'] as Record<string, unknown>[])[2]['mehrfach'] = 'ja';
		expect(entwurfAus(k)).toEqual(ungueltig('module.2.mehrfach'));
	});

	it('verlangt bei einer Umfrage ohne Teilnahme eine Liste von Optionen', () => {
		const k = koerper();
		const u = (k['module'] as Record<string, unknown>[])[2];
		u['teilnahme'] = false;
		u['optionen'] = 'Ja';
		expect(entwurfAus(k)).toEqual(ungueltig('module.2.optionen'));
		u['optionen'] = [{ text: 7 }];
		expect(entwurfAus(k)).toEqual(ungueltig('module.2.optionen'));
	});

	it('liest Optionen ohne Schluessel als neu und behaelt vorhandene Schluessel', () => {
		const k = koerper();
		const u = (k['module'] as Record<string, unknown>[])[2];
		u['teilnahme'] = false;
		u['optionen'] = [
			{ schluessel: 'o12345678', text: ' Ja ' },
			{ text: 'Nein' },
			{ schluessel: '', text: 'Weiss nicht' },
		];
		const r = entwurfAus(k);
		if (!('entwurf' in r)) throw new Error('Fehler erwartet nicht');
		expect((r.entwurf.module[2] as Umfrage).optionen).toEqual([
			{ schluessel: 'o12345678', text: 'Ja' },
			{ schluessel: null, text: 'Nein' },
			{ schluessel: null, text: 'Weiss nicht' },
		]);
	});

	it('uebernimmt Modul-IDs und macht aus fehlenden IDs null', () => {
		const k = koerper();
		const module = k['module'] as Record<string, unknown>[];
		module[0]['id'] = 'm1';
		delete module[1]['id'];
		const r = entwurfAus(k);
		if (!('entwurf' in r)) throw new Error('Fehler erwartet nicht');
		expect(r.entwurf.module.map((m) => m.id)).toEqual(['m1', null, null]);
		module[0]['id'] = 7;
		expect(entwurfAus(k)).toEqual(ungueltig('module.0.id'));
	});
});

describe('neuesModul', () => {
	it('legt als erste Umfrage die Teilnahme-Vorlage an', () => {
		const m = neuesModul('UMFRAGE', [], JETZT, 'JUNGFISCHER_FAMILIE');
		expect(m).toEqual({ typ: 'UMFRAGE', id: null, titel: null, ...neueUmfrageVorlage() });
	});

	it('legt als weitere Umfrage eine leere Ja-Nein-Umfrage ohne Teilnahme an', () => {
		const m = neuesModul('UMFRAGE', [umfrage()], JETZT, 'JUNGFISCHER_FAMILIE') as Umfrage;
		expect(m).toMatchObject({
			typ: 'UMFRAGE',
			id: null,
			teilnahme: false,
			frage: '',
			optionen: [
				{ schluessel: null, text: 'Ja' },
				{ schluessel: null, text: 'Nein' },
			],
		});
	});

	it('zaehlt nur Teilnahme-Umfragen: eine andere Umfrage laesst die Vorlage stehen', () => {
		const m = neuesModul('UMFRAGE', [umfrage({ teilnahme: false })], JETZT, 'JUNGFISCHER_FAMILIE') as Umfrage;
		expect(m.teilnahme).toBe(true);
	});

	it('legt einen Termin sieben Berliner Tage nach jetzt an, 18:00 bis 20:00 ohne Ort', () => {
		expect(neuesModul('TERMIN', [], JETZT, 'JUNGFISCHER_FAMILIE')).toEqual({
			typ: 'TERMIN',
			id: null,
			titel: null,
			termin: {
				startDatum: '2026-10-29',
				endDatum: null,
				beginn: '18:00',
				ende: '20:00',
				ort: null,
				treffpunkt: null,
			},
		});
	});

	it('rechnet den Berliner Tag, nicht den UTC-Tag: kurz nach Mitternacht Berlin ist schon der naechste', () => {
		const m = neuesModul('TERMIN', [], new Date('2026-10-22T22:30:00Z'), 'JUNGFISCHER_FAMILIE') as Extract<
			ModulEntwurf,
			{ typ: 'TERMIN' }
		>;
		expect(m.termin.startDatum).toBe('2026-10-30');
	});

	it('legt Info mit leerem Text an', () => {
		expect(neuesModul('INFO', [], JETZT, 'JUNGFISCHER_FAMILIE')).toEqual({
			typ: 'INFO',
			id: null,
			titel: null,
			text: '',
		});
	});

	it('gibt jedes Mal frische Objekte', () => {
		const a = neuesModul('UMFRAGE', [], JETZT, 'JUNGFISCHER_FAMILIE') as Umfrage;
		a.optionen[0].text = 'Ja';
		expect((neuesModul('UMFRAGE', [], JETZT, 'JUNGFISCHER_FAMILIE') as Umfrage).optionen[0].text).toBe('Dabei');
	});
});

describe('entwurfAusThread', () => {
	const termin: TerminDaten = {
		modulId: 't1',
		startDatum: '2026-10-24',
		endDatum: null,
		beginn: '18:00',
		ende: '20:00',
		ort: 'Bowlingcenter',
		treffpunkt: null,
	};
	const umfrageDaten: UmfrageDaten = {
		modulId: 'u1',
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: true,
		frist: new Date('2026-10-22T16:00:00Z'),
		ergebnisse: 'ALLE',
		optionen: [
			{ id: 'o1', schluessel: 'dabei', text: 'Dabei' },
			{ id: 'o2', schluessel: 'vielleicht', text: 'Vielleicht' },
			{ id: 'o3', schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		antworten: [],
	};
	const module: ModulDaten[] = [
		{ typ: 'INFO', id: 'i1', titel: 'Hinweis', text: 'Wir treffen uns an der Bahn.' },
		{ typ: 'TERMIN', id: 't1', titel: null, termin },
		{ typ: 'UMFRAGE', id: 'u1', titel: null, umfrage: umfrageDaten },
	];
	const k = kopf({ alleUntergruppen: false, untergruppenIds: ['gross'] });

	it('ergibt einen Entwurf ohne Fehler', () => {
		expect(entwurfFehler(entwurfAusThread(k, module), GRUPPEN)).toEqual([]);
	});

	it('uebernimmt Kopf, Module in Reihenfolge, IDs und Schluessel; die Frist steht als ISO', () => {
		const e = entwurfAusThread(k, module);
		expect(e).toMatchObject({
			titel: '🎳 Bowling',
			modus: 'KOMMENTARE',
			rollenfilter: 'JUNGFISCHER_FAMILIE',
			alleUntergruppen: false,
			untergruppenIds: ['gross'],
		});
		expect(e.module.map((m) => [m.typ, m.id])).toEqual([
			['INFO', 'i1'],
			['TERMIN', 't1'],
			['UMFRAGE', 'u1'],
		]);
		expect(e.module[0]).toMatchObject({ titel: 'Hinweis', text: 'Wir treffen uns an der Bahn.' });
		expect(e.module[1]).toEqual({
			typ: 'TERMIN',
			id: 't1',
			titel: null,
			termin: {
				startDatum: '2026-10-24',
				endDatum: null,
				beginn: '18:00',
				ende: '20:00',
				ort: 'Bowlingcenter',
				treffpunkt: null,
			},
		});
		const u = e.module[2] as Umfrage;
		expect(u.frist).toBe('2026-10-22T16:00:00.000Z');
		expect(u.optionen).toEqual([
			{ schluessel: 'dabei', text: 'Dabei' },
			{ schluessel: 'vielleicht', text: 'Vielleicht' },
			{ schluessel: 'abgesagt', text: 'Abgesagt' },
		]);
	});

	it('teilt keine Felder mit dem Thread: Aenderungen am Entwurf lassen ihn unberuehrt', () => {
		const e = entwurfAusThread(k, module);
		e.untergruppenIds.push('klein');
		(e.module[2] as Umfrage).optionen[0].text = 'Ja';
		expect(k.untergruppenIds).toEqual(['gross']);
		expect(umfrageDaten.optionen[0].text).toBe('Dabei');
	});

	it('bleibt eine Rundreise: dieselben Daten, durch entwurfAus gelesen, aendern sich nicht', () => {
		const e = entwurfAusThread(k, module);
		expect(entwurfAus(JSON.parse(JSON.stringify(e)))).toEqual({ entwurf: e });
		expect(threadDatenAus(k, module).umfragen).toHaveLength(1);
	});
});

describe('Datei- und Foto-Module im Entwurf', () => {
	const mitMedien = (): ThreadEntwurf => {
		const e = bowling();
		e.module.push(
			{ typ: 'DATEIEN', id: null, titel: 'Packliste' },
			{ typ: 'FOTOS', id: null, titel: null, hochladen: 'ALLE' },
		);
		return e;
	};
	const body = () => JSON.parse(JSON.stringify(mitMedien())) as Record<string, unknown>;
	const module = (k: Record<string, unknown>) => k['module'] as Record<string, unknown>[];

	it('liest beide Typen unveraendert', () => {
		expect(entwurfAus(body())).toEqual({ entwurf: mitMedien() });
	});

	it('weist ein unbekanntes hochladen mit dem Feld des Moduls ab', () => {
		const k = body();
		module(k)[4]['hochladen'] = 'X';
		expect(entwurfAus(k)).toEqual({ fehler: { feld: 'module.4.hochladen', text: 'Ungültige Anfrage' } });
		const k2 = body();
		delete module(k2)[4]['hochladen'];
		expect(entwurfAus(k2)).toEqual({ fehler: { feld: 'module.4.hochladen', text: 'Ungültige Anfrage' } });
	});

	it('macht aus Titeln von Datei- und Foto-Modulen null, wenn sie leer sind', () => {
		const k = body();
		module(k)[3]['titel'] = '  ';
		const r = entwurfAus(k);
		expect('entwurf' in r && r.entwurf.module[3].titel).toBeNull();
	});

	it('prueft die Laenge des Titels wie bei jedem Modul', () => {
		const e = mitMedien();
		e.module[3] = { typ: 'DATEIEN', id: null, titel: zeichen(GRENZEN.modulTitel + 1) };
		expect(entwurfFehler(e, GRUPPEN)).toEqual([
			{ feld: 'module.3.titel', text: `Höchstens ${GRENZEN.modulTitel} Zeichen.` },
		]);
		expect(entwurfFehler(mitMedien(), GRUPPEN)).toEqual([]);
	});

	it('legt ein neues Datei-Modul leer und ein neues Foto-Modul fuer Jugendleiter an', () => {
		expect(neuesModul('DATEIEN', [], JETZT, 'JUNGFISCHER_FAMILIE')).toEqual({ typ: 'DATEIEN', id: null, titel: null });
		expect(neuesModul('FOTOS', [], JETZT, 'JUNGFISCHER_FAMILIE')).toEqual({
			typ: 'FOTOS',
			id: null,
			titel: null,
			hochladen: 'JUGENDLEITER',
		});
	});

	it('uebernimmt hochladen aus dem Thread und ignoriert die Dateien', () => {
		const dateien: ModulDaten = {
			typ: 'DATEIEN',
			id: 'd1',
			titel: 'Packliste',
			dateien: [
				{
					id: 'x',
					name: 'Packliste.pdf',
					typ: 'application/pdf',
					groesse: 10,
					vonId: 'thomas',
					hochgeladenAm: JETZT,
				},
			],
		};
		const fotos: ModulDaten = { typ: 'FOTOS', id: 'f1', titel: null, hochladen: 'ALLE', fotos: [] };
		const e = entwurfAusThread(kopf(), [dateien, fotos]);
		expect(e.module).toEqual([
			{ typ: 'DATEIEN', id: 'd1', titel: 'Packliste' },
			{ typ: 'FOTOS', id: 'f1', titel: null, hochladen: 'ALLE' },
		]);
		expect(entwurfAus(JSON.parse(JSON.stringify(e)))).toEqual({ entwurf: e });
	});
});

describe('Helferliste im Entwurf', () => {
	function helfer(aenderung: Partial<Helfer> = {}): Helfer {
		return {
			typ: 'HELFER',
			id: null,
			titel: 'Mitbringen',
			einheit: 'ERWACHSENER',
			frist: null,
			positionen: [
				{ schluessel: null, text: 'Kuchen', anzahl: 4 },
				{ schluessel: null, text: 'Grill', anzahl: 2 },
			],
			...aenderung,
		};
	}
	// Bowling mit der Helferliste an Index 3.
	const mitHelfer = (aenderung: Partial<Helfer> = {}): ThreadEntwurf => {
		const e = bowling();
		e.module.push(helfer(aenderung));
		return e;
	};
	const mitPositionen = (positionen: Helfer['positionen']) => entwurfFehler(mitHelfer({ positionen }), GRUPPEN);
	const position = (text: string, anzahl = 1) => ({ schluessel: null, text, anzahl });
	const nummeriert = (n: number) => Array.from({ length: n }, (_, i) => position(`Position ${i}`));
	const fehler = (text: string) => [{ feld: 'module.3.positionen', text }];
	const body = (aenderung: Partial<Helfer> = {}) =>
		JSON.parse(JSON.stringify(mitHelfer(aenderung))) as Record<string, unknown>;
	const helferIn = (k: Record<string, unknown>) => (k['module'] as Record<string, unknown>[])[3];
	const ungueltig = (feld: string) => ({ fehler: { feld, text: 'Ungültige Anfrage' } });

	it('liest eine Helferliste mit zwei Positionen und findet keinen Fehler', () => {
		expect(entwurfAus(body())).toEqual({ entwurf: mitHelfer() });
		expect(entwurfFehler(mitHelfer(), GRUPPEN)).toEqual([]);
	});

	it('schneidet Positionstexte, behaelt Schluessel und macht aus fehlenden null', () => {
		const k = body();
		helferIn(k)['positionen'] = [
			{ schluessel: 'pkuchen01', text: ' Kuchen ', anzahl: 4 },
			{ text: 'Grill', anzahl: 2 },
		];
		const r = entwurfAus(k);
		if (!('entwurf' in r)) throw new Error('Fehler erwartet nicht');
		expect((r.entwurf.module[3] as Helfer).positionen).toEqual([
			{ schluessel: 'pkuchen01', text: 'Kuchen', anzahl: 4 },
			{ schluessel: null, text: 'Grill', anzahl: 2 },
		]);
	});

	it('weist Positionen ohne Liste, ohne Text oder ohne Zahl als Anzahl am Feld positionen ab', () => {
		for (const positionen of ['Kuchen', [{ anzahl: 1 }], [{ text: 'Kuchen', anzahl: '4' }], [{ text: 'Kuchen' }]]) {
			const k = body();
			helferIn(k)['positionen'] = positionen;
			expect(entwurfAus(k)).toEqual(ungueltig('module.3.positionen'));
		}
	});

	it('weist eine unbekannte Einheit und eine unlesbare Frist ab und schreibt die Frist als UTC-ISO', () => {
		const einheit = body();
		helferIn(einheit)['einheit'] = 'FAMILIE';
		expect(entwurfAus(einheit)).toEqual(ungueltig('module.3.einheit'));
		const unlesbar = body();
		helferIn(unlesbar)['frist'] = 'morgen';
		expect(entwurfAus(unlesbar)).toEqual(ungueltig('module.3.frist'));
		const frist = body();
		helferIn(frist)['frist'] = '2026-10-27T18:00:00+01:00';
		const r = entwurfAus(frist);
		expect('entwurf' in r && (r.entwurf.module[3] as Helfer).frist).toBe('2026-10-27T17:00:00.000Z');
	});

	it('verlangt mindestens eine Position', () => {
		expect(mitPositionen([])).toEqual(fehler('Bitte mindestens eine Position.'));
	});

	it('erlaubt 30 und verweigert 31 Positionen', () => {
		expect(mitPositionen(nummeriert(GRENZEN.positionen))).toEqual([]);
		expect(mitPositionen(nummeriert(GRENZEN.positionen + 1))).toEqual(fehler('Höchstens 30 Positionen.'));
	});

	it('verlangt jede Position ausgefuellt', () => {
		expect(mitPositionen([position('Kuchen'), position('  ')])).toEqual(fehler('Bitte jede Position ausfüllen.'));
	});

	it('erlaubt 80 und verweigert 81 Zeichen, gemessen ohne Leerraum an den Enden', () => {
		expect(mitPositionen([position(` ${zeichen(80)} `)])).toEqual([]);
		expect(mitPositionen([position(zeichen(81))])).toEqual(fehler('Höchstens 80 Zeichen.'));
	});

	it('verweigert dieselbe Position zweimal, ohne Gross-/Kleinschreibung', () => {
		expect(mitPositionen([position('Kuchen'), position(' kuchen')])).toEqual(fehler('Jede Position nur einmal.'));
	});

	it('verlangt eine ganze Anzahl zwischen 1 und 99', () => {
		for (const anzahl of [0, 100, 1.5, -1]) {
			expect(mitPositionen([position('Kuchen', anzahl)])).toEqual(fehler('Die Anzahl muss zwischen 1 und 99 liegen.'));
		}
		expect(mitPositionen([position('Kuchen', 1), position('Grill', 99)])).toEqual([]);
	});

	it('meldet je Liste nur den ersten Fehler der Positionen: leer vor doppelt vor Anzahl', () => {
		expect(mitPositionen([position('Kuchen', 0), position('kuchen'), position('')])).toEqual(
			fehler('Bitte jede Position ausfüllen.'),
		);
		expect(mitPositionen([position('Kuchen', 0), position('kuchen')])).toEqual(fehler('Jede Position nur einmal.'));
	});

	it('verweigert pro Jungfischer bei Nur Familie am Feld einheit', () => {
		const e: ThreadEntwurf = { ...mitHelfer({ einheit: 'JUNGFISCHER' }), rollenfilter: 'NUR_FAMILIE' };
		e.module = [e.module[3]];
		expect(entwurfFehler(e, GRUPPEN)).toEqual([
			{ feld: 'module.0.einheit', text: 'Diese Einheit fragt bei dieser Zielgruppe niemanden.' },
		]);
	});

	it('prueft den Modultitel wie bei jedem Modul', () => {
		expect(entwurfFehler(mitHelfer({ titel: zeichen(81) }), GRUPPEN)).toEqual([
			{ feld: 'module.3.titel', text: 'Höchstens 80 Zeichen.' },
		]);
	});

	it('legt eine neue Helferliste pro Erwachsenem ohne Frist mit einer leeren Position an', () => {
		const erwartet = {
			typ: 'HELFER',
			id: null,
			titel: null,
			einheit: 'ERWACHSENER',
			frist: null,
			positionen: [{ schluessel: null, text: '', anzahl: 1 }],
		};
		expect(neuesModul('HELFER', [], JETZT, 'NUR_JUGENDLEITER')).toEqual(erwartet);
		expect(neuesModul('HELFER', [], JETZT, 'JUNGFISCHER_FAMILIE')).toEqual(erwartet);
	});

	it('gibt jedes Mal frische Positionen', () => {
		const a = neuesModul('HELFER', [], JETZT, 'NUR_FAMILIE') as Helfer;
		a.positionen[0].text = 'Kuchen';
		expect((neuesModul('HELFER', [], JETZT, 'NUR_FAMILIE') as Helfer).positionen[0].text).toBe('');
	});

	describe('entwurfAusThread', () => {
		const daten: HelferDaten = {
			modulId: 'h1',
			titel: 'Mitbringen',
			einheit: 'PERSON',
			frist: new Date('2026-10-27T17:00:00Z'),
			positionen: [
				{
					id: 'p-grill',
					schluessel: 'pgrill001',
					text: 'Grill',
					anzahl: 2,
					eintraege: [{ fuerId: 'sandra', vonId: 'sandra', notiz: null, eingetragenAm: JETZT }],
				},
				{ id: 'p-kuchen', schluessel: 'pkuchen01', text: 'Kuchen', anzahl: 4, eintraege: [] },
			],
		};
		const module: ModulDaten[] = [{ typ: 'HELFER', id: 'h1', titel: 'Mitbringen', helfer: daten }];

		it('uebernimmt Einheit, Frist als ISO und Positionen in ihrer Reihenfolge mit Schluessel, ohne Eintraege', () => {
			expect(entwurfAusThread(kopf(), module).module).toEqual([
				{
					typ: 'HELFER',
					id: 'h1',
					titel: 'Mitbringen',
					einheit: 'PERSON',
					frist: '2026-10-27T17:00:00.000Z',
					positionen: [
						{ schluessel: 'pgrill001', text: 'Grill', anzahl: 2 },
						{ schluessel: 'pkuchen01', text: 'Kuchen', anzahl: 4 },
					],
				},
			]);
		});

		it('bleibt eine Rundreise und gibt die Liste an die Threaddaten', () => {
			const e = entwurfAusThread(kopf(), module);
			expect(entwurfAus(JSON.parse(JSON.stringify(e)))).toEqual({ entwurf: e });
			expect(threadDatenAus(kopf(), module).helfer).toEqual([daten]);
		});
	});
});
