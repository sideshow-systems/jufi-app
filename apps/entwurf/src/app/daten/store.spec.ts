import { TestBed } from '@angular/core/testing';
import { M, P, T } from './beispieldaten';
import { SCHLUESSEL, speicherAblage, type Ablage } from './speicher';
import { ABLAGE, EntwurfStore, UHR } from './store';
import type { FahrModul, HelferModul, KostenModul, UmfrageModul } from './typen';

function aufbau(): { store: EntwurfStore; ablage: Ablage } {
	const ablage = speicherAblage();
	TestBed.configureTestingModule({
		providers: [
			{ provide: ABLAGE, useValue: ablage },
			{ provide: UHR, useValue: () => new Date(2026, 9, 11, 10, 0) },
		],
	});
	return { store: TestBed.inject(EntwurfStore), ablage };
}

const modul = <X>(store: EntwurfStore, t: string, m: string) =>
	store
		.stand()
		.threads.find((x) => x.id === t)!
		.module.find((x) => x.id === m) as X;

describe('EntwurfStore', () => {
	it('friert jetzt auf den Bezugstag ein', () => {
		const { store } = aufbau();
		expect(store.jetzt().getDate()).toBe(11);
		expect(store.jetzt().getHours()).toBe(10);
	});

	it('speichert Antworten mit "fuer" und "von", die letzte gilt', () => {
		const { store } = aufbau();
		store.antworten(T.bowling, M.bowlingUmfrage, P.max, ['ja']);
		let u = modul<UmfrageModul>(store, T.bowling, M.bowlingUmfrage);
		expect(u.antworten.find((a) => a.fuer === P.max)).toMatchObject({ von: P.sandra, optionen: ['ja'] });

		store.setzeIch(P.lena);
		store.antworten(T.bowling, M.bowlingUmfrage, P.lena, ['nein']);
		u = modul<UmfrageModul>(store, T.bowling, M.bowlingUmfrage);
		expect(u.antworten.filter((a) => a.fuer === P.lena)).toEqual([
			expect.objectContaining({ von: P.lena, optionen: ['nein'] }),
		]);
	});

	it('setzt die letzte Aktivitaet des Threads', () => {
		const { store } = aufbau();
		store.antworten(T.bowling, M.bowlingUmfrage, P.max, ['ja']);
		expect(store.stand().threads.find((t) => t.id === T.bowling)!.letzteAktivitaet).toBe('2026-10-11T10:00');
	});

	it('sperrt volle Helferplaetze', () => {
		const { store } = aufbau();
		const h = () => modul<HelferModul>(store, T.herbstfest, M.herbstHelfer);
		for (const fuer of ['e-x1', 'e-x2']) store.helferEintragen(T.herbstfest, M.herbstHelfer, 'h-kuchen', fuer);
		expect(h().plaetze[0].eintraege).toHaveLength(5);
		expect(store.helferEintragen(T.herbstfest, M.herbstHelfer, 'h-kuchen', P.sandra)).toBe(false);
		expect(h().plaetze[0].eintraege).toHaveLength(5);
		store.helferAustragen(T.herbstfest, M.herbstHelfer, 'h-kuchen', 'e-x1');
		expect(store.helferEintragen(T.herbstfest, M.herbstHelfer, 'h-kuchen', P.sandra)).toBe(true);
		expect(h().plaetze[0].eintraege.at(-1)).toEqual({ fuer: P.sandra, von: P.sandra });
	});

	it('setzt ein Kind je Richtung in genau ein Auto', () => {
		const { store } = aufbau();
		const autos = () => modul<FahrModul>(store, T.bowling, M.bowlingFahrt).autos;
		expect(store.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.max, 'a-huber-hin', 'hin')).toBe(true);
		expect(store.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.max, 'a-maier', 'hin')).toBe(true);
		expect(autos().find((a) => a.id === 'a-maier')!.mitfahrer).toContain(P.max);
		expect(autos().find((a) => a.id === 'a-huber-hin')!.mitfahrer).not.toContain(P.max);
		expect(store.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.jonas, 'a-maier', 'hin')).toBe(false);
		store.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.max, null, 'hin');
		expect(autos().some((a) => a.mitfahrer.includes(P.max))).toBe(false);
	});

	it('bietet ein Auto an', () => {
		const { store } = aufbau();
		store.autoAnbieten(T.bowling, M.bowlingFahrt, {
			fahrer: P.sandra,
			richtung: 'rueck',
			plaetze: 3,
			abfahrt: '17:15',
			ort: 'Bowlingcenter',
		});
		const neu = modul<FahrModul>(store, T.bowling, M.bowlingFahrt).autos.at(-1)!;
		expect(neu).toMatchObject({ fahrer: P.sandra, richtung: 'rueck', plaetze: 3, mitfahrer: [] });
	});

	it('setzt den Kostenstatus und nimmt ihn zurueck', () => {
		const { store } = aufbau();
		const k = () => modul<KostenModul>(store, T.bowling, M.bowlingKosten);
		store.kostenSetzen(T.bowling, M.bowlingKosten, P.lena, 'gemeldet');
		expect(k().status[P.lena]).toBe('gemeldet');
		store.kostenSetzen(T.bowling, M.bowlingKosten, P.lena, 'offen');
		expect(k().status[P.lena]).toBeUndefined();
	});

	it('schreibt Nachrichten, aber keine leeren', () => {
		const { store } = aufbau();
		const vorher = store.stand().threads.find((t) => t.id === T.zeltlager)!.verlauf.length;
		store.nachrichtSchreiben(T.zeltlager, '   ');
		store.nachrichtSchreiben(T.zeltlager, ' Wann geht es los? ');
		const verlauf = store.stand().threads.find((t) => t.id === T.zeltlager)!.verlauf;
		expect(verlauf).toHaveLength(vorher + 1);
		expect(verlauf.at(-1)).toMatchObject({ von: P.sandra, text: 'Wann geht es los?', art: 'nachricht' });
	});

	it('vergibt neuen Threads die naechste Nummer', () => {
		const { store } = aufbau();
		const basis = store.stand().threads[0];
		const neu = store.threadSpeichern({ ...basis, id: '', nr: 0, titel: 'Neu', angepinnt: false });
		expect(neu.nr).toBe(9);
		expect(neu.id).not.toBe('');
		expect(store.stand().threads).toHaveLength(9);
		store.threadSpeichern({ ...neu, titel: 'Geaendert' });
		expect(store.stand().threads).toHaveLength(9);
		expect(store.stand().threads.at(-1)!.titel).toBe('Geaendert');
	});

	it('legt Personen mit Kindern an', () => {
		const { store } = aufbau();
		const id = store.personAnlegen(
			{ vorname: 'Eva', nachname: 'Neu', art: 'erwachsener', hatZugang: false, rechte: [] },
			[P.max],
		);
		expect(store.stand().personen.find((p) => p.id === id)?.vorname).toBe('Eva');
		expect(store.stand().elternschaften).toContainEqual({ elternteil: id, kind: P.max });
	});

	it('entzieht dem letzten Verwalter das Verwalten nicht', () => {
		const { store } = aufbau();
		store.rechteSetzen(P.thomas, []);
		expect(store.stand().personen.find((p) => p.id === P.thomas)!.rechte).toEqual(['rechteVerwalten']);
	});

	it('legt jede Aenderung sofort ab', () => {
		const { store, ablage } = aufbau();
		store.vereinsfarbeSetzen('#e11d48');
		expect(JSON.parse(ablage.lesen(SCHLUESSEL)!).stand.verein.farbe).toBe('#e11d48');
		store.setzeTestmodus({ person: 'lena' });
		expect(JSON.parse(ablage.lesen(SCHLUESSEL)!).testmodus).toEqual({ person: 'lena' });
	});

	it('setzt alles zurueck', () => {
		const { store } = aufbau();
		store.vereinsfarbeSetzen('#e11d48');
		store.setzeTestmodus({ person: 'lena' });
		store.zuruecksetzen();
		expect(store.stand().verein.farbe).toBe('#0f766e');
		expect(store.testmodusDaten()).toBeNull();
	});

	it('merkt sich, wer zuletzt im Thread etwas getan hat', () => {
		const { store } = aufbau();
		store.setzeIch(P.thomas);
		store.nachrichtSchreiben(T.zeltlager, 'Hallo');
		expect(store.stand().threads.find((t) => t.id === T.zeltlager)!.letzteAktivitaetVon).toBe(P.thomas);
	});
});
