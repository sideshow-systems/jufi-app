import { erzeugeBeispieldaten, M, P, T } from '../daten/beispieldaten';
import type { HelferModul, UmfrageModul } from '../daten/typen';
import { jetzt as jetztVon } from '../daten/zeit';
import { antwortZeilen, brauchtAntwort, zusagen } from './antworten';
import { mitModul, modulVon, threadVon } from './testhilfe';

const stand = erzeugeBeispieldaten('2026-10-11');
const jetzt = jetztVon('2026-10-11', new Date(2026, 9, 11, 10, 0));
const bowling = threadVon(stand, T.bowling);
const umfrage = modulVon<UmfrageModul>(stand, T.bowling, M.bowlingUmfrage);
const maxSagtJa = mitModul<UmfrageModul>(stand, T.bowling, M.bowlingUmfrage, (m) => ({
	...m,
	antworten: [...m.antworten, { fuer: P.max, von: P.sandra, optionen: ['ja'], zeit: '2026-10-11T10:00' }],
}));
const kurz = (punkte: ReturnType<typeof brauchtAntwort>) => punkte.map((p) => `${p.art}:${p.threadId}:${p.label}`);

describe('antwortZeilen', () => {
	it('gibt Eltern eine Zeile je Kind im Thread', () => {
		const zeilen = antwortZeilen(stand, P.sandra, bowling, umfrage);
		expect(zeilen.map((z) => z.label)).toEqual(['Lena', 'Max']);
		expect(zeilen[0].antwort?.von).toBe(P.lena);
		expect(zeilen[1].antwort).toBeUndefined();
	});

	it('gibt Jungfischern ihre eigene Zeile', () => {
		expect(antwortZeilen(stand, P.lena, bowling, umfrage).map((z) => z.label)).toEqual(['Lena']);
	});

	it('gibt einem Jugendleiter mit Kind dessen Zeile, ohne Kind keine', () => {
		expect(antwortZeilen(stand, P.thomas, bowling, umfrage).map((z) => z.label)).toEqual(['Jonas']);
		expect(antwortZeilen(stand, P.katrin, bowling, umfrage)).toEqual([]);
	});

	it('gibt bei "pro Person" eine Zeile "Du"', () => {
		const pizza = modulVon<UmfrageModul>(stand, T.zeltlager, M.pizzaUmfrage);
		expect(antwortZeilen(stand, P.lena, threadVon(stand, T.zeltlager), pizza)).toEqual([{ fuer: P.lena, label: 'Du' }]);
	});

	it('gibt bei "pro Erwachsenem" nur Erwachsenen eine Zeile', () => {
		const helfer = modulVon<HelferModul>(stand, T.herbstfest, M.herbstHelfer);
		const herbst = threadVon(stand, T.herbstfest);
		expect(antwortZeilen(stand, P.sandra, herbst, helfer)).toEqual([{ fuer: P.sandra, label: 'Du' }]);
		expect(antwortZeilen(stand, P.lena, herbst, helfer)).toEqual([]);
	});
});

describe('zusagen', () => {
	it('liefert die Kinder mit Ja aus der Teilnahme-Umfrage', () => {
		expect(zusagen(bowling)).toEqual([P.lena, 'k-paul']);
	});

	it('ist null ohne Teilnahme-Umfrage', () => {
		expect(zusagen(threadVon(stand, T.herbstfest))).toBeNull();
	});
});

describe('brauchtAntwort', () => {
	it('sammelt fuer Sandra Umfrage, Helferliste und Kosten', () => {
		const punkte = kurz(brauchtAntwort(stand, P.sandra, jetzt));
		expect(punkte).toContain(`umfrage:${T.bowling}:Max`);
		expect(punkte).toContain(`helfer:${T.herbstfest}:Du`);
		expect(punkte).toContain(`kosten:${T.bowling}:Lena`);
		expect(punkte).not.toContain(`kosten:${T.bowling}:Max`);
		expect(punkte).not.toContain(`umfrage:${T.bowling}:Lena`);
	});

	it('nimmt Max in die Kosten auf, sobald er zugesagt hat', () => {
		expect(kurz(brauchtAntwort(maxSagtJa, P.sandra, jetzt))).toContain(`kosten:${T.bowling}:Max`);
	});

	it('zeigt Lena die Pizza, aber keine Kosten', () => {
		const punkte = kurz(brauchtAntwort(stand, P.lena, jetzt));
		expect(punkte).toContain(`umfrage:${T.zeltlager}:Du`);
		expect(punkte.some((p) => p.startsWith('kosten'))).toBe(false);
	});

	it('laesst abgelaufene Fristen weg', () => {
		const spaeter = new Date(2026, 9, 15, 10, 0);
		expect(kurz(brauchtAntwort(stand, P.sandra, spaeter))).not.toContain(`umfrage:${T.bowling}:Max`);
	});

	it('sortiert nach Frist, ohne Frist zuletzt', () => {
		const punkte = brauchtAntwort(stand, P.sandra, jetzt);
		expect(punkte[0].threadId).toBe(T.bowling);
		expect(punkte.at(-1)?.art).toBe('kosten');
	});
});
