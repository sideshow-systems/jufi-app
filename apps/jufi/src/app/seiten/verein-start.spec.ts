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

	it('zeigt Meine Jungfischer nur, wenn die Person Kinder hat', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo');
		await vi.waitFor(() =>
			http.expectOne('/demo/api/v1/ich').flush({ person: { vorname: 'Flo' }, passkeys: [], totp: {}, hatKinder: true }),
		);
		await navigation;
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();
		const link = harness.routeNativeElement?.querySelector<HTMLAnchorElement>('a[href="/demo/jungfischer"]');
		expect(link?.textContent).toContain('Meine Jungfischer');
	});

	it('zeigt Meine Jungfischer nicht ohne Kinder', async () => {
		const harness = await oeffne('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();
		expect(harness.routeNativeElement?.querySelector('a[href="/demo/jungfischer"]')).toBeNull();
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

	it('die Adresse mit Schraegstrich am Ende ist nicht die Startseite des Vereins', async () => {
		// Ursache des Fehlers nach Anmeldung und Zur App: navigateByUrl('/demo/') liefert dem
		// Router ein leeres letztes Segment, das keine Route trifft; der Waechter lief dann
		// gar nicht und es erschien Nicht gefunden, obwohl die Sitzung galt. Ein voller
		// Seitenaufruf strippt den Schraegstrich vorher, darum fiel es nur im Browser auf.
		const harness = await RouterTestingHarness.create();
		await harness.navigateByUrl('/demo/');
		harness.detectChanges();

		http.expectNone('/demo/api/v1/ich');
		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
	});

	it('zeigt die Links Profil und Abmelden', async () => {
		const harness = await oeffne('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();

		const profil = [...(harness.routeNativeElement?.querySelectorAll('a') ?? [])].find((a) =>
			a.textContent?.includes('Profil'),
		);
		expect(profil?.getAttribute('href')).toBe('/demo/profil');
		expect(harness.routeNativeElement?.textContent).toContain('Abmelden');
	});

	it('Abmelden ruft abmelden und geht zur Anmeldung des Vereins', async () => {
		const harness = await oeffne('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();
		const navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

		const knopf = [...(harness.routeNativeElement?.querySelectorAll('button') ?? [])].find((b) =>
			b.textContent?.includes('Abmelden'),
		);
		knopf?.click();
		const anfrage = http.expectOne('/demo/api/v1/abmelden');
		expect(anfrage.request.method).toBe('POST');
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
		await harness.fixture.whenStable();

		expect(navigiert).toHaveBeenCalledWith('/demo/anmelden');
	});

	it('scheitert das Abmelden am Netz, bleibt die Seite stehen und sagt es', async () => {
		const harness = await oeffne('/demo');
		http
			.expectOne('/demo/api/v1/verein')
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await harness.fixture.whenStable();
		harness.detectChanges();
		const navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

		[...(harness.routeNativeElement?.querySelectorAll('button') ?? [])]
			.find((b) => b.textContent?.includes('Abmelden'))
			?.click();
		http.expectOne('/demo/api/v1/abmelden').error(new ProgressEvent('error'));
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(navigiert).not.toHaveBeenCalled();
		expect(harness.routeNativeElement?.textContent).toContain('Keine Verbindung – nochmal versuchen');
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
