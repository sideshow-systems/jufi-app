import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
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

	it('rendert das Markdown ohne Rohtext und ohne Skripte', async () => {
		const seite = await oeffne('/impressum');

		expect(seite.textContent).not.toContain('##');
		expect(seite.querySelector('script')).toBeNull();
	});

	it('zeigt ohne Verlauf den Link zur Plattform', async () => {
		vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
		const seite = await oeffne('/impressum');

		const link = [...seite.querySelectorAll('a')].find((a) => a.textContent?.includes('JuFi App'));
		expect(link?.getAttribute('href')).toBe('/');
		expect(seite.querySelector('button')).toBeNull();
	});

	it('geht mit Verlauf einen Schritt zurueck', async () => {
		vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
		const zurueck = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
		const seite = await oeffne('/datenschutz');

		const knopf = [...seite.querySelectorAll('button')].find((b) => b.textContent?.includes('Zurück'));
		knopf?.click();

		expect(knopf).toBeDefined();
		expect(zurueck).toHaveBeenCalledOnce();
	});

	// Deckt Review Focus 5: Die Rechtstexte liegen ausserhalb des Vereins, aber man erreicht sie aus ihm.
	it('entfernt beim Wechsel von /demo nach /impressum die Vereinsfarbe, den Titel und die Kopf-Links', async () => {
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
		expect(document.title).toBe('JuFi App');
		expect(document.head.querySelectorAll('[data-jufi-verein]')).toHaveLength(0);
	});
});
