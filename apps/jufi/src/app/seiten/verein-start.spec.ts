import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';

describe('Vereinsseite', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [
				provideRouter(routes, withComponentInputBinding()),
				provideHttpClient(withFetch()),
				provideHttpClientTesting(),
			],
		});
		http = TestBed.inject(HttpTestingController);
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => http.verify());

	it('zeigt den Anzeigenamen und setzt die Vereinsfarbe', async () => {
		const harness = await RouterTestingHarness.create('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(harness.routeNativeElement?.textContent).toContain('Jungfischer Demo');
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).not.toBe('');
		expect(document.title).toBe('Jungfischer Demo');
	});

	it('zeigt bei 404 Nicht gefunden oder keine Berechtigung', async () => {
		const harness = await RouterTestingHarness.create('/demo');
		http.expectOne('/demo/api/v1/verein').flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
	});

	it('zeigt ohne Netz die Meldung zum erneuten Versuch', async () => {
		const harness = await RouterTestingHarness.create('/demo');
		http.expectOne('/demo/api/v1/verein').error(new ProgressEvent('error'));
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(harness.routeNativeElement?.textContent).toContain('Keine Verbindung – nochmal versuchen');
		expect(harness.routeNativeElement?.textContent).not.toContain('Nicht gefunden');
	});

	it('unbekannte tiefe Route zeigt Nicht gefunden', async () => {
		const harness = await RouterTestingHarness.create('/demo/gibt/es/nicht');

		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
	});
});
