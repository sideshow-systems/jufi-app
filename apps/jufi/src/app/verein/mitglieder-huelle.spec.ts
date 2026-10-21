import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ThreadListe, ThreadZeile } from '@jufi/domain';
import { adminTestAnbieter, EchtzeitAttrappe } from '../admin/test-hilfen';
import { WEB_SOCKET } from './echtzeit';
import { ThreadUebersicht } from './threads/thread-uebersicht';

const API = '/demo/api/v1';

const ICH = {
	person: { id: 'p-1', vorname: 'Anna', nachname: 'Muster', art: 'ERWACHSENER', rechte: [] },
	kennung: 'anna@example.org',
	passkeys: [],
	hatPasswort: true,
	hatKinder: true,
	totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

const LEERE_LISTE: ThreadListe = { threads: [], archiv: 0 };

/**
 * Ob die Huelle neu laden laesst, steht am Aufruf von neuLaden: Die Anfrage selbst kommt entprellt
 * 250 ms spaeter, und "keine Anfrage" sagte erst nach dieser Zeit etwas. Verworfen: echt warten
 * (zeitabhaengig) und falsche Zeitgeber, die Router und whenStable des Harness mit anhalten.
 */
const neuLadenSpion = () => vi.spyOn(ThreadUebersicht.prototype, 'neuLaden');

function zeile(neu: boolean): ThreadZeile {
	return {
		id: 't1',
		titel: 'Kegeln',
		segment: 't1-kegeln',
		angepinnt: false,
		archiviert: false,
		entwurf: false,
		naechsterTermin: null,
		neu,
	};
}

describe('Mitglieder-Huelle', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;
	let echtzeit: EchtzeitAttrappe;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter({ eigeneThreadListe: true }) });
		http = TestBed.inject(HttpTestingController);
		echtzeit = TestBed.inject(EchtzeitAttrappe);
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => {
		http.verify();
		vi.restoreAllMocks();
	});

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	/**
	 * Der Waechter fragt GET /ich, danach laedt der Kontext den Verein. Die Seiten unter
	 * der Huelle holen eigene Daten; wer eine solche Seite oeffnet, beantwortet sie in kinder.
	 * Die Huelle selbst fragt die Thread-Liste fuer den Punkt an der Leiste; liste ist ihre Antwort.
	 */
	async function oeffne(
		url: string,
		verein: object | Error = VEREIN,
		kinder: (() => Promise<void>) | undefined = url === '/demo' ? startDaten : undefined,
		liste: ThreadListe = LEERE_LISTE,
	): Promise<void> {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(url);
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		await kinder?.();
		const anfrage = http.expectOne(`${API}/verein`);
		if (verein instanceof Error) anfrage.error(new ProgressEvent('error'));
		else anfrage.flush(verein);
		await threadListe(liste);
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;
	}

	// Der Effekt der Ressource schickt die Anfrage erst im naechsten Durchlauf.
	const threadListe = (liste: ThreadListe = LEERE_LISTE) =>
		vi.waitFor(() => {
			harness.detectChanges();
			http.expectOne(`${API}/threads`).flush(liste);
		});

	// Die Startseite holt ihre Abschnitte selbst; ICH hat Kinder und keine Rechte.
	async function startDaten(): Promise<void> {
		await vi.waitFor(() => http.expectOne(`${API}/ansprechpartner`).flush({ ansprechpartner: [] }));
		await vi.waitFor(() => http.expectOne(`${API}/meine-jungfischer`).flush({ kinder: [] }));
	}

	const profilDaten = () => vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
	// Mehr laedt nichts selbst; nur der Waechter und der Kopf fragen.
	const mehrDaten = () => Promise.resolve();
	const jungfischerDaten = () => vi.waitFor(() => http.expectOne(`${API}/meine-jungfischer`).flush({ kinder: [] }));

	function leiste(): HTMLAnchorElement[] {
		return [...seite.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Hauptnavigation"] a')];
	}

	function eintrag(text: string): HTMLAnchorElement {
		const a = leiste().find((e) => e.textContent?.includes(text));
		if (!a) throw new Error(`Eintrag nicht gefunden: ${text}`);
		return a;
	}

	it('zeigt auf der Startseite vier Eintraege, und Start ist aktiv', async () => {
		await oeffne('/demo');

		expect(leiste().map((a) => a.textContent?.trim())).toEqual(['Start', 'Threads', 'Termine', 'Mehr']);
		expect(eintrag('Start').getAttribute('href')).toBe('/demo');
		expect(eintrag('Threads').getAttribute('href')).toBe('/demo/threads');
		expect(eintrag('Termine').getAttribute('href')).toBe('/demo/termine');
		expect(eintrag('Mehr').getAttribute('href')).toBe('/demo/mehr');
		expect(eintrag('Start').getAttribute('aria-current')).toBe('page');
		expect(eintrag('Mehr').hasAttribute('aria-current')).toBe(false);
	});

	it('hat die Inhalte der Seite in main, nicht in der Leiste', async () => {
		await oeffne('/demo');

		expect(seite.querySelectorAll('main').length).toBe(1);
		expect(seite.querySelector('main')?.textContent).toContain('Hallo Anna');
	});

	// Gewollt: Die Seiten holen ihre Daten selbst, ein leerer Bildschirm bis zur Antwort von /verein waere laenger.
	it('zeigt den Inhalt schon, bevor GET /verein antwortet', async () => {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		harness.detectChanges();
		seite = harness.routeNativeElement as HTMLElement;

		expect(seite.querySelector('main jf-start')).not.toBeNull();
		expect(leiste().length).toBe(4);
		expect(seite.querySelector('header .name')).toBeNull();

		await startDaten();
		http.expectOne(`${API}/verein`).flush(VEREIN);
		await threadListe();
		await stabil();
		expect(seite.querySelector('header .name')?.textContent).toContain('Jungfischer Demo');
	});

	it.each([
		['/demo/mehr', mehrDaten],
		['/demo/profil', profilDaten],
		['/demo/meine-jungfischer', jungfischerDaten],
	])('macht auf %s den Eintrag Mehr aktiv', async (url, daten) => {
		await oeffne(url, VEREIN, daten);

		expect(eintrag('Mehr').getAttribute('aria-current')).toBe('page');
		expect(eintrag('Start').hasAttribute('aria-current')).toBe(false);
	});

	it('macht auf einer Thread-Seite den Eintrag Threads aktiv', async () => {
		// Die Seite fragt den Thread; ein 404 genuegt, es geht nur um die Leiste.
		await oeffne('/demo/t/abc-x', VEREIN, () =>
			vi.waitFor(() =>
				http
					.expectOne(`${API}/threads/abc`)
					.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
			),
		);

		expect(eintrag('Threads').getAttribute('aria-current')).toBe('page');
		expect(eintrag('Start').hasAttribute('aria-current')).toBe(false);
	});

	it('zeigt an Threads einen Punkt neu, wenn eine Zeile neu ist', async () => {
		await oeffne('/demo', VEREIN, startDaten, { threads: [zeile(false), zeile(true)], archiv: 0 });

		const punkt = eintrag('Threads').querySelector('[aria-label="neu"]');
		expect(punkt).not.toBeNull();
		expect(seite.querySelectorAll('[aria-label="neu"]').length).toBe(1);
	});

	it('zeigt an Threads keinen Punkt, wenn nichts neu ist', async () => {
		await oeffne('/demo', VEREIN, startDaten, { threads: [zeile(false)], archiv: 0 });

		expect(seite.querySelector('[aria-label="neu"]')).toBeNull();
	});

	it('fragt die Thread-Liste nach einem Seitenwechsel neu, nach einer reinen Aenderung der Adresse-Parameter nicht', async () => {
		await oeffne('/demo', VEREIN, startDaten);
		const neuLaden = neuLadenSpion();

		await harness.navigateByUrl('/demo?x=1');
		harness.detectChanges();
		expect(neuLaden).not.toHaveBeenCalled();

		await harness.navigateByUrl('/demo/mehr');
		expect(neuLaden).toHaveBeenCalledTimes(1);
		await threadListe();
		await stabil();
	});

	// Entscheidung 9: Mit Verbindung kommen Aenderungen als Ereignisse, eine Navigation fragt nicht.
	it('fragt die Thread-Liste nach einem Seitenwechsel nur ohne Verbindung neu', async () => {
		// Die Navigation, die die Huelle baut, fragt nicht: Die Liste laedt mit dem Slug ohnehin.
		const neuLaden = neuLadenSpion();
		await oeffne('/demo', VEREIN, startDaten);
		expect(neuLaden).not.toHaveBeenCalled();

		echtzeit.verbunden.set(true);
		await harness.navigateByUrl('/demo/mehr');
		harness.detectChanges();
		expect(neuLaden).not.toHaveBeenCalled();

		echtzeit.verbunden.set(false);
		echtzeit.getrennt.set(true);
		const navigation = harness.navigateByUrl('/demo/meine-jungfischer');
		await jungfischerDaten();
		await navigation;
		expect(neuLaden).toHaveBeenCalledTimes(1);
		await threadListe();
		await stabil();
	});

	it('startet die Echtzeit mit dem Slug', async () => {
		await oeffne('/demo');

		expect(echtzeit.gestartet).toBe('demo');
	});

	// Die Live-Region bleibt stehen, nur ihr Text wechselt; so kuendigen Screenreader die Aenderung an.
	it('zeigt ohne Verbindung rechts im Kopf den Hinweis, mit Verbindung nicht', async () => {
		await oeffne('/demo');
		const hinweis = seite.querySelector('header [role="status"]');
		expect(hinweis).not.toBeNull();
		expect(hinweis?.textContent?.trim()).toBe('');

		echtzeit.getrennt.set(true);
		harness.detectChanges();
		expect(seite.querySelector('header [role="status"]')).toBe(hinweis);
		expect(hinweis?.textContent?.trim()).toBe('Nicht verbunden – Inhalte evtl. veraltet');

		echtzeit.getrennt.set(false);
		harness.detectChanges();
		expect(seite.querySelector('header [role="status"]')).toBe(hinweis);
		expect(hinweis?.textContent?.trim()).toBe('');
	});

	it('zeigt mit Logo das Bild aus dem Kontext statt des Abzeichens', async () => {
		await oeffne('/demo', { ...VEREIN, hatLogo: true, logoStand: '2026-10-01T10:00:00.000Z' });

		const bild = seite.querySelector<HTMLImageElement>('header img');
		expect(bild?.getAttribute('src')).toBe('/demo/api/v1/verein/logo?v=2026-10-01T10%3A00%3A00.000Z');
		expect(bild?.getAttribute('alt')).toBe('');
		expect(seite.querySelector('header .abzeichen')).toBeNull();
		expect(seite.querySelector('header')?.textContent).toContain('Jungfischer Demo');
	});

	it('zeigt ohne Logo das Abzeichen mit den Initialen', async () => {
		await oeffne('/demo');

		expect(seite.querySelector('header img')).toBeNull();
		expect(seite.querySelector('header .abzeichen')?.textContent?.trim()).toBe('JD');
		expect(seite.querySelector('header')?.textContent).toContain('Jungfischer Demo');
	});

	it('zeigt Nicht gefunden ohne Leiste wenn GET /verein mit 404 antwortet', async () => {
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		// Die Startseite ist schon da und fragt; ein 404 baut sie erst danach ab.
		await startDaten();
		http.expectOne(`${API}/verein`).flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await threadListe();
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;

		expect(seite.querySelector('jf-nicht-gefunden')).not.toBeNull();
		expect(seite.querySelector('nav')).toBeNull();
		expect(seite.querySelector('header')).toBeNull();
	});

	it('zeigt bei einem Ladefehler die Meldung mit Knopf und laedt auf Wunsch neu', async () => {
		await oeffne('/demo', new Error('netz'));

		expect(seite.textContent).toContain('Keine Verbindung – nochmal versuchen');
		expect(seite.querySelector('nav')).toBeNull();
		const knopf = [...seite.querySelectorAll('button')].find((b) => b.textContent?.includes('Nochmal versuchen'));
		expect(knopf).toBeTruthy();

		knopf?.click();
		// Der Effekt der Ressource schickt die Anfrage erst im naechsten Durchlauf.
		await vi.waitFor(() => {
			harness.detectChanges();
			http.expectOne(`${API}/verein`).flush(VEREIN);
		});
		// Mit dem Verein steht die Startseite wieder da und fragt ihre Abschnitte neu.
		await vi.waitFor(() => {
			harness.detectChanges();
			return startDaten();
		});
		await stabil();

		expect(seite.textContent).not.toContain('Keine Verbindung');
		expect(leiste().length).toBe(4);
	});

	// Entscheidung 8: Der alte Pfad wurde nie ausgeliefert, deshalb gibt es keine Weiterleitung.
	it('kennt /demo/jungfischer nicht mehr', async () => {
		harness = await RouterTestingHarness.create();
		await harness.navigateByUrl('/demo/jungfischer');
		harness.detectChanges();
		http.match(`${API}/verein`);
		http.match(`${API}/threads`);

		expect(harness.routeNativeElement?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		expect(harness.routeNativeElement?.querySelector('nav')).toBeNull();
		http.expectNone(`${API}/ich`);
	});
});

