import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { AdminIch } from './admin-api';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';
import { adminTestAnbieter, knopf, oeffneVerwaltung, stabil, tippe } from './test-hilfen';

// jsdom hat kein canvas; der QR-Code ist hier nicht der Gegenstand.
vi.mock('qrcode', () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));

const API = '/admin/api/v1';
const ICH: AdminIch = { benutzername: 'flo', totpAktiv: false, passkeys: 0, wiederherstellungscodesUebrig: 0 };

describe('Admin-Konto', () => {
	beforeEach(() => {
		const passkeyBrowser: Partial<PasskeyBrowser> = {
			unterstuetzt: () => true,
			hinzufuegen: () => Promise.resolve('fertig'),
		};
		TestBed.configureTestingModule({
			providers: [...adminTestAnbieter(), { provide: PasskeyBrowser, useValue: passkeyBrowser }],
		});
	});
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne(ich: AdminIch = ICH) {
		const o = await oeffneVerwaltung('/admin/konto');
		o.http.expectOne(`${API}/ich`).flush(ich);
		await stabil(o.harness);
		return o;
	}

	/** Der Abmelden-Knopf der Seite, nicht der in der Kopfzeile des Rahmens. */
	function seitenAbmelden(seite: HTMLElement): HTMLButtonElement {
		const knopf = [...seite.querySelectorAll<HTMLButtonElement>('main button')].find((b) =>
			b.textContent?.includes('Abmelden'),
		);
		if (!knopf) throw new Error('Abmelden nicht gefunden');
		return knopf;
	}

	it('Abmelden fuehrt zur Anmeldung', async () => {
		const { seite, http, harness } = await oeffne();

		seitenAbmelden(seite).click();
		http.expectOne(`${API}/abmelden`).flush(null);
		await stabil(harness);

		await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/admin/anmelden'));
	});

	it('Abmelden bei abgelaufener Sitzung (401) gilt als abgemeldet', async () => {
		const { seite, http, harness } = await oeffne();

		seitenAbmelden(seite).click();
		http
			.expectOne(`${API}/abmelden`)
			.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
		await stabil(harness);

		await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/admin/anmelden'));
	});

	it('Abmelden ohne Verbindung bleibt auf der Seite und meldet den Fehler', async () => {
		const { seite, http, harness } = await oeffne();

		seitenAbmelden(seite).click();
		http.expectOne(`${API}/abmelden`).error(new ProgressEvent('error'));
		await stabil(harness);

		expect(seite.textContent).toContain('Abmelden fehlgeschlagen');
		expect(TestBed.inject(Router).url).toBe('/admin/konto');
	});

	it('TOTP einrichten: die Codes bleiben, bis sie quittiert sind; erst dann laedt das Konto neu', async () => {
		const { seite, http, harness } = await oeffne();

		knopf(seite, 'Einrichten').click();
		harness.detectChanges();
		http.expectOne(`${API}/konto/totp/start`).flush({
			zwischenmarke: 'z',
			geheimnis: 'ABCDEFGHIJKLMNOP',
			uri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP',
			wiederherstellungscodes: ['A-1', 'A-2'],
		});
		await stabil(harness);

		tippe(seite, 'input[name=code]', '123456');
		harness.detectChanges();
		knopf(seite, 'Bestätigen').click();
		http.expectOne(`${API}/konto/totp/bestaetigen`).flush({ ok: true });
		await stabil(harness);

		// Kein Neuladen des Kontos (GET /ich), das die Codes mit dem Bauteil entfernte.
		expect(seite.textContent).toContain('A-1');
		expect(seite.textContent).toContain('Nur jetzt sichtbar');

		knopf(seite, 'Ich habe die Codes gesichert').click();
		await vi.waitFor(() =>
			http.expectOne(`${API}/ich`).flush({ ...ICH, totpAktiv: true, wiederherstellungscodesUebrig: 2 }),
		);
		await stabil(harness);

		expect(seite.textContent).not.toContain('Nur jetzt sichtbar');
		expect(seite.textContent).toContain('Wiederherstellungscodes übrig: 2');
	});
});
