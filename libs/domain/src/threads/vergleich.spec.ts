import type { ModulDaten } from './ansicht.js';
import { teilnahmeOptionen } from '../module/umfrage/umfrage.js';
import { entwurfAusThread, type ModulEntwurf, type ThreadEntwurf } from './entwurf.js';
import { bowlingUmfeld, kopf } from './testhilfe.js';
import type { FahrtDaten, HelferDaten, UmfrageDaten } from './typen.js';
import { umfrageSperre, vergleicheEntwurf, zielgruppeGeaendert } from './vergleich.js';
import { systemSatz } from './verlauf.js';

const umfeld = bowlingUmfeld();

type UmfrageEntwurf = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;
type TerminEntwurf = Extract<ModulEntwurf, { typ: 'TERMIN' }>;

const antwort = (fuerId: string, optionIds: string[]) => ({
	fuerId,
	vonId: fuerId,
	optionIds,
	abgegebenAm: new Date('2026-10-21T12:00:00Z'),
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
		// Lena hat auf "Vielleicht" geantwortet, Max auf nichts (leere Antwort).
		antworten: [antwort('lena', ['o-vielleicht']), antwort('max', [])],
		...daten,
	};
}

// Bowling: Info, Termin, Teilnahme-Umfrage (Index 2).
function bowling(u: Partial<UmfrageDaten> = {}): ModulDaten[] {
	return [
		{ typ: 'INFO', id: 'i1', titel: 'Wichtig', text: 'Bitte Socken mitbringen' },
		{
			typ: 'TERMIN',
			id: 't1',
			titel: null,
			termin: {
				modulId: 't1',
				startDatum: '2026-10-24',
				endDatum: null,
				beginn: '18:00',
				ende: '20:00',
				ort: 'Bowlingcenter',
				treffpunkt: null,
			},
		},
		{ typ: 'UMFRAGE', id: 'u1', titel: null, umfrage: umfrage(u) },
	];
}

const alt = (u: Partial<UmfrageDaten> = {}, k = kopf()) => ({ kopf: k, module: bowling(u) });

// Der gespeicherte Thread als Entwurf mit Aenderungen: die Form, in der der Server ihn
// nach entwurfAus bekommt.
function entwurf(aendern: (e: ThreadEntwurf) => void = () => {}, u: Partial<UmfrageDaten> = {}): ThreadEntwurf {
	const e = entwurfAusThread(kopf(), bowling(u));
	aendern(e);
	return e;
}
const umfrageIn = (e: ThreadEntwurf) => e.module[2] as UmfrageEntwurf;
// Wie entwurfAus: Der Schalter bestimmt die festen Optionen einer Teilnahme mit.
function vielleichtSetzen(e: ThreadEntwurf, vielleicht: boolean): void {
	const u = umfrageIn(e);
	u.vielleicht = vielleicht;
	u.optionen = teilnahmeOptionen(vielleicht);
}
const terminIn = (e: ThreadEntwurf) => e.module[1] as TerminEntwurf;