/** Der echte Dienst in der Huelle, mit einem falschen WebSocket: Die Huelle baut ihn auf und wieder ab. */
describe('Mitglieder-Huelle mit Echtzeit', () => {
	class FalscherSocket {
		static alle: FalscherSocket[] = [];
		onopen: WebSocket['onopen'] = null;
		onmessage: WebSocket['onmessage'] = null;
		onclose: WebSocket['onclose'] = null;
		geschlossenMit: number | null = null;

		constructor(readonly url: string) {
			FalscherSocket.alle.push(this);
		}

		close(code?: number): void {
			this.geschlossenMit = code ?? 1005;
		}
	}

	let http: HttpTestingController;

	beforeEach(() => {
		FalscherSocket.alle = [];
		TestBed.configureTestingModule({
			providers: [
				...adminTestAnbieter({ eigeneThreadListe: true, eigeneEchtzeit: true }),
				{ provide: WEB_SOCKET, useValue: FalscherSocket },
			],
		});
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it('verbindet sich mit dem Verein und schliesst beim Verlassen der Huelle, ohne neu zu verbinden', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/mehr');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ICH));
		await navigation;
		http.expectOne(`${API}/verein`).flush(VEREIN);
		await vi.waitFor(() => {
			harness.detectChanges();
			http.expectOne(`${API}/threads`).flush(LEERE_LISTE);
		});

		expect(FalscherSocket.alle.map((s) => s.url)).toEqual([`ws://${location.host}/demo/ws`]);

		await harness.navigateByUrl('/datenschutz');
		await harness.fixture.whenStable();

		const alt = FalscherSocket.alle[0];
		expect(alt.geschlossenMit).toBe(1000);
		// Ein spaeter Abbruch des geschlossenen Sockets loest weder Abgleich noch neuen Socket aus.
		alt.onclose?.call(alt as never, { code: 1006 } as CloseEvent);
		http.expectNone(`${API}/sync`);
		expect(FalscherSocket.alle.length).toBe(1);
	});
});
