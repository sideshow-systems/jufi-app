import { signaleFuer, syncAntwort, type SignalAenderung, type SignalEintrag } from './echtzeit.js';
import { bowlingUmfeld, kopf } from './testhilfe.js';
import type { ThreadKopf } from './typen.js';
import { verlaufAnsicht } from './verlauf.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;
const thomas = person('thomas');
const sandra = person('sandra');

const familie = kopf({ id: 'familie' });
const nurLeiter = kopf({ id: 'leiter', rollenfilter: 'NUR_JUGENDLEITER' });
const entwurf = kopf({ id: 'entwurf', veroeffentlichtAm: null });

function koepfe(...liste: ThreadKopf[]): ReadonlyMap<string, ThreadKopf> {
	return new Map(liste.map((k) => [k.id, k]));
}

const alle = koepfe(familie, nurLeiter, entwurf);

const aenderung = (threadId: string | null, art: SignalAenderung['art'], objektId: string): SignalAenderung => ({
	threadId,
	art,
	objektId,
});

function nachricht(id: string, daten: Partial<SignalEintrag> = {}): SignalEintrag {
	return {
		id,
		threadId: 'familie',
		art: 'NACHRICHT',
		autorId: 'thomas',
		text: 'Treffen um drei',
		systemArt: null,
		systemDaten: null,
		stand: 12,
		angelegtAm: new Date('2026-10-22T09:00:00Z'),
		geloeschtAm: null,
		geloeschtVonId: null,
		...daten,
	};
}