describe('vergleicheEntwurf', () => {
	it('findet an einem unveraenderten Entwurf nichts', () => {
		const v = vergleicheEntwurf(alt(), entwurf());
		expect(v).toMatchObject({
			fehler: null,
			konflikt: null,
			loeschen: [],
			anlegen: [],
			kopfGeaendert: false,
			sichtbarkeitGeaendert: false,
			system: [],
		});
		expect(v.behalten.map((b) => [b.id, b.position, b.geaendert, b.optionenLoeschen, b.positionenLoeschen])).toEqual([
			['i1', 0, false, [], []],
			['t1', 1, false, [], []],
			['u1', 2, false, [], []],
		]);
	});

	describe('Module', () => {
		it('plant neue Module mit ihrer Position und loescht fehlende', () => {
			const e = entwurf(
				(e) => {
					e.module.splice(0, 1);
					e.module.push({ typ: 'INFO', id: null, titel: null, text: 'Neu' });
				},
				{ antworten: [] },
			);
			const v = vergleicheEntwurf(alt({ antworten: [] }), e);
			expect(v.loeschen).toEqual(['i1']);
			expect(v.anlegen).toEqual([{ position: 2, neu: e.module[2] }]);
			// Die uebrigen rutschen nach vorn: ihre Position muss geschrieben werden.
			expect(v.behalten.map((b) => [b.id, b.position, b.geaendert])).toEqual([
				['t1', 0, true],
				['u1', 1, true],
			]);
		});

		it('sortiert um: beide Module geaendert, kein Systemeintrag', () => {
			const e = entwurf((e) => e.module.splice(0, 2, e.module[1], e.module[0]));
			const v = vergleicheEntwurf(alt(), e);
			expect(v.behalten.map((b) => [b.id, b.position, b.geaendert])).toEqual([
				['t1', 0, true],
				['i1', 1, true],
				['u1', 2, false],
			]);
			expect(v.system).toEqual([]);
			expect(v.fehler).toBeNull();
		});

		it('lehnt eine Modul-ID ab, die der Thread nicht hat', () => {
			const e = entwurf((e) => (e.module[0] = { ...e.module[0], id: 'fremd' }));
			expect(vergleicheEntwurf(alt(), e).fehler).toEqual({ feld: 'module.0', text: 'Ungültige Anfrage' });
		});

		it('lehnt dieselbe ID mit anderem Typ ab', () => {
			const e = entwurf((e) => (e.module[0] = { typ: 'INFO', id: 't1', titel: null, text: 'x' }));
			expect(vergleicheEntwurf(alt(), e).fehler).toEqual({ feld: 'module.0', text: 'Ungültige Anfrage' });
		});

		it('lehnt dieselbe ID zweimal ab, am zweiten Vorkommen', () => {
			const e = entwurf((e) => e.module.push({ ...e.module[0] }));
			expect(vergleicheEntwurf(alt(), e).fehler).toEqual({ feld: 'module.3', text: 'Ungültige Anfrage' });
		});

		it('meldet einen ungueltigen Entwurf als fehler und laesst den Plan leer', () => {
			const e = entwurf((e) => {
				e.titel = 'Neu';
				e.module[2] = { ...e.module[2], id: 'fremd' };
			});
			const v = vergleicheEntwurf(alt(), e);
			expect(v).toMatchObject({ loeschen: [], behalten: [], anlegen: [], kopfGeaendert: false, system: [] });
		});

		it('sperrt das Entfernen einer Umfrage mit einer leeren Antwort', () => {
			const e = entwurf((e) => e.module.pop(), { antworten: [antwort('max', [])] });
			const v = vergleicheEntwurf(alt({ antworten: [antwort('max', [])] }), e);
			expect(v.konflikt).toEqual({
				feld: 'module',
				text: 'Die Umfrage „Kommst du mit?“ hat schon Antworten und lässt sich nicht entfernen.',
				konflikt: true,
			});
			expect(v.loeschen).toEqual([]);
		});

		it('erlaubt das Entfernen einer Umfrage ohne Antworten', () => {
			const e = entwurf((e) => e.module.pop());
			const v = vergleicheEntwurf(alt({ antworten: [] }), e);
			expect(v.konflikt).toBeNull();
			expect(v.loeschen).toEqual(['u1']);
		});

		it('meldet den Konflikt des ersten gespeicherten Moduls, nicht des ersten im Entwurf', () => {
			const zweite = {
				typ: 'UMFRAGE' as const,
				id: 'u2',
				titel: null,
				umfrage: umfrage({ modulId: 'u2', frage: 'Essen?' }),
			};
			const modul = [...bowling(), zweite];
			const e = entwurfAusThread(kopf(), modul);
			// u2 (Index 3) bleibt mit geaenderter Einheit vorn im Entwurf, u1 (Index 2) faellt weg.
			e.module = [e.module[3], e.module[0], e.module[1]];
			(e.module[0] as UmfrageEntwurf).einheit = 'PERSON';
			const v = vergleicheEntwurf({ kopf: kopf(), module: modul }, e);
			expect(v.konflikt?.feld).toBe('module');
		});
	});

	describe('Umfrage mit Antworten', () => {
		it('sperrt eine entfernte Option, auf die jemand geantwortet hat', () => {
			const e = entwurf((e) => vielleichtSetzen(e, false));
			const v = vergleicheEntwurf(alt(), e);
			expect(v.konflikt).toEqual({
				feld: 'module.2.optionen',
				text: 'Auf „Vielleicht“ hat schon jemand geantwortet.',
				konflikt: true,
			});
		});

		it('sperrt die Einheit', () => {
			const e = entwurf((e) => (umfrageIn(e).einheit = 'PERSON'));
			expect(vergleicheEntwurf(alt(), e).konflikt).toEqual({
				feld: 'module.2.einheit',
				text: 'Die Einheit lässt sich nach den ersten Antworten nicht mehr ändern.',
				konflikt: true,
			});
		});

		it('sperrt den Teilnahme-Schalter', () => {
			const e = entwurf((e) => {
				const u = umfrageIn(e);
				u.teilnahme = false;
				u.optionen = umfrage().optionen.map((o) => ({ schluessel: o.schluessel, text: o.text }));
			});
			const v = vergleicheEntwurf(alt(), e);
			expect(v.konflikt?.feld).toBe('module.2.teilnahme');
			expect(v.konflikt?.konflikt).toBe(true);
		});

		it('sperrt das Abschalten von mehrfach bei einer Antwort mit zwei Optionen', () => {
			const u = { mehrfach: true, antworten: [antwort('lena', ['o-dabei', 'o-vielleicht'])] };
			const e = entwurf((e) => (umfrageIn(e).mehrfach = false), u);
			const v = vergleicheEntwurf(alt(u), e);
			expect(v.konflikt?.feld).toBe('module.2.mehrfach');
		});

		it('erlaubt Umbenennen und Umsortieren der Optionen', () => {
			const e = entwurf((e) => {
				const u = umfrageIn(e);
				u.optionen = [u.optionen[1], u.optionen[0], u.optionen[2]].map((o) => ({ ...o, text: o.text + '!' }));
			});
			const v = vergleicheEntwurf(alt(), e);
			expect(v.konflikt).toBeNull();
			expect(v.behalten[2].geaendert).toBe(true);
		});

		it('meldet den Konflikt vor einem unbeantworteten Rest, ohne etwas zu loeschen', () => {
			const e = entwurf((e) => vielleichtSetzen(e, false));
			expect(vergleicheEntwurf(alt(), e).behalten).toEqual([]);
		});

		it('geht bei fehler und konflikt zugleich mit dem fehler vor', () => {
			const e = entwurf((e) => {
				umfrageIn(e).einheit = 'PERSON';
				e.module[0] = { ...e.module[0], id: 'fremd' };
			});
			const v = vergleicheEntwurf(alt(), e);
			expect(v.fehler?.feld).toBe('module.0');
			expect(v.konflikt).toBeNull();
		});
	});

	describe('Optionen ohne Antworten', () => {
		const ohne = { antworten: [] };

		it('listet eine entfernte unbeantwortete Option zum Loeschen', () => {
			const e = entwurf((e) => vielleichtSetzen(e, false), ohne);
			const v = vergleicheEntwurf(alt(ohne), e);
			expect(v.konflikt).toBeNull();
			expect(v.behalten[2].optionenLoeschen).toEqual(['vielleicht']);
		});

		it('loescht auch eine unbeantwortete Option, wenn eine andere beantwortet ist', () => {
			const u = { antworten: [antwort('lena', ['o-dabei'])] };
			const e = entwurf((e) => vielleichtSetzen(e, false), u);
			const v = vergleicheEntwurf(alt(u), e);
			expect(v.konflikt).toBeNull();
			expect(v.behalten[2].optionenLoeschen).toEqual(['vielleicht']);
		});

		it('nimmt "Vielleicht" als neue Option mit festem Schluessel an', () => {
			const stand = {
				vielleicht: false,
				optionen: umfrage().optionen.filter((o) => o.schluessel !== 'vielleicht'),
				antworten: [],
			};
			const e = entwurf((e) => vielleichtSetzen(e, true), stand);
			const v = vergleicheEntwurf(alt(stand), e);
			expect(v.fehler).toBeNull();
			expect(v.behalten[2]).toMatchObject({ geaendert: true, optionenLoeschen: [] });
		});

		const offen = (optionen: UmfrageEntwurf['optionen']): ThreadEntwurf => {
			const stand = {
				teilnahme: false,
				optionen: [
					{ id: 'o1', schluessel: 'oab12cd34', text: 'Ja' },
					{ id: 'o2', schluessel: 'oef56gh78', text: 'Nein' },
				],
				antworten: [],
			};
			const e = entwurf((e) => (e.module[2] = { ...umfrageIn(e), teilnahme: false, optionen }), stand);
			return e;
		};
		const offenAlt = () => ({
			kopf: kopf(),
			module: bowling({
				teilnahme: false,
				optionen: [
					{ id: 'o1', schluessel: 'oab12cd34', text: 'Ja' },
					{ id: 'o2', schluessel: 'oef56gh78', text: 'Nein' },
				],
				antworten: [],
			}),
		});

		it('nimmt neue Optionen ohne Schluessel und bestehende mit Schluessel an', () => {
			const e = offen([
				{ schluessel: 'oab12cd34', text: 'Ja' },
				{ schluessel: null, text: 'Vielleicht' },
			]);
			const v = vergleicheEntwurf(offenAlt(), e);
			expect(v.fehler).toBeNull();
			expect(v.behalten[2].optionenLoeschen).toEqual(['oef56gh78']);
		});

		it('lehnt einen Schluessel ab, den die Umfrage nicht hat', () => {
			const e = offen([
				{ schluessel: 'oab12cd34', text: 'Ja' },
				{ schluessel: 'ofremd000', text: 'Nein' },
			]);
			expect(vergleicheEntwurf(offenAlt(), e).fehler).toEqual({
				feld: 'module.2.optionen',
				text: 'Ungültige Anfrage',
			});
		});

		it('lehnt denselben Schluessel zweimal ab', () => {
			const e = offen([
				{ schluessel: 'oab12cd34', text: 'Ja' },
				{ schluessel: 'oab12cd34', text: 'Nein' },
			]);
			expect(vergleicheEntwurf(offenAlt(), e).fehler?.feld).toBe('module.2.optionen');
		});

		it('lehnt einen Schluessel an einer neuen Umfrage ab, ausser bei der Teilnahme', () => {
			const e = entwurf();
			e.module.push({ ...umfrageIn(e), id: null, teilnahme: false, optionen: [{ schluessel: 'dabei', text: 'Ja' }] });
			expect(vergleicheEntwurf(alt(), e).fehler).toEqual({ feld: 'module.3.optionen', text: 'Ungültige Anfrage' });

			const f = entwurf();
			f.module.push({ ...umfrageIn(f), id: null });
			expect(vergleicheEntwurf(alt(), f).fehler).toBeNull();
		});
	});

	describe('Systemeintraege', () => {
		it('meldet einen verschobenen Termin mit allen Feldern', () => {
			const e = entwurf((e) => (terminIn(e).termin.startDatum = '2026-10-25'));
			const v = vergleicheEntwurf(alt(), e);
			expect(v.system).toEqual([
				{
					art: 'TERMIN_GEAENDERT',
					daten: {
						termin: {
							modulId: 't1',
							startDatum: '2026-10-25',
							endDatum: null,
							beginn: '18:00',
							ende: '20:00',
							ort: 'Bowlingcenter',
							treffpunkt: null,
						},
					},
				},
			]);
		});

		it('meldet bei geaendertem Ort nichts, markiert das Modul aber als geaendert', () => {
			const e = entwurf((e) => (terminIn(e).termin.ort = 'Kegelbahn'));
			const v = vergleicheEntwurf(alt(), e);
			expect(v.system).toEqual([]);
			expect(v.behalten[1].geaendert).toBe(true);
		});

		it('meldet eine geaenderte Frist, auch als aufgehobene', () => {
			const e = entwurf((e) => (umfrageIn(e).frist = '2026-10-23T16:00:00.000Z'));
			expect(vergleicheEntwurf(alt(), e).system).toEqual([
				{ art: 'FRIST_GEAENDERT', daten: { frage: 'Kommst du mit?', frist: '2026-10-23T16:00:00.000Z' } },
			]);
			const f = entwurf((e) => (umfrageIn(e).frist = null));
			expect(vergleicheEntwurf(alt(), f).system).toEqual([
				{ art: 'FRIST_GEAENDERT', daten: { frage: 'Kommst du mit?', frist: null } },
			]);
		});

		it('meldet einen geaenderten Modus und markiert den Kopf', () => {
			const e = entwurf((e) => (e.modus = 'AUSHANG'));
			const v = vergleicheEntwurf(alt(), e);
			expect(v.system).toEqual([{ art: 'MODUS_GEAENDERT', daten: { modus: 'AUSHANG' } }]);
			expect(v.kopfGeaendert).toBe(true);
		});

		it('meldet nichts fuer neue und entfernte Module', () => {
			const e = entwurf((e) => {
				e.module.shift();
				e.module.push({ typ: 'INFO', id: null, titel: null, text: 'Neu' });
			});
			expect(vergleicheEntwurf(alt(), e).system).toEqual([]);
		});

		it('ergibt Daten, aus denen systemSatz einen eigenen Satz macht', () => {
			const e = entwurf((e) => {
				e.modus = 'AUSHANG';
				terminIn(e).termin.startDatum = '2026-10-25';
				umfrageIn(e).frist = '2026-10-23T16:00:00.000Z';
			});
			const f = entwurf((e) => (umfrageIn(e).frist = null));
			const eintraege = [...vergleicheEntwurf(alt(), e).system, ...vergleicheEntwurf(alt(), f).system];
			expect(eintraege).toHaveLength(4);
			for (const s of eintraege) {
				expect(systemSatz(s.art, s.daten, 'Thomas', umfeld)).not.toBe('Thomas hat den Thread geändert');
			}
		});
	});

	describe('Kopf und Sichtbarkeit', () => {
		it('aendert beim Titel nur den Kopf', () => {
			const v = vergleicheEntwurf(
				alt(),
				entwurf((e) => (e.titel = 'Kegeln')),
			);
			expect(v).toMatchObject({ kopfGeaendert: true, sichtbarkeitGeaendert: false, system: [] });
		});

		it('meldet geaenderte Untergruppen und Rollenfilter als Sichtbarkeit', () => {
			const a = vergleicheEntwurf(
				alt(),
				entwurf((e) => (e.rollenfilter = 'NUR_FAMILIE')),
			);
			expect(a.sichtbarkeitGeaendert).toBe(true);
			const b = vergleicheEntwurf(
				alt(),
				entwurf((e) => ((e.alleUntergruppen = false), (e.untergruppenIds = ['gross']))),
			);
			expect(b.sichtbarkeitGeaendert).toBe(true);
			const gewaehlt = kopf({ alleUntergruppen: false, untergruppenIds: ['gross'] });
			const c = vergleicheEntwurf(
				{ kopf: gewaehlt, module: bowling() },
				{ ...entwurfAusThread(gewaehlt, bowling()), untergruppenIds: ['gross', 'klein'] },
			);
			expect(c.sichtbarkeitGeaendert).toBe(true);
		});

		it('vergleicht Untergruppen als Menge', () => {
			const gewaehlt = kopf({ alleUntergruppen: false, untergruppenIds: ['gross', 'klein'] });
			const e = { ...entwurfAusThread(gewaehlt, bowling()), untergruppenIds: ['klein', 'gross', 'klein'] };
			expect(vergleicheEntwurf({ kopf: gewaehlt, module: bowling() }, e).sichtbarkeitGeaendert).toBe(false);
		});

		it('ignoriert die IDs, solange alle Untergruppen gelten', () => {
			const e = entwurf((e) => (e.untergruppenIds = ['gross']));
			expect(vergleicheEntwurf(alt(), e).sichtbarkeitGeaendert).toBe(false);
		});
	});
});

