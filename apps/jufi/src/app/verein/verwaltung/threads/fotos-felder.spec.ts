import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import type { Feldfehler, MedienZahl, ModulEntwurf } from '@jufi/domain';
import { HochladenFeldComponent } from '../../hochladen-feld';
import { FotosFelderComponent } from './fotos-felder';

type Fotos = Extract<ModulEntwurf, { typ: 'FOTOS' }>;

const modul = (rest: Partial<Fotos> = {}): Fotos => ({
	typ: 'FOTOS',
	id: 'm-fotos',
	titel: null,
	hochladen: 'JUGENDLEITER',
	...rest,
});

beforeEach(() =>
	TestBed.configureTestingModule({
		providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
	}),
);

function zeige(m: Fotos, zahl: MedienZahl | null = null, fehler: Feldfehler[] = []) {
	const fixture = TestBed.createComponent(FotosFelderComponent);
	fixture.componentRef.setInput('modul', m);
	fixture.componentRef.setInput('slug', 'demo');
	fixture.componentRef.setInput('zahl', zahl);
	fixture.componentRef.setInput('fehler', fehler);
	fixture.detectChanges();
	const gemeldet: ModulEntwurf[] = [];
	fixture.componentInstance.aendern.subscribe((x) => gemeldet.push(x));
	const hochgeladen = vi.fn();
	fixture.componentInstance.hochgeladen.subscribe(hochgeladen);
	const el = fixture.nativeElement as HTMLElement;
	const text = () => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
	return { fixture, el, gemeldet, hochgeladen, text };
}

describe('jf-fotos-felder', () => {
	it('meldet den Titel als neues Modul, leer als null', () => {
		const { el, gemeldet } = zeige(modul({ titel: 'Zelt' }));
		const feld = el.querySelector<HTMLInputElement>('input[name="titel"]')!;
		expect(feld.value).toBe('Zelt');

		feld.value = 'Fischerfest';
		feld.dispatchEvent(new Event('input'));
		feld.value = '';
		feld.dispatchEvent(new Event('input'));

		expect(gemeldet).toEqual([modul({ titel: 'Fischerfest' }), modul({ titel: null })]);
	});

	it('zeigt den Schalter fuer Fotos von allen Lesern, aus bei JUGENDLEITER, mit dem Satz dazu', () => {
		const { el, text } = zeige(modul());
		const haken = el.querySelector<HTMLInputElement>('label.haken input[type="checkbox"][name="hochladen"]')!;

		expect(haken.checked).toBe(false);
		expect(text()).toContain('Alle Leser dürfen Fotos hochladen');
		expect(text()).toContain('Sonst nur, wer den Thread bearbeiten darf.');
		const hinweis = el.querySelector(`#${haken.getAttribute('aria-describedby')}`);
		expect(hinweis?.textContent).toContain('Sonst nur, wer den Thread bearbeiten darf.');
	});

	it('der Schalter wechselt zwischen ALLE und JUGENDLEITER', () => {
		const { el, gemeldet } = zeige(modul());
		const haken = el.querySelector<HTMLInputElement>('input[name="hochladen"]')!;

		haken.click();
		haken.click();

		expect(gemeldet.map((m) => (m as Fotos).hochladen)).toEqual(['ALLE', 'JUGENDLEITER']);
	});

	it('steht bei ALLE angehakt', () => {
		const { el } = zeige(modul({ hochladen: 'ALLE' }));
		expect(el.querySelector<HTMLInputElement>('input[name="hochladen"]')?.checked).toBe(true);
	});

	it('ungespeichert: nur der Satz Erst speichern, dann hochladen, kein Upload-Feld', () => {
		const { el, text } = zeige(modul({ id: null }));

		expect(text()).toContain('Erst speichern, dann hochladen');
		expect(el.querySelector('jf-hochladen-feld')).toBeNull();
	});

	it('gespeichert: die Zahl und ein Upload-Feld auf die Adresse des Moduls', () => {
		const { fixture, el, text } = zeige(modul(), { fotos: 23, dateien: 0, personen: 5 });
		const feld = fixture.debugElement.query(By.directive(HochladenFeldComponent)).componentInstance;

		expect(text()).toContain('23 Fotos');
		expect(text()).not.toContain('Erst speichern');
		expect(feld.ziel()).toBe('/demo/api/v1/module/m-fotos/fotos');
		expect(feld.slug()).toBe('demo');
		expect(feld.art()).toBe('FOTO');
		expect(el.querySelector('jf-hochladen-feld input[type="file"]')).toBeTruthy();
	});

	it('nennt ein einzelnes Foto in der Einzahl und leer noch keine', () => {
		expect(zeige(modul(), { fotos: 1, dateien: 0, personen: 1 }).text()).toContain('1 Foto');
		expect(zeige(modul(), { fotos: 1, dateien: 0, personen: 1 }).text()).not.toContain('1 Fotos');
		expect(zeige(modul(), { fotos: 0, dateien: 0, personen: 0 }).text()).toContain('Noch keine Fotos.');
	});

	it('ohne bekannte Zahl steht keine Zahl da, der Upload aber schon', () => {
		const { el, text } = zeige(modul(), null);

		expect(text()).not.toMatch(/\d+ Fotos?/);
		expect(text()).not.toContain('Noch keine Fotos');
		expect(el.querySelector('jf-hochladen-feld')).toBeTruthy();
	});

	it('meldet hochgeladen, wenn das Upload-Feld einen Stapel fertig hat', () => {
		const { fixture, hochgeladen } = zeige(modul(), { fotos: 0, dateien: 0, personen: 0 });
		fixture.debugElement.query(By.directive(HochladenFeldComponent)).componentInstance.hochgeladen.emit();

		expect(hochgeladen).toHaveBeenCalledTimes(1);
	});

	it('zeigt den Fehler am Titel und markiert das Feld', () => {
		const { el } = zeige(modul(), null, [{ feld: 'module.2.titel', text: 'Der Titel ist zu lang.' }]);
		const feld = el.querySelector('input[name="titel"]')!;

		expect(feld.getAttribute('aria-invalid')).toBe('true');
		expect(el.querySelector(`#${feld.getAttribute('aria-describedby')}`)?.textContent).toContain(
			'Der Titel ist zu lang.',
		);
	});
});
