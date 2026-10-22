import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DateienModulAnsicht, DateiZeile } from '@jufi/domain';
import { DateienModulComponent } from './dateien-modul';

const API = '/demo/api/v1';

function zeile(id: string, name: string, typ = 'application/pdf', groesse = 1572864): DateiZeile {
	return { id, name, typ, groesse, hochgeladenAm: '2026-10-01T10:00:00.000Z' };
}

function modul(darfAendern: boolean, dateien: DateiZeile[] | null = null): DateienModulAnsicht {
	return {
		typ: 'DATEIEN',
		id: 'm1',
		titel: 'Material',
		darfAendern,
		dateien: dateien ?? [
			zeile('d1', 'Packliste.pdf'),
			zeile('d2', 'Plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 20480),
		],
	};
}

describe('jf-dateien-modul', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
		});
		http = TestBed.inject(HttpTestingController);
	});
	afterEach(() => http.verify());

	function zeige(m: DateienModulAnsicht) {
		const fixture = TestBed.createComponent(DateienModulComponent);
		fixture.componentRef.setInput('slug', 'demo');
		fixture.componentRef.setInput('modul', m);
		fixture.detectChanges();
		const el = fixture.nativeElement as HTMLElement;
		const geaendert = vi.fn();
		fixture.componentInstance.geaendert.subscribe(geaendert);
		const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
		const knopf = (wurzel: Element, t: string) =>
			[...wurzel.querySelectorAll('button')].find((b) => b.textContent?.trim() === t) as HTMLButtonElement;
		const zeilen = () => [...el.querySelectorAll<HTMLElement>('li[data-datei]')];
		return { fixture, el, geaendert, text, knopf, zeilen, an: () => fixture.detectChanges() };
	}

	async function stabil(f: ReturnType<typeof zeige>) {
		await f.fixture.whenStable();
		f.an();
	}

	it('zeigt Titel und je Datei Name, Typ-Kuerzel und Groesse', () => {
		const f = zeige(modul(false));

		expect(f.el.querySelector('h2')?.textContent).toBe('Material');
		expect(f.zeilen()).toHaveLength(2);
		expect(f.text(f.zeilen()[0])).toContain('Packliste.pdf');
		expect(f.text(f.zeilen()[0])).toContain('PDF · 1,5 MB');
		expect(f.text(f.zeilen()[1])).toContain('Word · 20 KB');
	});

	it('oeffnet PDF in neuem Tab und laedt alles andere herunter', () => {
		const f = zeige(modul(false));
		const [pdf, word] = f.zeilen().map((z) => z.querySelector('a') as HTMLAnchorElement);

		expect(pdf?.getAttribute('href')).toBe(`${API}/dateien/d1`);
		expect(pdf?.getAttribute('target')).toBe('_blank');
		expect(pdf?.getAttribute('rel')).toBe('noopener');
		expect(word?.getAttribute('href')).toBe(`${API}/dateien/d2?herunterladen=1`);
		expect(word?.hasAttribute('target')).toBe(false);
	});

	it('sagt, wenn es noch keine Dateien gibt', () => {
		const f = zeige(modul(false, []));

		expect(f.text(f.el)).toContain('Noch keine Dateien.');
	});

	it('zeigt Lesern die Liste ohne Knoepfe', () => {
		const f = zeige(modul(false));

		expect(f.el.querySelectorAll('button')).toHaveLength(0);
		expect(f.el.querySelector('input[type="file"]')).toBeNull();
	});

	it('zeigt Bearbeitern Umbenennen, Loeschen und Hochladen', () => {
		const f = zeige(modul(true));
		const erste = f.zeilen()[0] as HTMLElement;

		expect(f.knopf(erste, 'Umbenennen')).toBeDefined();
		expect(f.knopf(erste, 'Löschen')).toBeDefined();
		const feld = f.el.querySelector('jf-hochladen-feld input[type="file"]') as HTMLInputElement;
		expect(feld.getAttribute('aria-label')).toBe('Dateien hochladen');
	});

	it('loescht erst nach der Rueckfrage und meldet danach geaendert', async () => {
		const f = zeige(modul(true));
		f.knopf(f.zeilen()[0] as HTMLElement, 'Löschen').click();
		f.an();

		expect(f.text(f.el.querySelector('jf-bestaetigung'))).toContain('‚Packliste.pdf‘ löschen?');
		http.expectNone(`${API}/dateien/d1`);

		f.knopf(f.el.querySelector('jf-bestaetigung') as HTMLElement, 'Löschen').click();
		const anfrage = http.expectOne(`${API}/dateien/d1`);
		expect(anfrage.request.method).toBe('DELETE');
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
		await stabil(f);

		expect(f.geaendert).toHaveBeenCalledTimes(1);
		expect(f.el.querySelector('jf-bestaetigung')).toBeNull();
	});

	it('loescht nicht, wenn die Rueckfrage abgebrochen wird', () => {
		const f = zeige(modul(true));
		f.knopf(f.zeilen()[0] as HTMLElement, 'Löschen').click();
		f.an();

		f.knopf(f.el.querySelector('jf-bestaetigung') as HTMLElement, 'Abbrechen').click();
		f.an();

		expect(f.el.querySelector('jf-bestaetigung')).toBeNull();
		expect(f.geaendert).not.toHaveBeenCalled();
	});

	it('benennt um und meldet danach geaendert', async () => {
		const f = zeige(modul(true));
		f.knopf(f.zeilen()[0] as HTMLElement, 'Umbenennen').click();
		f.an();
		const feld = f.el.querySelector('input[name="name"]') as HTMLInputElement;
		expect(feld.value).toBe('Packliste.pdf');
		feld.value = 'Neue Packliste.pdf';
		feld.dispatchEvent(new Event('input'));

		f.knopf(f.el.querySelector('form') as HTMLElement, 'Speichern').click();
		const anfrage = http.expectOne(`${API}/dateien/d1`);
		expect(anfrage.request.method).toBe('PUT');
		expect(anfrage.request.body).toEqual({ name: 'Neue Packliste.pdf' });
		anfrage.flush(zeile('d1', 'Neue Packliste.pdf'));
		await stabil(f);

		expect(f.geaendert).toHaveBeenCalledTimes(1);
		expect(f.el.querySelector('form')).toBeNull();
	});

	it('zeigt bei 400 den Text des Servers am Feld und laesst das Feld offen', async () => {
		const f = zeige(modul(true));
		f.knopf(f.zeilen()[0] as HTMLElement, 'Umbenennen').click();
		f.an();

		f.knopf(f.el.querySelector('form') as HTMLElement, 'Speichern').click();
		http
			.expectOne(`${API}/dateien/d1`)
			.flush({ fehler: 'Der Name ist ungültig', feld: 'name' }, { status: 400, statusText: 'Bad Request' });
		await stabil(f);

		const form = f.el.querySelector('form') as HTMLElement;
		expect(f.text(form.querySelector('[role="alert"]'))).toBe('Der Name ist ungültig');
		expect(form.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
		expect(f.geaendert).not.toHaveBeenCalled();
	});

	it('bricht das Umbenennen ab', () => {
		const f = zeige(modul(true));
		f.knopf(f.zeilen()[0] as HTMLElement, 'Umbenennen').click();
		f.an();

		f.knopf(f.el.querySelector('form') as HTMLElement, 'Abbrechen').click();
		f.an();

		expect(f.el.querySelector('form')).toBeNull();
	});

	it('meldet nach einem Upload geaendert', async () => {
		const f = zeige(modul(true));
		const eingabe = f.el.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(eingabe, 'files', {
			value: [new File([new Uint8Array(5)], 'neu.pdf', { type: 'application/pdf' })],
			configurable: true,
		});
		eingabe.dispatchEvent(new Event('change'));

		const anfrage = http.expectOne(`${API}/module/m1/dateien`);
		expect(anfrage.request.method).toBe('POST');
		anfrage.flush(zeile('d3', 'neu.pdf'), { status: 201, statusText: 'Created' });
		await stabil(f);

		expect(f.geaendert).toHaveBeenCalledTimes(1);
	});
});
