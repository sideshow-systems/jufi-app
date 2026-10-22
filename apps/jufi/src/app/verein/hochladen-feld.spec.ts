import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FEHLER_TEXT } from '@jufi/domain';
import { HochladenFeldComponent } from './hochladen-feld';

const ZIEL = '/demo/api/v1/module/m1/dateien';

function datei(name: string, typ = 'application/pdf'): File {
	return new File([new Uint8Array(10)], name, { type: typ });
}

describe('jf-hochladen-feld', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
		});
		http = TestBed.inject(HttpTestingController);
		URL.createObjectURL = vi.fn(() => 'blob:test/1');
		URL.revokeObjectURL = vi.fn();
	});
	afterEach(() => http.match(() => true));

	function zeige(art: 'DATEI' | 'FOTO' = 'DATEI') {
		const fixture = TestBed.createComponent(HochladenFeldComponent);
		fixture.componentRef.setInput('slug', 'demo');
		fixture.componentRef.setInput('ziel', ZIEL);
		fixture.componentRef.setInput('art', art);
		fixture.componentRef.setInput('beschriftung', 'Dateien hochladen');
		fixture.detectChanges();
		const el = fixture.nativeElement as HTMLElement;
		const hochgeladen: unknown[] = [];
		fixture.componentInstance.hochgeladen.subscribe((a) => hochgeladen.push(a));
		return {
			fixture,
			el,
			hochgeladen,
			eingabe: el.querySelector('input[type="file"]') as HTMLInputElement,
			waehle(dateien: File[]) {
				const eingabe = el.querySelector('input[type="file"]') as HTMLInputElement;
				Object.defineProperty(eingabe, 'files', { value: dateien, configurable: true });
				eingabe.dispatchEvent(new Event('change'));
				fixture.detectChanges();
			},
		};
	}

	it('traegt den Namen am Feld und nicht am label', () => {
		const { el, eingabe } = zeige();

		expect(eingabe.getAttribute('aria-label')).toBe('Dateien hochladen');
		expect(el.querySelector('label')?.hasAttribute('aria-label')).toBe(false);
		expect(el.querySelector('label')?.textContent).toContain('Dateien hochladen');
	});

	it('erlaubt mehrere Dateien und nennt die Endungen der Dokumente', () => {
		const { eingabe } = zeige();

		expect(eingabe.multiple).toBe(true);
		expect(eingabe.accept).toBe('.pdf,.docx,.xlsx,.pptx,.odt,.ods,.jpg,.jpeg,.png');
	});

	it('nimmt bei Fotos jedes Bild an, damit iOS HEIC selbst umwandelt', () => {
		const { eingabe } = zeige('FOTO');

		expect(eingabe.accept).toBe('image/*');
	});

	it('zeigt eine laufende Datei mit Balken und eine wartende mit "Wartet" statt Balken', () => {
		const f = zeige();
		f.waehle([datei('eins.pdf'), datei('zwei.pdf')]);

		const zeilen = [...f.el.querySelectorAll('li')];
		expect(zeilen).toHaveLength(2);
		expect(zeilen[0]?.querySelector('progress')).not.toBeNull();
		expect(zeilen[0]?.textContent).not.toContain('Wartet');
		expect(zeilen[1]?.querySelector('progress')).toBeNull();
		expect(zeilen[1]?.textContent).toContain('Wartet');
		expect(f.el.querySelector('progress[value=""], progress:not([value])')).toBeNull();
		http.expectOne(ZIEL);
	});

	it('schickt die Datei an das Ziel, meldet hochgeladen mit der Antwort und raeumt die Zeile ab', () => {
		const f = zeige();
		f.waehle([datei('eins.pdf')]);

		const anfrage = http.expectOne(ZIEL);
		expect(anfrage.request.method).toBe('POST');
		anfrage.flush({ id: 'd1' }, { status: 201, statusText: 'Created' });
		f.fixture.detectChanges();

		expect(f.hochgeladen).toEqual([{ id: 'd1' }]);
		expect(f.el.querySelectorAll('li')).toHaveLength(0);
	});

	it('zeigt den Fehler mit Nochmal und Verwerfen', () => {
		const f = zeige();
		f.waehle([datei('eins.pdf')]);
		http
			.expectOne(ZIEL)
			.flush({ fehler: FEHLER_TEXT.TYP.DATEI, code: 'TYP' }, { status: 415, statusText: 'Unsupported Media Type' });
		f.fixture.detectChanges();

		const zeile = f.el.querySelector('li') as HTMLElement;
		expect(zeile.querySelector('[role="alert"]')?.textContent).toBe(FEHLER_TEXT.TYP.DATEI);
		const knopf = (t: string) =>
			[...zeile.querySelectorAll('button')].find((b) => b.textContent?.trim() === t) as HTMLButtonElement;

		knopf('Nochmal').click();
		f.fixture.detectChanges();
		http.expectOne(ZIEL).flush({}, { status: 201, statusText: 'Created' });
		f.fixture.detectChanges();
		expect(f.el.querySelectorAll('li')).toHaveLength(0);

		f.waehle([datei('zwei.pdf')]);
		http.expectOne(ZIEL).flush({ fehler: 'x', code: 'TYP' }, { status: 415, statusText: 'x' });
		f.fixture.detectChanges();
		(
			[...f.el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Verwerfen') as HTMLButtonElement
		).click();
		f.fixture.detectChanges();
		expect(f.el.querySelectorAll('li')).toHaveLength(0);
	});

	it('zeigt bei Fotos das Vorschaubild der Datei', () => {
		const f = zeige('FOTO');
		f.waehle([datei('bild.jpg', 'image/jpeg')]);

		expect(f.el.querySelector('li img')?.getAttribute('src')).toBe('blob:test/1');
		http.expectOne(ZIEL);
	});

	it('geht bei abgelaufener Sitzung zur Anmeldung, mit der Seite als weiter', async () => {
		const router = TestBed.inject(Router);
		const navigiere = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
		const f = zeige();
		f.waehle([datei('eins.pdf')]);

		http.expectOne(ZIEL).flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });

		expect(navigiere).toHaveBeenCalledTimes(1);
		expect(navigiere.mock.calls[0]?.[0]).toMatch(/^\/demo\/anmelden\?weiter=/);
	});

	it('gibt beim Abbau die Vorschauadressen frei', () => {
		const f = zeige('FOTO');
		f.waehle([datei('bild.jpg', 'image/jpeg')]);
		http.expectOne(ZIEL);

		f.fixture.destroy();

		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
	});
});
