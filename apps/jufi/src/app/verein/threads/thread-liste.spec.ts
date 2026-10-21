import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ThreadListe, ThreadZeile } from '@jufi/domain';
import { adminTestAnbieter, EchtzeitAttrappe, tippe } from '../../admin/test-hilfen';

const API = '/demo/api/v1';

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

const ICH = {
	person: { id: 'p-1', vorname: 'Flo', nachname: 'Muster', art: 'ERWACHSENER', rechte: [] as string[] },
	kennung: 'flo@example.org',
	passkeys: [],
	hatPasswort: true,
	hatKinder: false,
	totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

function zeile(id: string, titel: string, zusatz: Partial<ThreadZeile> = {}): ThreadZeile {
	return {
		id,
		titel,
		segment: `${id}-${titel.toLowerCase()}`,
		angepinnt: false,
		archiviert: false,
		entwurf: false,
		naechsterTermin: null,
		neu: false,
		...zusatz,
	};
}

const ZELTLAGER = zeile('t1', 'Zeltlager', { angepinnt: true, neu: true });
const BOWLING = zeile('t2', 'Bowling', { naechsterTermin: 'Sa, 7. Nov., 14:00 Uhr' });
const KEGELN = zeile('t3', 'Kegeln', { entwurf: true });
const ALT = zeile('t4', 'Bowling 2025', { archiviert: true });
const ALT2 = zeile('t5', 'Zeltlager 2025', { archiviert: true });

const GRUNDLISTE: ThreadListe = { threads: [ZELTLAGER, BOWLING, KEGELN], archiv: 2 };

describe('Thread-Liste', () => {
	let http: HttpTestingController;
	let router: Router;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(() => {
		// Die Liste ist die Seite, die die Listenanfrage der Huelle mitbenutzt; also beantwortet der Test sie selbst.
		TestBed.configureTestingModule({ providers: adminTestAnbieter({ eigeneThreadListe: true }) });
		http = TestBed.inject(HttpTestingController);
		router = TestBed.inject(Router);
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => {
		vi.useRealTimers();
		http.verify();
	});

	function text(el: Element): string {
		return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	/** Beantwortet die erste Listenanfrage der Huelle; wartet, bis sie da ist (der Effekt der Ressource schickt sie spaet). */
	async function antworteGrundliste(antwort: ThreadListe | { status: number; body: object } | 'netz'): Promise<void> {
		await vi.waitFor(() => {
			harness.detectChanges();
			const anfrage = http.expectOne(`${API}/threads`);
			if (antwort === 'netz') anfrage.error(new ProgressEvent('error'));
			else if ('status' in antwort) anfrage.flush(antwort.body, { status: antwort.status, statusText: 'Fehler' });
			else anfrage.flush(antwort);
		});
	}

	async function stabil(): Promise<void> {
		for (const kopf of http.match(`${API}/verein`)) kopf.flush(VEREIN);
		await harness.fixture.whenStable();
		harness.detectChanges();
		seite = harness.routeNativeElement as HTMLElement;
	}

	/** Waechter fragt GET /ich, die Huelle den Kopf und die Liste; danach steht die Seite. */
	async function oeffne(
		url = '/demo/threads',
		grund: ThreadListe | { status: number; body: object } | 'netz' = GRUNDLISTE,
	): Promise<void> {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(url);
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		await antworteGrundliste(grund);
		await stabil();
	}

	/** Beantwortet eine gefilterte Listenanfrage (mit Suche oder Archiv). */
	async function antworteGefiltert(
		abfrage: string,
		antwort: ThreadListe | { status: number; body: object } | 'netz',
		warten = true,
	) {
		await vi.waitFor(() => {
			harness.detectChanges();
			const anfrage = http.expectOne(`${API}/threads?${abfrage}`);
			if (antwort === 'netz') anfrage.error(new ProgressEvent('error'));
			else if ('status' in antwort) anfrage.flush(antwort.body, { status: antwort.status, statusText: 'Fehler' });
			else anfrage.flush(antwort);
		});
		// Beim ersten Aufruf der Seite stehen die Liste der Huelle und der Kopf noch offen und halten whenStable an.
		if (!warten) return;
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	function abschnitt(titel: string): HTMLElement | null {
		return (
			[...seite.querySelectorAll<HTMLElement>('jf-abschnitt')].find(
				(a) => a.querySelector('h2')?.textContent === titel,
			) ?? null
		);
	}

	function titel(el: Element): string[] {
		return [...el.querySelectorAll('li a .titel')].map((t) => text(t));
	}

	function archiv(): HTMLDetailsElement {
		return seite.querySelector('details') as HTMLDetailsElement;
	}

	/** Klappt das Archiv auf, wie es ein Tipp auf die Zusammenfassung taete: open setzt der Browser, toggle feuert er. */
	function klappeArchivAuf(): void {
		const d = archiv();
		d.open = true;
		d.dispatchEvent(new Event('toggle'));
		harness.detectChanges();
	}

	describe('Grundzustand', () => {
		it('zeigt Angepinnt und Aktiv in der Reihenfolge der Antwort und das Archiv zu', async () => {
			await oeffne();

			expect(titel(abschnitt('Angepinnt') as HTMLElement)).toEqual(['Zeltlager']);
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling', 'Kegeln · Entwurf']);
			expect(text(archiv().querySelector('summary') as HTMLElement)).toBe('Archiv · 2');
			expect(archiv().open).toBe(false);
		});

		it('laesst einen Abschnitt ohne Zeilen weg', async () => {
			await oeffne('/demo/threads', { threads: [BOWLING], archiv: 0 });

			expect(abschnitt('Angepinnt')).toBeNull();
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling']);
			expect(seite.querySelector('details')).toBeNull();
		});

		it('zeigt den Termin, den Punkt neu und den Link auf den Thread', async () => {
			await oeffne();

			const zeilen = [...seite.querySelectorAll('li a')] as HTMLAnchorElement[];
			const zelt = zeilen.find((a) => a.textContent?.includes('Zeltlager')) as HTMLAnchorElement;
			const bowling = zeilen.find((a) => a.textContent?.includes('Bowling')) as HTMLAnchorElement;
			expect(zelt.getAttribute('href')).toBe('/demo/t/t1-zeltlager');
			expect(zelt.querySelector('[aria-label="neu"]')).not.toBeNull();
			expect(zelt.textContent).not.toContain('Entwurf');
			expect(bowling.querySelector('[aria-label="neu"]')).toBeNull();
			expect(text(bowling)).toContain('Sa, 7. Nov., 14:00 Uhr');
			expect(text(zelt)).not.toContain('Uhr');
		});

		it('hat ein Suchfeld mit sichtbarer Beschriftung', async () => {
			await oeffne();

			const feld = seite.querySelector('input[type="search"]') as HTMLInputElement;
			expect(feld.labels?.[0]?.textContent).toContain('Threads durchsuchen');
			expect(feld.maxLength).toBe(100);
		});

		it('zeigt bei einer leeren Liste Noch keine Threads', async () => {
			await oeffne('/demo/threads', { threads: [], archiv: 0 });

			expect(text(seite)).toContain('Noch keine Threads.');
		});

		it('zeigt bei nur archivierten Threads das Archiv statt Noch keine Threads', async () => {
			await oeffne('/demo/threads', { threads: [], archiv: 1 });

			expect(text(seite)).not.toContain('Noch keine Threads.');
			expect(text(archiv().querySelector('summary') as HTMLElement)).toBe('Archiv · 1');
		});
	});

	describe('Archiv', () => {
		it('laedt beim Aufklappen mit archiv=1 und zeigt die archivierten Zeilen darin', async () => {
			await oeffne();
			http.expectNone(`${API}/threads?archiv=1`);

			klappeArchivAuf();
			await antworteGefiltert('archiv=1', { threads: [ZELTLAGER, BOWLING, KEGELN, ALT, ALT2], archiv: 2 });

			expect(titel(archiv())).toEqual(['Bowling 2025', 'Zeltlager 2025']);
			// Angepinnt und Aktiv bleiben, wie sie waren.
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling', 'Kegeln · Entwurf']);
		});

		it('fragt beim Zuklappen und erneuten Aufklappen nicht noch einmal', async () => {
			await oeffne();
			klappeArchivAuf();
			await antworteGefiltert('archiv=1', { threads: [ALT, ALT2], archiv: 2 });

			archiv().open = false;
			archiv().dispatchEvent(new Event('toggle'));
			harness.detectChanges();
			klappeArchivAuf();
			await harness.fixture.whenStable();

			expect(titel(archiv())).toEqual(['Bowling 2025', 'Zeltlager 2025']);
		});

		it('zeigt einen Fehler im Archiv, ohne die Liste darueber zu ersetzen, und laedt auf Knopfdruck neu', async () => {
			await oeffne();
			klappeArchivAuf();
			await antworteGefiltert('archiv=1', 'netz');

			expect(text(archiv())).toContain('Keine Verbindung – nochmal versuchen');
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling', 'Kegeln · Entwurf']);

			(archiv().querySelector('button') as HTMLButtonElement).click();
			await antworteGefiltert('archiv=1', { threads: [ALT], archiv: 1 });
			expect(titel(archiv())).toEqual(['Bowling 2025']);
		});
	});

	describe('Suche', () => {
		it('fragt nach 300 ms mit suche und archiv, schreibt die Adresse und zeigt Treffer samt Archiv', async () => {
			await oeffne();

			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			tippe(seite, 'input[type="search"]', 'bowl');
			vi.advanceTimersByTime(299);
			harness.detectChanges();
			http.expectNone((r) => r.params.has('suche'));
			vi.advanceTimersByTime(1);
			vi.useRealTimers();

			await antworteGefiltert('suche=bowl&archiv=1', { threads: [BOWLING, ALT], archiv: 1 });
			await vi.waitFor(() => expect(router.url).toBe('/demo/threads?suche=bowl'));
			await stabil();

			expect(abschnitt('Angepinnt')).toBeNull();
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling']);
			expect(text(archiv().querySelector('summary') as HTMLElement)).toBe('Archiv · 1');
			expect(archiv().open).toBe(true);
			expect(titel(archiv())).toEqual(['Bowling 2025']);
		});

		it('fasst schnelles Tippen zu einer Anfrage zusammen', async () => {
			await oeffne();

			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			tippe(seite, 'input[type="search"]', 'b');
			vi.advanceTimersByTime(200);
			tippe(seite, 'input[type="search"]', 'bo');
			vi.advanceTimersByTime(200);
			http.expectNone((r) => r.params.has('suche'));
			vi.advanceTimersByTime(100);
			vi.useRealTimers();

			await antworteGefiltert('suche=bo&archiv=1', { threads: [BOWLING], archiv: 0 });
		});

		it('zeigt Keine Treffer ohne Archiv und ohne Angepinnt', async () => {
			await oeffne();

			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			tippe(seite, 'input[type="search"]', 'xyz');
			vi.advanceTimersByTime(300);
			vi.useRealTimers();
			await antworteGefiltert('suche=xyz&archiv=1', { threads: [], archiv: 0 });

			expect(text(seite)).toContain('Keine Treffer.');
			expect(text(seite)).not.toContain('Noch keine Threads.');
			expect(seite.querySelector('details')).toBeNull();
		});

		it('geht beim Leeren des Feldes ohne neue Anfrage in den Grundzustand zurueck', async () => {
			await oeffne();
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			tippe(seite, 'input[type="search"]', 'bowl');
			vi.advanceTimersByTime(300);
			vi.useRealTimers();
			await antworteGefiltert('suche=bowl&archiv=1', { threads: [BOWLING, ALT], archiv: 1 });
			await vi.waitFor(() => expect(router.url).toBe('/demo/threads?suche=bowl'));

			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			tippe(seite, 'input[type="search"]', '');
			vi.advanceTimersByTime(300);
			vi.useRealTimers();
			await vi.waitFor(() => expect(router.url).toBe('/demo/threads'));
			await stabil();

			expect(titel(abschnitt('Angepinnt') as HTMLElement)).toEqual(['Zeltlager']);
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling', 'Kegeln · Entwurf']);
			expect(text(archiv().querySelector('summary') as HTMLElement)).toBe('Archiv · 2');
			expect(archiv().open).toBe(false);
		});

		it('behandelt nur Leerraum nicht als Suche', async () => {
			await oeffne();

			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			tippe(seite, 'input[type="search"]', '   ');
			vi.advanceTimersByTime(300);
			vi.useRealTimers();
			await harness.fixture.whenStable();

			expect(router.url).toBe('/demo/threads');
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling', 'Kegeln · Entwurf']);
		});

		it('fuellt das Feld aus der Adresse und sucht sofort', async () => {
			harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/threads?suche=zelt');
			await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
			await navigation;
			await antworteGefiltert('suche=zelt&archiv=1', { threads: [ZELTLAGER, ALT2], archiv: 1 }, false);
			await antworteGrundliste(GRUNDLISTE);
			await stabil();

			expect((seite.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('zelt');
			expect(titel(abschnitt('Angepinnt') as HTMLElement)).toEqual(['Zeltlager']);
			expect(titel(archiv())).toEqual(['Zeltlager 2025']);
		});

		it('nimmt einen wiederholten Parameter suche als keine Suche, ohne Fehler', async () => {
			const fehler = vi.spyOn(console, 'error');
			await oeffne('/demo/threads?suche=a&suche=b');

			expect((seite.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling', 'Kegeln · Entwurf']);
			expect(fehler).not.toHaveBeenCalled();
			fehler.mockRestore();
		});

		it('uebernimmt eine Aenderung der Adresse von aussen (Zurueck im Browser) ins Feld und sucht sofort', async () => {
			await oeffne();

			await harness.navigateByUrl('/demo/threads?suche=zelt');
			await antworteGefiltert('suche=zelt&archiv=1', { threads: [ZELTLAGER], archiv: 0 });

			expect((seite.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('zelt');
			expect(titel(abschnitt('Angepinnt') as HTMLElement)).toEqual(['Zeltlager']);
		});

		it('zeigt einen Fehler der Suche mit Knopf und sucht auf Knopfdruck erneut', async () => {
			await oeffne();
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			tippe(seite, 'input[type="search"]', 'bowl');
			vi.advanceTimersByTime(300);
			vi.useRealTimers();
			await antworteGefiltert('suche=bowl&archiv=1', 'netz');

			expect(text(seite)).toContain('Keine Verbindung – nochmal versuchen');
			(seite.querySelector('[role="alert"] ~ button') as HTMLButtonElement).click();
			await antworteGefiltert('suche=bowl&archiv=1', { threads: [BOWLING], archiv: 0 });
			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling']);
		});
	});

	describe('Fehler', () => {
		it('zeigt bei 404 Nicht gefunden oder keine Berechtigung', async () => {
			await oeffne('/demo/threads', { status: 404, body: { fehler: 'nicht gefunden' } });

			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
			expect(text(seite)).not.toContain('nicht gefunden');
			expect(seite.querySelector('details')).toBeNull();
		});

		it('fuehrt bei 401 zur Anmeldung und merkt sich die Seite als weiter', async () => {
			await oeffne('/demo/threads', { status: 401, body: { fehler: 'nicht angemeldet' } });

			await vi.waitFor(() => expect(router.url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fthreads'));
		});

		it('zeigt bei einem Netzfehler den Text mit Knopf und laedt auf Knopfdruck neu', async () => {
			await oeffne('/demo/threads', 'netz');

			expect(text(seite)).toContain('Keine Verbindung – nochmal versuchen');
			(seite.querySelector('button.knopf') as HTMLButtonElement).click();
			await antworteGrundliste(GRUNDLISTE);
			harness.detectChanges();

			expect(titel(abschnitt('Aktiv') as HTMLElement)).toEqual(['Bowling', 'Kegeln · Entwurf']);
		});
	});

	describe('Echtzeit', () => {
		it('laedt bei offenem Archiv nach einem Ereignis auch die Archivzeilen neu', async () => {
			await oeffne();
			klappeArchivAuf();
			await antworteGefiltert('archiv=1', { threads: [ALT], archiv: 1 });

			TestBed.inject(EchtzeitAttrappe).quelle.next({ typ: 'alles' });
			// Die Grundliste laedt die Huelle neu (ThreadUebersicht), das Archiv die Seite.
			await antworteGrundliste(GRUNDLISTE);
			await antworteGefiltert('archiv=1', { threads: [ALT, ALT2], archiv: 2 });

			expect(titel(archiv())).toEqual(['Bowling 2025', 'Zeltlager 2025']);
		});

		it('laedt mit einer Suche nach einem Ereignis die Treffer neu', async () => {
			harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/threads?suche=bowl');
			await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
			await navigation;
			await antworteGefiltert('suche=bowl&archiv=1', { threads: [BOWLING], archiv: 0 }, false);
			await antworteGrundliste(GRUNDLISTE);
			await stabil();

			TestBed.inject(EchtzeitAttrappe).quelle.next({
				typ: 'signal',
				signal: { stand: 43, threadId: 't4', art: 'THREAD', objektId: 't4' },
			});
			await antworteGrundliste(GRUNDLISTE);
			await antworteGefiltert('suche=bowl&archiv=1', { threads: [BOWLING, ALT], archiv: 1 });

			expect(titel(archiv())).toEqual(['Bowling 2025']);
		});

		it('fragt ohne Suche und ohne Archiv nur die Liste der Huelle', async () => {
			await oeffne();

			TestBed.inject(EchtzeitAttrappe).quelle.next({ typ: 'alles' });
			await antworteGrundliste(GRUNDLISTE);
			await new Promise((r) => setTimeout(r, 300));
			await stabil();

			http.expectNone((r) => r.params.has('archiv'));
		});
	});
});
