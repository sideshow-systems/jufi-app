import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter } from '../admin/test-hilfen';
import { MitgliedSitzung } from './mitglied-waechter';
import type { MitgliedIch } from './mitglieder-api';

const API = '/demo/api/v1';

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

const ICH: MitgliedIch = {
	person: { id: 'p-1', vorname: 'Lena', nachname: 'Muster', art: 'JUNGFISCHER', rechte: [] },
	kennung: 'lena',
	passkeys: [],
	hatPasswort: true,
	hatKinder: false,
	fotoEinwilligung: null,
	totp: { moeglich: false, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

const LEITUNG: MitgliedIch = {
	...ICH,
	person: { ...ICH.person, art: 'ERWACHSENER', rechte: ['MITGLIEDER'] },
	hatKinder: true,
};

describe('Mehr', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => http.verify());

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	/** Mehr laedt nichts ausser dem, was der Waechter schon holt (GET /ich) und dem Kopf der Huelle. */
	async function oeffne(ich: MitgliedIch = ICH): Promise<void> {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/mehr');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ich));
		await navigation;
		http.expectOne(`${API}/verein`).flush(VEREIN);
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;
	}

	const zeilen = () => [...seite.querySelectorAll<HTMLElement>('main .zeile')].map((e) => e.textContent?.trim());

	function zeile(text: string): HTMLElement {
		const z = [...seite.querySelectorAll<HTMLElement>('main .zeile')].find((e) => e.textContent?.includes(text));
		if (!z) throw new Error(`Zeile nicht gefunden: ${text}`);
		return z;
	}

	function abmeldeKnopf(): HTMLButtonElement {
		return zeile('Abmelden') as HTMLButtonElement;
	}

	it('zeigt in der Huelle die Ueberschrift Mehr und macht Mehr in der Leiste aktiv', async () => {
		await oeffne();

		expect(seite.querySelector('main h1')?.textContent?.trim()).toBe('Mehr');
		const mehr = [...seite.querySelectorAll('nav[aria-label="Hauptnavigation"] a')].find((a) =>
			a.textContent?.includes('Mehr'),
		);
		expect(mehr?.getAttribute('aria-current')).toBe('page');
	});

	it('zeigt einem Kind ohne Rechte und ohne Kinder Profil, Darstellung, Impressum, Datenschutz und Abmelden', async () => {
		await oeffne();

		expect(zeilen()).toEqual(['Profil', 'Impressum', 'Datenschutz', 'Abmelden']);
		expect(zeile('Profil').getAttribute('href')).toBe('/demo/profil');
		expect(seite.querySelector('main jf-thema-wahl')).not.toBeNull();
		expect(seite.textContent).toContain('Darstellung');
		expect(seite.textContent).toContain('Gilt nur auf diesem Gerät.');
		expect(seite.textContent).not.toContain('Verwaltung');
		expect(seite.textContent).not.toContain('Meine Jungfischer');
	});

	it('zeigt einer Leitung mit Kindern auch Meine Jungfischer und Verwaltung', async () => {
		await oeffne(LEITUNG);

		expect(zeilen()).toEqual(['Profil', 'Meine Jungfischer', 'Verwaltung', 'Impressum', 'Datenschutz', 'Abmelden']);
		expect(zeile('Meine Jungfischer').getAttribute('href')).toBe('/demo/meine-jungfischer');
		expect(zeile('Verwaltung').getAttribute('href')).toBe('/demo/verwaltung');
	});

	it('zeigt einer Person mit Kindern ohne Recht Meine Jungfischer, aber nicht Verwaltung', async () => {
		await oeffne({ ...ICH, person: { ...ICH.person, art: 'ERWACHSENER' }, hatKinder: true });

		expect(zeilen()).toEqual(['Profil', 'Meine Jungfischer', 'Impressum', 'Datenschutz', 'Abmelden']);
	});

	it('zeigt Verwaltung auch mit einem anderen Recht als MITGLIEDER', async () => {
		await oeffne({ ...ICH, person: { ...ICH.person, rechte: ['DOKUMENTE'] } });

		expect(zeilen()).toContain('Verwaltung');
		expect(zeilen()).not.toContain('Meine Jungfischer');
	});

	it('fuehrt Impressum und Datenschutz auf die Seiten der Plattform', async () => {
		await oeffne();

		expect(zeile('Impressum').getAttribute('href')).toBe('/impressum');
		expect(zeile('Datenschutz').getAttribute('href')).toBe('/datenschutz');
	});

	describe('Abmelden', () => {
		it('ruft abmelden und geht zur Anmeldung des Vereins', async () => {
			await oeffne();
			// Erst navigieren, dann ich leeren: Sonst verlore Mehr kurz seine Zeilen.
			let ichBeimNavigieren: unknown = null;
			const navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(async () => {
				ichBeimNavigieren = TestBed.inject(MitgliedSitzung).ich();
				return true;
			});

			abmeldeKnopf().click();
			const anfrage = http.expectOne(`${API}/abmelden`);
			expect(anfrage.request.method).toBe('POST');
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
			await stabil();

			expect(navigiert).toHaveBeenCalledWith('/demo/anmelden');
			expect(ichBeimNavigieren).not.toBeNull();
			expect(TestBed.inject(MitgliedSitzung).ich()).toBeNull();
		});

		it('bleibt bei einem Netzfehler stehen und sagt es', async () => {
			await oeffne();
			const navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

			abmeldeKnopf().click();
			http.expectOne(`${API}/abmelden`).error(new ProgressEvent('error'));
			await stabil();

			expect(navigiert).not.toHaveBeenCalled();
			expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Keine Verbindung – nochmal versuchen');
		});

		// Die Sitzung ist dann ohnehin weg; ein Fehler waere falsch, die Person wollte genau das.
		it('geht bei 401 nicht angemeldet ebenfalls zur Anmeldung, ohne Fehler und ohne weiter', async () => {
			await oeffne();
			const navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

			abmeldeKnopf().click();
			http
				.expectOne(`${API}/abmelden`)
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
			await stabil();

			expect(navigiert).toHaveBeenCalledWith('/demo/anmelden');
			expect(seite.querySelector('[role="alert"]')).toBeNull();
		});
	});
});
