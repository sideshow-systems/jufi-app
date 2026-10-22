import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { FotoZeile } from '@jufi/domain';
import { FotoGrossansichtComponent } from './foto-grossansicht';

const API = '/demo/api/v1';

function foto(id: string, von: string, darfLoeschen = false): FotoZeile {
	return { id, breite: 1200, hoehe: 800, von, hochgeladenAm: '2026-10-01T10:00:00.000Z', darfLoeschen };
}

const FOTOS = [foto('aaaaaaaa-1', 'Mia', true), foto('bbbbbbbb-2', 'Ben'), foto('cccccccc-3', 'Lea')];

describe('jf-foto-grossansicht', () => {
	let http: HttpTestingController;
	const angehaengt: HTMLElement[] = [];
	const navigatorVorher = { canShare: navigator.canShare, share: navigator.share };

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
		});
		http = TestBed.inject(HttpTestingController);
	});
	afterEach(() => {
		for (const e of angehaengt.splice(0)) e.remove();
		http.match(() => true);
		Object.assign(navigator, navigatorVorher);
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function zeige(index = 0, fotos: FotoZeile[] = FOTOS) {
		const fixture = TestBed.createComponent(FotoGrossansichtComponent);
		fixture.componentRef.setInput('slug', 'demo');
		fixture.componentRef.setInput('fotos', fotos);
		fixture.componentRef.setInput('index', index);
		// Im Dokument, bevor es das erste Mal zeichnet: Der Fokus beim Oeffnen setzt sich nach dem ersten Rendern.
		const el = fixture.nativeElement as HTMLElement;
		document.body.append(el);
		angehaengt.push(el);
		fixture.detectChanges();
		const schliessen = vi.fn();
		const geloescht = vi.fn();
		fixture.componentInstance.schliessen.subscribe(schliessen);
		fixture.componentInstance.geloescht.subscribe(geloescht);
		const text = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
		const knopf = (wurzel: Element, t: string) =>
			[...wurzel.querySelectorAll('button')].find((b) => b.textContent?.trim() === t) as HTMLButtonElement | undefined;
		const taste = (key: string, zusatz: KeyboardEventInit = {}) => {
			const ereignis = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...zusatz });
			document.dispatchEvent(ereignis);
			fixture.detectChanges();
			return ereignis;
		};
		const beschriftet = (t: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${t}"]`);
		const bild = () => el.querySelector('.gross')?.getAttribute('src');
		return {
			fixture,
			el,
			schliessen,
			geloescht,
			text,
			knopf,
			beschriftet,
			taste,
			bild,
			an: () => fixture.detectChanges(),
		};
	}

	// jsdom kennt PointerEvent nicht in allen Fassungen; der Handler liest nur clientX und clientY.
	function zeiger(ziel: Element, art: string, x: number, y = 0) {
		ziel.dispatchEvent(new MouseEvent(art, { clientX: x, clientY: y, bubbles: true }));
	}

	it('ist ein modaler Dialog ueber der Seite mit Bild, Namen und den Knoepfen', () => {
		const f = zeige(1);
		const dialog = f.el.querySelector('[role="dialog"]');

		expect(dialog?.getAttribute('aria-modal')).toBe('true');
		expect(f.bild()).toBe(`${API}/dateien/bbbbbbbb-2`);
		expect(f.text(dialog)).toContain('Foto von Ben');
		expect(f.el.querySelector('.gross')?.getAttribute('alt')).toBe('');
		expect(f.knopf(f.el, 'Speichern')).toBeDefined();
		expect(f.knopf(f.el, 'Schließen')).toBeDefined();
	});

	it('setzt den Fokus beim Oeffnen auf Schliessen', async () => {
		const f = zeige();
		await f.fixture.whenStable();

		expect(document.activeElement).toBe(f.knopf(f.el, 'Schließen'));
	});

	it('schliesst mit Escape und mit dem Knopf', () => {
		const f = zeige();

		f.taste('Escape');
		f.knopf(f.el, 'Schließen')?.click();

		expect(f.schliessen).toHaveBeenCalledTimes(2);
		expect(f.schliessen).toHaveBeenCalledWith('aaaaaaaa-1');
	});

	it('blaettert mit den Pfeilen und haelt an den Enden', () => {
		const f = zeige(1);

		f.taste('ArrowRight');
		expect(f.text(f.el)).toContain('Foto von Lea');
		f.taste('ArrowRight');
		expect(f.text(f.el)).toContain('Foto von Lea');
		f.taste('ArrowLeft');
		f.taste('ArrowLeft');
		f.taste('ArrowLeft');
		expect(f.text(f.el)).toContain('Foto von Mia');
		expect(f.bild()).toBe(`${API}/dateien/aaaaaaaa-1`);
	});

	it('blaettert beim Wischen um mehr als 50 px waagerecht', () => {
		const f = zeige(1);
		const flaeche = f.el.querySelector('.buehne') as Element;

		zeiger(flaeche, 'pointerdown', 300);
		zeiger(flaeche, 'pointerup', 220);
		f.an();
		expect(f.text(f.el)).toContain('Foto von Lea');

		zeiger(flaeche, 'pointerdown', 100);
		zeiger(flaeche, 'pointerup', 180);
		f.an();
		expect(f.text(f.el)).toContain('Foto von Ben');
	});

	it('blaettert nicht bei kurzem oder senkrechtem Wischen', () => {
		const f = zeige(1);
		const flaeche = f.el.querySelector('.buehne') as Element;

		zeiger(flaeche, 'pointerdown', 300, 0);
		zeiger(flaeche, 'pointerup', 260, 0);
		zeiger(flaeche, 'pointerdown', 300, 0);
		zeiger(flaeche, 'pointerup', 200, 300);
		f.an();

		expect(f.text(f.el)).toContain('Foto von Ben');
	});

	it('schliesst von selbst, wenn die Liste leer wird', () => {
		const f = zeige(0, [FOTOS[0] as FotoZeile]);

		f.fixture.componentRef.setInput('fotos', []);
		f.an();

		expect(f.schliessen).toHaveBeenCalledWith('aaaaaaaa-1');
		expect(f.el.querySelector('[role="dialog"]')).toBeNull();
	});

	it('sperrt die Seite dahinter und gibt sie beim Schliessen wieder frei', () => {
		document.body.style.overflow = 'auto';
		const f = zeige();

		expect(document.body.style.overflow).toBe('hidden');
		f.fixture.destroy();

		expect(document.body.style.overflow).toBe('auto');
		document.body.style.overflow = '';
	});

	it('blaettert mit den Knoepfen, nennt die Stelle und sperrt sie an den Enden', () => {
		const f = zeige(0);
		const zurueck = f.beschriftet('Vorheriges Foto') as HTMLButtonElement;
		const vor = f.beschriftet('Nächstes Foto') as HTMLButtonElement;
		const stelle = f.el.querySelector('.stelle');

		expect(stelle?.getAttribute('aria-live')).toBe('polite');
		expect(f.text(stelle)).toBe('1 von 3');
		expect(zurueck.disabled).toBe(true);
		expect(vor.disabled).toBe(false);

		vor.click();
		f.an();
		expect(f.text(stelle)).toBe('2 von 3');
		expect(f.text(f.el)).toContain('Foto von Ben');
		vor.click();
		f.an();
		expect(f.text(stelle)).toBe('3 von 3');
		expect(vor.disabled).toBe(true);
		expect(zurueck.disabled).toBe(false);
		zurueck.click();
		f.an();
		expect(f.text(f.el)).toContain('Foto von Ben');
	});

	it('gibt den Fokus an den Gegenknopf, wenn der eigene am Ende gesperrt wird', () => {
		const f = zeige(1);
		const zurueck = f.beschriftet('Vorheriges Foto') as HTMLButtonElement;
		const vor = f.beschriftet('Nächstes Foto') as HTMLButtonElement;
		vor.focus();

		vor.click();
		f.an();

		expect(vor.disabled).toBe(true);
		expect(document.activeElement).toBe(zurueck);
	});

	it('gibt den Fokus bei genau zwei Fotos an den Gegenknopf, der eben noch gesperrt war', () => {
		const f = zeige(0, FOTOS.slice(0, 2));
		const zurueck = f.beschriftet('Vorheriges Foto') as HTMLButtonElement;
		const vor = f.beschriftet('Nächstes Foto') as HTMLButtonElement;
		expect(zurueck.disabled).toBe(true);
		vor.focus();

		vor.click();
		f.an();

		expect(vor.disabled).toBe(true);
		expect(document.activeElement).toBe(zurueck);
	});

	it('ueberlaesst Tasten mit Alt, Strg oder Meta dem Browser', () => {
		const f = zeige(1);

		f.taste('ArrowRight', { altKey: true });
		f.taste('ArrowLeft', { ctrlKey: true });
		f.taste('Escape', { metaKey: true });

		expect(f.text(f.el)).toContain('Foto von Ben');
		expect(f.schliessen).not.toHaveBeenCalled();
	});

	it('zeigt Loeschen nur, wenn die Person es darf', () => {
		const darf = zeige(0);
		expect(darf.knopf(darf.el, 'Löschen')).toBeDefined();

		const darfNicht = zeige(1);
		expect(darfNicht.knopf(darfNicht.el, 'Löschen')).toBeUndefined();
	});

	it('loescht nach der Rueckfrage und meldet geloescht', async () => {
		const f = zeige(0);

		f.knopf(f.el, 'Löschen')?.click();
		f.an();
		expect(http.match(() => true)).toHaveLength(0);
		f.knopf(f.el.querySelector('jf-bestaetigung') as Element, 'Löschen')?.click();
		http.expectOne({ method: 'DELETE', url: `${API}/dateien/aaaaaaaa-1` }).flush(null);
		await f.fixture.whenStable();

		expect(f.geloescht).toHaveBeenCalledWith('aaaaaaaa-1');
		expect(f.schliessen).not.toHaveBeenCalled();
	});

	it('laesst Escape der Rueckfrage und schliesst die Grossansicht dabei nicht mit', () => {
		const f = zeige(0);
		f.knopf(f.el, 'Löschen')?.click();
		f.an();

		f.taste('Escape');

		expect(f.schliessen).not.toHaveBeenCalled();
		expect(f.el.querySelector('jf-bestaetigung')).toBeNull();
	});

	it('bleibt beim eigenen Foto, wenn davor eins hinzukommt', () => {
		const f = zeige(1);

		f.fixture.componentRef.setInput('fotos', [foto('neu-0000', 'Tom'), ...FOTOS]);
		f.an();

		expect(f.text(f.el)).toContain('Foto von Ben');
	});

	it('haelt Tab im Dialog: vom letzten Knopf zum ersten und mit Umschalt zurueck', () => {
		const f = zeige(1);
		const knoepfe = [...f.el.querySelectorAll<HTMLButtonElement>('[role="dialog"] button:not(:disabled)')];
		const erster = knoepfe[0] as HTMLButtonElement;
		const letzter = knoepfe[knoepfe.length - 1] as HTMLButtonElement;
		letzter.focus();

		const vor = f.taste('Tab');
		expect(vor.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(erster);

		const zurueck = f.taste('Tab', { shiftKey: true });
		expect(zurueck.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(letzter);
	});

	it('holt den Fokus in den Dialog, wenn er auf body liegt', () => {
		const f = zeige(0);
		const knoepfe = [...f.el.querySelectorAll<HTMLButtonElement>('[role="dialog"] button:not(:disabled)')];
		(document.activeElement as HTMLElement).blur();
		expect(document.activeElement).toBe(document.body);

		f.taste('Tab');
		expect(document.activeElement).toBe(knoepfe[0]);

		(document.activeElement as HTMLElement).blur();
		f.taste('Tab', { shiftKey: true });
		expect(document.activeElement).toBe(knoepfe[knoepfe.length - 1]);
	});

	it('laesst Tab innerhalb des Dialogs in Ruhe', () => {
		const f = zeige(1);
		const knoepfe = [...f.el.querySelectorAll<HTMLButtonElement>('[role="dialog"] button:not(:disabled)')];
		knoepfe[1]?.focus();

		expect(f.taste('Tab').defaultPrevented).toBe(false);
	});

	it('zeigt einen Fehler, wenn das Loeschen scheitert, und meldet nichts', async () => {
		const f = zeige(0);
		f.knopf(f.el, 'Löschen')?.click();
		f.an();
		f.knopf(f.el.querySelector('jf-bestaetigung') as Element, 'Löschen')?.click();

		http
			.expectOne({ method: 'DELETE', url: `${API}/dateien/aaaaaaaa-1` })
			.flush({ fehler: 'Das ging schief' }, { status: 500, statusText: 'Server Error' });
		await f.fixture.whenStable();
		f.an();

		expect(f.text(f.el.querySelector('[role="alert"]'))).toBe('Das ging schief');
		expect(f.geloescht).not.toHaveBeenCalled();
		expect(f.el.querySelector('jf-bestaetigung')).toBeNull();
	});

	it('meldet geloescht auch bei 404: Das Foto ist schon weg', async () => {
		const f = zeige(0);
		f.knopf(f.el, 'Löschen')?.click();
		f.an();
		f.knopf(f.el.querySelector('jf-bestaetigung') as Element, 'Löschen')?.click();

		http
			.expectOne({ method: 'DELETE', url: `${API}/dateien/aaaaaaaa-1` })
			.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await f.fixture.whenStable();

		expect(f.geloescht).toHaveBeenCalledWith('aaaaaaaa-1');
		expect(f.el.querySelector('[role="alert"]')).toBeNull();
	});

	describe('Speichern', () => {
		function antwort(bytes = new Uint8Array([1, 2, 3])) {
			return vi.fn(async () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
		}

		it('teilt die Datei foto-<id>.jpg, wenn das Geraet Dateien teilen kann', async () => {
			const fetchMock = antwort();
			vi.stubGlobal('fetch', fetchMock);
			const teilen = vi.fn(async () => undefined);
			Object.assign(navigator, { canShare: vi.fn(() => true), share: teilen });
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			await vi.waitFor(() => expect(teilen).toHaveBeenCalledTimes(1));

			expect(fetchMock).toHaveBeenCalledWith(`${API}/dateien/aaaaaaaa-1`, { credentials: 'same-origin' });
			const arg = teilen.mock.calls[0] as unknown as [{ files: File[] }];
			expect(arg[0].files).toHaveLength(1);
			expect(arg[0].files[0]?.name).toBe('foto-aaaaaaaa.jpg');
			expect(arg[0].files[0]?.type).toBe('image/jpeg');
		});

		it('nimmt ein abgebrochenes Teilen hin, ohne Fehler und ohne Herunterladen', async () => {
			vi.stubGlobal('fetch', antwort());
			const abbruch = Object.assign(new Error('weg'), { name: 'AbortError' });
			const teilen = vi.fn(async () => {
				throw abbruch;
			});
			Object.assign(navigator, { canShare: vi.fn(() => true), share: teilen });
			const klick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			await vi.waitFor(() => expect(teilen).toHaveBeenCalled());
			await f.fixture.whenStable();
			f.an();

			expect(klick).not.toHaveBeenCalled();
			expect(f.el.querySelector('[role="alert"]')).toBeNull();
		});

		it('laedt ueber einen Link mit download, wenn es kein canShare gibt', async () => {
			Object.assign(navigator, { canShare: undefined, share: undefined });
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);
			const angeklickt: HTMLAnchorElement[] = [];
			vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
				angeklickt.push(this);
			});
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			await vi.waitFor(() => expect(angeklickt).toHaveLength(1));

			expect(angeklickt[0]?.getAttribute('href')).toBe(`${API}/dateien/aaaaaaaa-1?herunterladen=1`);
			expect(angeklickt[0]?.hasAttribute('download')).toBe(true);
			expect(angeklickt[0]?.isConnected).toBe(false);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('laedt auch herunter, wenn das Geraet diese Datei nicht teilen kann', async () => {
			vi.stubGlobal('fetch', antwort());
			Object.assign(navigator, { canShare: vi.fn(() => false), share: vi.fn() });
			const angeklickt: HTMLAnchorElement[] = [];
			vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
				angeklickt.push(this);
			});
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			await vi.waitFor(() => expect(angeklickt).toHaveLength(1));

			expect(navigator.share).not.toHaveBeenCalled();
			expect(angeklickt[0]?.getAttribute('href')).toContain('herunterladen=1');
		});

		it('faellt auf den Download zurueck, wenn das Teilen mit einem anderen Fehler scheitert', async () => {
			vi.stubGlobal('fetch', antwort());
			const teilen = vi.fn(async () => {
				throw Object.assign(new Error('nicht erlaubt'), { name: 'NotAllowedError' });
			});
			Object.assign(navigator, { canShare: vi.fn(() => true), share: teilen });
			const angeklickt: HTMLAnchorElement[] = [];
			vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
				angeklickt.push(this);
			});
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			await vi.waitFor(() => expect(angeklickt).toHaveLength(1));

			expect(teilen).toHaveBeenCalledTimes(1);
			expect(angeklickt[0]?.getAttribute('href')).toBe(`${API}/dateien/aaaaaaaa-1?herunterladen=1`);
		});

		it('tut nach dem Schliessen nichts mehr, wenn der Abruf erst dann fertig wird', async () => {
			let fertig: (r: Response) => void = () => undefined;
			vi.stubGlobal(
				'fetch',
				vi.fn(() => new Promise<Response>((aufloesen) => (fertig = aufloesen))),
			);
			const teilen = vi.fn();
			Object.assign(navigator, { canShare: vi.fn(() => true), share: teilen });
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			f.fixture.destroy();
			fertig(new Response(new Uint8Array([1]), { status: 200 }));
			await new Promise((r) => setTimeout(r, 0));

			expect(teilen).not.toHaveBeenCalled();
		});

		it('geht bei abgelaufener Sitzung zur Anmeldung', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => Response.json({ fehler: 'nicht angemeldet' }, { status: 401 })),
			);
			Object.assign(navigator, { canShare: vi.fn(() => true), share: vi.fn() });
			const navigiere = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			await vi.waitFor(() => expect(navigiere).toHaveBeenCalledTimes(1));
			f.an();

			expect(String(navigiere.mock.calls[0]?.[0])).toContain('/demo/anmelden');
			expect(f.el.querySelector('[role="alert"]')).toBeNull();
		});

		it('sagt, wenn das Foto sich nicht holen laesst', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response(null, { status: 404 })),
			);
			Object.assign(navigator, { canShare: vi.fn(() => true), share: vi.fn() });
			const f = zeige(0);

			f.knopf(f.el, 'Speichern')?.click();
			await vi.waitFor(() => {
				f.an();
				expect(f.el.querySelector('[role="alert"]')).not.toBeNull();
			});

			expect(f.text(f.el.querySelector('[role="alert"]'))).toBe(
				'Das Foto ließ sich nicht holen. Bitte noch einmal versuchen.',
			);
			expect(navigator.share).not.toHaveBeenCalled();
		});
	});
});
