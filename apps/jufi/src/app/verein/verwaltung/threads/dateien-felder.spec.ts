import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import type { Feldfehler, MedienZahl, ModulEntwurf } from '@jufi/domain';
import { HochladenFeldComponent } from '../../hochladen-feld';
import { DateienFelderComponent } from './dateien-felder';

type Dateien = Extract<ModulEntwurf, { typ: 'DATEIEN' }>;

const modul = (rest: Partial<Dateien> = {}): Dateien => ({ typ: 'DATEIEN', id: 'm-dateien', titel: null, ...rest });

beforeEach(() =>
	TestBed.configureTestingModule({
		providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
	}),
);

function zeige(m: Dateien, zahl: MedienZahl | null = null, fehler: Feldfehler[] = []) {
	const fixture = TestBed.createComponent(DateienFelderComponent);
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

describe('jf-dateien-felder', () => {
	it('meldet den Titel als neues Modul, leer als null', () => {
		const { el, gemeldet } = zeige(modul({ titel: 'Packliste' }));
		const feld = el.querySelector<HTMLInputElement>('input[name="titel"]')!;
		expect(feld.value).toBe('Packliste');

		feld.value = 'Anmeldung';
		feld.dispatchEvent(new Event('input'));
		feld.value = '';
		feld.dispatchEvent(new Event('input'));

		expect(gemeldet).toEqual([modul({ titel: 'Anmeldung' }), modul({ titel: null })]);
	});

	it('hat keinen Schalter zum Hochladen', () => {
		expect(zeige(modul()).el.querySelector('input[type="checkbox"]')).toBeNull();
	});

	it('ungespeichert: nur der Satz Erst speichern, dann hochladen, kein Upload-Feld', () => {
		const { el, text } = zeige(modul({ id: null }));

		expect(text()).toContain('Erst speichern, dann hochladen');
		expect(el.querySelector('jf-hochladen-feld')).toBeNull();
	});

	it('gespeichert: die Zahl und ein Upload-Feld auf die Adresse des Moduls', () => {
		const { fixture, text } = zeige(modul(), { fotos: 0, dateien: 3, personen: 0 });
		const feld = fixture.debugElement.query(By.directive(HochladenFeldComponent)).componentInstance;

		expect(text()).toContain('3 Dateien');
		expect(feld.ziel()).toBe('/demo/api/v1/module/m-dateien/dateien');
		expect(feld.art()).toBe('DATEI');
	});

	it('nennt eine einzelne Datei in der Einzahl und leer noch keine', () => {
		expect(zeige(modul(), { fotos: 0, dateien: 1, personen: 0 }).text()).toContain('1 Datei');
		expect(zeige(modul(), { fotos: 0, dateien: 1, personen: 0 }).text()).not.toContain('1 Dateien');
		expect(zeige(modul(), { fotos: 0, dateien: 0, personen: 0 }).text()).toContain('Noch keine Dateien hochgeladen.');
	});

	it('meldet hochgeladen, wenn das Upload-Feld einen Stapel fertig hat', () => {
		const { fixture, hochgeladen } = zeige(modul(), { fotos: 0, dateien: 0, personen: 0 });
		fixture.debugElement.query(By.directive(HochladenFeldComponent)).componentInstance.hochgeladen.emit();

		expect(hochgeladen).toHaveBeenCalledTimes(1);
	});

	it('zeigt den Fehler am Titel', () => {
		const { el } = zeige(modul(), null, [{ feld: 'module.0.titel', text: 'Der Titel ist zu lang.' }]);
		const feld = el.querySelector('input[name="titel"]')!;

		expect(feld.getAttribute('aria-invalid')).toBe('true');
		expect(el.querySelector(`#${feld.getAttribute('aria-describedby')}`)?.textContent).toContain(
			'Der Titel ist zu lang.',
		);
	});
});
