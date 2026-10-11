import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { testProvider } from './testhilfe';

async function oeffne(url: string): Promise<string> {
	TestBed.configureTestingModule({ providers: [provideRouter(routes), ...testProvider()] });
	const harness = await RouterTestingHarness.create(url);
	harness.detectChanges();
	return harness.routeNativeElement?.textContent ?? '';
}

describe('Mitglieder-Ansicht', () => {
	it('begruesst Sandra und zeigt, was eine Antwort braucht', async () => {
		const text = await oeffne('/glonntal');
		expect(text).toContain('Hallo Sandra');
		expect(text).toContain('Braucht deine Antwort');
		expect(text).toMatch(/Max/);
		expect(text).toContain('Als Nächstes');
		expect(text).toContain('Nächste Gruppenstunde');
	});

	it('listet nur sichtbare Threads', async () => {
		const text = await oeffne('/glonntal/threads');
		expect(text).toContain('Bowling');
		expect(text).toContain('Angepinnt');
		expect(text).not.toContain('Fischerprüfung');
		expect(text).not.toContain('Orga Jugendleiter');
	});

	it('meldet unbekannte Adressen als nicht gefunden', async () => {
		expect(await oeffne('/irgendwas')).toContain('Nicht gefunden');
	});
});
