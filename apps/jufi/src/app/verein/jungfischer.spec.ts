import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf } from '../admin/test-hilfen';
import { FOTO_EINWILLIGUNG_TEXT } from '@jufi/domain';
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
		fotos: { erlaubt: false, darfAendern: true },
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

	it('hat die Ueberschrift Meine Jungfischer', async () => {
		await oeffne([kind()]);
		expect(seite.querySelector('h1')?.textContent).toBe('Meine Jungfischer');
	});

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
		await oeffne([kind({ ichBinErziehungsberechtigt: false, fotos: { erlaubt: false, darfAendern: false } })]);
		expect(seite.querySelectorAll('article button').length).toBe(0);
		expect(seite.textContent).toContain('Lena Muster');
	});

	it('volljähriges Kind zeigt Hinweis statt Aktionen', async () => {
		await oeffne([kind({ volljaehrig: true, fotos: { erlaubt: false, darfAendern: false } })]);
		expect(seite.querySelectorAll('article button').length).toBe(0);
		expect(seite.textContent).toContain('volljährig');
	});

	describe('Fotos', () => {
		const fotosZeile = (): string => seite.querySelector('[data-fotos]')?.textContent ?? '';

		it('nicht erlaubt: eine Zeile und der Knopf zum Erlauben', async () => {
			await oeffne([kind()]);
			expect(fotosZeile()).toContain('Fotos: nicht erlaubt');
			expect(knopf(seite, 'Fotos erlauben')).toBeTruthy();
			expect(seite.textContent).not.toContain('Erlaubnis zurückziehen');
		});

		it('erlaubt: eine Zeile und der Knopf zum Zurueckziehen', async () => {
			await oeffne([kind({ fotos: { erlaubt: true, darfAendern: true } })]);
			expect(fotosZeile()).toContain('Fotos: erlaubt');
			expect(fotosZeile()).not.toContain('nicht erlaubt');
			expect(knopf(seite, 'Erlaubnis zurückziehen')).toBeTruthy();
		});

		it('Erlauben schickt erst nach der Bestaetigung mit dem Wortlaut und laedt neu', async () => {
			await oeffne([kind()]);
			knopf(seite, 'Fotos erlauben').click();
			await stabil();
			http.expectNone(`${API}/meine-jungfischer/k1/einwilligung`);
			const frage = seite.querySelector('[role="alertdialog"]')?.textContent ?? '';
			expect(frage).toContain(FOTO_EINWILLIGUNG_TEXT);

			knopf(seite, 'Ja, Fotos erlauben').click();
			const anfrage = http.expectOne(`${API}/meine-jungfischer/k1/einwilligung`);
			expect(anfrage.request.body).toEqual({ erteilen: true, art: 'FOTOS' });
			anfrage.flush({ erteilt: true });
			await neuGeladen([kind({ fotos: { erlaubt: true, darfAendern: true } })]);
			expect(fotosZeile()).toContain('Fotos: erlaubt');
			expect(seite.querySelector('[role="alertdialog"]')).toBeNull();
		});

		it('Abbrechen beim Erlauben sendet nichts', async () => {
			await oeffne([kind()]);
			knopf(seite, 'Fotos erlauben').click();
			await stabil();
			knopf(seite, 'Abbrechen').click();
			await stabil();
			http.expectNone(`${API}/meine-jungfischer/k1/einwilligung`);
			expect(knopf(seite, 'Fotos erlauben')).toBeTruthy();
		});

		it('Zurueckziehen fragt nach und schickt erteilen false mit der Art FOTOS', async () => {
			await oeffne([kind({ fotos: { erlaubt: true, darfAendern: true } })]);
			knopf(seite, 'Erlaubnis zurückziehen').click();
			await stabil();
			http.expectNone(`${API}/meine-jungfischer/k1/einwilligung`);
			expect(seite.querySelector('[role="alertdialog"]')?.textContent).toContain('Lena');
			knopf(seite, 'Ja, zurückziehen').click();
			const anfrage = http.expectOne(`${API}/meine-jungfischer/k1/einwilligung`);
			expect(anfrage.request.body).toEqual({ erteilen: false, art: 'FOTOS' });
			anfrage.flush({ erteilt: false });
			await neuGeladen([kind()]);
			expect(fotosZeile()).toContain('Fotos: nicht erlaubt');
		});

		it('die Rueckfrage zu den Fotos und die zum Zugang stehen nie gleichzeitig offen', async () => {
			await oeffne([kind()]);
			knopf(seite, 'Fotos erlauben').click();
			await stabil();
			knopf(seite, 'Einwilligung widerrufen').click();
			await stabil();
			expect(seite.querySelectorAll('[role="alertdialog"]').length).toBe(1);
			expect(seite.querySelector('[role="alertdialog"]')?.textContent).toContain('Der Zugang von Lena endet');
		});

		it('ein Fehler beim Erlauben steht beim Kind', async () => {
			await oeffne([kind()]);
			knopf(seite, 'Fotos erlauben').click();
			await stabil();
			knopf(seite, 'Ja, Fotos erlauben').click();
			http
				.expectOne(`${API}/meine-jungfischer/k1/einwilligung`)
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await stabil();
			expect(seite.querySelector('[role="alert"]')?.textContent).toContain('nicht gefunden');
		});

		it('ohne darfAendern gibt es die Zeile, aber keine Knoepfe; volljaehrige Kinder pflegen es selbst', async () => {
			await oeffne([
				kind({
					id: 'k2',
					vorname: 'Gro',
					ichBinErziehungsberechtigt: false,
					fotos: { erlaubt: true, darfAendern: false },
				}),
				kind({ id: 'k3', vorname: 'Max', volljaehrig: true, fotos: { erlaubt: false, darfAendern: false } }),
			]);
			const gross = seite.querySelector('[data-kind="k2"]') as HTMLElement;
			const volljaehrig = seite.querySelector('[data-kind="k3"]') as HTMLElement;
			expect(gross.querySelector('[data-fotos]')?.textContent).toContain('Fotos: erlaubt');
			expect(gross.querySelectorAll('button').length).toBe(0);
			expect(gross.textContent).not.toContain('selbst im Profil');
			expect(volljaehrig.querySelector('[data-fotos]')?.textContent).toContain('Fotos: nicht erlaubt');
			expect(volljaehrig.textContent).toContain('Pflegt Max selbst im Profil.');
			expect(volljaehrig.querySelectorAll('button').length).toBe(0);
		});
	});

	// Der Waechter laeuft nur beim Betreten der Huelle; beim Wechsel zwischen den Seiten faengt die Seite das 401 selbst ab.
	it('eine abgelaufene Sitzung beim Laden fuehrt zur Anmeldung mit weiter', async () => {
		http = TestBed.inject(HttpTestingController);
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/meine-jungfischer');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/meine-jungfischer`)
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
		);
		await vi.waitFor(() =>
			expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fmeine-jungfischer'),
		);
		// Die Anmeldeseite laedt ihren Vereinskopf; hier zaehlt nur das Ziel der Umleitung.
		http.match(`${API}/verein`);
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
