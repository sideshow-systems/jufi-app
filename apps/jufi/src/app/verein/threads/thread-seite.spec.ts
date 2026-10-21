import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
	type EchtzeitSignal,
	type ModulAnsicht,
	type ThreadAnsicht,
	threadSegment,
	type UmfrageAnsicht,
	type VerlaufAnsicht,
} from '@jufi/domain';
import { adminTestAnbieter, EchtzeitAttrappe, tippe } from '../../admin/test-hilfen';
import type { EchtzeitEreignis } from '../echtzeit';

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

const ICH = {
	person: { id: 'p-1', vorname: 'Flo', nachname: 'Muster', art: 'ERWACHSENER', rechte: [] as string[] },
	kennung: 'flo@example.org',
	passkeys: [],
	hatPasswort: true,
	hatKinder: false,
	totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
};

const MODULE: ModulAnsicht[] = [
	{ typ: 'INFO', id: 'm1', titel: 'Worum es geht', text: 'Wir gehen kegeln.' },
	{
		typ: 'TERMIN',
		id: 'm2',
		titel: 'Wann',
		termin: {
			modulId: 'm2',
			startDatum: '2026-11-07',
			endDatum: null,
			beginn: '14:00',
			ende: '17:00',
			ort: 'Bowlingcenter',
			treffpunkt: null,
		},
	},
];

