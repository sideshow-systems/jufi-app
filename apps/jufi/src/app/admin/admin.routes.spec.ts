import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter } from './test-hilfen';

const API = '/admin/api/v1';

describe('Admin-Routen', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it('ohne Sitzung leitet der Waechter zur Anmeldung um', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/admin/konto');
		await vi.waitFor(() =>
			http.expectOne(`${API}/ich`).flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
		);
		await navigation;

		expect(TestBed.inject(Router).url).toBe('/admin/anmelden');
	});

	it('/admin fuehrt angemeldet zu /admin/vereine', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/admin');
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/ich`)
				.flush({ benutzername: 'flo', totpAktiv: false, passkeys: 0, wiederherstellungscodesUebrig: 0 }),
		);
		await navigation;
		// Die Vereinsliste laedt ihre Daten.
		await vi.waitFor(() => http.expectOne(`${API}/vereine`).flush({ vereine: [] }));

		expect(TestBed.inject(Router).url).toBe('/admin/vereine');
	});

	it('Anmeldung und Einrichtung sind ohne Sitzung erreichbar', async () => {
		const harness = await RouterTestingHarness.create('/admin/anmelden');
		expect(TestBed.inject(Router).url).toBe('/admin/anmelden');
		expect(harness.routeNativeElement?.textContent).toContain('Anmelden');
	});

	it('ein Netzfehler beim Pruefen der Sitzung leitet nicht zur Anmeldung um', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/admin/konto').catch(() => undefined);
		await vi.waitFor(() => http.expectOne(`${API}/ich`).error(new ProgressEvent('error')));
		await navigation;

		expect(TestBed.inject(Router).url).not.toBe('/admin/anmelden');
	});
});
