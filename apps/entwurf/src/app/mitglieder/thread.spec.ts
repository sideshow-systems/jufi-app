import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { T } from '../daten/beispieldaten';
import { EntwurfStore, UHR } from '../daten/store';
import { testProvider } from '../testhilfe';
import { nrAusSegment } from './thread';

async function oeffne(url: string): Promise<string> {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [provideRouter(routes, withComponentInputBinding()), ...testProvider()],
	});
	const harness = await RouterTestingHarness.create(url);
	harness.detectChanges();
	return harness.routeNativeElement?.textContent ?? '';
}

describe('nrAusSegment', () => {
	it('liest die Nummer vor dem Bindestrich', () => {
		expect(nrAusSegment('2-bowling')).toBe(2);
		expect(nrAusSegment('12')).toBe(12);
		expect(nrAusSegment('x')).toBeNull();
		expect(nrAusSegment('-3-minus')).toBeNull();
	});
});

describe('Thread-Seite', () => {
	it('zeigt Unsichtbares wie Unbekanntes', async () => {
		expect(await oeffne('/glonntal/t/6-fischerpruefung-2027')).toContain('Nicht gefunden oder keine Berechtigung');
		expect(await oeffne('/glonntal/t/999-gibts-nicht')).toContain('Nicht gefunden oder keine Berechtigung');
	});

	it('zeigt beide Reiter bei Kommentaren', async () => {
		const text = await oeffne('/glonntal/t/2-bowling');
		expect(text).toContain('Bowling');
		expect(text).toContain('Übersicht');
		expect(text).toContain('Verlauf');
		expect(text).toContain('Bowlingcenter Dachau');
	});

	it('laesst den Verlauf im Modus "Nur Aushang" weg', async () => {
		const text = await oeffne('/glonntal/t/1-wichtige-infos');
		expect(text).toContain('Vereinsheim');
		expect(text).not.toContain('Übersicht');
		expect(text).not.toContain('Verlauf');
	});

	it('oeffnet den Verlauf per Adresse', async () => {
		const text = await oeffne('/glonntal/t/4-zeltlager-2027?reiter=verlauf');
		expect(text).toContain('Gibt es eine Packliste?');
	});

	it('findet den Thread auch mit veraltetem Titel in der Adresse', async () => {
		expect(await oeffne('/glonntal/t/2-alter-titel')).toContain('Bowlingcenter Dachau');
	});
});

describe('Verlauf', () => {
	it('zeigt eine neue Nachricht unten, auch wenn die Uhr frueher steht als die letzte', async () => {
		// Der Bezugstag ist eingefroren, die Uhrzeit laeuft mit: um 7 Uhr liegt
		// Petras Frage von 8:30 "spaeter" als die neue Nachricht.
		TestBed.configureTestingModule({
			providers: [
				provideRouter(routes, withComponentInputBinding()),
				...testProvider(),
				{ provide: UHR, useValue: () => new Date(2026, 9, 11, 7, 0) },
			],
		});
		const harness = await RouterTestingHarness.create('/glonntal/t/4-zeltlager-2027?reiter=verlauf');
		TestBed.inject(EntwurfStore).nachrichtSchreiben(T.zeltlager, 'Ganz neu');
		harness.detectChanges();
		const eintraege = harness.routeNativeElement!.querySelectorAll('jf-verlauf li');
		expect(eintraege[eintraege.length - 1].textContent).toContain('Ganz neu');
	});
});
