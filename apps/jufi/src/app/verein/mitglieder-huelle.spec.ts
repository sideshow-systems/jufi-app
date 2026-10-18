import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter } from '../admin/test-hilfen';

const API = '/demo/api/v1';

const ICH = {
	person: { id: 'p-1', vorname: 'Anna', nachname: 'Muster', art: 'ERWACHSENER', rechte: [] },
	kennung: 'anna@example.org',
	passkeys: [],
	hatPasswort: true,
	hatKinder: true,
	totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

describe('Mitglieder-Huelle', () => {
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

	/**
	 * Der Waechter fragt GET /ich, danach laedt der Kontext den Verein. Die Seiten unter
	 * der Huelle holen eigene Daten; wer eine solche Seite oeffnet, beantwortet sie in kinder.
	 */
	async function oeffne(url: string, verein: object | Error = VEREIN, kinder?: () => Promise<void>): Promise<void> {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(url);
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		await kinder?.();
		const anfrage = http.expectOne(`${API}/verein`);
		if (verein instanceof Error) anfrage.error(new ProgressEvent('error'));
		else anfrage.flush(verein);
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;
	}

	const profilDaten = () => vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
	const jungfischerDaten = () => vi.waitFor(() => http.expectOne(`${API}/meine-jungfischer`).flush({ kinder: [] }));

	function leiste(): HTMLAnchorElement[] {
		return [...seite.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Hauptnavigation"] a')];
	}

	function eintrag(text: string): HTMLAnchorElement {
		const a = leiste().find((e) => e.textContent?.includes(text));
		if (!a) throw new Error(`Eintrag nicht gefunden: ${text}`);
		return a;
	}

	it('zeigt auf der Startseite genau zwei Eintraege, und Start ist aktiv', async () => {
		await oeffne('/demo');

		expect(leiste().map((a) => a.textContent?.trim())).toEqual(['Start', 'Mehr']);
		expect(eintrag('Start').getAttribute('href')).toBe('/demo');
		expect(eintrag('Mehr').getAttribute('href')).toBe('/demo/mehr');
		expect(eintrag('Start').getAttribute('aria-current')).toBe('page');
		expect(eintrag('Mehr').hasAttribute('aria-current')).toBe(false);
	});

	it('hat die Inhalte der Seite in main, nicht in der Leiste', async () => {
		await oeffne('/demo');

		expect(seite.querySelectorAll('main').length).toBe(1);
		expect(seite.querySelector('main')?.textContent).toContain('Willkommen');
	});

	it.each([
		['/demo/profil', profilDaten],
		['/demo/meine-jungfischer', jungfischerDaten],
	])('macht auf %s den Eintrag Mehr aktiv', async (url, daten) => {
		await oeffne(url, VEREIN, daten);

		expect(eintrag('Mehr').getAttribute('aria-current')).toBe('page');
		expect(eintrag('Start').hasAttribute('aria-current')).toBe(false);
	});

	it('zeigt mit Logo das Bild aus dem Kontext statt des Abzeichens', async () => {
		await oeffne('/demo', { ...VEREIN, hatLogo: true, logoStand: '2026-10-01T10:00:00.000Z' });

		const bild = seite.querySelector<HTMLImageElement>('header img');
		expect(bild?.getAttribute('src')).toBe('/demo/api/v1/verein/logo?v=2026-10-01T10%3A00%3A00.000Z');
		expect(bild?.getAttribute('alt')).toBe('');
		expect(seite.querySelector('header .abzeichen')).toBeNull();
		expect(seite.querySelector('header')?.textContent).toContain('Jungfischer Demo');
	});

	it('zeigt ohne Logo das Abzeichen mit den Initialen', async () => {
		await oeffne('/demo');

		expect(seite.querySelector('header img')).toBeNull();
		expect(seite.querySelector('header .abzeichen')?.textContent?.trim()).toBe('JD');
		expect(seite.querySelector('header')?.textContent).toContain('Jungfischer Demo');
	});

	it('zeigt Nicht gefunden ohne Leiste wenn GET /verein mit 404 antwortet', async () => {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		http.expectOne(`${API}/verein`).flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;

		expect(seite.querySelector('jf-nicht-gefunden')).not.toBeNull();
		expect(seite.querySelector('nav')).toBeNull();
		expect(seite.querySelector('header')).toBeNull();
	});

	it('zeigt bei einem Ladefehler die Meldung mit Knopf und laedt auf Wunsch neu', async () => {
		await oeffne('/demo', new Error('netz'));

		expect(seite.textContent).toContain('Keine Verbindung – nochmal versuchen');
		expect(seite.querySelector('nav')).toBeNull();
		const knopf = [...seite.querySelectorAll('button')].find((b) => b.textContent?.includes('Nochmal versuchen'));
		expect(knopf).toBeTruthy();

		knopf?.click();
		// Der Effekt der Ressource schickt die Anfrage erst im naechsten Durchlauf.
		await vi.waitFor(() => {
			harness.detectChanges();
			http.expectOne(`${API}/verein`).flush(VEREIN);
		});
		await stabil();

		expect(seite.textContent).not.toContain('Keine Verbindung');
		expect(leiste().length).toBe(2);
	});

	// Entscheidung 8: Der alte Pfad wurde nie ausgeliefert, deshalb gibt es keine Weiterleitung.
	it('kennt /demo/jungfischer nicht mehr', async () => {
		harness = await RouterTestingHarness.create();
		await harness.navigateByUrl('/demo/jungfischer');
		harness.detectChanges();
		http.match(`${API}/verein`);

		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		expect(harness.routeNativeElement?.querySelector('nav')).toBeNull();
		http.expectNone(`${API}/ich`);
	});
});
