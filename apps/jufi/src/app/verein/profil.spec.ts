import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf, tippe } from '../admin/test-hilfen';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';
import type { MitgliedIch } from './mitglieder-api';

const API = '/demo/api/v1';

const ICH: MitgliedIch = {
	person: { id: 'p-1', vorname: 'Thomas', nachname: 'Beispiel', art: 'ERWACHSENER', rechte: ['MITGLIEDER'] },
	kennung: 'thomas@example.org',
	passkeys: [
		{ id: 'k1', label: 'Mac von Thomas', erstelltAm: '2026-09-01T10:00:00.000Z', zuletztGenutztAm: null },
		{ id: 'k2', label: 'Handy', erstelltAm: '2026-09-02T10:00:00.000Z', zuletztGenutztAm: '2026-10-01T08:00:00.000Z' },
	],
	hatPasswort: true,
	hatKinder: false,
	totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

describe('Profil', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;
	let navigiert: ReturnType<typeof vi.spyOn>;
	let passkeyUnterstuetzt: boolean;
	let hinzufuegen: PasskeyBrowser['hinzufuegen'];

	beforeEach(() => {
		passkeyUnterstuetzt = true;
		hinzufuegen = async () => 'fertig';
		const passkeys: Partial<PasskeyBrowser> = {
			unterstuetzt: () => passkeyUnterstuetzt,
			hinzufuegen: (wege) => hinzufuegen(wege),
		};
		TestBed.configureTestingModule({
			providers: [...adminTestAnbieter(), { provide: PasskeyBrowser, useValue: passkeys }],
		});
	});

	afterEach(() => http.verify());

	/**
	 * Der Waechter fragt GET /ich, danach laedt die Seite ihren eigenen Stand (ein
	 * zweites GET /ich) und der Kopf den Verein. Alles drei wird hier beantwortet.
	 */
	async function oeffne(ich: MitgliedIch = ICH): Promise<void> {
		http = TestBed.inject(HttpTestingController);
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/profil');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ich));
		await navigation;
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ich));
		http
			.expectOne(`${API}/verein`)
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;
		// Erst nach dem Oeffnen: Die Navigation oben laeuft ueber den echten Router.
		navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
	}

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	/** Beantwortet das Neuladen nach einer Aenderung. */
	async function neuGeladen(ich: MitgliedIch): Promise<void> {
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ich));
		await stabil();
	}

	function zeile(id: string): HTMLElement {
		const z = seite.querySelector<HTMLElement>(`[data-passkey="${id}"]`);
		if (!z) throw new Error(`Passkey-Zeile nicht gefunden: ${id}`);
		return z;
	}

	it('zeigt Name und Kennung nur lesend, die Passkeys und den Passwortstatus', async () => {
		await oeffne();

		expect(seite.textContent).toContain('Thomas Beispiel');
		expect(seite.textContent).toContain('thomas@example.org');
		expect(seite.querySelector('input[name=kennung]')).toBeNull();
		expect(zeile('k1').textContent).toContain('Mac von Thomas');
		expect(zeile('k2').textContent).toContain('Handy');
		expect(seite.textContent).toContain('Ein Passwort ist gesetzt');
	});

	// Der Vereinsname steht im Kopf der Huelle; die Seite hat nur ihre eigene Ueberschrift.
	it('hat die Ueberschrift Profil', async () => {
		await oeffne();
		expect(seite.querySelector('h1')?.textContent).toBe('Profil');
	});

	describe('Passkeys', () => {
		it('der 409 "letzter Anmeldeweg" erscheint als Text an der Zeile', async () => {
			await oeffne({ ...ICH, passkeys: [ICH.passkeys[0]!], hatPasswort: false });
			knopf(zeile('k1'), 'Löschen').click();
			http
				.expectOne(`${API}/profil/passkeys/k1`)
				.flush({ fehler: 'Das ist dein letzter Anmeldeweg' }, { status: 409, statusText: 'Conflict' });
			await stabil();

			expect(zeile('k1').textContent).toContain('Das ist dein letzter Anmeldeweg');
			expect(zeile('k1').querySelector('[role=alert]')).not.toBeNull();
		});

		it('Loeschen entfernt den Passkey und laedt neu', async () => {
			await oeffne();
			knopf(zeile('k2'), 'Löschen').click();
			http.expectOne(`${API}/profil/passkeys/k2`).flush({ ok: true });
			await neuGeladen({ ...ICH, passkeys: [ICH.passkeys[0]!] });

			expect(seite.querySelector('[data-passkey="k2"]')).toBeNull();
			expect(zeile('k1')).toBeTruthy();
		});

		it('Umbenennen schickt den neuen Namen und zeigt ihn danach', async () => {
			await oeffne();
			knopf(zeile('k1'), 'Umbenennen').click();
			harness.detectChanges();
			tippe(zeile('k1'), 'input[name=label]', 'Arbeitsrechner');
			harness.detectChanges();
			knopf(zeile('k1'), 'Speichern').click();

			const anfrage = http.expectOne(`${API}/profil/passkeys/k1`);
			expect(anfrage.request.method).toBe('PATCH');
			expect(anfrage.request.body).toEqual({ label: 'Arbeitsrechner' });
			anfrage.flush({ id: 'k1', label: 'Arbeitsrechner' });
			await neuGeladen({ ...ICH, passkeys: [{ ...ICH.passkeys[0]!, label: 'Arbeitsrechner' }, ICH.passkeys[1]!] });

			expect(zeile('k1').textContent).toContain('Arbeitsrechner');
			expect(zeile('k1').querySelector('input[name=label]')).toBeNull();
		});

		it('ein zu langer oder leerer Name geht gar nicht erst an den Server', async () => {
			await oeffne();
			knopf(zeile('k1'), 'Umbenennen').click();
			harness.detectChanges();
			tippe(zeile('k1'), 'input[name=label]', '   ');
			harness.detectChanges();
			knopf(zeile('k1'), 'Speichern').click();
			await stabil();

			// afterEach prueft per verify(), dass keine Anfrage offen ist.
			expect(zeile('k1').textContent).toContain('Der Name braucht 1 bis 40 Zeichen');
		});

		it('Hinzufuegen reicht Optionen, Namen und Antwort durch und laedt neu', async () => {
			await oeffne();
			let optionen: unknown;
			hinzufuegen = async (wege) => {
				optionen = await new Promise((ok, fehler) => wege.optionen().subscribe({ next: ok, error: fehler }));
				await new Promise((ok, fehler) => wege.senden({ id: 'neu' }).subscribe({ next: ok, error: fehler }));
				return 'fertig';
			};
			tippe(seite, 'input[name=passkey-name]', 'Tablet');
			harness.detectChanges();
			knopf(seite, 'Passkey hinzufügen').click();

			http.expectOne(`${API}/profil/passkeys/optionen`).flush({ optionen: { challenge: 'c' } });
			await vi.waitFor(() => {
				const anfrage = http.expectOne(`${API}/profil/passkeys`);
				expect(anfrage.request.body).toEqual({ name: 'Tablet', antwort: { id: 'neu' } });
				anfrage.flush({ id: 'k3', label: 'Tablet' });
			});
			expect(optionen).toEqual({ challenge: 'c' });
			await neuGeladen(ICH);
		});

		it('ohne WebAuthn im Browser fehlt der Knopf zum Hinzufuegen', async () => {
			passkeyUnterstuetzt = false;
			await oeffne();
			expect(seite.textContent).not.toContain('Passkey hinzufügen');
		});

		it('ein sofort abgelehnter Dialog wird gesagt statt verschwiegen', async () => {
			await oeffne();
			hinzufuegen = async () => 'abgelehnt';
			knopf(seite, 'Passkey hinzufügen').click();
			await stabil();
			expect(seite.textContent).toContain('Der Browser hat sofort abgelehnt');
		});
	});

	describe('Passwort', () => {
		it('verlangt das alte Passwort nur, wenn eines existiert', async () => {
			await oeffne();
			expect(seite.querySelector('input[name=altes-passwort]')).not.toBeNull();
		});

		it('ohne vorhandenes Passwort fehlt das Feld fuer das alte', async () => {
			await oeffne({ ...ICH, hatPasswort: false });
			expect(seite.querySelector('input[name=altes-passwort]')).toBeNull();
			expect(seite.textContent).toContain('Noch kein Passwort');
		});

		it('schickt altes und neues Passwort, meldet den Erfolg und leert die Felder', async () => {
			await oeffne();
			tippe(seite, 'input[name=altes-passwort]', 'altes-langes-passwort');
			tippe(seite, 'input[name=neues-passwort]', 'ein-neues-langes-passwort');
			harness.detectChanges();
			knopf(seite, 'Passwort speichern').click();

			const anfrage = http.expectOne(`${API}/profil/passwort`);
			expect(anfrage.request.body).toEqual({ alt: 'altes-langes-passwort', neu: 'ein-neues-langes-passwort' });
			anfrage.flush({ ok: true });
			await neuGeladen(ICH);

			expect(seite.textContent).toContain('Passwort gespeichert');
			expect(seite.querySelector<HTMLInputElement>('input[name=neues-passwort]')?.value).toBe('');
		});

		it('ohne vorhandenes Passwort geht es ohne altes an den Server', async () => {
			await oeffne({ ...ICH, hatPasswort: false });
			tippe(seite, 'input[name=neues-passwort]', 'ein-neues-langes-passwort');
			harness.detectChanges();
			knopf(seite, 'Passwort speichern').click();

			const anfrage = http.expectOne(`${API}/profil/passwort`);
			expect(anfrage.request.body).toEqual({ alt: '', neu: 'ein-neues-langes-passwort' });
			anfrage.flush({ ok: true });
			await neuGeladen({ ...ICH, hatPasswort: true });
			expect(seite.querySelector('input[name=altes-passwort]')).not.toBeNull();
		});

		it('ein zu kurzes neues Passwort geht nicht an den Server und nennt die Regel', async () => {
			await oeffne();
			tippe(seite, 'input[name=altes-passwort]', 'altes-langes-passwort');
			tippe(seite, 'input[name=neues-passwort]', 'kurz');
			harness.detectChanges();
			knopf(seite, 'Passwort speichern').click();
			await stabil();

			expect(seite.querySelector('#passwort-fehler')?.textContent).toBeTruthy();
		});

		it('ein falsches altes Passwort zeigt den Text des Servers', async () => {
			await oeffne();
			tippe(seite, 'input[name=altes-passwort]', 'falsch-falsch-falsch');
			tippe(seite, 'input[name=neues-passwort]', 'ein-neues-langes-passwort');
			harness.detectChanges();
			knopf(seite, 'Passwort speichern').click();
			http
				.expectOne(`${API}/profil/passwort`)
				.flush({ fehler: 'Anmeldung fehlgeschlagen' }, { status: 401, statusText: 'Unauthorized' });
			await stabil();

			expect(seite.querySelector('#passwort-fehler')?.textContent).toContain('Anmeldung fehlgeschlagen');
		});
	});

	describe('Zweiter Faktor', () => {
		it('fehlt, wenn er fuer diese Person nicht moeglich ist', async () => {
			await oeffne({ ...ICH, totp: { moeglich: false, aktiv: false, wiederherstellungscodesUebrig: 0 } });
			expect(seite.textContent).not.toContain('Zweiter Faktor');
			expect(seite.querySelector('jf-totp-einrichtung')).toBeNull();
		});

		it('bietet das Einrichten an, wenn er moeglich und noch nicht aktiv ist', async () => {
			await oeffne();
			expect(seite.textContent).toContain('Zweiter Faktor');
			expect(seite.querySelector('jf-totp-einrichtung')).toBeNull();
			knopf(seite, 'Zweiten Faktor einrichten').click();
			harness.detectChanges();

			expect(seite.querySelector('jf-totp-einrichtung')).not.toBeNull();
			http.expectOne(`${API}/profil/totp/start`).flush({
				marke: 'm',
				geheimnis: 'ABCDEFGHIJKLMNOP',
				uri: 'otpauth://totp/x',
				wiederherstellungscodes: ['AAAAA-BBBBB'],
			});
			await stabil();
		});

		it('zeigt bei aktivem zweiten Faktor den Stand statt der Einrichtung', async () => {
			await oeffne({ ...ICH, totp: { moeglich: true, aktiv: true, wiederherstellungscodesUebrig: 7 } });
			expect(seite.textContent).toContain('Eingerichtet. Noch 7 Wiederherstellungscodes übrig.');
			expect(seite.textContent).not.toContain('Zweiten Faktor einrichten');
		});
	});

	describe('Meine Daten', () => {
		// Ein schlichter Link statt HttpClient und Blob (Plan-Entscheidung 9): Der Server schickt Content-Disposition attachment.
		it('bietet den Datenauszug als Link mit download an', async () => {
			await oeffne();

			expect(seite.textContent).toContain('Alles, was die App über dich speichert, als Datei.');
			const link = [...seite.querySelectorAll('a')].find((a) => a.textContent?.includes('Meine Daten herunterladen'));
			expect(link?.getAttribute('href')).toBe('/demo/api/v1/ich/daten');
			expect(link?.hasAttribute('download')).toBe(true);
			expect(link?.classList.contains('knopf')).toBe(true);
		});
	});

	describe('Abmelden', () => {
		it('Abmelden ruft die API und geht zur Anmeldung des Vereins', async () => {
			await oeffne();
			knopf(seite, 'Abmelden').click();
			const anfrage = http.expectOne(`${API}/abmelden`);
			expect(anfrage.request.method).toBe('POST');
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
			await stabil();

			expect(navigiert).toHaveBeenCalledWith('/demo/anmelden');
		});

		// Die Sitzung ist dann ohnehin weg; ein Fehlertext waere falsch (gleiche Regel wie auf Mehr).
		it('Abmelden bei 401 nicht angemeldet fuehrt zur Anmeldung und zeigt keinen Fehler', async () => {
			await oeffne();
			knopf(seite, 'Abmelden').click();
			http
				.expectOne(`${API}/abmelden`)
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
			await stabil();

			expect(navigiert).toHaveBeenCalledWith('/demo/anmelden');
			expect(seite.querySelector('[role="alert"]')).toBeNull();
		});

		it('Ueberall abmelden ruft die API fuer alle Geraete und geht zur Anmeldung', async () => {
			await oeffne();
			knopf(seite, 'Überall abmelden').click();
			http.expectOne(`${API}/abmelden/alle`).flush(null, { status: 204, statusText: 'No Content' });
			await stabil();

			expect(navigiert).toHaveBeenCalledWith('/demo/anmelden');
		});

		it('scheitert das Abmelden am Netz, bleibt die Seite stehen und sagt es', async () => {
			await oeffne();
			knopf(seite, 'Überall abmelden').click();
			http.expectOne(`${API}/abmelden/alle`).error(new ProgressEvent('error'));
			await stabil();

			expect(navigiert).not.toHaveBeenCalled();
			expect(seite.textContent).toContain('Keine Verbindung – nochmal versuchen');
		});
	});

	it('eine abgelaufene Sitzung beim Speichern fuehrt zur Anmeldung', async () => {
		await oeffne();
		knopf(zeile('k2'), 'Löschen').click();
		http
			.expectOne(`${API}/profil/passkeys/k2`)
			.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
		await stabil();

		expect(navigiert).toHaveBeenCalledWith('/demo/anmelden?weiter=%2Fdemo%2Fprofil');
	});
});