describe('signaleFuer', () => {
	const grund = { umfeld, koepfe: alle, stand: 12, eintraege: [] as SignalEintrag[] };

	it('sendet einer entfernten Person nichts', () => {
		expect(signaleFuer({ ...grund, ich: undefined, aenderungen: [aenderung('familie', 'THREAD', 'familie')] })).toEqual(
			[],
		);
	});

	it('meldet THREAD nur, wo die Person den Thread sieht', () => {
		const aenderungen = [
			aenderung('familie', 'THREAD', 'familie'),
			aenderung('leiter', 'THREAD', 'leiter'),
			aenderung('entwurf', 'THREAD', 'entwurf'),
		];
		expect(signaleFuer({ ...grund, ich: sandra, aenderungen })).toEqual([
			{ stand: 12, threadId: 'familie', art: 'THREAD', objektId: 'familie' },
		]);
		expect(signaleFuer({ ...grund, ich: thomas, aenderungen }).map((s) => s.threadId)).toEqual([
			'familie',
			'leiter',
			'entwurf',
		]);
	});

	it('meldet einen Thread ohne Kopf nicht, weil es nichts zu pruefen gibt', () => {
		expect(signaleFuer({ ...grund, ich: thomas, aenderungen: [aenderung('weg', 'MODUL', 'm1')] })).toEqual([]);
	});

	it('schickt SICHTBARKEIT und GELOESCHT auch fuer Threads, die die Person nicht (mehr) sieht', () => {
		const aenderungen = [
			aenderung('leiter', 'SICHTBARKEIT', 'leiter'),
			aenderung('weg', 'GELOESCHT', 'weg'),
			aenderung('entwurf', 'SICHTBARKEIT', 'entwurf'),
		];
		expect(signaleFuer({ ...grund, ich: sandra, aenderungen })).toEqual([
			{ stand: 12, threadId: 'leiter', art: 'SICHTBARKEIT', objektId: 'leiter' },
			{ stand: 12, threadId: 'weg', art: 'GELOESCHT', objektId: 'weg' },
			{ stand: 12, threadId: 'entwurf', art: 'SICHTBARKEIT', objektId: 'entwurf' },
		]);
	});

	it('fasst Aenderungen ohne Thread zu einem Signal zusammen', () => {
		expect(
			signaleFuer({
				...grund,
				ich: sandra,
				aenderungen: [aenderung(null, 'SICHTBARKEIT', 'lena'), aenderung(null, 'SICHTBARKEIT', 'gross')],
			}),
		).toEqual([{ stand: 12, threadId: null, art: 'SICHTBARKEIT', objektId: 'lena' }]);
	});

	it('fasst je Thread und Art zusammen und behaelt die erste objektId', () => {
		const signale = signaleFuer({
			...grund,
			ich: sandra,
			aenderungen: [
				aenderung('familie', 'THREAD', 'familie'),
				aenderung('familie', 'MODUL', 'm1'),
				aenderung('familie', 'MODUL', 'm2'),
				aenderung('familie', 'MODUL', 'm3'),
			],
		});
		expect(signale).toEqual([
			{ stand: 12, threadId: 'familie', art: 'THREAD', objektId: 'familie' },
			{ stand: 12, threadId: 'familie', art: 'MODUL', objektId: 'm1' },
		]);
	});

	it('behaelt die Reihenfolge des ersten Auftretens', () => {
		const signale = signaleFuer({
			...grund,
			ich: sandra,
			aenderungen: [
				aenderung('familie', 'MODUL', 'm1'),
				aenderung(null, 'SICHTBARKEIT', 'lena'),
				aenderung('familie', 'THREAD', 'familie'),
				aenderung('familie', 'MODUL', 'm2'),
			],
		});
		expect(signale.map((s) => [s.threadId, s.art])).toEqual([
			['familie', 'MODUL'],
			[null, 'SICHTBARKEIT'],
			['familie', 'THREAD'],
		]);
	});

	it('gibt je Verlaufseintrag ein Signal mit der Ansicht der Person', () => {
		const eins = nachricht('e1');
		const zwei = nachricht('e2', { autorId: 'sandra', text: 'Wir kommen' });
		const aenderungen = [aenderung('familie', 'VERLAUF', 'e1'), aenderung('familie', 'VERLAUF', 'e2')];
		const eintraege = [eins, zwei];

		const fuerSandra = signaleFuer({ ...grund, ich: sandra, aenderungen, eintraege });
		expect(fuerSandra).toEqual([
			{
				stand: 12,
				threadId: 'familie',
				art: 'VERLAUF',
				objektId: 'e1',
				eintrag: verlaufAnsicht(sandra, familie, eins, umfeld),
			},
			{
				stand: 12,
				threadId: 'familie',
				art: 'VERLAUF',
				objektId: 'e2',
				eintrag: verlaufAnsicht(sandra, familie, zwei, umfeld),
			},
		]);
		expect(fuerSandra[0].eintrag).toMatchObject({ eigen: false, absender: 'Thomas K. (Jugendleiter)' });
		expect(fuerSandra[1].eintrag?.eigen).toBe(true);

		const fuerThomas = signaleFuer({ ...grund, ich: thomas, aenderungen, eintraege });
		expect(fuerThomas[0].eintrag?.eigen).toBe(true);
		expect(fuerThomas[1].eintrag?.eigen).toBe(false);
	});

	it('zeigt bei einer geloeschten Nachricht keinen Text', () => {
		const geloescht = nachricht('e1', { geloeschtAm: new Date('2026-10-22T09:30:00Z'), geloeschtVonId: 'thomas' });
		const [signal] = signaleFuer({
			...grund,
			ich: sandra,
			aenderungen: [aenderung('familie', 'VERLAUF', 'e1')],
			eintraege: [geloescht],
		});
		expect(signal.eintrag?.text).toBeNull();
		expect(signal.eintrag?.geloescht).toBe('SELBST');
	});

	it('schickt Verlaufseintraege eines unsichtbaren Threads nicht', () => {
		expect(
			signaleFuer({
				...grund,
				ich: sandra,
				aenderungen: [aenderung('leiter', 'VERLAUF', 'e1')],
				eintraege: [nachricht('e1', { threadId: 'leiter' })],
			}),
		).toEqual([]);
	});

	it('fasst VERLAUF ohne passenden Eintrag wie die anderen Arten zusammen', () => {
		const signale = signaleFuer({
			...grund,
			ich: sandra,
			aenderungen: [
				aenderung('familie', 'VERLAUF', 's1'),
				aenderung('familie', 'VERLAUF', 'e1'),
				aenderung('familie', 'VERLAUF', 's2'),
			],
			eintraege: [nachricht('e1')],
		});
		expect(signale.map((s) => [s.objektId, s.eintrag !== undefined])).toEqual([
			['s1', false],
			['e1', true],
		]);
	});

	it('ordnet einen Eintrag nur dem Thread zu, zu dem er gehoert', () => {
		const signale = signaleFuer({
			...grund,
			ich: thomas,
			aenderungen: [aenderung('leiter', 'VERLAUF', 'e1')],
			eintraege: [nachricht('e1', { threadId: 'familie' })],
		});
		expect(signale).toEqual([{ stand: 12, threadId: 'leiter', art: 'VERLAUF', objektId: 'e1' }]);
	});

	it('meldet einen Eintrag nur einmal, auch wenn seine Aenderung doppelt vorkommt', () => {
		const signale = signaleFuer({
			...grund,
			ich: sandra,
			aenderungen: [aenderung('familie', 'VERLAUF', 'e1'), aenderung('familie', 'VERLAUF', 'e1')],
			eintraege: [nachricht('e1')],
		});
		expect(signale).toHaveLength(1);
	});
});

