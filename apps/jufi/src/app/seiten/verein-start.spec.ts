import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
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
		document.title = 'JuFi App';
	});

	afterEach(() => http.verify());

	/**
	 * Die Startseite liegt hinter dem Waechter: erst fragt er GET /ich, dann laedt die
	 * Seite ihren Verein. Die Tests stellen die Sitzung hier als gueltig, ausser sie
	 * prueft ausdruecklich etwas anderes.
	 */
	async function oeffne(url: string, slug = 'demo') {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(url);
		await vi.waitFor(() =>
			http.expectOne(`/${slug}/api/v1/ich`).flush({ person: { vorname: 'Flo' }, passkeys: [], totp: {} }),
		);
		await navigation;
		return harness;
	}

	it('zeigt den Anzeigenamen und setzt die Vereinsfarbe', async () => {
		const harness = await oeffne('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();

		// Der Name steht allein, weil kein Artikel zu jedem Vereinsnamen passt.
		expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe('Jungfischer Demo');
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).not.toBe('');
		expect(document.title).toBe('Jungfischer Demo');
	});

	it('zeigt "Willkommen" und den Vereinsnamen, wenn der Server die Sitzung kennt', async () => {
		const harness = await oeffne('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();

		const text = harness.routeNativeElement?.textContent ?? '';
		expect(text).toContain('Willkommen');
		expect(text).toContain('Jungfischer Demo');
	});

	it('leitet ohne Sitzung (401) auf die Anmeldung des Vereins', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo');
		await vi.waitFor(() =>
			http
				.expectOne('/demo/api/v1/ich')
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
		);
		await navigation;

		expect(TestBed.inject(Router).url).toBe('/demo/anmelden');
		// Die Anmeldeseite laedt ihren Vereinskopf; hier zaehlt nur das Ziel der Umleitung.
		http.match('/demo/api/v1/verein');
	});

	it('zeigt Nicht gefunden, wenn der Server den Verein nicht kennt (404 auf ich)', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo');
		await vi.waitFor(() =>
			http.expectOne('/demo/api/v1/ich').flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
		);
		await navigation;
		harness.detectChanges();

		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
	});

	it('zeigt bei 404 Nicht gefunden oder keine Berechtigung', async () => {
		const harness = await oeffne('/demo');
		http.expectOne('/demo/api/v1/verein').flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
	});

	it('setzt Titel und Vereinsfarbe zurueck, wenn die Person den Verein verlaesst', async () => {
		const harness = await oeffne('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();
		expect(document.title).toBe('Jungfischer Demo');

		await harness.navigateByUrl('/');
		await harness.fixture.whenStable();

		expect(document.title).toBe('JuFi App');
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');
		expect(document.documentElement.style.getPropertyValue('--akzent-flaeche-dunkel')).toBe('');
		expect(document.documentElement.style.getPropertyValue('--auf-akzent-hell')).toBe('');
	});

	it('zeigt beim Wechsel von Verein A zu unbekanntem Verein B nichts von A', async () => {
		const harness = await oeffne('/vereina', 'vereina');
		http
			.expectOne('/vereina/api/v1/verein')
			.flush({ slug: 'vereina', anzeigename: 'Verein A', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();
		expect(document.title).toBe('Verein A');

		// Kein whenStable: die offene Anfrage von B haelt die Anwendung absichtlich instabil.
		const wechsel = harness.navigateByUrl('/vereinb');
		await vi.waitFor(() => http.expectOne('/vereinb/api/v1/ich').flush({ person: { vorname: 'Flo' } }));
		await wechsel;
		harness.detectChanges();
		// Waehrend B noch laedt: weder Titel noch Farbe von A.
		expect(document.title).toBe('JuFi App');
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');

		http
			.expectOne('/vereinb/api/v1/verein')
			.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		expect(harness.routeNativeElement?.textContent).not.toContain('Verein A');
		expect(document.title).toBe('JuFi App');
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');
	});

	it('zeigt ohne Netz die Meldung zum erneuten Versuch', async () => {
		const harness = await oeffne('/demo');
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