const UMFRAGE: UmfrageAnsicht = {
	typ: 'UMFRAGE',
	id: 'm3',
	titel: null,
	frage: 'Kommst du mit?',
	einheit: 'JUNGFISCHER',
	mehrfach: false,
	teilnahme: true,
	frist: null,
	fristAbgelaufen: false,
	optionen: [
		{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
		{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
	],
	zeilen: [
		{ fuerId: 'k-lena', vorname: 'Lena', selbst: false, optionIds: [], eingetragenVon: null, darfAntworten: true },
	],
	ergebnis: null,
};

function thread(zusatz: Partial<ThreadAnsicht> = {}): ThreadAnsicht {
	return {
		id: 'ck1',
		titel: '🎳 Bowling',
		art: 'NORMAL',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		angepinnt: false,
		entwurf: false,
		archiviert: false,
		stand: 42,
		schreibSperre: null,
		darfBearbeiten: false,
		darfArchivieren: false,
		verlauf: { eintraege: 3, ungelesen: 2 },
		module: MODULE,
		...zusatz,
	};
}

const UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('Thread-Seite', () => {
	let http: HttpTestingController;
	let router: Router;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: adminTestAnbieter(),
		});
		http = TestBed.inject(HttpTestingController);
		router = TestBed.inject(Router);
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		http.verify();
		// jsdom kennt scrollIntoView nicht; die Tests, die es brauchen, setzen es selbst.
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
	});

	function text(seite: HTMLElement): string {
		return (seite.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	/** Beantwortet GET /threads/:id; wartet, bis die Seite fragt. */
	async function antworteThread(
		id: string,
		koerper: ThreadAnsicht | { fehler: string },
		status?: number,
	): Promise<void> {
		await vi.waitFor(() => {
			const anfrage = http.expectOne(`/demo/api/v1/threads/${id}`);
			expect(anfrage.request.method).toBe('GET');
			if (status === undefined) anfrage.flush(koerper);
			else anfrage.flush(koerper, { status, statusText: 'Fehler' });
		});
	}

	/** Quittiert PUT /threads/:id/gelesen und gibt den Koerper zurueck, den die Seite geschickt hat. */
	async function quittiereGelesen(id = 'ck1'): Promise<unknown> {
		let koerper: unknown;
		await vi.waitFor(() => {
			const anfrage = http.expectOne(`/demo/api/v1/threads/${id}/gelesen`);
			expect(anfrage.request.method).toBe('PUT');
			koerper = anfrage.request.body;
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
		});
		return koerper;
	}

	/**
	 * Beantwortet GET /threads/:id/verlauf und quittiert die Meldung des Verlaufs; gibt deren Koerper zurueck.
	 * Ohne melden bleibt es bei der Antwort (etwa im Hintergrund, wo der Verlauf nichts meldet).
	 */
	async function antworteVerlauf(id = 'ck1', eintraege: VerlaufAnsicht[] = [], melden = true): Promise<unknown> {
		await vi.waitFor(() => {
			const anfrage = http.expectOne(`/demo/api/v1/threads/${id}/verlauf`);
			expect(anfrage.request.method).toBe('GET');
			anfrage.flush({ eintraege, weitere: false });
		});
		if (!melden) return undefined;
		const url = `/demo/api/v1/threads/${id}/gelesen`;
		let koerper: unknown;
		await vi.waitFor(() => {
			const anfrage = http.expectOne(url);
			koerper = anfrage.request.body;
			anfrage.flush(null, { status: 204, statusText: 'No Content' });
		});
		return koerper;
	}

	/** Der Vereinskopf kommt zuletzt, weil seine offene Anfrage die Stabilitaet sonst aufhaelt. */
	async function beendeSeite(harness: RouterTestingHarness): Promise<void> {
		for (const kopf of http.match('/demo/api/v1/verein')) kopf.flush(VEREIN);
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	/**
	 * Die Seite liegt hinter dem Waechter: erst fragt er GET /ich, dann holt die Seite den Thread.
	 * Ohne antwort darf gar keine Thread-Anfrage kommen. gelesen sagt, ob die Seite danach
	 * den Gelesen-Stand meldet; der Koerper kommt als gemeldet zurueck.
	 */
	async function oeffne(
		url: string,
		antwort?: { id: string; koerper: ThreadAnsicht | { fehler: string }; status?: number },
		gelesen = antwort !== undefined && antwort.status === undefined,
	): Promise<{ harness: RouterTestingHarness; seite: HTMLElement; gemeldet: unknown }> {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(url);
		await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ICH));
		await navigation;
		if (antwort) await antworteThread(antwort.id, antwort.koerper, antwort.status);
		else http.expectNone((r) => r.url.includes('/threads/'));
		const gemeldet = gelesen && antwort ? await quittiereGelesen(antwort.id) : undefined;
		await beendeSeite(harness);
		return { harness, seite: harness.routeNativeElement as HTMLElement, gemeldet };
	}

	describe('Laden', () => {
		it('holt den Thread aus dem Segment, zeigt den Titel und meldet danach die Uebersicht als gelesen', async () => {
			const { seite, gemeldet } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			expect(seite.querySelector('h1')?.textContent).toBe('🎳 Bowling');
			expect(gemeldet).toEqual({ bereich: 'uebersicht', bis: 42 });
		});

		it('laedt bei einer UUID-Adresse die UUID', async () => {
			const { seite } = await oeffne(`/demo/t/${UUID}-austausch`, {
				id: UUID,
				koerper: thread({ id: UUID, titel: 'Austausch' }),
			});

			expect(seite.querySelector('h1')?.textContent).toBe('Austausch');
		});

		it('fragt bei einer Adresse ohne lesbare Id gar nicht erst und zeigt Nicht gefunden', async () => {
			const { seite } = await oeffne('/demo/t/-x');

			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
		});

		it('zeigt bei 404 denselben Text wie bei einer unlesbaren Adresse', async () => {
			const { seite } = await oeffne('/demo/t/ck9-weg', {
				id: 'ck9',
				koerper: { fehler: 'nicht gefunden' },
				status: 404,
			});

			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
			expect(seite.querySelector('[role="alert"]')).toBeNull();
		});

		it('fuehrt bei 401 zur Anmeldung und merkt sich die Seite als weiter', async () => {
			const { harness } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: { fehler: 'nicht angemeldet' },
				status: 401,
			});

			await vi.waitFor(() => expect(router.url).toBe('/demo/anmelden?weiter=%2Fdemo%2Ft%2Fck1-bowling'));
			expect(text(harness.routeNativeElement as HTMLElement)).not.toContain('nicht angemeldet');
		});

		it('zeigt andere Fehler mit Text und laedt auf Knopfdruck neu', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: { fehler: 'Unerwarteter Fehler' },
				status: 500,
			});
			expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Unerwarteter Fehler');

			const knopf = Array.from(seite.querySelectorAll('button')).find((b) =>
				b.textContent?.includes('Nochmal versuchen'),
			);
			knopf?.click();
			await antworteThread('ck1', thread());
			await quittiereGelesen();
			await harness.fixture.whenStable();
			harness.detectChanges();

			expect(seite.querySelector('h1')?.textContent).toBe('🎳 Bowling');
			expect(seite.querySelector('[role="alert"]')).toBeNull();
		});

		it('ignoriert die Antwort eines Threads, zu dem die Person schon nicht mehr will', async () => {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/t/ck1-bowling');
			await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ICH));
			await navigation;
			// Die erste Anfrage laeuft noch, wenn die Adresse wechselt.
			const alt = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1'));
			await router.navigateByUrl('/demo/t/ck2-zelten');
			await antworteThread('ck2', thread({ id: 'ck2', titel: 'Zelten' }));
			alt.flush(thread());
			await quittiereGelesen('ck2');
			await beendeSeite(harness);

			expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe('Zelten');
			http.expectNone('/demo/api/v1/threads/ck1/gelesen');
		});
	});

	describe('Adresse', () => {
		it('schreibt einen veralteten Titel im Segment um und behaelt Modul und Reiter', async () => {
			const { harness } = await oeffne(
				'/demo/t/ck1-kegeln/m/m2?reiter=verlauf',
				{ id: 'ck1', koerper: thread() },
				false,
			);
			await antworteVerlauf();
			await beendeSeite(harness);

			await vi.waitFor(() =>
				expect(router.url).toBe(`/demo/t/${threadSegment('ck1', '🎳 Bowling')}/m/m2?reiter=verlauf`),
			);
		});

		it('schreibt mit replaceUrl um und laedt dabei weder Thread noch Sitzung neu', async () => {
			const navigieren = vi.spyOn(Router.prototype, 'navigate');
			const { harness } = await oeffne('/demo/t/ck1', { id: 'ck1', koerper: thread() });
			await vi.waitFor(() => expect(router.url).toBe('/demo/t/ck1-bowling'));
			await beendeSeite(harness);

			expect(navigieren).toHaveBeenCalledTimes(1);
			expect(navigieren.mock.calls[0]?.[1]).toMatchObject({ replaceUrl: true });
			// Ein Segmentwechsel mit derselben Id ist kein neuer Thread (und kein neuer Waechterlauf).
			http.expectNone('/demo/api/v1/threads/ck1');
			http.expectNone('/demo/api/v1/ich');
		});

		it('laesst ein passendes Segment unangetastet', async () => {
			const navigieren = vi.spyOn(Router.prototype, 'navigate');
			await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			expect(navigieren).not.toHaveBeenCalled();
		});

		it('der Zurueck-Link fuehrt zur Thread-Liste des Vereins', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			const zurueck = seite.querySelector('a[aria-label^="Zurück"]');
			expect(zurueck?.getAttribute('href')).toBe('/demo/threads');
			expect(zurueck?.getAttribute('aria-label')).toBe('Zurück zur Thread-Liste');
		});
	});

	describe('Seite verlassen', () => {
		/** Oeffnet den Thread, laesst die Anfrage offen und geht auf die Mehr-Seite, bevor sie beantwortet ist. */
		async function verlasseVorAntwort(url: string): Promise<{ offen: TestRequest; harness: RouterTestingHarness }> {
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl(url);
			await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ICH));
			await navigation;
			const offen = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1'));
			await router.navigateByUrl('/demo/mehr');
			expect(router.url).toBe('/demo/mehr');
			return { offen, harness };
		}

		it('schreibt bei einer spaeten Antwort mit veraltetem Segment die Adresse nicht zurueck', async () => {
			const navigieren = vi.spyOn(Router.prototype, 'navigate');
			const { offen, harness } = await verlasseVorAntwort('/demo/t/ck1-kegeln');
			offen.flush(thread());
			await beendeSeite(harness);

			expect(router.url).toBe('/demo/mehr');
			expect(navigieren).not.toHaveBeenCalled();
			// Auch kein Gelesen-Stand fuer eine Seite, die nicht mehr da ist (afterEach prueft offene Anfragen).
		});

		it('schickt bei einem spaeten 401 nicht mit der neuen Seite als weiter zur Anmeldung', async () => {
			const { offen, harness } = await verlasseVorAntwort('/demo/t/ck1-bowling');
			offen.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
			await beendeSeite(harness);

			expect(router.url).toBe('/demo/mehr');
		});
	});

	describe('Reiter', () => {
		it('zeigt Uebersicht und Verlauf mit dem Zaehler der ungelesenen Nachrichten', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			const reiter = Array.from(seite.querySelectorAll('nav.reiter a'));
			expect(reiter.map((a) => a.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
				'Übersicht',
				'Verlauf 2 ungelesen',
			]);
			// Das Wort steht nur fuer Screenreader da; sichtbar bleibt die Zahl.
			expect(reiter[1]?.querySelector('.zahl')?.textContent?.trim()).toBe('2');
			expect(reiter[1]?.querySelector('.unsichtbar')?.textContent?.trim()).toBe('ungelesen');
			expect(reiter[0]?.getAttribute('aria-current')).toBe('page');
			expect(reiter[1]?.getAttribute('aria-current')).toBeNull();
		});

		it('zeigt keinen Zaehler ohne ungelesene Nachrichten', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ verlauf: { eintraege: 3, ungelesen: 0 } }),
			});

			expect(seite.querySelector('nav.reiter .zahl')).toBeNull();
		});

		it('zeigt bei Nur Aushang ohne Nachrichten keine Reiter', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ modus: 'AUSHANG', verlauf: { eintraege: 0, ungelesen: 0 } }),
			});

			expect(seite.querySelector('nav.reiter')).toBeNull();
		});

		it('zeigt bei Nur Aushang mit alten Nachrichten die Reiter, damit sie lesbar bleiben', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ modus: 'AUSHANG', verlauf: { eintraege: 2, ungelesen: 0 } }),
			});

			expect(seite.querySelector('nav.reiter')).not.toBeNull();
		});

		it('zeigt mit reiter=verlauf den Verlauf statt der Module und meldet die Uebersicht nicht', async () => {
			const { harness, seite } = await oeffne(
				'/demo/t/ck1-bowling?reiter=verlauf',
				{ id: 'ck1', koerper: thread() },
				false,
			);
			const gemeldet = await antworteVerlauf();
			await beendeSeite(harness);

			expect(seite.querySelector('#modul-m1')).toBeNull();
			expect(seite.querySelector('jf-verlauf#verlauf')).not.toBeNull();
			expect(seite.querySelector('nav.reiter a[aria-current="page"]')?.textContent).toContain('Verlauf');
			// Gemeldet wird der Verlauf, nicht die Uebersicht (die Person hat sie nicht gesehen).
			expect(gemeldet).toEqual({ bereich: 'verlauf', bis: 42 });
		});

		it('setzt den Zaehler am Reiter auf 0, sobald der Server den Verlauf als gelesen angenommen hat', async () => {
			const { harness, seite } = await oeffne(
				'/demo/t/ck1-bowling?reiter=verlauf',
				{ id: 'ck1', koerper: thread() },
				false,
			);
			expect(seite.querySelector('nav.reiter .zahl')?.textContent).toBe('2');
			await antworteVerlauf();
			await beendeSeite(harness);

			expect(seite.querySelector('nav.reiter .zahl')).toBeNull();
		});

		it('meldet die Uebersicht nach dem Zaehler-Zuruecksetzen nicht doppelt, wenn sie schon gemeldet war', async () => {
			const { harness } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });
			await router.navigateByUrl('/demo/t/ck1-bowling?reiter=verlauf');
			await antworteVerlauf();
			await beendeSeite(harness);
			await router.navigateByUrl('/demo/t/ck1-bowling');
			await beendeSeite(harness);
			await new Promise((r) => setTimeout(r));

			// Ein zweites PUT uebersicht waere eine offene Anfrage, und afterEach wuerde scheitern.
			http.expectNone('/demo/api/v1/threads/ck1/gelesen');
		});

		it('meldet die Uebersicht beim Wechsel vom Verlauf dorthin', async () => {
			const { harness } = await oeffne('/demo/t/ck1-bowling?reiter=verlauf', { id: 'ck1', koerper: thread() }, false);
			await antworteVerlauf();
			await router.navigateByUrl('/demo/t/ck1-bowling');
			const gemeldet = await quittiereGelesen();
			await beendeSeite(harness);

			expect(gemeldet).toEqual({ bereich: 'uebersicht', bis: 42 });
			http.expectNone('/demo/api/v1/threads/ck1');
		});

		it('faellt bei reiter=verlauf ohne Verlauf auf die Uebersicht zurueck', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling?reiter=verlauf', {
				id: 'ck1',
				koerper: thread({ modus: 'AUSHANG', verlauf: { eintraege: 0, ungelesen: 0 } }),
			});

			expect(seite.querySelector('#modul-m1')).not.toBeNull();
			expect(seite.querySelector('#verlauf')).toBeNull();
		});
	});

	describe('Module', () => {
		it('legt jedes Modul in eine Karte mit der Id modul-<id>', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			expect(seite.querySelector('jf-karte#modul-m1 jf-info-modul')).not.toBeNull();
			expect(seite.querySelector('jf-karte#modul-m2 jf-termin-modul')).not.toBeNull();
		});

		it('legt eine Umfrage in ihre Karte', async () => {
			const umfrage: ModulAnsicht = {
				typ: 'UMFRAGE',
				id: 'm3',
				titel: null,
				frage: 'Kommst du mit?',
				einheit: 'JUNGFISCHER',
				mehrfach: false,
				teilnahme: true,
				frist: null,
				fristAbgelaufen: false,
				optionen: [],
				zeilen: [],
				ergebnis: null,
			};
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread({ module: [umfrage] }) });

			expect(seite.querySelector('jf-karte#modul-m3 jf-umfrage-modul')?.textContent).toContain('Kommst du mit?');
		});

		it('scrollt bei einem Deep Link die Karte in den Blick und hebt sie hervor', async () => {
			const scrollen = vi.fn();
			Element.prototype.scrollIntoView = scrollen;
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling/m/m2', { id: 'ck1', koerper: thread() });

			await vi.waitFor(() => expect(scrollen).toHaveBeenCalledTimes(1));
			expect(scrollen.mock.contexts[0]).toBe(seite.querySelector('#modul-m2'));
			harness.detectChanges();
			expect(seite.querySelector('#modul-m2')?.classList.contains('hervor')).toBe(true);
			expect(seite.querySelector('#modul-m1')?.classList.contains('hervor')).toBe(false);
		});

		it('nimmt die Hervorhebung nach zwei Sekunden zurueck', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			try {
				Element.prototype.scrollIntoView = vi.fn();
				const { harness, seite } = await oeffne('/demo/t/ck1-bowling/m/m2', { id: 'ck1', koerper: thread() });
				await vi.waitFor(() => expect(seite.querySelector('#modul-m2')?.classList.contains('hervor')).toBe(true));
				vi.advanceTimersByTime(2000);
				harness.detectChanges();
				expect(seite.querySelector('.hervor')).toBeNull();
			} finally {
				vi.useRealTimers();
			}
		});

		it('zeigt fuer einen unbekannten Modultyp eines neueren Servers einen Hinweis statt einer leeren Karte', async () => {
			const fremd = { typ: 'FAHRT', id: 'm9', titel: 'Mitfahrt' } as unknown as ModulAnsicht;
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread({ module: [fremd] }) });

			expect(text(seite.querySelector('jf-karte#modul-m9') as HTMLElement)).toContain(
				'Dieser Inhalt lässt sich in dieser Version der App nicht anzeigen.',
			);
		});

		it('setzt nach einer Antwort die neue Umfrage ein, ohne erneut zu scrollen oder den Stand zu melden', async () => {
			const scrollen = vi.fn();
			Element.prototype.scrollIntoView = scrollen;
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling/m/m3', {
				id: 'ck1',
				koerper: thread({ module: [...MODULE, UMFRAGE] }),
			});
			await vi.waitFor(() => expect(scrollen).toHaveBeenCalledTimes(1));

			const dabei = Array.from(seite.querySelectorAll('#modul-m3 button')).find(
				(b) => b.textContent?.trim() === '✓ Dabei',
			) as HTMLButtonElement;
			dabei.click();
			const antwort = await vi.waitFor(() => http.expectOne('/demo/api/v1/umfragen/m3/antworten/k-lena'));
			antwort.flush({
				modul: { ...UMFRAGE, zeilen: [{ ...UMFRAGE.zeilen[0]!, optionIds: ['o-dabei'] }] },
				stand: 43,
			});
			await beendeSeite(harness);
			await new Promise((r) => setTimeout(r));
			harness.detectChanges();

			expect(seite.querySelector('#modul-m3 jf-pille')?.textContent?.trim()).toBe('✓ Dabei');
			expect(scrollen).toHaveBeenCalledTimes(1);
			// Ein zweites PUT gelesen waere eine offene Anfrage, und afterEach wuerde scheitern.
		});

		it('scrollt nach einem Wechsel in den Verlauf und zurueck nicht erneut', async () => {
			const scrollen = vi.fn();
			Element.prototype.scrollIntoView = scrollen;
			const { harness } = await oeffne('/demo/t/ck1-bowling/m/m2', { id: 'ck1', koerper: thread() });
			await vi.waitFor(() => expect(scrollen).toHaveBeenCalledTimes(1));

			await router.navigateByUrl('/demo/t/ck1-bowling/m/m2?reiter=verlauf');
			await antworteVerlauf();
			await beendeSeite(harness);
			expect((harness.routeNativeElement as HTMLElement).querySelector('#verlauf')).not.toBeNull();
			await router.navigateByUrl('/demo/t/ck1-bowling/m/m2');
			await beendeSeite(harness);
			await new Promise((r) => setTimeout(r));
			harness.detectChanges();

			expect(scrollen).toHaveBeenCalledTimes(1);
		});

		it('hebt nichts hervor, wenn das Modul im Thread fehlt', async () => {
			const scrollen = vi.fn();
			Element.prototype.scrollIntoView = scrollen;
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling/m/gibtsnicht', { id: 'ck1', koerper: thread() });
			await new Promise((r) => setTimeout(r));
			harness.detectChanges();

			expect(scrollen).not.toHaveBeenCalled();
			expect(seite.querySelector('.hervor')).toBeNull();
		});
	});

	describe('Marken', () => {
		it('zeigt bei einem Entwurf die Marke Entwurf', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread({ entwurf: true }) });

			expect(text(seite)).toContain('Entwurf');
			expect(text(seite)).not.toContain('Archiviert');
		});

		it('zeigt bei einem archivierten Thread die Marke Archiviert', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread({ archiviert: true }) });

			expect(text(seite)).toContain('Archiviert');
			expect(text(seite)).not.toContain('Entwurf');
		});

		it('zeigt ohne Entwurf und Archiv keine Marke', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			expect(seite.querySelector('jf-pille')).toBeNull();
		});
	});

	describe('Bearbeiten und Wiederherstellen', () => {
		const bearbeiten = (seite: HTMLElement) =>
			[...seite.querySelectorAll<HTMLAnchorElement>('header a')].find((a) => a.textContent?.includes('Bearbeiten'));
		const wiederherstellen = (seite: HTMLElement) =>
			[...seite.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Wiederherstellen'));

		it('hat Bearbeiten nur mit darfBearbeiten und fuehrt in den Editor', async () => {
			const mit = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread({ darfBearbeiten: true }) });
			expect(bearbeiten(mit.seite)?.getAttribute('href')).toBe('/demo/verwaltung/threads/ck1');
		});

		it('hat ohne darfBearbeiten kein Bearbeiten', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread({ darfArchivieren: true }) });
			expect(bearbeiten(seite)).toBeUndefined();
		});

		it('hat Wiederherstellen nur bei einem archivierten Thread und mit darfArchivieren', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ archiviert: true, darfArchivieren: true }),
			});
			expect(wiederherstellen(seite)).toBeTruthy();
		});

		it('hat Wiederherstellen nicht ohne darfArchivieren', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ archiviert: true, darfBearbeiten: true }),
			});
			expect(text(seite)).toContain('Archiviert');
			expect(wiederherstellen(seite)).toBeUndefined();
		});

		it('hat Wiederherstellen nicht bei einem Thread, der nicht archiviert ist', async () => {
			const { seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread({ darfArchivieren: true }) });
			expect(wiederherstellen(seite)).toBeUndefined();
		});

		it('stellt wieder her und laedt den Thread neu', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ archiviert: true, darfArchivieren: true }),
			});
			wiederherstellen(seite)?.click();

			await vi.waitFor(() => {
				const anfrage = http.expectOne('/demo/api/v1/threads/ck1/archiv');
				expect(anfrage.request.method).toBe('PUT');
				expect(anfrage.request.body).toEqual({ archiviert: false });
				anfrage.flush({});
			});
			await antworteThread('ck1', thread({ darfArchivieren: true }));
			await quittiereGelesen();
			await beendeSeite(harness);

			expect(text(seite)).not.toContain('Archiviert');
			expect(wiederherstellen(seite)).toBeUndefined();
		});

		it('zeigt einen Fehler beim Wiederherstellen und laesst den Knopf stehen', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ archiviert: true, darfArchivieren: true }),
			});
			wiederherstellen(seite)?.click();
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/threads/ck1/archiv')
					.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
			);
			await beendeSeite(harness);

			expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
			expect(wiederherstellen(seite)).toBeTruthy();
		});
	});

	describe('Echtzeit', () => {
		const THREAD_URL = '/demo/api/v1/threads/ck1';
		const GELESEN_URL = '/demo/api/v1/threads/ck1/gelesen';

		function nachricht(id: string, inhalt: string, zusatz: Partial<VerlaufAnsicht> = {}): VerlaufAnsicht {
			return {
				id,
				art: 'NACHRICHT',
				text: inhalt,
				absender: 'Lena M.',
				eigen: false,
				angelegtAm: '2026-10-21T12:05:00.000Z',
				stand: 43,
				geloescht: null,
				darfLoeschen: false,
				...zusatz,
			};
		}

		function sende(e: EchtzeitEreignis): void {
			TestBed.inject(EchtzeitAttrappe).quelle.next(e);
		}

		function signal(art: EchtzeitSignal['art'], stand: number, zusatz: Partial<EchtzeitSignal> = {}): EchtzeitEreignis {
			return { typ: 'signal', signal: { stand, threadId: 'ck1', art, objektId: 'x', ...zusatz } };
		}

		/** Ohne whenStable: Eine offene Anfrage hielte es an. */
		async function kurz(harness: RouterTestingHarness): Promise<void> {
			await new Promise((r) => setTimeout(r));
			harness.detectChanges();
		}

		async function oeffneVerlauf(
			eintraege: VerlaufAnsicht[] = [],
		): Promise<{ harness: RouterTestingHarness; seite: HTMLElement }> {
			const { harness, seite } = await oeffne(
				'/demo/t/ck1-bowling?reiter=verlauf',
				{ id: 'ck1', koerper: thread() },
				false,
			);
			await antworteVerlauf('ck1', eintraege);
			await beendeSeite(harness);
			return { harness, seite };
		}

		const nachrichten = (seite: HTMLElement) =>
			[...seite.querySelectorAll('jf-verlauf ol > li.nachricht')].map((li) => text(li as HTMLElement));

		it('zeigt eine Live-Nachricht im offenen Verlauf und meldet ihn bis zum Stand des Signals', async () => {
			const { harness, seite } = await oeffneVerlauf();

			sende(signal('VERLAUF', 43, { eintrag: nachricht('v1', 'Wir kommen zu zweit') }));
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 43 });
			await beendeSeite(harness);

			expect(nachrichten(seite)).toEqual([expect.stringContaining('Wir kommen zu zweit')]);
			// Keine Anfrage nach dem Thread: Die Nachricht kam fertig mit.
			http.expectNone(THREAD_URL);
		});

		it('zeigt die eigene Nachricht nach Senden und eigenem Signal genau einmal', async () => {
			const { harness, seite } = await oeffneVerlauf();
			const eigene = nachricht('v1', 'Wir kommen zu zweit', { eigen: true });

			tippe(seite, 'form.eingabe input', 'Wir kommen zu zweit');
			harness.detectChanges();
			(seite.querySelector('form.eingabe button[type=submit]') as HTMLButtonElement).click();
			await vi.waitFor(() => {
				const a = http.expectOne((r) => r.method === 'POST' && r.url === '/demo/api/v1/threads/ck1/verlauf');
				a.flush({ eintrag: eigene, stand: 43 });
			});
			await beendeSeite(harness);
			sende(signal('VERLAUF', 43, { eintrag: eigene }));
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 43 });
			await beendeSeite(harness);

			expect(nachrichten(seite)).toHaveLength(1);
		});

		it('meldet eine Nachricht nach einer Modul-Aenderung erst, wenn die stille Aktualisierung zurueck ist', async () => {
			const { harness } = await oeffneVerlauf();

			sende(signal('MODUL', 43));
			const offen = await vi.waitFor(() => http.expectOne(THREAD_URL));
			sende(signal('VERLAUF', 44, { eintrag: nachricht('v1', 'Hallo', { stand: 44 }) }));
			await kurz(harness);
			// Bis 44 gemeldet, galte die Modul-Aenderung als gelesen, bevor sie geladen ist (Entscheidung 8).
			http.expectNone(GELESEN_URL);

			offen.flush(thread({ stand: 44 }));
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 44 });
			await beendeSeite(harness);
		});

		it('meldet im Hintergrund nichts und genau einmal, sobald das Dokument sichtbar wird', async () => {
			const echtzeit = TestBed.inject(EchtzeitAttrappe);
			echtzeit.vordergrund.set(false);
			const { harness } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() }, false);
			await kurz(harness);
			http.expectNone(GELESEN_URL);

			echtzeit.vordergrund.set(true);
			harness.detectChanges();
			expect(await quittiereGelesen()).toEqual({ bereich: 'uebersicht', bis: 42 });
			await beendeSeite(harness);
			http.expectNone(GELESEN_URL);
		});

		it('meldet eine Live-Nachricht im Hintergrund nicht und im Vordergrund genau einmal', async () => {
			const echtzeit = TestBed.inject(EchtzeitAttrappe);
			echtzeit.vordergrund.set(false);
			const { harness } = await oeffne('/demo/t/ck1-bowling?reiter=verlauf', { id: 'ck1', koerper: thread() }, false);
			await antworteVerlauf('ck1', [], false);
			await beendeSeite(harness);

			sende(signal('VERLAUF', 43, { eintrag: nachricht('v1', 'Hallo') }));
			await beendeSeite(harness);
			http.expectNone(GELESEN_URL);

			echtzeit.vordergrund.set(true);
			harness.detectChanges();
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 43 });
			await beendeSeite(harness);
			http.expectNone(GELESEN_URL);
		});

		it('zeigt nach GELOESCHT Nicht gefunden, ohne zu fragen', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('GELOESCHT', 43));
			await beendeSeite(harness);

			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
			http.expectNone(THREAD_URL);
		});

		it('zeigt Nicht gefunden, ohne zu fragen, wenn ein Abgleich den Thread unsichtbar nennt', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende({ typ: 'sync', geaendert: [], unsichtbar: ['ck1'] });
			await beendeSeite(harness);

			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
			http.expectNone(THREAD_URL);
		});

		it('uebergeht Ereignisse anderer Threads', async () => {
			const { harness } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('GELOESCHT', 43, { threadId: 'ck2' }));
			sende(signal('MODUL', 43, { threadId: 'ck2' }));
			sende({ typ: 'sync', geaendert: ['ck2'], unsichtbar: ['ck3'] });
			await beendeSeite(harness);

			expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe('🎳 Bowling');
			http.expectNone(THREAD_URL);
		});

		it('aktualisiert still: kein Wird geladen, die Karte bleibt, danach der neue Stand und die Meldung', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });
			const karte = seite.querySelector('#modul-m1');

			sende(signal('MODUL', 43));
			const offen = await vi.waitFor(() => http.expectOne(THREAD_URL));
			await kurz(harness);
			expect(text(seite)).not.toContain('Wird geladen');
			expect(seite.querySelector('#modul-m1')).toBe(karte);

			offen.flush(
				thread({ stand: 43, module: [{ typ: 'INFO', id: 'm1', titel: 'Worum es geht', text: 'Wir gehen bowlen.' }] }),
			);
			expect(await quittiereGelesen()).toEqual({ bereich: 'uebersicht', bis: 43 });
			await beendeSeite(harness);

			expect(text(seite.querySelector('#modul-m1') as HTMLElement)).toContain('Wir gehen bowlen.');
		});

		it('aktualisiert in der Uebersicht auch bei einer Nachricht still, damit der Zaehler am Reiter stimmt', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('VERLAUF', 43, { eintrag: nachricht('v1', 'Hallo') }));
			await vi.waitFor(() =>
				http.expectOne(THREAD_URL).flush(thread({ stand: 43, verlauf: { eintraege: 4, ungelesen: 3 } })),
			);
			await quittiereGelesen();
			await beendeSeite(harness);

			expect(seite.querySelector('nav.reiter .zahl')?.textContent).toBe('3');
		});

		it('meldet eine stille Aktualisierung mit gleichem Stand nicht noch einmal', async () => {
			const { harness } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('ANTWORT', 42));
			await vi.waitFor(() => http.expectOne(THREAD_URL).flush(thread()));
			await beendeSeite(harness);

			http.expectNone(GELESEN_URL);
		});

		it('zeigt Nicht gefunden, wenn die stille Aktualisierung 404 bekommt', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('SICHTBARKEIT', 43, { threadId: null }));
			await vi.waitFor(() =>
				http.expectOne(THREAD_URL).flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
			);
			await beendeSeite(harness);

			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
		});

		it('schickt zur Anmeldung, wenn die stille Aktualisierung 401 bekommt', async () => {
			const { harness } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('THREAD', 43));
			await vi.waitFor(() =>
				http.expectOne(THREAD_URL).flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
			);
			await beendeSeite(harness);

			await vi.waitFor(() => expect(router.url).toBe('/demo/anmelden?weiter=%2Fdemo%2Ft%2Fck1-bowling'));
		});

		it('behaelt bei einem anderen Fehler der stillen Aktualisierung den alten Stand, ohne Fehlerblock', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('THREAD', 43));
			await vi.waitFor(() =>
				http.expectOne(THREAD_URL).flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' }),
			);
			await beendeSeite(harness);

			expect(seite.querySelector('h1')?.textContent).toBe('🎳 Bowling');
			expect(seite.querySelector('[role="alert"]')).toBeNull();
		});

		it('verwirft eine aeltere stille Aktualisierung, die nach einer neueren eintrifft', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', { id: 'ck1', koerper: thread() });

			sende(signal('THREAD', 43));
			const alt = await vi.waitFor(() => http.expectOne(THREAD_URL));
			sende(signal('THREAD', 44));
			const neu = await vi.waitFor(() => http.expectOne(THREAD_URL));
			neu.flush(thread({ stand: 44, titel: 'Neu' }));
			alt.flush(thread({ stand: 43, titel: 'Alt' }));
			expect(await quittiereGelesen()).toEqual({ bereich: 'uebersicht', bis: 44 });
			await beendeSeite(harness);

			expect(seite.querySelector('h1')?.textContent).toBe('Neu');
		});

		it('hebt den Stand nach einer gescheiterten Aktualisierung erst mit der naechsten gelungenen', async () => {
			const { harness } = await oeffneVerlauf();

			sende(signal('MODUL', 43));
			await vi.waitFor(() =>
				http.expectOne(THREAD_URL).flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' }),
			);
			await kurz(harness);
			sende(signal('VERLAUF', 44, { eintrag: nachricht('v1', 'Hallo', { stand: 44 }) }));
			await beendeSeite(harness);
			// Bis 44 gemeldet, galte die nicht geladene Modul-Aenderung 43 als gelesen (Entscheidung 8).
			http.expectNone(GELESEN_URL);

			sende(signal('ANTWORT', 45));
			await vi.waitFor(() => http.expectOne(THREAD_URL).flush(thread({ stand: 45 })));
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 45 });
			await beendeSeite(harness);
			http.expectNone(GELESEN_URL);
		});

		it('meldet eine Nachricht, die waehrend der Aktualisierung kam, auch wenn deren Antwort aelter ist', async () => {
			const { harness } = await oeffneVerlauf();

			sende(signal('MODUL', 43));
			const offen = await vi.waitFor(() => http.expectOne(THREAD_URL));
			sende(signal('VERLAUF', 44, { eintrag: nachricht('v1', 'Hallo', { stand: 44 }) }));
			await kurz(harness);
			http.expectNone(GELESEN_URL);

			// Der Server hat vor der Nachricht gelesen; die Modul-Aenderung 43 ist jetzt da, die Nachricht steht im Verlauf.
			offen.flush(thread({ stand: 43 }));
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 44 });
			await beendeSeite(harness);
		});

		it('fragt bei Nicht gefunden still nach und zeigt den Thread, wenn er wieder sichtbar ist', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: { fehler: 'nicht gefunden' },
				status: 404,
			});

			sende(signal('SICHTBARKEIT', 43, { threadId: null }));
			const offen = await vi.waitFor(() => http.expectOne(THREAD_URL));
			await kurz(harness);
			expect(text(seite)).toContain('Nicht gefunden oder keine Berechtigung');
			expect(text(seite)).not.toContain('Wird geladen');

			offen.flush(thread({ stand: 43 }));
			expect(await quittiereGelesen()).toEqual({ bereich: 'uebersicht', bis: 43 });
			await beendeSeite(harness);
			expect(seite.querySelector('h1')?.textContent).toBe('🎳 Bowling');
		});

		it('zeigt den Fehler beim Wiederherstellen auch, wenn waehrenddessen ein Ereignis kam', async () => {
			const { harness, seite } = await oeffne('/demo/t/ck1-bowling', {
				id: 'ck1',
				koerper: thread({ archiviert: true, darfArchivieren: true }),
			});
			[...seite.querySelectorAll<HTMLButtonElement>('button')]
				.find((b) => b.textContent?.includes('Wiederherstellen'))
				?.click();
			const archiv = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1/archiv'));

			sende(signal('ANTWORT', 42));
			const still = await vi.waitFor(() => http.expectOne(THREAD_URL));
			archiv.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			still.flush(thread({ archiviert: true, darfArchivieren: true }));
			await beendeSeite(harness);

			expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		});

		it('frischt bei alles den offenen Verlauf auf, ohne einen gezeigten Eintrag doppelt zu zeigen', async () => {
			const { harness, seite } = await oeffneVerlauf([nachricht('v1', 'Erste', { stand: 40 })]);

			sende({ typ: 'alles' });
			await vi.waitFor(() => http.expectOne(THREAD_URL).flush(thread()));
			await vi.waitFor(() =>
				http.expectOne('/demo/api/v1/threads/ck1/verlauf').flush({
					eintraege: [nachricht('v2', 'Zweite', { stand: 41 }), nachricht('v1', 'Erste', { stand: 40 })],
					weitere: false,
				}),
			);
			await beendeSeite(harness);

			expect(nachrichten(seite)).toEqual([expect.stringContaining('Erste'), expect.stringContaining('Zweite')]);
		});

		it('frischt den Verlauf nach einem Systemeintrag auf und meldet den neuen Stand erst danach', async () => {
			const { harness, seite } = await oeffneVerlauf();

			sende(signal('VERLAUF', 43));
			await vi.waitFor(() => http.expectOne(THREAD_URL).flush(thread({ stand: 43 })));
			const verlauf = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1/verlauf'));
			await kurz(harness);
			// Der Stand ist bekannt, die Zeilen dazu noch nicht: nichts melden, was die Seite nicht hat.
			http.expectNone(GELESEN_URL);
			verlauf.flush({ eintraege: [nachricht('v1', 'Erste')], weitere: false });
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 43 });
			await beendeSeite(harness);

			expect(nachrichten(seite)).toHaveLength(1);
		});
	});
});