describe('syncAntwort', () => {
	const grund = {
		ich: sandra,
		umfeld,
		koepfe: alle,
		seit: 5,
		stand: 12,
		aeltesterStand: 3,
		threadIds: [] as (string | null)[],
	};

	it('ist ohne seit vollstaendig und reicht den Stand durch', () => {
		expect(syncAntwort({ ...grund, seit: null, threadIds: ['familie'] })).toEqual({
			stand: 12,
			geaendert: [],
			unsichtbar: [],
			vollstaendig: true,
		});
	});

	it('ist vollstaendig, wenn seit hinter dem Stand liegt', () => {
		expect(syncAntwort({ ...grund, seit: 13 }).vollstaendig).toBe(true);
		expect(syncAntwort({ ...grund, seit: 12 }).vollstaendig).toBe(false);
	});

	it('ist vollstaendig, wenn Aenderungen vor seit schon aufgeraeumt sind', () => {
		expect(syncAntwort({ ...grund, aeltesterStand: 10, seit: 8 }).vollstaendig).toBe(true);
		expect(syncAntwort({ ...grund, aeltesterStand: 10, seit: 9 }).vollstaendig).toBe(false);
	});

	it('vergleicht ohne Zeilen mit dem Stand', () => {
		expect(syncAntwort({ ...grund, aeltesterStand: null, seit: 11 }).vollstaendig).toBe(true);
		expect(syncAntwort({ ...grund, aeltesterStand: null, seit: 12 }).vollstaendig).toBe(false);
	});

	it('leert beide Listen, wenn alles neu geladen wird', () => {
		expect(syncAntwort({ ...grund, seit: 13, threadIds: ['familie', 'leiter'] })).toEqual({
			stand: 12,
			geaendert: [],
			unsichtbar: [],
			vollstaendig: true,
		});
	});

	it('ist vollstaendig, wenn eine Aenderung ohne Thread dabei ist', () => {
		expect(syncAntwort({ ...grund, threadIds: ['familie', null] })).toEqual({
			stand: 12,
			geaendert: [],
			unsichtbar: [],
			vollstaendig: true,
		});
	});

	it('trennt sichtbare, unsichtbare und unbekannte Threads in der Reihenfolge der Eingabe', () => {
		expect(syncAntwort({ ...grund, threadIds: ['leiter', 'familie', 'weg', 'entwurf'] })).toEqual({
			stand: 12,
			geaendert: ['familie'],
			unsichtbar: ['leiter', 'weg', 'entwurf'],
			vollstaendig: false,
		});
		expect(syncAntwort({ ...grund, ich: thomas, threadIds: ['leiter', 'familie', 'weg'] })).toEqual({
			stand: 12,
			geaendert: ['leiter', 'familie'],
			unsichtbar: ['weg'],
			vollstaendig: false,
		});
	});

	it('nennt eine Thread-ID nur einmal', () => {
		expect(syncAntwort({ ...grund, threadIds: ['familie', 'familie'] }).geaendert).toEqual(['familie']);
	});
});
