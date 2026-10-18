import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf } from '../admin/test-hilfen';
import type { KindAnsicht } from './mitglieder-api';

const API = '/demo/api/v1';

const ICH = { person: { vorname: 'Anna' }, passkeys: [], totp: {}, hatKinder: true };

function kind(zusatz: Partial<KindAnsicht> = {}): KindAnsicht {
	return {
		id: 'k1',
		vorname: 'Lena',
		nachname: 'Muster',
		jugendsprecher: true,
		untergruppen: [{ id: 'u1', name: 'Gruppe A' }],
		familie: [
			{ vorname: 'Anna', nachname: 'Muster', beziehung: 'MUTTER', beziehungFreitext: null },
			{ vorname: 'Rosa', nachname: 'Muster', beziehung: 'GROSSMUTTER', beziehungFreitext: null },
		],
		zugang: { erlaubt: true, vorhanden: true, einwilligungGueltig: true },
		ichBinErziehungsberechtigt: true,
		volljaehrig: false,
		...zusatz,
	};
}

describe('Meine Jungfischer', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => http.verify());

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	async function oeffne(kinder: KindAnsicht[]): Promise<void> {
		http = TestBed.inject(HttpTestingController);
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/meine-jungfischer');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		await vi.waitFor(() => http.expectOne(`${API}/meine-jungfischer`).flush({ kinder }));
		http
			.expectOne(`${API}/verein`)
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;
	}

	async function neuGeladen(kinder: KindAnsicht[]): Promise<void> {
		await vi.waitFor(() => http.expectOne(`${API}/meine-jungfischer`).flush({ kinder }));
		await stabil();
	}

	it('zeigt die Kinder mit Familie und Untergruppen', async () => {
		await oeffne([kind()]);
		const text = seite.textContent ?? '';
		expect(text).toContain('Lena Muster');
		expect(text).toContain('Jugendsprecher-Rolle: Lena nimmt am Austausch mit den Jugendleitern teil.');
		expect(text).toContain('Gruppe A');
		expect(text).toContain('Anna Muster');
		expect(text).toContain('Mutter');
		expect(text).toContain('Rosa Muster');
		expect(text).toContain('Großmutter');
		expect(knopf(seite, 'Zugang entziehen')).toBeTruthy();
		expect(knopf(seite, 'Einwilligung widerrufen')).toBeTruthy();
	});

	it('Großmutter sieht keine Aktionen', async () => {
		await oeffne([kind({ ichBinErziehungsberechtigt: false })]);
		expect(seite.querySelectorAll('article button').length).toBe(0);
		expect(seite.textContent).toContain('Lena Muster');
	});

	it('volljähriges Kind zeigt Hinweis statt Aktionen', async () => {
		await oeffne([kind({ volljaehrig: true })]);
		expect(seite.querySelectorAll('article button').length).toBe(0);
		expect(seite.textContent).toContain('volljährig');
	});

	it('Zugang erlauben sendet und lädt neu', async () => {
		await oeffne([kind({ zugang: { erlaubt: false, vorhanden: false, einwilligungGueltig: true } })]);
		knopf(seite, 'Zugang erlauben').click();
		const anfrage = http.expectOne(`${API}/meine-jungfischer/k1/zugang`);
		expect(anfrage.request.body).toEqual({ erlaubt: true });
		anfrage.flush({ erlaubt: true });
		await neuGeladen([kind()]);
		expect(knopf(seite, 'Zugang entziehen')).toBeTruthy();
	});

	it('Widerruf fragt erst nach, sendet erst nach Bestätigung', async () => {
		await oeffne([kind()]);
		knopf(seite, 'Einwilligung widerrufen').click();
		await stabil();
		http.expectNone(`${API}/meine-jungfischer/k1/einwilligung`);
		const frage = seite.querySelector('[role="alertdialog"]')?.textContent ?? '';
		expect(frage).toContain('Der Zugang von Lena endet');
		expect(frage).toContain('keine andere Einwilligung besteht');
		knopf(seite, 'Ja, widerrufen').click();
		const anfrage = http.expectOne(`${API}/meine-jungfischer/k1/einwilligung`);
		expect(anfrage.request.body).toEqual({ erteilen: false });
		anfrage.flush({ erteilt: false });
		await neuGeladen([kind({ zugang: { erlaubt: true, vorhanden: true, einwilligungGueltig: false } })]);
		expect(knopf(seite, 'Einwilligung geben')).toBeTruthy();
	});

	it('Abbrechen beim Widerruf sendet nichts', async () => {
		await oeffne([kind()]);
		knopf(seite, 'Einwilligung widerrufen').click();
		await stabil();
		knopf(seite, 'Abbrechen').click();
		await stabil();
		http.expectNone(`${API}/meine-jungfischer/k1/einwilligung`);
		expect(knopf(seite, 'Einwilligung widerrufen')).toBeTruthy();
	});

	it('Fehler 409 EINWILLIGUNG_FEHLT erscheint als Text', async () => {
		await oeffne([kind({ zugang: { erlaubt: false, vorhanden: false, einwilligungGueltig: false } })]);
		knopf(seite, 'Zugang erlauben').click();
		http
			.expectOne(`${API}/meine-jungfischer/k1/zugang`)
			.flush(
				{ fehler: 'Ohne Einwilligung kein Zugang', code: 'EINWILLIGUNG_FEHLT' },
				{ status: 409, statusText: 'Conflict' },
			);
		await stabil();
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Ohne Einwilligung kein Zugang');
	});

	it('Link-Erzeugung zeigt Link und Kopieren-Knopf', async () => {
		await oeffne([kind()]);
		knopf(seite, 'Neuen Link erzeugen').click();
		http.expectOne(`${API}/meine-jungfischer/k1/einladung`).flush({
			link: 'https://x.example/demo/einladung?t=abc',
			text: 'Hallo Lena, hier ist dein Link: https://x.example/demo/einladung?t=abc',
			ablauf: '2026-11-01T00:00:00.000Z',
		});
		await neuGeladen([kind()]);
		// Das Neuladen darf den Link nicht wegraeumen: Er ist nur dieses eine Mal zu sehen.
		expect(seite.textContent).toContain('hier ist dein Link');
		expect(seite.textContent).toContain('Der Link gilt bis 01.11.2026, 01:00 Uhr');
		expect(knopf(seite, 'Link kopieren')).toBeTruthy();
	});

	it('Zugang entziehen räumt den angezeigten Link weg', async () => {
		await oeffne([kind()]);
		knopf(seite, 'Neuen Link erzeugen').click();
		http
			.expectOne(`${API}/meine-jungfischer/k1/einladung`)
			.flush({ link: 'l', text: 'Hallo Lena, dein Link', ablauf: '2026-11-01T00:00:00.000Z' });
		await neuGeladen([kind()]);
		expect(seite.textContent).toContain('dein Link');
		knopf(seite, 'Zugang entziehen').click();
		http.expectOne(`${API}/meine-jungfischer/k1/zugang`).flush({ erlaubt: false });
		await neuGeladen([kind({ zugang: { erlaubt: false, vorhanden: true, einwilligungGueltig: true } })]);
		expect(seite.textContent).not.toContain('dein Link');
	});
});