describe('zielgruppeGeaendert', () => {
	const gewaehlt = kopf({ alleUntergruppen: false, untergruppenIds: ['gross', 'klein'] });
	const entwurf = (aenderung: Partial<ThreadEntwurf>): ThreadEntwurf => ({
		...entwurfAusThread(gewaehlt, []),
		...aenderung,
	});

	it('erkennt einen anderen Rollenfilter, Schalter oder eine andere Auswahl', () => {
		expect(zielgruppeGeaendert(gewaehlt, entwurf({}))).toBe(false);
		expect(zielgruppeGeaendert(gewaehlt, entwurf({ rollenfilter: 'NUR_FAMILIE' }))).toBe(true);
		expect(zielgruppeGeaendert(gewaehlt, entwurf({ alleUntergruppen: true }))).toBe(true);
		expect(zielgruppeGeaendert(gewaehlt, entwurf({ untergruppenIds: ['gross'] }))).toBe(true);
	});

	it('vergleicht die Auswahl als Menge und ignoriert sie bei "alle Untergruppen"', () => {
		expect(zielgruppeGeaendert(gewaehlt, entwurf({ untergruppenIds: ['klein', 'gross', 'klein'] }))).toBe(false);
		const alle = kopf({ alleUntergruppen: true, untergruppenIds: [] });
		expect(zielgruppeGeaendert(alle, { ...entwurfAusThread(alle, []), untergruppenIds: ['gross'] })).toBe(false);
	});
});

