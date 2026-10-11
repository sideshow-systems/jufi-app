import { erzeugeBeispieldaten, M, P, T } from './beispieldaten';
import type { FahrModul, HelferModul, TerminModul, UmfrageModul } from './typen';

const stand = erzeugeBeispieldaten('2026-10-11');
const person = (id: string) => stand.personen.find((p) => p.id === id)!;
const thread = (id: string) => stand.threads.find((t) => t.id === id)!;
const modul = <X>(threadId: string, modulId: string) => thread(threadId).module.find((m) => m.id === modulId) as X;
const termine = (threadId: string) => thread(threadId).module.filter((m): m is TerminModul => m.typ === 'termin');

describe('erzeugeBeispieldaten', () => {
	it('legt den Verein an', () => {
		expect(stand.verein).toMatchObject({ name: 'Jungfischer Glonntal', slug: 'glonntal', farbe: '#0f766e' });
		expect(stand.bezugstag).toBe('2026-10-11');
		expect(stand.version).toBe(1);
	});

	it('enthaelt die Personen aus Spec 3.3', () => {
		expect(person(P.sandra).vorname).toBe('Sandra');
		expect(person(P.lena)).toMatchObject({ vorname: 'Lena', art: 'jungfischer', alter: 13, hatZugang: true });
		expect(person(P.max)).toMatchObject({ vorname: 'Max', alter: 10, hatZugang: false, fotoEinwilligung: false });
		expect(person(P.jonas)).toMatchObject({ vorname: 'Jonas', alter: 12 });
		expect(person(P.thomas).rechte).toHaveLength(7);
		expect(person(P.katrin).rechte).toHaveLength(5);
		expect(person(P.katrin).rechte).not.toContain('rechteVerwalten');
		expect(person(P.katrin).rechte).not.toContain('einstellungen');
		expect(person(P.michael).rechte).toEqual(['antwortenDetail']);
		expect(stand.personen.filter((p) => p.art === 'jungfischer').length).toBeGreaterThanOrEqual(15);
	});

	it('verknuepft Eltern und Kinder', () => {
		expect(stand.elternschaften).toEqual(
			expect.arrayContaining([
				{ elternteil: P.sandra, kind: P.lena },
				{ elternteil: P.sandra, kind: P.max },
				{ elternteil: P.thomas, kind: P.jonas },
			]),
		);
		for (const kind of stand.personen.filter((p) => p.art === 'jungfischer')) {
			expect(stand.elternschaften.some((e) => e.kind === kind.id)).toBe(true);
		}
	});

	it('bildet die Untergruppen', () => {
		const aeltere = stand.untergruppen.find((u) => u.name === 'Ältere')!;
		const zeltlager = stand.untergruppen.find((u) => u.name === 'Zeltlager-Teilnehmer')!;
		expect(aeltere.mitglieder).not.toContain(P.lena);
		expect(aeltere.mitglieder).not.toContain(P.max);
		expect(aeltere.mitglieder).not.toContain(P.jonas);
		expect(aeltere.mitglieder.length).toBeGreaterThan(0);
		for (const id of aeltere.mitglieder) expect(person(id).alter).toBeGreaterThanOrEqual(14);
		expect(zeltlager.mitglieder).toContain(P.lena);
	});

	it('legt die acht Threads aus Spec 3.4 an', () => {
		expect(stand.threads.map((t) => t.nr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(stand.threads.filter((t) => t.angepinnt).map((t) => t.id)).toEqual([T.infos]);
		expect(stand.threads.filter((t) => t.archiviert).map((t) => t.id)).toEqual([T.koenigsfischen]);
		expect(thread(T.infos).modus).toBe('aushang');
		expect(thread(T.herbstfest).zielgruppe).toEqual({ untergruppen: 'alle', rollen: 'nurEltern' });
		expect(thread(T.zeltlager).modus).toBe('chat');
		expect(thread(T.pruefung).zielgruppe.untergruppen).toHaveLength(1);
		expect(thread(T.orga).zielgruppe.rollen).toBe('nurJugendleiter');
		for (const t of stand.threads) expect(t.veroeffentlicht).toBe(true);
	});

	it('setzt Termine und Fristen relativ zum Bezugstag', () => {
		expect(modul<TerminModul>(T.infos, M.gruppenstunde)).toMatchObject({
			beginn: '2026-10-13T18:00',
			ort: 'Vereinsheim',
		});
		expect(termine(T.bowling)[0].beginn.slice(0, 10)).toBe('2026-10-17');
		expect(modul<UmfrageModul>(T.bowling, M.bowlingUmfrage).frist?.slice(0, 10)).toBe('2026-10-14');
		expect(termine(T.hegefischen)[0].beginn.slice(0, 10)).toBe('2026-10-06');
		expect(termine(T.koenigsfischen)[0].beginn.slice(0, 10)).toBe('2026-08-30');
		expect(termine(T.herbstfest)[0].beginn.slice(0, 10)).toBe('2026-11-01');
		expect(termine(T.zeltlager)[0].beginn.slice(0, 10)).toBe('2026-10-25');
	});

	it('bildet den Ausgangszustand im Bowling-Thread', () => {
		const umfrage = modul<UmfrageModul>(T.bowling, M.bowlingUmfrage);
		expect(umfrage).toMatchObject({ einheit: 'jungfischer', teilnahme: true, mehrfach: false });
		const lena = umfrage.antworten.find((a) => a.fuer === P.lena)!;
		expect(lena).toMatchObject({ von: P.lena, optionen: ['ja'] });
		expect(umfrage.antworten.some((a) => a.fuer === P.max || a.fuer === P.jonas)).toBe(false);

		const fahrt = modul<FahrModul>(T.bowling, M.bowlingFahrt);
		const maier = fahrt.autos.find((a) => person(a.fahrer).nachname === 'Maier')!;
		expect(maier).toMatchObject({ richtung: 'hin', plaetze: 3 });
		expect(maier.mitfahrer).toHaveLength(2);
		expect(maier.mitfahrer).toContain(P.lena);
		const huber = fahrt.autos.filter((a) => person(a.fahrer).nachname === 'Huber');
		expect(huber.map((a) => [a.richtung, a.plaetze])).toEqual([
			['hin', 2],
			['rueck', 2],
		]);
	});

	it('bildet die Helferliste Herbstfest', () => {
		const helfer = modul<HelferModul>(T.herbstfest, M.herbstHelfer);
		expect(helfer.einheit).toBe('erwachsener');
		expect(helfer.plaetze.map((p) => [p.text, p.eintraege.length, p.anzahl])).toEqual([
			['Kuchen', 3, 5],
			['Salat', 1, 4],
			['Aufbau Sa', 2, 4],
			['Abbau', 0, 4],
		]);
	});

	it('legt die Pizza-Umfrage pro Person an', () => {
		expect(modul<UmfrageModul>(T.zeltlager, M.pizzaUmfrage).einheit).toBe('person');
	});

	it('legt die globalen Dokumente an', () => {
		expect(new Set(stand.dokumente.map((d) => d.kategorie))).toEqual(
			new Set(['Ordnungen', 'Merkblätter', 'Formulare']),
		);
		expect(stand.dokumente.find((d) => d.name === 'Jugendfischereiordnung')?.kategorie).toBe('Ordnungen');
	});
});
