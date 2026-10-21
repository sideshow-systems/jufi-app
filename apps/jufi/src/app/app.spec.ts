import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
	it('startet', () => {
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
		});
		expect(TestBed.createComponent(App).componentInstance).toBeTruthy();
	});

	// Ohne den Wirt an der Wurzel zeigte keine Huelle ausser dem Admin-Rahmen die Meldung (Kopiert, Gespeichert).
	it('traegt die Meldung an der Wurzel', () => {
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
		});
		const fixture = TestBed.createComponent(App);
		fixture.detectChanges();
		expect((fixture.nativeElement as HTMLElement).querySelector('jf-meldung')).not.toBeNull();
	});
});