describe('umfrageSperre', () => {
	it('ist ohne Antworten frei', () => {
		expect(umfrageSperre(umfrage({ antworten: [] }))).toEqual({
			beantwortet: false,
			schluessel: [],
			mehrfachGenutzt: false,
		});
	});

	it('zaehlt eine leere Antwort als beantwortet und sperrt nur Optionen mit Antwort', () => {
		expect(umfrageSperre(umfrage({ antworten: [antwort('max', [])] }))).toEqual({
			beantwortet: true,
			schluessel: [],
			mehrfachGenutzt: false,
		});
	});

	it('nennt die Schluessel beantworteter Optionen und erkennt mehrfach', () => {
		const u = umfrage({ antworten: [antwort('max', []), antwort('lena', ['o-dabei', 'o-vielleicht'])] });
		expect(umfrageSperre(u)).toEqual({
			beantwortet: true,
			schluessel: ['dabei', 'vielleicht'],
			mehrfachGenutzt: true,
		});
	});
});

describe('vergleicheEntwurf: Datei- und Foto-Module', () => {
	const datei = {
		id: 'x',
		name: 'Packliste.pdf',
		typ: 'application/pdf',
		groesse: 10,
		vonId: 'thomas',
		hochgeladenAm: new Date('2026-10-21T12:00:00Z'),
	};
	const medien = (): ModulDaten[] => [
		{ typ: 'DATEIEN', id: 'd1', titel: 'Packliste', dateien: [datei] },
		{ typ: 'FOTOS', id: 'f1', titel: null, hochladen: 'JUGENDLEITER', fotos: [] },
	];
	const gespeichert = { kopf: kopf(), module: medien() };
	const neuerEntwurf = (aendern: (e: ThreadEntwurf) => void = () => {}) => {
		const e = entwurfAusThread(kopf(), medien());
		aendern(e);
		return e;
	};
	const fotosIn = (e: ThreadEntwurf) => e.module[1] as Extract<ModulEntwurf, { typ: 'FOTOS' }>;

	it('findet an unveraenderten Modulen nichts, auch wenn Dateien da sind', () => {
		const v = vergleicheEntwurf(gespeichert, neuerEntwurf());
		expect(v.behalten.map((b) => [b.id, b.geaendert])).toEqual([
			['d1', false],
			['f1', false],
		]);
		expect(v).toMatchObject({ fehler: null, konflikt: null, loeschen: [], anlegen: [], system: [] });
	});

	it('zaehlt eine Umstellung von hochladen als Aenderung des Moduls, ohne Systemeintrag', () => {
		const v = vergleicheEntwurf(
			gespeichert,
			neuerEntwurf((e) => (fotosIn(e).hochladen = 'ALLE')),
		);
		expect(v.behalten.map((b) => [b.id, b.geaendert])).toEqual([
			['d1', false],
			['f1', true],
		]);
		expect(v.system).toEqual([]);
	});

	it('zaehlt den Titel beider Typen als Aenderung', () => {
		const e = neuerEntwurf((e) => {
			e.module[0] = { ...e.module[0], titel: 'Neu' };
			e.module[1] = { ...e.module[1], titel: 'Bilder' };
		});
		expect(vergleicheEntwurf(gespeichert, e).behalten.map((b) => b.geaendert)).toEqual([true, true]);
	});

	it('loescht entfernte Module ohne Konflikt, auch mit Dateien', () => {
		const v = vergleicheEntwurf(
			gespeichert,
			neuerEntwurf((e) => e.module.splice(0, 1)),
		);
		expect(v).toMatchObject({ konflikt: null, fehler: null, loeschen: ['d1'] });
	});

	it('lehnt einen Typwechsel unter derselben ID ab', () => {
		const e = neuerEntwurf((e) => (e.module[0] = { typ: 'FOTOS', id: 'd1', titel: null, hochladen: 'ALLE' }));
		expect(vergleicheEntwurf(gespeichert, e).fehler).toEqual({ feld: 'module.0', text: 'Ungültige Anfrage' });
	});
});

