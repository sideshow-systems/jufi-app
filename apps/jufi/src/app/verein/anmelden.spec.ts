import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf, tippe } from '../admin/test-hilfen';
import { PasskeyBrowser, type PasskeyAusgang } from '../gemeinsam/passkey-browser';
import { oeffneVereinsseite } from './test-hilfen';

const API = '/demo/api/v1';

describe('Anmeldung im Verein', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;
	let navigiert: ReturnType<typeof vi.spyOn>;
	let passkeyAusgang: PasskeyAusgang;
	let passkeyUnterstuetzt: boolean;

	beforeEach(async () => {
		passkeyAusgang = 'fertig';
		passkeyUnterstuetzt = true;
		const passkeys: Partial<PasskeyBrowser> = {
			unterstuetzt: () => passkeyUnterstuetzt,
			// Echtes WebAuthn gibt es im Test nicht; die Seite soll nur Optionen und Antwort durchreichen.
			anmelden: async (wege) => {
				const optionen = await new Promise((ok, fehler) => wege.optionen().subscribe({ next: ok, error: fehler }));
				expect(optionen).toEqual({ challenge: 'c' });
				if (passkeyAusgang === 'fertig') {
					await new Promise((ok, fehler) => wege.senden({ id: 'p' }).subscribe({ next: ok, error: fehler }));
				}
				return passkeyAusgang;
			},
		};
		TestBed.configureTestingModule({
			providers: [...adminTestAnbieter(), { provide: PasskeyBrowser, useValue: passkeys }],
		});
		({ harness, seite, http } = await oeffneVereinsseite('/demo/anmelden'));
		// Erst nach dem Oeffnen: Die Testhilfe navigiert selbst ueber den Router.
		navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
	});

	afterEach(() => http.verify());

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	function ausfuellenUndAbsenden(): void {
		// Absichtlich mit Leerzeichen und Grossbuchstaben: der Server normalisiert, die Seite nicht.
		tippe(seite, 'input[name=kennung]', '  Flo@Example.org ');
		tippe(seite, 'input[name=passwort]', 'ein-langes-passwort');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();
	}

	it('zeigt den Vereinsnamen und das Kennungsfeld fuer Passkey-Vorschlaege', () => {
		expect(seite.querySelector('h1')?.textContent).toContain('Jungfischer Demo');
		expect(seite.querySelector('input[name=kennung]')?.getAttribute('autocomplete')).toBe('username webauthn');
	});

	it('schickt die Feldwerte unveraendert und geht bei fertig zur Vereinsstartseite', async () => {
		ausfuellenUndAbsenden();
		const anfrage = http.expectOne(`${API}/anmelden`);
		expect(anfrage.request.body).toEqual({ kennung: '  Flo@Example.org ', passwort: 'ein-langes-passwort' });
		anfrage.flush({ schritt: 'fertig' });
		await stabil();
		expect(navigiert).toHaveBeenCalledWith('/demo');
	});

	it('bei totp erscheint das Codefeld statt des Passworts, der Code geht mit der Zwischenmarke', async () => {
		ausfuellenUndAbsenden();
		http.expectOne(`${API}/anmelden`).flush({ schritt: 'totp', zwischenmarke: 'marke-1' });
		await stabil();

		expect(seite.querySelector('input[name=passwort]')).toBeNull();
		expect(seite.querySelector('input[name=kennung]')).toBeNull();
		expect(seite.textContent).toContain('Code aus der Authenticator-App');

		tippe(seite, 'input[name=code]', '123456');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();
		const anfrage = http.expectOne(`${API}/anmelden/totp`);
		expect(anfrage.request.body).toEqual({ zwischenmarke: 'marke-1', code: '123456' });
		anfrage.flush({ schritt: 'fertig', wiederherstellungscodesUebrig: 9 });
		await stabil();
		expect(navigiert).toHaveBeenCalledWith('/demo');
	});

	it('der Wiederherstellungscode geht statt des Codes an den Server', async () => {
		ausfuellenUndAbsenden();
		http.expectOne(`${API}/anmelden`).flush({ schritt: 'totp', zwischenmarke: 'marke-1' });
		await stabil();

		knopf(seite, 'Wiederherstellungscode verwenden').click();
		harness.detectChanges();
		tippe(seite, 'input[name=wiederherstellungscode]', 'ABCDE-FGHJK');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();
		expect(http.expectOne(`${API}/anmelden/totp`).request.body).toEqual({
			zwischenmarke: 'marke-1',
			wiederherstellungscode: 'ABCDE-FGHJK',
		});
	});

	it('401 zeigt Anmeldung fehlgeschlagen und der Fokus bleibt im Formular', async () => {
		ausfuellenUndAbsenden();
		http
			.expectOne(`${API}/anmelden`)
			.flush({ fehler: 'Anmeldung fehlgeschlagen' }, { status: 401, statusText: 'Unauthorized' });
		await stabil();

		expect(seite.querySelector('[role=alert]')?.textContent).toContain('Anmeldung fehlgeschlagen');
		// Der gesperrte Knopf verliert den Fokus; ohne Rueckgabe landete er im Nichts.
		await vi.waitFor(() => expect(seite.querySelector('form')?.contains(document.activeElement)).toBe(true));
		expect(navigiert).not.toHaveBeenCalled();
	});

	it('429 nennt die Wartezeit', async () => {
		ausfuellenUndAbsenden();
		http
			.expectOne(`${API}/anmelden`)
			.flush({ fehler: 'Zu viele Versuche', wartenSekunden: 42 }, { status: 429, statusText: 'Too Many Requests' });
		await stabil();
		expect(seite.querySelector('[role=alert]')?.textContent).toContain(
			'Zu viele Versuche – bitte in 42 Sekunden erneut',
		);
	});

	it('Passkey-Knopf holt Optionen, sendet die Antwort und geht zur Startseite', async () => {
		knopf(seite, 'Mit Passkey anmelden').click();
		http.expectOne(`${API}/anmelden/passkey-optionen`).flush({ optionen: { challenge: 'c' } });
		await vi.waitFor(() => {
			http.expectOne(`${API}/anmelden/passkey`).flush({ schritt: 'fertig' });
		});
		await stabil();
		expect(navigiert).toHaveBeenCalledWith('/demo');
	});

	it('ein abgebrochener Passkey-Dialog zeigt keinen Fehlertext', async () => {
		passkeyAusgang = 'abgebrochen';
		knopf(seite, 'Mit Passkey anmelden').click();
		http.expectOne(`${API}/anmelden/passkey-optionen`).flush({ optionen: { challenge: 'c' } });
		await vi.waitFor(() => expect(seite.querySelector('button[disabled]')).toBeNull());
		await stabil();
		expect(seite.querySelector('[role=alert]')).toBeNull();
		expect(navigiert).not.toHaveBeenCalled();
	});

	it('Passwort vergessen fuehrt zur Seite Zugang verloren', () => {
		const link = seite.querySelector<HTMLAnchorElement>('a[href="/demo/zugang-verloren"]');
		expect(link?.textContent).toContain('Passwort vergessen?');
	});
});

