import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from '../app.routes';
import { M, T } from '../daten/beispieldaten';
import { EntwurfStore } from '../daten/store';
import { testProvider } from '../testhilfe';
import { Band } from './band';
import { TestmodusService } from './testmodus';

async function aufbauen(url: string) {
	TestBed.configureTestingModule({ providers: [provideRouter(routes), ...testProvider()] });
	await TestBed.inject(Router).navigateByUrl(url);
	const fixture = TestBed.createComponent(Band);
	fixture.detectChanges();
	const el = fixture.nativeElement as HTMLElement;
	return { fixture, el, tm: TestBed.inject(TestmodusService) };
}

describe('Band', () => {
	it('sagt Besuchern eines geteilten Links ohne Personenwahl, dass alles erfunden ist', async () => {
		const { el } = await aufbauen('/glonntal/t/2-bowling');
		expect(el.textContent).toContain('nichts hier ist echt');
		expect(el.querySelector('a')?.getAttribute('href')).toBe('/glonntal/willkommen');
	});

	it('zeigt den Hinweis weder im Einstieg noch nach der Personenwahl', async () => {
		const { fixture, el, tm } = await aufbauen('/glonntal/willkommen');
		expect(el.textContent).not.toContain('nichts hier ist echt');
		tm.waehlePerson('sandra', false);
		await TestBed.inject(Router).navigateByUrl('/glonntal/t/2-bowling');
		fixture.detectChanges();
		expect(el.textContent).not.toContain('nichts hier ist echt');
	});
});

describe('Beispieldaten', () => {
	it('fordern nur erkennbar erfundene Zahlungsdaten an', () => {
		TestBed.configureTestingModule({ providers: testProvider() });
		const kosten = TestBed.inject(EntwurfStore)
			.stand()
			.threads.find((t) => t.id === T.bowling)!
			.module.find((m) => m.id === M.bowlingKosten);
		expect(kosten?.typ === 'kosten' && kosten.paypal).toMatch(/example/);
	});
});