// Eigener Block, weil die Liste der Huelle hier nicht vom Interceptor beantwortet werden darf:
// Geprueft wird gerade, dass nach dem Gelesen-Stand eine weitere Listenanfrage kommt.
describe('Thread-Seite mit der Liste der Huelle', () => {
	const LISTE = '/demo/api/v1/threads';
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter({ eigeneThreadListe: true }) });
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it('fragt die Liste nach dem Gelesen-Stand erneut, auch wenn ihre Anfrage zum Pfadwechsel schon beantwortet ist', async () => {
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/t/ck1-bowling');
		await vi.waitFor(() => http.expectOne('/demo/api/v1/ich').flush(ICH));
		await navigation;
		await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1').flush(thread()));
		// Die Listenanfrage der Huelle ist beantwortet, bevor der Gelesen-Stand ankommt: der Fall "schnell zurueck".
		await vi.waitFor(() => expect(http.match(LISTE).map((r) => r.flush({ threads: [], archiv: 0 }))).not.toEqual([]));

		await vi.waitFor(() => {
			const gelesen = http.expectOne('/demo/api/v1/threads/ck1/gelesen');
			expect(gelesen.request.method).toBe('PUT');
			gelesen.flush(null, { status: 204, statusText: 'No Content' });
		});

		await vi.waitFor(() => {
			const erneut = http.expectOne(LISTE);
			expect(erneut.request.method).toBe('GET');
			erneut.flush({ threads: [], archiv: 0 });
		});
		for (const kopf of http.match('/demo/api/v1/verein')) kopf.flush(VEREIN);
		await harness.fixture.whenStable();
	});
});
