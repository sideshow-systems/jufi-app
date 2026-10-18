import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { VereinKontext } from './verein-kontext';

@Component({ selector: 'jf-leer', changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class LeerComponent {}

const DEMO = {
	slug: 'demo',
	anzeigename: 'Jungfischer Demo',
	farbe: '#1d4ed8',
	hatLogo: true,
	logoStand: '2026-10-18T10:00:00.000Z',
};
const ANDERER = { ...DEMO, slug: 'anderer', anzeigename: 'Anderer Verein', hatLogo: false, logoStand: null };

const KOPF = '[data-jufi-verein]';

describe('VereinKontext', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let kontext: VereinKontext;

	beforeEach(async () => {
		TestBed.configureTestingModule({
			providers: [
				provideRouter([{ path: '**', component: LeerComponent }]),
				provideHttpClient(withFetch()),
				provideHttpClientTesting(),
			],
		});
		http = TestBed.inject(HttpTestingController);
		document.documentElement.removeAttribute('style');
		document.title = 'JuFi App';
		document.head.querySelectorAll(KOPF).forEach((e) => e.remove());
		// Wie App beim Start: der Kontext lebt vor der ersten Navigation.
		kontext = TestBed.inject(VereinKontext);
		harness = await RouterTestingHarness.create();
	});

	afterEach(() => {
		http.verify();
		document.head.querySelectorAll(KOPF).forEach((e) => e.remove());
	});

	async function setzeAb(): Promise<void> {
		await harness.fixture.whenStable();
		TestBed.tick();
	}

	/** Navigiert, beantwortet GET /verein und laesst die Effekte laufen. */
	async function gehe(url: string, antwort: object, slug: string): Promise<void> {
		await harness.navigateByUrl(url);
		await vi.waitFor(() => http.expectOne(`/${slug}/api/v1/verein`).flush(antwort));
		await setzeAb();
	}

	/** Navigiert auf eine Seite, die keinen Verein hat; es darf keine Anfrage entstehen. */
	async function gehePlattform(url: string): Promise<void> {
		await harness.navigateByUrl(url);
		await setzeAb();
		http.expectNone((a) => a.url.endsWith('/verein'));
	}

	function kopfElemente(): Element[] {
		return [...document.head.querySelectorAll(KOPF)];
	}

	function link(rel: string): string | null | undefined {
		return document.head.querySelector(`link[rel="${rel}"]${KOPF}`)?.getAttribute('href');
	}

	function themeColor(): string | null | undefined {
		return document.head.querySelector(`meta[name="theme-color"]${KOPF}`)?.getAttribute('content');
	}

	it('setzt Farbe, Titel und Kopf-Links, sobald der Verein geladen ist', async () => {
		await gehe('/demo/profil', DEMO, 'demo');

		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).not.toBe('');
		expect(document.title).toBe('Jungfischer Demo');
		expect(link('manifest')).toBe('/demo/manifest.webmanifest');
		expect(link('apple-touch-icon')).toBe('/demo/icon-192.png?v=2026-10-18T10%3A00%3A00.000Z');
		expect(themeColor()).toMatch(/^#[0-9a-f]{6}$/i);
		expect(kontext.slug()).toBe('demo');
		expect(kontext.ladefehler()).toBe(false);
	});

	it('laesst das Icon ohne Logo unversioniert und meldet keine Logo-Adresse', async () => {
		await gehe('/anderer', ANDERER, 'anderer');

		expect(link('apple-touch-icon')).toBe('/anderer/icon-192.png');
		expect(kontext.logoUrl()).toBeNull();
	});

	it('logoUrl zeigt auf das Logo des Vereins und traegt den Stand', async () => {
		await gehe('/demo', DEMO, 'demo');

		expect(kontext.logoUrl()).toBe('/demo/api/v1/verein/logo?v=2026-10-18T10%3A00%3A00.000Z');
	});

	it('wechselt mit der URL den Verein: neue Anfrage, Links zeigen auf den neuen Slug', async () => {
		await gehe('/demo', DEMO, 'demo');
		await gehe('/anderer', ANDERER, 'anderer');

		expect(link('manifest')).toBe('/anderer/manifest.webmanifest');
		expect(document.title).toBe('Anderer Verein');
		// Nichts vom vorigen Verein bleibt doppelt stehen.
		expect(kopfElemente()).toHaveLength(3);
	});

	it.each([
		['der Plattform', '/'],
		['dem Admin-Bereich', '/admin/anmelden'],
	])('raeumt beim Wechsel zu %s alles weg', async (_name, ziel) => {
		await gehe('/demo', DEMO, 'demo');
		expect(kopfElemente()).toHaveLength(3);

		await gehePlattform(ziel);

		expect(kopfElemente()).toHaveLength(0);
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');
		expect(document.title).toBe('JuFi App');
		expect(kontext.slug()).toBeNull();
		expect(kontext.verein()).toBeUndefined();
	});

	it('raeumt bei einem unbekannten Verein (404) alles weg', async () => {
		await gehe('/demo', DEMO, 'demo');
		await harness.navigateByUrl('/gibtsnicht');
		await vi.waitFor(() =>
			http
				.expectOne('/gibtsnicht/api/v1/verein')
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
		);
		await setzeAb();

		expect(kontext.verein()).toBe('nicht-gefunden');
		expect(kopfElemente()).toHaveLength(0);
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');
		expect(document.title).toBe('JuFi App');
	});

	it('meldet einen Ladefehler und setzt nichts', async () => {
		await harness.navigateByUrl('/demo');
		await vi.waitFor(() => http.expectOne('/demo/api/v1/verein').error(new ProgressEvent('error')));
		await setzeAb();

		expect(kontext.ladefehler()).toBe(true);
		expect(kontext.verein()).toBeUndefined();
		expect(kopfElemente()).toHaveLength(0);
	});

	it('schickt beim Wechsel innerhalb desselben Vereins keine zweite Anfrage', async () => {
		await gehe('/demo/profil', DEMO, 'demo');

		await harness.navigateByUrl('/demo/mehr');
		await setzeAb();

		http.expectNone('/demo/api/v1/verein');
		expect(document.title).toBe('Jungfischer Demo');
		expect(kopfElemente()).toHaveLength(3);
	});

	it('neuLaden schickt genau eine neue Anfrage und uebernimmt die neuen Werte', async () => {
		await gehe('/demo', DEMO, 'demo');

		kontext.neuLaden();
		// Kein whenStable vor der Antwort: die offene Anfrage haelt die Anwendung absichtlich instabil.
		TestBed.tick();
		await vi.waitFor(() => http.expectOne('/demo/api/v1/verein').flush({ ...DEMO, anzeigename: 'Umbenannt' }));
		await setzeAb();

		expect(document.title).toBe('Umbenannt');
		expect(kopfElemente()).toHaveLength(3);
	});

	it('nimmt eine Adresse mit Query und Fragment nur als Slug', async () => {
		await gehe('/demo/anmelden?weiter=%2Fdemo%2Fprofil#x', DEMO, 'demo');

		expect(kontext.slug()).toBe('demo');
		expect(TestBed.inject(Router).url).toContain('?weiter=');
	});
});
