import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('App', () => {
	it('startet und zeigt den Platzhalter', async () => {
		TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
		const harness = await RouterTestingHarness.create('/glonntal');
		expect(harness.routeNativeElement?.textContent).toContain('JuFi Entwurf');
	});
});
