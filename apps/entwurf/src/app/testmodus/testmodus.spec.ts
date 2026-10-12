import { TestBed } from '@angular/core/testing';
import { M, P, T } from '../daten/beispieldaten';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import { EntwurfStore, UHR } from '../daten/store';
import { testProvider } from '../testhilfe';
import { AUFGABEN } from './aufgaben';
import { TestmodusService } from './testmodus';
import { MAX_DAUER_SEK, type Suche } from './typen';

function aufbauen() {
	TestBed.configureTestingModule({ providers: testProvider() });
	return { tm: TestBed.inject(TestmodusService), store: TestBed.inject(EntwurfStore) };
}

describe('TestmodusService', () => {
	it('startet ohne Person und ohne Aufgabe', () => {
		const { tm } = aufbauen();
		expect(tm.zustand().person).toBeNull();
		expect(tm.aktuelleAufgabe()).toBeNull();
	});

	it('setzt mit der Personenwahl die angemeldete Person und die erste Aufgabe', () => {
		const { tm, store } = aufbauen();
		tm.waehlePerson('lena', true);
		expect(store.ich()).toBe(P.lena);
		expect(tm.aktuelleAufgabe()?.id).toBe('lena-1');
	});

	it('zeigt "Frei umsehen" ohne Aufgabe', () => {
		const { tm } = aufbauen();
		tm.waehlePerson('sandra', false);
		expect(tm.aktuelleAufgabe()).toBeNull();
	});

	it('oeffnet nach erfuellter Pruefregel die Bewertung und geht danach weiter', () => {
		const { tm, store } = aufbauen();
		tm.waehlePerson('sandra', true);
		TestBed.tick();
		expect(tm.dialog()).toBeNull();

		store.antworten(T.bowling, M.bowlingUmfrage, P.max, ['ja']);
		TestBed.tick();
		expect(tm.dialog()?.art).toBe('geschafft');

		tm.bewerten('gut', 'ging schnell');
		expect(tm.zustand().ergebnisse.sandra).toEqual([
			{
				aufgabeId: 'sandra-1',
				ausgang: 'geschafft',
				dauerSek: 0,
				smiley: 'gut',
				notiz: 'ging schnell',
				fehlversuche: 0,
			},
		]);
		expect(tm.aktuelleAufgabe()?.id).toBe('sandra-2');
		expect(tm.dialog()).toBeNull();
	});

	it('zaehlt falsche Antworten einer Suchaufgabe', () => {
		const { tm, store } = aufbauen();
		tm.waehlePerson('lena', true);
		tm.ueberspringen();
		const a = tm.aktuelleAufgabe() as Suche;
		const { richtig, falsch } = a.antworten(store.stand());

		expect(tm.sucheBeantworten(falsch[0])).toBe(false);
		expect(tm.sucheBeantworten(richtig)).toBe(true);
		expect(tm.dialog()?.art).toBe('geschafft');
		tm.bewerten();
		expect(tm.zustand().ergebnisse.lena[1]).toMatchObject({ aufgabeId: 'lena-2', fehlversuche: 1 });
	});

	it('nimmt Testereignisse auf und prueft sie', () => {
		const { tm } = aufbauen();
		tm.waehlePerson('sandra', true);
		for (let i = 0; i < 5; i++) tm.ueberspringen();
		expect(tm.aktuelleAufgabe()?.id).toBe('sandra-6');

		TestBed.inject(TESTEREIGNISSE).next({ art: 'dokumentGeoeffnet', id: 'g-jfo' });
		TestBed.tick();
		expect(tm.dialog()?.art).toBe('geschafft');
	});

	it('vermerkt eine beim Anzeigen schon erfuellte Aufgabe als "schon erledigt", ohne Bewertung', () => {
		const { tm, store } = aufbauen();
		store.antworten(T.bowling, M.bowlingUmfrage, P.max, ['ja']);
		tm.waehlePerson('sandra', true);
		TestBed.tick();
		expect(tm.zustand().ergebnisse.sandra).toEqual([
			{ aufgabeId: 'sandra-1', ausgang: 'schonErledigt', dauerSek: 0, fehlversuche: 0 },
		]);
		expect(tm.aktuelleAufgabe()?.id).toBe('sandra-2');
		expect(tm.dialog()).toBeNull();
	});

	it('deckelt die Dauer, wenn der Tab ueber Nacht offen blieb', () => {
		let ms = new Date(2026, 9, 11, 10, 0).getTime();
		TestBed.configureTestingModule({ providers: [...testProvider(), { provide: UHR, useValue: () => new Date(ms) }] });
		const tm = TestBed.inject(TestmodusService);
		tm.waehlePerson('thomas', true);
		ms += 14 * 3600 * 1000;
		tm.ueberspringen();
		expect(tm.zustand().ergebnisse.thomas[0].dauerSek).toBe(MAX_DAUER_SEK);
	});

	it('vermerkt "nicht weiter" mit Notiz und geht weiter', () => {
		const { tm } = aufbauen();
		tm.waehlePerson('thomas', true);
		tm.nichtWeiter('Wo ist der Editor?');
		expect(tm.zustand().ergebnisse.thomas[0]).toMatchObject({
			aufgabeId: 'thomas-1',
			ausgang: 'nichtWeiter',
			notiz: 'Wo ist der Editor?',
		});
		expect(tm.aktuelleAufgabe()?.id).toBe('thomas-2');
	});

	it('bietet nach der letzten Aufgabe die Rueckmeldung an', () => {
		const { tm } = aufbauen();
		tm.waehlePerson('lena', true);
		for (let i = 0; i < AUFGABEN.lena.length; i++) tm.ueberspringen();
		expect(tm.aktuelleAufgabe()).toBeNull();
		expect(tm.dialog()?.art).toBe('rueckmeldung');
	});

	it('behaelt beim Personenwechsel Datenstand und Fortschritt', () => {
		const { tm, store } = aufbauen();
		tm.waehlePerson('sandra', true);
		store.antworten(T.bowling, M.bowlingUmfrage, P.max, ['ja']);
		TestBed.tick();
		tm.bewerten('gut');

		tm.waehlePerson('thomas', true);
		expect(store.ich()).toBe(P.thomas);
		expect(store.stand().threads.find((t) => t.id === T.bowling)?.module).toContainEqual(
			expect.objectContaining({ antworten: expect.arrayContaining([expect.objectContaining({ fuer: P.max })]) }),
		);
		tm.waehlePerson('sandra', true);
		expect(tm.aktuelleAufgabe()?.id).toBe('sandra-2');
	});

	it('speichert den Wunsch so, wie er getippt wird', () => {
		const { tm } = aufbauen();
		tm.wunschSetzen('Hallo ');
		expect(tm.zustand().wunsch).toBe('Hallo ');
	});

	it('legt den Fortschritt im Store ab', () => {
		const { tm, store } = aufbauen();
		tm.waehlePerson('lena', true);
		tm.ueberspringen();
		expect(store.testmodusDaten()).toMatchObject({ person: 'lena', index: { lena: 1 } });
	});

	it('setzt mit "Entwurf zuruecksetzen" alles zurueck', () => {
		const { tm, store } = aufbauen();
		tm.waehlePerson('lena', true);
		tm.ueberspringen();
		tm.allesZuruecksetzen();
		expect(tm.zustand().person).toBeNull();
		expect(store.ich()).toBe(P.sandra);
	});
});
