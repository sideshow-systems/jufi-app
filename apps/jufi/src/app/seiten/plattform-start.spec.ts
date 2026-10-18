import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter } from '../admin/test-hilfen';

describe('Plattformseite', () => {
	let http: HttpTestingController;
	let seite: HTMLElement;

	beforeEach(async () => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		http = TestBed.inject(HttpTestingController);
		const harness = await RouterTestingHarness.create();
		await harness.navigateByUrl('/');
		await harness.fixture.whenStable();
		harness.detectChanges();
		seite = harness.routeNativeElement as HTMLElement;
	});

	afterEach(() => http.verify());

	it('zeigt die Ueberschrift und den Zweck der App', () => {
		expect(seite.querySelector('h1')?.textContent).toBe('JuFi App');
		expect(seite.querySelector('main')?.textContent).toContain('Einladungslink');
	});

	it('hat genau drei Links: Entwurf, Impressum und Datenschutz', () => {
		const links = [...seite.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);

		expect(links).toEqual([
			['Zum klickbaren Entwurf', '/entwurf/'],
			['Impressum', '/impressum'],
			['Datenschutz', '/datenschutz'],
		]);
	});

	// Die Plattform kennt ihre Vereine, verraet sie aber nicht: Wer einen Verein sucht, bekommt den Link von dort.
	it('zeigt keine Liste von Vereinen und fragt keinen Verein ab', () => {
		expect(seite.querySelector('ul, ol, li, table')).toBeNull();
		http.expectNone(() => true);
	});
});