describe('vergleicheEntwurf: Helferliste', () => {
	type HelferEntwurf = Extract<ModulEntwurf, { typ: 'HELFER' }>;
	const eintrag = (fuerId: string) => ({
		fuerId,
		vonId: fuerId,
		notiz: null,
		eingetragenAm: new Date('2026-10-21T12:00:00Z'),
	});
	// Kuchen: Platz fuer vier, zwei eingetragen. Grill: Platz fuer zwei, leer.
	const helfer = (h: Partial<HelferDaten> = {}): HelferDaten => ({
		modulId: 'h1',
		titel: 'Mitbringen',
		einheit: 'ERWACHSENER',
		frist: null,
		positionen: [
			{
				id: 'p-kuchen',
				schluessel: 'pkuchen01',
				text: 'Kuchen',
				anzahl: 4,
				eintraege: [eintrag('sandra'), eintrag('peter')],
			},
			{ id: 'p-grill', schluessel: 'pgrill001', text: 'Grill', anzahl: 2, eintraege: [] },
		],
		...h,
	});
	const ohneEintraege = (): Partial<HelferDaten> => ({
		positionen: helfer().positionen.map((p) => ({ ...p, eintraege: [] })),
	});
	// Info an Index 0, die Helferliste an Index 1.
	const module = (h: Partial<HelferDaten> = {}, titel: string | null = 'Mitbringen'): ModulDaten[] => [
		{ typ: 'INFO', id: 'i1', titel: null, text: 'Bitte mithelfen' },
		{ typ: 'HELFER', id: 'h1', titel, helfer: { ...helfer(h), titel } },
	];
	const gespeichert = (h: Partial<HelferDaten> = {}, titel: string | null = 'Mitbringen') => ({
		kopf: kopf(),
		module: module(h, titel),
	});
	const neuerEntwurf = (
		aendern: (m: HelferEntwurf, e: ThreadEntwurf) => void = () => {},
		h: Partial<HelferDaten> = {},
		titel: string | null = 'Mitbringen',
	): ThreadEntwurf => {
		const e = entwurfAusThread(kopf(), module(h, titel));
		aendern(e.module[1] as HelferEntwurf, e);
		return e;
	};
	const kuchen = (m: HelferEntwurf) => m.positionen.find((p) => p.schluessel === 'pkuchen01')!;

	it('findet an einer unveraenderten Liste nichts', () => {
		const v = vergleicheEntwurf(gespeichert(), neuerEntwurf());
		expect(v).toMatchObject({ fehler: null, konflikt: null, loeschen: [], anlegen: [], system: [] });
		expect(v.behalten.map((b) => [b.id, b.geaendert, b.positionenLoeschen])).toEqual([
			['i1', false, []],
			['h1', false, []],
		]);
	});

	it('loescht eine entfernte leere Position', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((m) => m.positionen.pop()),
		);
		expect(v.konflikt).toBeNull();
		expect(v.behalten[1]).toMatchObject({ geaendert: true, positionenLoeschen: ['pgrill001'] });
	});

	it('sperrt das Entfernen einer belegten Position', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((m) => m.positionen.shift()),
		);
		expect(v.konflikt).toEqual({
			feld: 'module.1.positionen',
			text: 'Für „Kuchen“ hat sich schon jemand eingetragen.',
			konflikt: true,
		});
		expect(v.behalten).toEqual([]);
	});

	it('sperrt eine Anzahl unter den Eingetragenen', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((m) => (kuchen(m).anzahl = 1)),
		);
		expect(v.konflikt).toEqual({
			feld: 'module.1.positionen',
			text: 'Für „Kuchen“ sind schon 2 eingetragen.',
			konflikt: true,
		});
	});

	it('erlaubt Umbenennen und Umsortieren: der Schluessel bleibt, die Liste ist geaendert', () => {
		const e = neuerEntwurf((m) => {
			kuchen(m).text = 'Torte';
			m.positionen.reverse();
		});
		const v = vergleicheEntwurf(gespeichert(), e);
		expect(v.konflikt).toBeNull();
		expect(v.behalten[1]).toMatchObject({ geaendert: true, positionenLoeschen: [] });
		expect((v.behalten[1].neu as HelferEntwurf).positionen).toEqual([
			{ schluessel: 'pgrill001', text: 'Grill', anzahl: 2 },
			{ schluessel: 'pkuchen01', text: 'Torte', anzahl: 4 },
		]);
	});

	it('zaehlt eine geaenderte Anzahl als Aenderung ohne Systemeintrag', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((m) => (kuchen(m).anzahl = 5)),
		);
		expect(v.behalten[1].geaendert).toBe(true);
		expect(v.system).toEqual([]);
	});

	it('nimmt eine neue Position ohne Schluessel an', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((m) => m.positionen.push({ schluessel: null, text: 'Salat', anzahl: 3 })),
		);
		expect(v).toMatchObject({ fehler: null, konflikt: null });
		expect(v.behalten[1]).toMatchObject({ geaendert: true, positionenLoeschen: [] });
	});

	it('sperrt die Einheit nach den ersten Eintraegen, vorher nicht', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((m) => (m.einheit = 'PERSON')),
		);
		expect(v.konflikt).toEqual({
			feld: 'module.1.einheit',
			text: 'Die Einheit lässt sich nach den ersten Einträgen nicht mehr ändern.',
			konflikt: true,
		});
		const leer = vergleicheEntwurf(
			gespeichert(ohneEintraege()),
			neuerEntwurf((m) => (m.einheit = 'PERSON'), ohneEintraege()),
		);
		expect(leer.konflikt).toBeNull();
		expect(leer.behalten[1].geaendert).toBe(true);
	});

	it('sperrt das Entfernen einer Liste mit Eintraegen, ohne Titel unter ihrem Ersatztitel', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((_, e) => e.module.pop()),
		);
		expect(v.konflikt).toEqual({
			feld: 'module',
			text: 'Die Helferliste „Mitbringen“ hat schon Einträge und lässt sich nicht entfernen.',
			konflikt: true,
		});
		expect(v.loeschen).toEqual([]);
		const ohneTitel = vergleicheEntwurf(
			gespeichert({}, null),
			neuerEntwurf((_, e) => e.module.pop(), {}, null),
		);
		expect(ohneTitel.konflikt?.text).toBe(
			'Die Helferliste „Helferliste“ hat schon Einträge und lässt sich nicht entfernen.',
		);
	});

	it('loescht eine Liste ohne Eintraege', () => {
		const v = vergleicheEntwurf(
			gespeichert(ohneEintraege()),
			neuerEntwurf((_, e) => e.module.pop(), ohneEintraege()),
		);
		expect(v).toMatchObject({ konflikt: null, loeschen: ['h1'] });
	});

	it('meldet eine geaenderte Frist mit dem Modultitel, ohne Titel mit Helferliste', () => {
		const frist = '2026-10-27T17:00:00.000Z';
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((m) => (m.frist = frist)),
		);
		expect(v.system).toEqual([{ art: 'FRIST_GEAENDERT', daten: { frage: 'Mitbringen', frist } }]);
		expect(v.behalten[1].geaendert).toBe(true);
		const ohneTitel = vergleicheEntwurf(
			gespeichert({}, null),
			neuerEntwurf((m) => (m.frist = frist), {}, null),
		);
		expect(ohneTitel.system).toEqual([{ art: 'FRIST_GEAENDERT', daten: { frage: 'Helferliste', frist } }]);
		expect(systemSatz('FRIST_GEAENDERT', v.system[0].daten, 'Thomas', umfeld)).not.toBe(
			'Thomas hat den Thread geändert',
		);
	});

	it('lehnt einen fremden oder doppelten Schluessel ab', () => {
		const fremd = neuerEntwurf((m) => (m.positionen[1].schluessel = 'pfremd001'));
		expect(vergleicheEntwurf(gespeichert(), fremd).fehler).toEqual({
			feld: 'module.1.positionen',
			text: 'Ungültige Anfrage',
		});
		const doppelt = neuerEntwurf((m) => (m.positionen[1].schluessel = 'pkuchen01'));
		expect(vergleicheEntwurf(gespeichert(), doppelt).fehler?.feld).toBe('module.1.positionen');
	});

	it('lehnt einen Schluessel an einer neuen Liste ab', () => {
		const e = neuerEntwurf((m, e) => e.module.push({ ...m, id: null }));
		expect(vergleicheEntwurf(gespeichert(), e).fehler).toEqual({
			feld: 'module.2.positionen',
			text: 'Ungültige Anfrage',
		});
		const f = neuerEntwurf((m, e) =>
			e.module.push({ ...m, id: null, positionen: m.positionen.map((p) => ({ ...p, schluessel: null })) }),
		);
		expect(vergleicheEntwurf(gespeichert(), f)).toMatchObject({ fehler: null, konflikt: null });
	});
});