describe('Anmeldung im Verein mit weiter', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;
	let navigiert: ReturnType<typeof vi.spyOn>;

	async function oeffne(url: string): Promise<void> {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		({ harness, seite, http } = await oeffneVereinsseite(url));
		navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
	}

	afterEach(() => http.verify());

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	function ausfuellenUndAbsenden(): void {
		tippe(seite, 'input[name=kennung]', 'flo@example.org');
		tippe(seite, 'input[name=passwort]', 'ein-langes-passwort');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();
	}

	it('geht nach der Passwort-Anmeldung zur Seite aus weiter', async () => {
		await oeffne('/demo/anmelden?weiter=%2Fdemo%2Fprofil');
		ausfuellenUndAbsenden();
		http.expectOne(`${API}/anmelden`).flush({ schritt: 'fertig' });
		await stabil();
		expect(navigiert).toHaveBeenCalledWith('/demo/profil');
	});

	it('geht nach dem TOTP-Schritt zur Seite aus weiter', async () => {
		await oeffne('/demo/anmelden?weiter=%2Fdemo%2Fprofil');
		ausfuellenUndAbsenden();
		http.expectOne(`${API}/anmelden`).flush({ schritt: 'totp', zwischenmarke: 'marke-1' });
		await stabil();
		tippe(seite, 'input[name=code]', '123456');
		harness.detectChanges();
		knopf(seite, 'Anmelden').click();
		http.expectOne(`${API}/anmelden/totp`).flush({ schritt: 'fertig', wiederherstellungscodesUebrig: 9 });
		await stabil();
		expect(navigiert).toHaveBeenCalledWith('/demo/profil');
	});

	it('geht nach dem Passkey zur Seite aus weiter', async () => {
		const passkeys: Partial<PasskeyBrowser> = {
			unterstuetzt: () => true,
			anmelden: async (wege) => {
				await new Promise((ok, fehler) => wege.optionen().subscribe({ next: ok, error: fehler }));
				await new Promise((ok, fehler) => wege.senden({ id: 'p' }).subscribe({ next: ok, error: fehler }));
				return 'fertig';
			},
		};
		TestBed.configureTestingModule({
			providers: [...adminTestAnbieter(), { provide: PasskeyBrowser, useValue: passkeys }],
		});
		({ harness, seite, http } = await oeffneVereinsseite('/demo/anmelden?weiter=%2Fdemo%2Fprofil'));
		navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

		knopf(seite, 'Mit Passkey anmelden').click();
		http.expectOne(`${API}/anmelden/passkey-optionen`).flush({ optionen: { challenge: 'c' } });
		await vi.waitFor(() => {
			http.expectOne(`${API}/anmelden/passkey`).flush({ schritt: 'fertig' });
		});
		await stabil();
		expect(navigiert).toHaveBeenCalledWith('/demo/profil');
	});

	it('ein fremdes Ziel in weiter fuehrt zum Start des Vereins', async () => {
		await oeffne('/demo/anmelden?weiter=%2F%2Fboese.example');
		ausfuellenUndAbsenden();
		http.expectOne(`${API}/anmelden`).flush({ schritt: 'fertig' });
		await stabil();
		expect(navigiert).toHaveBeenCalledTimes(1);
		expect(navigiert).toHaveBeenCalledWith('/demo');
	});
});

describe('Anmeldung im Verein ohne Passkey-Unterstuetzung', () => {
	it('zeigt ohne window.PublicKeyCredential keinen Passkey-Knopf', async () => {
		const vorher = (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
		delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
		try {
			TestBed.configureTestingModule({ providers: adminTestAnbieter() });
			const { seite, http } = await oeffneVereinsseite('/demo/anmelden');
			expect(seite.textContent).not.toContain('Mit Passkey anmelden');
			http.verify();
		} finally {
			(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = vorher;
		}
	});
});
