import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { testProvider } from '../testhilfe';

async function oeffne() {
	TestBed.configureTestingModule({ providers: [provideRouter(routes), ...testProvider()] });
	const harness = await RouterTestingHarness.create('/glonntal/mehr');
	harness.detectChanges();
	return { harness, el: harness.routeNativeElement as HTMLElement };
}

const karte = (el: HTMLElement, vorname: string) =>
	[...el.querySelectorAll('jf-karte.kind')].find((k) => k.querySelector('strong')?.textContent?.startsWith(vorname))!;

describe('Mehr', () => {
	it('bietet fuer ein Kind mit Zugang einen neuen Zugang an', async () => {
		const { el } = await oeffne();
		expect(karte(el, 'Lena').querySelector('button')!.textContent!.trim()).toBe('Neuen Zugang erzeugen');
		expect(karte(el, 'Max').querySelector('button')!.textContent!.trim()).toBe('Zugang für Max erzeugen');
	});

	it('erzeugt den Einladungslink in diesen Entwurf', async () => {
		const { harness, el } = await oeffne();
		karte(el, 'Max').querySelector('button')!.click();
		harness.detectChanges();
		expect(karte(el, 'Max').querySelector('.einladung')!.textContent).toContain(
			`${location.origin}/entwurf/glonntal?einladung=max-beispiel`,
		);
	});
});
