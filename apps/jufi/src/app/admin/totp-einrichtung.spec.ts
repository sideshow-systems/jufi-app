import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { adminTestAnbieter, knopf, tippe } from './test-hilfen';
import { TotpEinrichtungComponent } from './totp-einrichtung';

// jsdom hat kein canvas; der QR-Code ist hier nicht der Gegenstand.
vi.mock('qrcode', () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));

const API = '/admin/api/v1';
const CODES = Array.from({ length: 10 }, (_, i) => `CODE-${i}`);

describe('TotpEinrichtungComponent', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	async function oeffne() {
		const fixture = TestBed.createComponent(TotpEinrichtungComponent);
		const eingerichtet = vi.fn();
		fixture.componentInstance.eingerichtet.subscribe(eingerichtet);
		fixture.detectChanges();
		http.expectOne(`${API}/konto/totp/start`).flush({
			zwischenmarke: 'z',
			geheimnis: 'ABCDEFGHIJKLMNOP',
			uri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP',
			wiederherstellungscodes: CODES,
		});
		await fixture.whenStable();
		fixture.detectChanges();
		return { fixture, seite: fixture.nativeElement as HTMLElement, eingerichtet };
	}

	it('die Wiederherstellungscodes bleiben nach dem Bestaetigen stehen, bis die Person sie quittiert', async () => {
		const { fixture, seite, eingerichtet } = await oeffne();
		for (const c of CODES) expect(seite.textContent).toContain(c);

		tippe(seite, 'input[name=code]', '123456');
		fixture.detectChanges();
		knopf(seite, 'Bestätigen').click();
		http.expectOne(`${API}/konto/totp/bestaetigen`).flush({ ok: true });
		await fixture.whenStable();
		fixture.detectChanges();

		// Noch nicht weitergegeben: Das Elternbauteil wuerde dieses sonst sofort entfernen.
		expect(eingerichtet).not.toHaveBeenCalled();
		for (const c of CODES) expect(seite.textContent).toContain(c);
		expect(seite.textContent).toContain('Nur jetzt sichtbar');
		// Das Formular ist erledigt und entfaellt.
		expect(seite.querySelector('input[name=code]')).toBeNull();
		expect(seite.querySelector('form')).toBeNull();

		knopf(seite, 'Ich habe die Codes gesichert – weiter').click();
		expect(eingerichtet).toHaveBeenCalledTimes(1);
	});

	it('ein falscher Code laesst das Formular stehen und sendet nichts', async () => {
		const { fixture, seite, eingerichtet } = await oeffne();

		tippe(seite, 'input[name=code]', '000000');
		fixture.detectChanges();
		knopf(seite, 'Bestätigen').click();
		http
			.expectOne(`${API}/konto/totp/bestaetigen`)
			.flush({ fehler: 'Der Code stimmt nicht' }, { status: 401, statusText: 'Unauthorized' });
		await fixture.whenStable();
		fixture.detectChanges();

		expect(seite.querySelector('[role=alert]')?.textContent).toContain('Der Code stimmt nicht');
		expect(seite.querySelector('input[name=code]')).not.toBeNull();
		expect(seite.textContent).not.toContain('Ich habe die Codes gesichert');
		expect(eingerichtet).not.toHaveBeenCalled();
	});
});
