import { erzeugeBeispieldaten, M, P, T } from '../daten/beispieldaten';
import type { FahrModul, KostenModul, UmfrageModul } from '../daten/typen';
import { freiePlaetze, kostenStatus, mitfahrtOffen, zahlungspflichtig } from './fahrt-kosten';
import { mitModul, modulVon, threadVon } from './testhilfe';

const stand = erzeugeBeispieldaten('2026-10-11');
const maxSagtJa = mitModul<UmfrageModul>(stand, T.bowling, M.bowlingUmfrage, (m) => ({
	...m,
	antworten: [...m.antworten, { fuer: P.max, von: P.sandra, optionen: ['ja'], zeit: '2026-10-11T10:00' }],
}));
const fahrt = (s = stand) => modulVon<FahrModul>(s, T.bowling, M.bowlingFahrt);

describe('mitfahrtOffen', () => {
	it('ist auf der Hinfahrt anfangs leer, weil alle Zugesagten sitzen', () => {
		expect(mitfahrtOffen(stand, threadVon(stand, T.bowling), fahrt(), 'hin')).toEqual([]);
	});

	it('nennt Max, sobald er zugesagt hat', () => {
		const offen = mitfahrtOffen(maxSagtJa, threadVon(maxSagtJa, T.bowling), fahrt(maxSagtJa), 'hin');
		expect(offen.map((p) => p.id)).toEqual([P.max]);
	});

	it('trennt Hin- und Rueckfahrt', () => {
		const offen = mitfahrtOffen(stand, threadVon(stand, T.bowling), fahrt(), 'rueck');
		expect(offen.map((p) => p.id)).toEqual([P.lena, 'k-paul']);
	});
});

describe('freiePlaetze', () => {
	it('zieht die Mitfahrer ab', () => {
		expect(fahrt().autos.map(freiePlaetze)).toEqual([1, 2, 2]);
	});
});

describe('zahlungspflichtig', () => {
	it('folgt den Zusagen', () => {
		expect(zahlungspflichtig(stand, threadVon(stand, T.bowling))).toEqual([P.lena, 'k-paul']);
		expect(zahlungspflichtig(maxSagtJa, threadVon(maxSagtJa, T.bowling))).toEqual([P.lena, 'k-paul', P.max]);
	});

	it('nimmt ohne Teilnahme-Umfrage alle Kinder des Threads', () => {
		expect(zahlungspflichtig(stand, threadVon(stand, T.hegefischen))).toHaveLength(15);
	});
});

describe('kostenStatus', () => {
	it('ist offen, bis etwas gemeldet ist', () => {
		const k = modulVon<KostenModul>(stand, T.bowling, M.bowlingKosten);
		expect(kostenStatus(k, P.lena)).toBe('offen');
		expect(kostenStatus({ ...k, status: { [P.lena]: 'gemeldet' } }, P.lena)).toBe('gemeldet');
		expect(kostenStatus({ ...k, status: { [P.lena]: 'bezahlt' } }, P.lena)).toBe('bezahlt');
	});
});
