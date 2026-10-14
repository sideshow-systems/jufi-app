import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';
import { adminTestAnbieter, knopf, tippe } from './test-hilfen';

// jsdom hat kein canvas; der QR-Code ist hier nicht der Gegenstand.
vi.mock('qrcode', () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));

const API = '/admin/api/v1';

describe('Admin-Einrichtung', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		// Kein echtes WebAuthn in den Tests: der Browser-Dienst ist durch ein Double ersetzt.
		const passkeyBrowser: Partial<PasskeyBrowser> = {
			unterstuetzt: () => true,
			hinzufuegen: () => Promise.resolve('fertig'),
		};
		TestBed.configureTestingModule({
			providers: [...adminTestAnbieter(), { provide: PasskeyBrowser, useValue: passkeyBrowser }],
		});
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		http.verify();
	});

	async function oeffne(fragment = 'token-1'): Promise<{ harness: RouterTestingHarness; seite: HTMLElement }> {
		const harness = await RouterTestingHarness.create(`/admin/einrichten#${fragment}`);
		return { harness, seite: harness.routeNativeElement as HTMLElement };
	}

	async function stabil(harness: RouterTestingHarness): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	it('liest das Token aus dem Fragment und prueft es', async () => {
		const verlauf = vi.spyOn(history, 'replaceState');
		const { harness, seite } = await oeffne('token-1');

		const anfrage = http.expectOne(`${API}/einrichtung/pruefen`);
		expect(anfrage.request.body).toEqual({ token: 'token-1' });
		anfrage.flush({ benutzername: 'flo' });
		await stabil(harness);

		expect(seite.textContent).toContain('Willkommen, flo');
		// Das Token liegt nicht im Verlauf: die Adresse wurde ohne Fragment ersetzt.
		expect(verlauf).toHaveBeenCalled();
		expect(String(verlauf.mock.calls.at(-1)?.[2])).not.toContain('#');
	});

	it('ungueltiger Link zeigt den Hinweis', async () => {
		const { harness, seite } = await oeffne();
		http
			.expectOne(`${API}/einrichtung/pruefen`)
			.flush({ fehler: 'Dieser Link gilt nicht mehr' }, { status: 404, statusText: 'Not Found' });
		await stabil(harness);

		expect(seite.textContent).toContain(
			'Dieser Link gilt nicht mehr – lass dir mit admin zuruecksetzen einen neuen geben',
		);
		expect(seite.querySelector('input[type=password]')).toBeNull();
	});

	it('ohne Token im Link wird nichts angefragt', async () => {
		const { harness, seite } = await oeffne('');
		await stabil(harness);

		expect(seite.textContent).toContain('Dieser Link gilt nicht mehr');
	});

	it('zu kurzes Passwort sperrt den Knopf und nennt die Regel', async () => {
		const { harness, seite } = await oeffne();
		http.expectOne(`${API}/einrichtung/pruefen`).flush({ benutzername: 'flo' });
		await stabil(harness);

		tippe(seite, 'input[name=passwort]', 'kurz');
		tippe(seite, 'input[name=wiederholung]', 'kurz');
		harness.detectChanges();

		expect(seite.textContent).toContain('Mindestens 10 Zeichen');
		expect(knopf(seite, 'Passwort festlegen').disabled).toBe(true);

		tippe(seite, 'input[name=passwort]', 'ein-langes-passwort');
		harness.detectChanges();
		// Passwort und Wiederholung weichen ab: weiter gesperrt.
		expect(knopf(seite, 'Passwort festlegen').disabled).toBe(true);
		expect(seite.textContent).toContain('Die beiden Passwörter sind nicht gleich');

		tippe(seite, 'input[name=wiederholung]', 'ein-langes-passwort');
		harness.detectChanges();
		expect(knopf(seite, 'Passwort festlegen').disabled).toBe(false);
	});

	it('nach dem Abschluss folgt der TOTP-Schritt, der sich ueberspringen laesst', async () => {
		const { harness, seite } = await oeffne();
		http.expectOne(`${API}/einrichtung/pruefen`).flush({ benutzername: 'flo' });
		await stabil(harness);

		tippe(seite, 'input[name=passwort]', 'ein-langes-passwort');
		tippe(seite, 'input[name=wiederholung]', 'ein-langes-passwort');
		harness.detectChanges();
		knopf(seite, 'Passwort festlegen').click();

		const abschluss = http.expectOne(`${API}/einrichtung/abschliessen`);
		expect(abschluss.request.body).toEqual({ token: 'token-1', passwort: 'ein-langes-passwort' });
		abschluss.flush({ benutzername: 'flo' });
		await stabil(harness);

		expect(seite.textContent).toContain('Dringend empfohlen');
		// Die Einrichtung des zweiten Faktors holt sich Geheimnis und Codes vom Server.
		http.expectOne(`${API}/konto/totp/start`).flush({
			zwischenmarke: 'z',
			geheimnis: 'ABCDEFGHIJKLMNOP',
			uri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP',
			wiederherstellungscodes: Array.from({ length: 10 }, (_, i) => `CODE-${i}`),
		});
		await stabil(harness);
		expect(seite.textContent).toContain('ABCD EFGH IJKL MNOP');
		expect(seite.textContent).toContain('Bewahre sie getrennt vom Gerät auf. Jeder gilt einmal.');

		knopf(seite, 'Überspringen').click();
		await stabil(harness);

		// Danach der Passkey, ebenfalls zum Ueberspringen.
		expect(seite.textContent).toContain('Passkey');
		knopf(seite, 'Überspringen').click();
		await stabil(harness);
		expect(seite.textContent).toContain('Zu den Vereinen');
	});

	it('der bestaetigte TOTP-Code fuehrt zum Passkey-Schritt', async () => {
		const { harness, seite } = await oeffne();
		http.expectOne(`${API}/einrichtung/pruefen`).flush({ benutzername: 'flo' });
		await stabil(harness);
		tippe(seite, 'input[name=passwort]', 'ein-langes-passwort');
		tippe(seite, 'input[name=wiederholung]', 'ein-langes-passwort');
		harness.detectChanges();
		knopf(seite, 'Passwort festlegen').click();
		http.expectOne(`${API}/einrichtung/abschliessen`).flush({ benutzername: 'flo' });
		await stabil(harness);
		const uri = 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP';
		http.expectOne(`${API}/konto/totp/start`).flush({
			zwischenmarke: 'z',
			geheimnis: 'ABCDEFGHIJKLMNOP',
			uri,
			wiederherstellungscodes: ['A-1', 'A-2'],
		});
		await stabil(harness);

		// Der QR-Code wird aus der URI des Servers gezeichnet (qrcode ist hier ersetzt).
		const { toCanvas } = await import('qrcode');
		await vi.waitFor(() =>
			expect(toCanvas).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), uri, expect.anything()),
		);

		tippe(seite, 'input[name=code]', '123456');
		harness.detectChanges();
		knopf(seite, 'Bestätigen').click();
		const anfrage = http.expectOne(`${API}/konto/totp/bestaetigen`);
		expect(anfrage.request.body).toEqual({ zwischenmarke: 'z', code: '123456' });
		anfrage.flush({ ok: true });
		await stabil(harness);

		// Erst die Quittung der Codes bringt weiter. Ueberspringen entfaellt jetzt:
		// es fuehrte an den nur einmal sichtbaren Codes vorbei.
		expect(seite.textContent).toContain('A-1');
		expect(seite.textContent).toContain('Nur jetzt sichtbar');
		expect(seite.textContent).not.toContain('Passkey hinzufügen');
		expect(() => knopf(seite, 'Überspringen')).toThrow();

		knopf(seite, 'Ich habe die Codes gesichert').click();
		await stabil(harness);

		expect(seite.textContent).toContain('Passkey hinzufügen');
		expect(seite.textContent).not.toContain('Dringend empfohlen');
	});

	it('zeigt die Regel des Servers, wenn er das Passwort ablehnt', async () => {
		const { harness, seite } = await oeffne();
		http.expectOne(`${API}/einrichtung/pruefen`).flush({ benutzername: 'flo' });
		await stabil(harness);

		tippe(seite, 'input[name=passwort]', 'ein-langes-passwort');
		tippe(seite, 'input[name=wiederholung]', 'ein-langes-passwort');
		harness.detectChanges();
		knopf(seite, 'Passwort festlegen').click();
		http
			.expectOne(`${API}/einrichtung/abschliessen`)
			.flush({ fehler: 'Dieses Passwort ist zu verbreitet' }, { status: 400, statusText: 'Bad Request' });
		await stabil(harness);

		expect(seite.querySelector('[role=alert]')?.textContent).toContain('Dieses Passwort ist zu verbreitet');
		expect(seite.textContent).not.toContain('Dringend empfohlen');
	});
});
