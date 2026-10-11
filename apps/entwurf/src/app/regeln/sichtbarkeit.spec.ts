import { erzeugeBeispieldaten, P, T } from '../daten/beispieldaten';
import type { Thread } from '../daten/typen';
import { kinderImThread, siehtThread, threadZuNr } from './sichtbarkeit';

const stand = erzeugeBeispieldaten('2026-10-11');
const t = (id: string) => stand.threads.find((x) => x.id === id)!;
const sichtbar = (personId: string) => stand.threads.filter((x) => siehtThread(stand, personId, x)).map((x) => x.id);

describe('siehtThread', () => {
	it('zeigt Sandra die Threads ihrer Kinder und die Eltern-Threads', () => {
		expect(sichtbar(P.sandra)).toEqual([
			T.infos,
			T.bowling,
			T.herbstfest,
			T.zeltlager,
			T.hegefischen,
			T.koenigsfischen,
		]);
	});

	it('zeigt Lena keine Eltern-Threads und nicht die Aelteren', () => {
		expect(sichtbar(P.lena)).toEqual([T.infos, T.bowling, T.zeltlager, T.hegefischen, T.koenigsfischen]);
	});

	it('wendet die Regel auch auf Max ohne Zugang an', () => {
		expect(siehtThread(stand, P.max, t(T.bowling))).toBe(true);
		expect(siehtThread(stand, P.max, t(T.zeltlager))).toBe(false);
	});

	it('zeigt Jugendleitern alles', () => {
		expect(sichtbar(P.thomas)).toHaveLength(8);
		expect(sichtbar(P.michael)).toHaveLength(8);
	});

	it('zeigt unveroeffentlichte Threads nur Jugendleitern', () => {
		const entwurf: Thread = { ...t(T.bowling), id: 't-neu', veroeffentlicht: false };
		expect(siehtThread(stand, P.sandra, entwurf)).toBe(false);
		expect(siehtThread(stand, P.katrin, entwurf)).toBe(true);
	});

	it('kennt unbekannte Personen nicht', () => {
		expect(siehtThread(stand, 'p-gibtsnicht', t(T.infos))).toBe(false);
	});
});

describe('threadZuNr', () => {
	it('liefert fuer Unsichtbares und Unbekanntes dieselbe Antwort', () => {
		expect(threadZuNr(stand, P.sandra, 6)).toBeUndefined();
		expect(threadZuNr(stand, P.sandra, 999)).toBeUndefined();
		expect(threadZuNr(stand, P.sandra, 2)?.id).toBe(T.bowling);
	});
});

describe('kinderImThread', () => {
	it('nimmt alle Jungfischer bei "alle"', () => {
		const ids = kinderImThread(stand, t(T.bowling)).map((p) => p.id);
		expect(ids).toEqual(expect.arrayContaining([P.lena, P.max, P.jonas]));
		expect(ids).toHaveLength(15);
	});

	it('filtert nach Untergruppe', () => {
		const erwartet = stand.untergruppen.find((u) => u.name === 'Zeltlager-Teilnehmer')!.mitglieder;
		expect(new Set(kinderImThread(stand, t(T.zeltlager)).map((p) => p.id))).toEqual(new Set(erwartet));
	});

	it('ist leer fuer Jugendleiter-Threads', () => {
		expect(kinderImThread(stand, t(T.orga))).toEqual([]);
	});
});
