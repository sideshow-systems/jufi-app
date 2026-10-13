import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf, tippe } from './test-hilfen';

const API = '/admin/api/v1';

describe('Admin-Anmeldung', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(async () => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
		harness = await RouterTestingHarness.create('/admin/anmelden');
		seite = harness.routeNativeElement as HTMLElement;
	});

	afterEach(() => http.verify());

	async function ausfuellenUndAbsenden(): Promise<void> {
		tippe(seite, 'input[name=benutzername]', 'flo');
		tippe(seite, 'input[name=passwort]', 'ein-langes-passwort');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();
	}

	/** Der Waechter der Verwaltung fragt nach der Anmeldung, ob die Sitzung gilt. */
	async function sitzungGilt(): Promise<void> {
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/ich`)
				.flush({ benutzername: 'flo', totpAktiv: false, passkeys: 0, wiederherstellungscodesUebrig: 0 }),
		);
		await harness.fixture.whenStable();
	}

	it('ohne TOTP fuehrt die Anmeldung zu den Vereinen', async () => {
		await ausfuellenUndAbsenden();

		const anfrage = http.expectOne(`${API}/anmelden`);
		expect(anfrage.request.body).toEqual({ benutzername: 'flo', passwort: 'ein-langes-passwort' });
		anfrage.flush({ schritt: 'fertig' });
		await sitzungGilt();
		expect(TestBed.inject(Router).url).toBe('/admin/vereine');
	});

	it('mit TOTP erscheint das Codefeld, der Code wird mit der Zwischenmarke gesendet', async () => {
		await ausfuellenUndAbsenden();
		http.expectOne(`${API}/anmelden`).flush({ schritt: 'totp', zwischenmarke: 'marke-1' });
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(seite.textContent).toContain('Code aus der Authenticator-App');
		expect(seite.textContent).toContain('Wiederherstellungscode verwenden');
		// Das Passwortfeld ist weg: der zweite Schritt fragt nur noch den Code.
		expect(seite.querySelector('input[name=passwort]')).toBeNull();

		tippe(seite, 'input[name=code]', '123456');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();

		const anfrage = http.expectOne(`${API}/anmelden/totp`);
		expect(anfrage.request.body).toEqual({ zwischenmarke: 'marke-1', code: '123456' });
		anfrage.flush({ schritt: 'fertig', wiederherstellungscodesUebrig: 10 });
		await sitzungGilt();
		expect(TestBed.inject(Router).url).toBe('/admin/vereine');
	});

	it('der Wiederherstellungscode geht statt des Codes an den Server', async () => {
		await ausfuellenUndAbsenden();
		http.expectOne(`${API}/anmelden`).flush({ schritt: 'totp', zwischenmarke: 'marke-1' });
		await harness.fixture.whenStable();
		harness.detectChanges();

		knopf(seite, 'Wiederherstellungscode verwenden').click();
		harness.detectChanges();
		tippe(seite, 'input[name=wiederherstellungscode]', 'ABCDE-FGHJK-LMNPQ');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();

		const anfrage = http.expectOne(`${API}/anmelden/totp`);
		expect(anfrage.request.body).toEqual({ zwischenmarke: 'marke-1', wiederherstellungscode: 'ABCDE-FGHJK-LMNPQ' });
		anfrage.flush({ schritt: 'fertig', wiederherstellungscodesUebrig: 9 });
		await sitzungGilt();
		expect(TestBed.inject(Router).url).toBe('/admin/vereine');
	});

	it('401 zeigt Anmeldung fehlgeschlagen', async () => {
		await ausfuellenUndAbsenden();
		http
			.expectOne(`${API}/anmelden`)
			.flush({ fehler: 'Anmeldung fehlgeschlagen' }, { status: 401, statusText: 'Unauthorized' });
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(seite.querySelector('[role=alert]')?.textContent).toContain('Anmeldung fehlgeschlagen');
		expect(TestBed.inject(Router).url).toBe('/admin/anmelden');
	});

	it('429 nennt die Wartezeit', async () => {
		await ausfuellenUndAbsenden();
		http
			.expectOne(`${API}/anmelden`)
			.flush({ fehler: 'Zu viele Versuche', wartenSekunden: 42 }, { status: 429, statusText: 'Too Many Requests' });
		await harness.fixture.whenStable();
		harness.detectChanges();

		expect(seite.querySelector('[role=alert]')?.textContent).toContain(
			'Zu viele Versuche – bitte in 42 Sekunden erneut',
		);
	});
});
