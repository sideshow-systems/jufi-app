import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { FotosModulAnsicht, FotoZeile } from '@jufi/domain';
import { FotosModulComponent } from './fotos-modul';

const API = '/demo/api/v1';

function foto(id: string, von = 'Mia', darfLoeschen = false): FotoZeile {
	return { id, breite: 1200, hoehe: 800, von, hochgeladenAm: '2026-10-01T10:00:00.000Z', darfLoeschen };
}

function modul(ueberschreibe: Partial<FotosModulAnsicht> = {}): FotosModulAnsicht {
	return {
		typ: 'FOTOS',
		id: 'm1',
		titel: 'Zeltlager',
		hochladen: 'ALLE',
		darfHochladen: false,
		hinweis: null,
		fotos: [foto('f1', 'Mia'), foto('f2', 'Ben'), foto('f3', 'Lea')],
		...ueberschreibe,
	};
}

describe('jf-fotos-modul', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
		});
		http = TestBed.inject(HttpTestingController);
	});
	afterEach(() => http.match(() => true));

	function zeige(m: FotosModulAnsicht) {
		const fixture = TestBed.createComponent(FotosModulComponent);
		fixture.componentRef.setInput('slug', 'demo');
		fixture.componentRef.setInput('modul', m);
		fixture.detectChanges();
		const el = fixture.nativeElement as HTMLElement;
		const geaendert = vi.fn();
		fixture.componentInstance.geaendert.subscribe(geaendert);
		const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
		const kacheln = () => [...el.querySelectorAll<HTMLButtonElement>('button[data-foto]')];
		return { fixture, el, geaendert, text, kacheln, an: () => fixture.detectChanges() };
	}

	it('zeigt Titel, Vorschaubilder ueber die Vorschau-Route und die Zahl', () => {
		const f = zeige(modul());
		const bilder = [...f.el.querySelectorAll('img')];

		expect(f.el.querySelector('h2')?.textContent).toBe('Zeltlager');
		expect(bilder.map((b) => b.getAttribute('src'))).toEqual([
			`${API}/dateien/f1/vorschau`,
			`${API}/dateien/f2/vorschau`,
			`${API}/dateien/f3/vorschau`,
		]);
		expect(bilder[1]?.getAttribute('alt')).toBe('Foto von Ben');
		expect(bilder[0]?.getAttribute('loading')).toBe('lazy');
		expect(f.text(f.el)).toContain('3 Fotos');
	});

	it('nennt ein einzelnes Foto in der Einzahl', () => {
		const f = zeige(modul({ fotos: [foto('f1')] }));

		expect(f.text(f.el)).toContain('1 Foto');
		expect(f.text(f.el)).not.toContain('1 Fotos');
	});

	it('legt die Vorschaubilder in ein Raster mit drei Spalten', () => {
		const f = zeige(modul());
		const raster = f.el.querySelector('.raster') as HTMLElement;
		const spalten = getComputedStyle(raster).gridTemplateColumns;

		// jsdom rechnet repeat() nicht aus; im Browser stehen hier drei Laengen.
		expect(spalten.startsWith('repeat(3,') || spalten.split(/\s+/).length === 3).toBe(true);
	});

	it('zeigt den Hinweis mit Warnsymbol nur, wenn es einen gibt', () => {
		const ohne = zeige(modul());
		expect(ohne.el.querySelector('.hinweis')).toBeNull();

		const mit = zeige(modul({ hinweis: 'Von Mia dürfen keine Fotos gezeigt werden' }));
		const hinweis = mit.el.querySelector('.hinweis');
		expect(mit.text(hinweis)).toBe('Von Mia dürfen keine Fotos gezeigt werden');
		expect(hinweis?.querySelector('jf-icon')?.getAttribute('name')).toBe('warnung');
	});

	it('sagt, wenn es noch keine Fotos gibt', () => {
		const f = zeige(modul({ fotos: [] }));

		expect(f.text(f.el)).toContain('Noch keine Fotos.');
		expect(f.el.querySelector('.raster')).toBeNull();
	});

	it('zeigt das Upload-Feld nur, wenn die Person hochladen darf', () => {
		const leser = zeige(modul({ darfHochladen: false }));
		expect(leser.el.querySelector('input[type="file"]')).toBeNull();

		const jugendleiter = zeige(modul({ darfHochladen: true }));
		const eingabe = jugendleiter.el.querySelector('input[type="file"]') as HTMLInputElement;
		expect(eingabe.getAttribute('aria-label')).toBe('Fotos hochladen');
		expect(eingabe.getAttribute('accept')).toBe('image/*');
	});

	it('meldet geaendert, wenn der Upload fertig ist', () => {
		const f = zeige(modul({ darfHochladen: true }));
		const feld = f.fixture.debugElement.query((d) => d.name === 'jf-hochladen-feld');

		feld.componentInstance.hochgeladen.emit();

		expect(f.geaendert).toHaveBeenCalledTimes(1);
	});

	it('oeffnet beim Antippen die Grossansicht am richtigen Foto', () => {
		const f = zeige(modul());
		expect(f.el.querySelector('jf-foto-grossansicht')).toBeNull();

		f.kacheln()[1]?.click();
		f.an();

		const dialog = f.el.querySelector('[role="dialog"]');
		expect(f.text(dialog)).toContain('Foto von Ben');
		expect(f.el.querySelector('.gross')?.getAttribute('src')).toBe(`${API}/dateien/f2`);
	});

	it('schliesst die Grossansicht und gibt dem Vorschaubild den Fokus zurueck', () => {
		const f = zeige(modul());
		document.body.append(f.el);
		const kachel = f.kacheln()[2];
		kachel?.focus();
		kachel?.click();
		f.an();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		f.an();

		expect(f.el.querySelector('jf-foto-grossansicht')).toBeNull();
		expect(document.activeElement).toBe(kachel);
		f.el.remove();
	});

	it('meldet nach dem Loeschen geaendert und schliesst die Grossansicht', async () => {
		const f = zeige(modul({ fotos: [foto('f1', 'Mia', true)] }));
		f.kacheln()[0]?.click();
		f.an();
		const gross = f.el.querySelector('jf-foto-grossansicht') as HTMLElement;
		const knopf = (wurzel: Element, t: string) =>
			[...wurzel.querySelectorAll('button')].find((b) => b.textContent?.trim() === t) as HTMLButtonElement;

		knopf(gross, 'Löschen').click();
		f.an();
		knopf(f.el.querySelector('jf-bestaetigung') as Element, 'Löschen').click();
		http.expectOne({ method: 'DELETE', url: `${API}/dateien/f1` }).flush(null);
		await f.fixture.whenStable();
		f.an();

		expect(f.geaendert).toHaveBeenCalledTimes(1);
		expect(f.el.querySelector('jf-foto-grossansicht')).toBeNull();
	});
});
