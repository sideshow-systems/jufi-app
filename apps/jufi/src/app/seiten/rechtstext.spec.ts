import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { marked } from 'marked';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter } from '../admin/test-hilfen';
import { VereinKontext } from '../verein/verein-kontext';

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

describe('Rechtstexte', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;

	beforeEach(async () => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
		document.documentElement.removeAttribute('style');
		document.title = 'JuFi App';
		// Wie App beim Start: der Kontext lebt vor der ersten Navigation.
		TestBed.inject(VereinKontext);
		harness = await RouterTestingHarness.create();
	});

	afterEach(() => {
		http.verify();
		vi.restoreAllMocks();
	});

	/** Der Text wird nachgeladen; vi.waitFor wartet auf das Ende, statt eine feste Zeit zu raten. */
	async function oeffne(url: string): Promise<HTMLElement> {
		await harness.navigateByUrl(url);
		const seite = harness.routeNativeElement as HTMLElement;
		await vi.waitFor(() => {
			harness.detectChanges();
			expect(seite.querySelector('h1')).not.toBeNull();
		});
		return seite;
	}

	it.each([
		['/impressum', 'Impressum'],
		['/datenschutz', 'Datenschutzerklärung'],
	])('%s zeigt die Ueberschrift aus dem Markdown', async (url, titel) => {
		const seite = await oeffne(url);

		expect(seite.querySelector('h1')?.textContent).toBe(titel);
		expect(seite.querySelectorAll('h2').length).toBeGreaterThan(2);
		http.expectNone(() => true);
	});

	it('rendert das Markdown ohne Rohtext', async () => {
		const seite = await oeffne('/impressum');

		expect(seite.textContent).not.toContain('##');
	});

	// marked wird ersetzt, weil das echte Markdown nichts Gefaehrliches enthaelt und der Test sonst nichts belegte.
	it('saeubert Ereignisattribute und javascript-Adressen aus dem Text', async () => {
		vi.spyOn(marked, 'parse').mockReturnValue(
			'<h1>Impressum</h1><img src="x" onerror="window.boese = 1"><a href="javascript:window.boese = 1">Link</a><script>window.boese = 1</script>',
		);
		const seite = await oeffne('/impressum');

		expect(seite.querySelector('img')?.hasAttribute('onerror')).toBe(false);
		expect(seite.querySelector('a[href^="javascript"]')).toBeNull();
		expect(seite.querySelector('article script')).toBeNull();
		expect(seite.querySelector('article h1')?.textContent).toBe('Impressum');
	});

	// Zwei echte Navigationen statt eines gemockten history.length: Ein Direktaufruf hat dort schon zwei Eintraege.
	it('zeigt beim Direktaufruf den Link zur Plattform statt Zurueck', async () => {
		const seite = await oeffne('/impressum');

		const link = [...seite.querySelectorAll('a')].find((a) => a.textContent?.includes('JuFi App'));
		expect(link?.getAttribute('href')).toBe('/');
		expect(seite.querySelector('button')).toBeNull();
	});

	it('zeigt nach einer Navigation der App Zurueck und geht einen Schritt zurueck', async () => {
		const zurueck = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
		await harness.navigateByUrl('/');
		const seite = await oeffne('/datenschutz');

		const knopf = [...seite.querySelectorAll('button')].find((b) => b.textContent?.includes('Zurück'));
		knopf?.click();

		expect(knopf).toBeDefined();
		expect(seite.querySelector('a[href="/"]')).toBeNull();
		expect(zurueck).toHaveBeenCalledOnce();
	});

	it('blendet den Pfeil im Knopf fuer Screenreader aus', async () => {
		await harness.navigateByUrl('/');
		const seite = await oeffne('/impressum');

		expect(seite.querySelector('.zurueck jf-icon svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('zeigt beim Laden eine Anzeige', async () => {
		await harness.navigateByUrl('/impressum');
		harness.detectChanges();
		const seite = harness.routeNativeElement as HTMLElement;

		expect(seite.querySelector('[role="status"]')?.textContent).toContain('geladen');
		await vi.waitFor(() => {
			harness.detectChanges();
			expect(seite.querySelector('article')).not.toBeNull();
		});
		expect(seite.querySelector('[role="status"]')).toBeNull();
	});

	// Nach einem Deployment gibt es den Chunk des Textes oder von marked nicht mehr.
	it('meldet einen Ladefehler und bietet an, die Seite neu zu laden', async () => {
		vi.spyOn(marked, 'parse').mockImplementation(() => {
			throw new Error('Chunk nicht gefunden');
		});
		await harness.navigateByUrl('/datenschutz');
		const seite = harness.routeNativeElement as HTMLElement;
		await vi.waitFor(() => {
			harness.detectChanges();
			expect(seite.querySelector('[role="alert"]')).not.toBeNull();
		});

		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('nicht geladen');
		expect(seite.querySelector('article')).toBeNull();
		const neuLaden = [...seite.querySelectorAll('a')].find((a) => a.textContent?.includes('Neu laden'));
		// href statt routerLink: voller Seitenaufruf.
		expect(neuLaden?.getAttribute('href')).toBe('/datenschutz');
	});

	it.each([
		['/impressum', 'Impressum – JuFi App'],
		['/datenschutz', 'Datenschutz – JuFi App'],
	])('%s setzt den Seitentitel', async (url, titel) => {
		await oeffne(url);
		TestBed.tick();

		expect(document.title).toBe(titel);
	});

	it('stellt den Standardtitel wieder her, wenn die Seite verlassen wird', async () => {
		await oeffne('/impressum');
		TestBed.tick();
		await harness.navigateByUrl('/');
		TestBed.tick();

		expect(document.title).toBe('JuFi App');
	});

	// Deckt Review Focus 5: Die Rechtstexte liegen ausserhalb des Vereins, aber man erreicht sie aus ihm.
	it('entfernt beim Wechsel von /demo nach /impressum die Vereinsfarbe und die Kopf-Links und behaelt den eigenen Titel', async () => {
		const navigation = harness.navigateByUrl('/demo/zugang-verloren');
		await vi.waitFor(() => http.expectOne('/demo/api/v1/verein').flush(VEREIN));
		await navigation;
		await harness.fixture.whenStable();
		TestBed.tick();
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).not.toBe('');
		expect(document.title).toBe('Jungfischer Demo');
		expect(document.head.querySelectorAll('[data-jufi-verein]')).toHaveLength(3);

		await oeffne('/impressum');
		await harness.fixture.whenStable();
		TestBed.tick();

		expect(TestBed.inject(Router).url).toBe('/impressum');
		expect(document.documentElement.style.getPropertyValue('--akzent-hell')).toBe('');
		// Der Titel der Seite gewinnt gegen das Aufraeumen des Vereins, in welcher Reihenfolge die Effekte auch laufen.
		expect(document.title).toBe('Impressum – JuFi App');
		expect(document.head.querySelectorAll('[data-jufi-verein]')).toHaveLength(0);
	});
});