describe('vergleicheEntwurf: Fahrgemeinschaft', () => {
	type FahrtEntwurf = Extract<ModulEntwurf, { typ: 'FAHRT' }>;
	const gestern = new Date('2026-10-21T12:00:00Z');
	const sandrasAuto: FahrtDaten['autos'][number] = {
		id: 'a1',
		fahrerId: 'sandra',
		richtung: 'HIN',
		plaetze: 3,
		abfahrtTag: null,
		abfahrtZeit: null,
		ort: null,
		notiz: null,
		angelegtAm: gestern,
	};
	const kommtSelbst = (richtung: 'HIN' | 'RUECK'): FahrtDaten['mitfahrten'][number] => ({
		richtung,
		kindId: 'max',
		autoId: null,
		vonId: 'sandra',
		eingetragenAm: gestern,
	});
	const fahrt = (f: Partial<FahrtDaten> = {}): FahrtDaten => ({
		modulId: 'f1',
		titel: null,
		hin: true,
		rueck: true,
		autos: [],
		mitfahrten: [],
		...f,
	});
	// Info an Index 0, die Fahrgemeinschaft an Index 1.
	const module = (f: Partial<FahrtDaten> = {}): ModulDaten[] => [
		{ typ: 'INFO', id: 'i1', titel: null, text: 'Bitte mitfahren' },
		{ typ: 'FAHRT', id: 'f1', titel: null, fahrt: fahrt(f) },
	];
	const gespeichert = (f: Partial<FahrtDaten> = {}) => ({ kopf: kopf(), module: module(f) });
	const neuerEntwurf = (
		aendern: (m: FahrtEntwurf, e: ThreadEntwurf) => void = () => {},
		f: Partial<FahrtDaten> = {},
	): ThreadEntwurf => {
		const e = entwurfAusThread(kopf(), module(f));
		aendern(e.module[1] as FahrtEntwurf, e);
		return e;
	};
	const mitAuto = { autos: [sandrasAuto] };

	it('findet an einer unveraenderten Fahrgemeinschaft nichts', () => {
		const v = vergleicheEntwurf(
			gespeichert(mitAuto),
			neuerEntwurf(() => {}, mitAuto),
		);
		expect(v).toMatchObject({ fehler: null, konflikt: null, loeschen: [], anlegen: [], system: [] });
		expect(v.behalten.map((b) => [b.id, b.geaendert])).toEqual([
			['i1', false],
			['f1', false],
		]);
	});

	it('meldet eine Aenderung von Titel, Hin oder Rueck als geaendert, ohne Systemeintrag', () => {
		for (const aendern of [
			(m: FahrtEntwurf) => (m.titel = 'Fahrten'),
			(m: FahrtEntwurf) => (m.hin = false),
			(m: FahrtEntwurf) => (m.rueck = false),
		]) {
			const v = vergleicheEntwurf(gespeichert(), neuerEntwurf(aendern));
			expect(v.behalten[1].geaendert).toBe(true);
			expect(v.system).toEqual([]);
		}
	});

	it('laesst die Rueckfahrt abschalten, wenn nur die Hinfahrt Autos hat', () => {
		const v = vergleicheEntwurf(
			gespeichert(mitAuto),
			neuerEntwurf((m) => (m.rueck = false), mitAuto),
		);
		expect(v).toMatchObject({ fehler: null, konflikt: null });
		expect(v.behalten[1].geaendert).toBe(true);
	});

	it('sperrt das Abschalten der Hinfahrt mit Autos, am Feld hin', () => {
		const v = vergleicheEntwurf(
			gespeichert(mitAuto),
			neuerEntwurf((m) => (m.hin = false), mitAuto),
		);
		expect(v.konflikt).toEqual({
			feld: 'module.1.hin',
			text: 'Für die Hinfahrt gibt es schon Autos oder Mitfahrten.',
			konflikt: true,
		});
		expect(v.behalten).toEqual([]);
	});

	it('zaehlt auch ein "kommt selbst" als Eintrag der Rueckfahrt, am Feld rueck', () => {
		const rueck = { mitfahrten: [kommtSelbst('RUECK')] };
		const v = vergleicheEntwurf(
			gespeichert(rueck),
			neuerEntwurf((m) => (m.rueck = false), rueck),
		);
		expect(v.konflikt).toEqual({
			feld: 'module.1.rueck',
			text: 'Für die Rückfahrt gibt es schon Autos oder Mitfahrten.',
			konflikt: true,
		});
	});

	it('meldet nur den ersten Konflikt, die Hinfahrt', () => {
		const beide = { autos: [sandrasAuto], mitfahrten: [kommtSelbst('RUECK')] };
		const v = vergleicheEntwurf(
			gespeichert(beide),
			neuerEntwurf((m) => {
				m.hin = false;
				m.rueck = false;
			}, beide),
		);
		expect(v.konflikt?.feld).toBe('module.1.hin');
	});

	it('sperrt das Entfernen einer Fahrgemeinschaft mit Eintraegen, am Feld module', () => {
		const v = vergleicheEntwurf(
			gespeichert(mitAuto),
			neuerEntwurf((_, e) => e.module.pop(), mitAuto),
		);
		expect(v.konflikt).toEqual({
			feld: 'module',
			text: 'Die Fahrgemeinschaft hat schon Einträge und lässt sich nicht entfernen.',
			konflikt: true,
		});
		expect(v.loeschen).toEqual([]);
	});

	it('loescht eine Fahrgemeinschaft ohne Eintraege', () => {
		const v = vergleicheEntwurf(
			gespeichert(),
			neuerEntwurf((_, e) => e.module.pop()),
		);
		expect(v).toMatchObject({ konflikt: null, loeschen: ['f1'] });
	});

	it('plant eine neue Fahrgemeinschaft als anzulegendes Modul', () => {
		const e = entwurfAusThread(kopf(), module());
		e.module.splice(1, 1, { typ: 'FAHRT', id: null, titel: null, hin: true, rueck: true });
		const v = vergleicheEntwurf(gespeichert(), e);
		expect(v.anlegen).toEqual([{ position: 1, neu: e.module[1] }]);
		expect(v.loeschen).toEqual(['f1']);
	});
});
