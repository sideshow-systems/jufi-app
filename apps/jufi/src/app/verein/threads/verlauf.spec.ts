import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { SchreibSperre, VerlaufAnsicht } from '@jufi/domain';
import { EchtzeitAttrappe, echtzeitAttrappe } from '../../admin/test-hilfen';
import { zeitpunktBerlin } from '../../gestaltung/format';
import { Verlauf } from './verlauf';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function nachricht(id: string, text: string, zusatz: Partial<VerlaufAnsicht> = {}): VerlaufAnsicht {
	return {
		id,
		art: 'NACHRICHT',
		text,
		absender: 'Lena M.',
		eigen: false,
		angelegtAm: '2026-10-13T12:05:00.000Z',
		stand: 10,
		geloescht: null,
		darfLoeschen: false,
		...zusatz,
	};
}

describe('Verlauf', () => {
	let http: HttpTestingController;
	let fixture: ComponentFixture<Verlauf>;
	let el: HTMLElement;
	let gelesen: number;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(withFetch()), provideHttpClientTesting(), ...echtzeitAttrappe()],
		});
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		http.verify();
	});

	function zeige(schreibSperre: SchreibSperre | null = null): void {
		fixture = TestBed.createComponent(Verlauf);
		fixture.componentRef.setInput('slug', 'demo');
		fixture.componentRef.setInput('threadId', 'ck1');
		fixture.componentRef.setInput('stand', 42);
		fixture.componentRef.setInput('schreibSperre', schreibSperre);
		gelesen = 0;
		fixture.componentInstance.gelesen.subscribe(() => gelesen++);
		fixture.detectChanges();
		el = fixture.nativeElement as HTMLElement;
	}

	async function fertig(): Promise<void> {
		await fixture.whenStable();
		fixture.detectChanges();
	}

	/** Beantwortet GET /verlauf (mit vor fuer eine aeltere Seite) und die Meldung als gelesen danach. */
	async function ladeSeite(
		eintraege: VerlaufAnsicht[],
		weitere = false,
		vor?: string,
		meldet = vor === undefined,
	): Promise<void> {
		const adresse = `/demo/api/v1/threads/ck1/verlauf${vor === undefined ? '' : `?vor=${vor}`}`;
		await vi.waitFor(() => {
			const a = http.expectOne(adresse);
			expect(a.request.method).toBe('GET');
			a.flush({ eintraege, weitere });
		});
		if (meldet) await quittiereGelesen();
		await fertig();
	}

	async function quittiereGelesen(): Promise<unknown> {
		let koerper: unknown;
		await vi.waitFor(() => {
			const a = http.expectOne('/demo/api/v1/threads/ck1/gelesen');
			expect(a.request.method).toBe('PUT');
			koerper = a.request.body;
			a.flush(null, { status: 204, statusText: 'No Content' });
		});
		return koerper;
	}

	function zeilen(): HTMLElement[] {
		return Array.from(el.querySelectorAll<HTMLElement>('ol > li'));
	}

	function text(wurzel: Element = el): string {
		return (wurzel.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	function knopf(wurzel: Element, beschriftung: string): HTMLButtonElement {
		const k = Array.from(wurzel.querySelectorAll('button')).find((b) => b.textContent?.trim() === beschriftung);
		if (!k) throw new Error(`kein Knopf ${beschriftung}`);
		return k;
	}

	function feld(): HTMLInputElement {
		return el.querySelector<HTMLInputElement>('form.eingabe input')!;
	}

	function tippe(wert: string): void {
		const f = feld();
		f.value = wert;
		f.dispatchEvent(new Event('input'));
		fixture.detectChanges();
	}

	function sendeKnopf(): HTMLButtonElement {
		return el.querySelector<HTMLButtonElement>('form.eingabe button[type=submit]')!;
	}

	function schreibeAnfrage(): TestRequest {
		const a = http.expectOne('/demo/api/v1/threads/ck1/verlauf');
		expect(a.request.method).toBe('POST');
		return a;
	}

	describe('Laden', () => {
		it('zeigt die erste Seite chronologisch, aelteste oben', async () => {
			zeige();
			await ladeSeite([nachricht('e3', 'Dritte'), nachricht('e2', 'Zweite'), nachricht('e1', 'Erste')]);

			expect(zeilen().map((z) => text(z).match(/Erste|Zweite|Dritte/)?.[0])).toEqual(['Erste', 'Zweite', 'Dritte']);
		});

		it('zeigt Fruehere laden nur, wenn es weitere gibt', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')]);

			expect(el.querySelector('.frueher')).toBeNull();
		});

		it('haengt die naechste Seite oben an, mit vor als Id des aeltesten Eintrags', async () => {
			zeige();
			await ladeSeite([nachricht('e5', 'Fuenfte'), nachricht('e4', 'Vierte'), nachricht('e3', 'Dritte')], true);

			knopf(el, 'Frühere laden').click();
			await ladeSeite([nachricht('e2', 'Zweite'), nachricht('e1', 'Erste')], false, 'e3');

			expect(zeilen().map((z) => text(z).match(/Erste|Zweite|Dritte|Vierte|Fuenfte/)?.[0])).toEqual([
				'Erste',
				'Zweite',
				'Dritte',
				'Vierte',
				'Fuenfte',
			]);
			expect(el.querySelector('.frueher')).toBeNull();
		});

		it('laesst Fruehere laden nach einem Fehler stehen und zeigt ihn', async () => {
			zeige();
			await ladeSeite([nachricht('e2', 'Zweite')], true);
			knopf(el, 'Frühere laden').click();
			http
				.expectOne('/demo/api/v1/threads/ck1/verlauf?vor=e2')
				.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' });
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent).toContain('Unerwarteter Fehler');
			expect(zeilen()).toHaveLength(1);
			expect(knopf(el, 'Frühere laden').disabled).toBe(false);
		});

		it('meldet nach dem ersten Laden den Stand der Seite als gelesen und danach gelesen()', async () => {
			zeige();
			await vi.waitFor(() =>
				http.expectOne('/demo/api/v1/threads/ck1/verlauf').flush({ eintraege: [], weitere: false }),
			);
			expect(gelesen).toBe(0);
			const koerper = await quittiereGelesen();
			await fertig();

			expect(koerper).toEqual({ bereich: 'verlauf', bis: 42 });
			expect(gelesen).toBe(1);
		});

		it('meldet nach dem Nachladen einer aelteren Seite nichts erneut', async () => {
			zeige();
			await ladeSeite([nachricht('e2', 'Zweite')], true);
			knopf(el, 'Frühere laden').click();
			await ladeSeite([nachricht('e1', 'Erste')], false, 'e2');

			expect(gelesen).toBe(1);
		});

		it('meldet nichts und emittiert nichts, wenn das Melden scheitert', async () => {
			zeige();
			await vi.waitFor(() =>
				http.expectOne('/demo/api/v1/threads/ck1/verlauf').flush({ eintraege: [], weitere: false }),
			);
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/threads/ck1/gelesen')
					.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' }),
			);
			await fertig();

			expect(gelesen).toBe(0);
			expect(el.querySelector('[role="alert"]')).toBeNull();
		});

		it('zeigt bei einem Ladefehler den Fehler und laedt mit Nochmal versuchen neu', async () => {
			zeige();
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/threads/ck1/verlauf')
					.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' }),
			);
			await fertig();
			expect(el.querySelector('[role="alert"]')?.textContent).toContain('Unerwarteter Fehler');

			knopf(el, 'Nochmal versuchen').click();
			await ladeSeite([nachricht('e1', 'Erste')]);

			expect(zeilen()).toHaveLength(1);
			expect(el.querySelector('[role="alert"]')).toBeNull();
		});

		it('zeigt bei 404 Nicht gefunden oder keine Berechtigung statt des Servertextes', async () => {
			zeige();
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/threads/ck1/verlauf')
					.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
			);
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Nicht gefunden oder keine Berechtigung');
		});

		it('schickt bei abgelaufener Sitzung zur Anmeldung', async () => {
			const navigieren = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
			zeige();
			await vi.waitFor(() =>
				http
					.expectOne('/demo/api/v1/threads/ck1/verlauf')
					.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
			);
			await fertig();

			expect(navigieren).toHaveBeenCalledWith(expect.stringContaining('/demo/anmelden?weiter='));
			expect(el.querySelector('[role="alert"]')).toBeNull();
		});

		it('verwirft eine Antwort, die nach dem Verlassen der Seite eintrifft', async () => {
			zeige();
			const offen = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1/verlauf'));
			fixture.destroy();
			offen.flush({ eintraege: [nachricht('e1', 'Erste')], weitere: false });
			await new Promise((r) => setTimeout(r));

			expect(gelesen).toBe(0);
			// Ein PUT gelesen waere eine offene Anfrage, und afterEach wuerde scheitern.
		});
	});

	describe('Nachrichten', () => {
		it('zeigt Absender, Berliner Zeit und Text', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Wir treffen uns um zwei.')]);

			const z = zeilen()[0]!;
			expect(z.querySelector('strong')?.textContent).toBe('Lena M.');
			expect(text(z)).toContain(zeitpunktBerlin('2026-10-13T12:05:00.000Z'));
			expect(text(z)).toContain('Wir treffen uns um zwei.');
		});

		it('macht https-Links klickbar, mit neuem Tab und ohne Referrer', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Schau: https://example.org/karte?x=1. Danke')]);

			const a = zeilen()[0]!.querySelector('a')!;
			expect(a.getAttribute('href')).toBe('https://example.org/karte?x=1');
			expect(a.getAttribute('target')).toBe('_blank');
			expect(a.getAttribute('rel')).toBe('noopener noreferrer');
			expect(a.textContent).toBe('https://example.org/karte?x=1');
			expect(text(zeilen()[0]!.querySelector('p')!)).toBe('Schau: https://example.org/karte?x=1. Danke');
		});

		it('zeigt Markup im Text als Text', async () => {
			zeige();
			await ladeSeite([nachricht('e1', '<script>alert(1)</script> <b>fett</b>')]);

			const z = zeilen()[0]!;
			expect(z.querySelector('script')).toBeNull();
			expect(z.querySelector('b')).toBeNull();
			expect(text(z.querySelector('p')!)).toBe('<script>alert(1)</script> <b>fett</b>');
		});

		it('rueckt eigene Nachrichten nach rechts und nennt den Absender Du', async () => {
			zeige();
			await ladeSeite([nachricht('e2', 'Ich', { eigen: true, absender: 'Flo M.' }), nachricht('e1', 'Andere')]);

			const [andere, eigene] = zeilen();
			expect(andere!.classList).not.toContain('eigen');
			expect(eigene!.classList).toContain('eigen');
			expect(eigene!.querySelector('strong')?.textContent).toBe('Du');
		});

		it('zeigt einen Systemeintrag gedaempft mit seinem Satz und ohne Absender', async () => {
			zeige();
			await ladeSeite([
				nachricht('e1', 'Lena hat den Thread veröffentlicht', { art: 'SYSTEM', absender: null, eigen: false }),
			]);

			const z = zeilen()[0]!;
			expect(z.classList).toContain('system');
			expect(text(z)).toContain('Lena hat den Thread veröffentlicht');
			expect(z.querySelector('strong')).toBeNull();
		});

		it('zeigt eine selbst geloeschte Nachricht als Nachricht geloescht, ohne Loeschen', async () => {
			zeige();
			await ladeSeite([nachricht('e1', null as unknown as string, { text: null, geloescht: 'SELBST' })]);

			const z = zeilen()[0]!;
			expect(text(z)).toContain('Nachricht gelöscht');
			expect(z.querySelector('button')).toBeNull();
		});

		it('zeigt eine von der Moderation geloeschte Nachricht als Von einem Jugendleiter entfernt', async () => {
			zeige();
			await ladeSeite([nachricht('e1', '', { text: null, geloescht: 'MODERATION' })]);

			expect(text(zeilen()[0]!)).toContain('Von einem Jugendleiter entfernt');
		});

		it('zeigt bei einem leeren Verlauf einen Hinweis', async () => {
			zeige();
			await ladeSeite([]);

			expect(text(el)).toContain('Noch keine Nachrichten');
		});
	});

	describe('Loeschen', () => {
		it('nennt am Loeschen-Knopf den Absender, damit gleichlautende Knoepfe unterscheidbar sind', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Fremde', { darfLoeschen: true, absender: 'Lena M.' })]);

			expect(knopf(zeilen()[0]!, 'Löschen').getAttribute('aria-label')).toBe('Nachricht von Lena M. löschen');
		});

		it('zeigt bei 404 am Loeschen Nicht gefunden oder keine Berechtigung', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Meine', { darfLoeschen: true, eigen: true })]);
			knopf(zeilen()[0]!, 'Löschen').click();
			fixture.detectChanges();
			knopf(el.querySelector('[role="dialog"]')!, 'Löschen').click();
			http
				.expectOne('/demo/api/v1/verlauf/e1')
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Nicht gefunden oder keine Berechtigung');
		});

		it('bietet Loeschen nur, wo der Server darfLoeschen sagt', async () => {
			zeige();
			await ladeSeite([nachricht('e2', 'Meine', { darfLoeschen: true, eigen: true }), nachricht('e1', 'Fremde')]);

			const [fremde, meine] = zeilen();
			expect(fremde!.querySelector('button')).toBeNull();
			expect(knopf(meine!, 'Löschen')).toBeTruthy();
		});

		it('fragt nach, loescht erst nach Bestaetigung und zeigt danach Nachricht geloescht', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Meine', { darfLoeschen: true, eigen: true })]);
			knopf(zeilen()[0]!, 'Löschen').click();
			fixture.detectChanges();

			expect(el.querySelector('[role="dialog"]')).not.toBeNull();
			http.expectNone('/demo/api/v1/verlauf/e1');
			knopf(el.querySelector('[role="dialog"]')!, 'Löschen').click();
			const a = http.expectOne('/demo/api/v1/verlauf/e1');
			expect(a.request.method).toBe('DELETE');
			a.flush(null, { status: 204, statusText: 'No Content' });
			await fertig();

			expect(el.querySelector('[role="dialog"]')).toBeNull();
			expect(text(zeilen()[0]!)).toContain('Nachricht gelöscht');
			expect(text(zeilen()[0]!)).not.toContain('Meine');
			expect(zeilen()[0]!.querySelector('button')).toBeNull();
		});

		it('zeigt eine fremde Nachricht nach dem Loeschen durch einen Jugendleiter als entfernt', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Fremde', { darfLoeschen: true })]);
			knopf(zeilen()[0]!, 'Löschen').click();
			fixture.detectChanges();
			knopf(el.querySelector('[role="dialog"]')!, 'Löschen').click();
			http.expectOne('/demo/api/v1/verlauf/e1').flush(null, { status: 204, statusText: 'No Content' });
			await fertig();

			expect(text(zeilen()[0]!)).toContain('Von einem Jugendleiter entfernt');
		});

		it('loescht nichts bei Abbrechen', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Meine', { darfLoeschen: true, eigen: true })]);
			knopf(zeilen()[0]!, 'Löschen').click();
			fixture.detectChanges();
			knopf(el.querySelector('[role="dialog"]')!, 'Abbrechen').click();
			fixture.detectChanges();

			expect(el.querySelector('[role="dialog"]')).toBeNull();
			expect(text(zeilen()[0]!)).toContain('Meine');
		});

		it('zeigt einen Fehler und behaelt die Nachricht, wenn das Loeschen scheitert', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Meine', { darfLoeschen: true, eigen: true })]);
			knopf(zeilen()[0]!, 'Löschen').click();
			fixture.detectChanges();
			knopf(el.querySelector('[role="dialog"]')!, 'Löschen').click();
			http
				.expectOne('/demo/api/v1/verlauf/e1')
				.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' });
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent).toContain('Unerwarteter Fehler');
			expect(text(zeilen()[0]!)).toContain('Meine');
		});
	});

	describe('Senden', () => {
		it('zeigt das Eingabefeld nur ohne Schreibsperre', async () => {
			zeige();
			await ladeSeite([]);

			expect(feld()).not.toBeNull();
		});

		it.each(['NUR_AUSHANG', 'ARCHIVIERT', 'ENTWURF'] as const)(
			'zeigt bei %s kein Eingabefeld, aber die Liste',
			async (sperre) => {
				zeige(sperre);
				await ladeSeite([nachricht('e1', 'Erste')]);

				expect(el.querySelector('form.eingabe')).toBeNull();
				expect(zeilen()).toHaveLength(1);
			},
		);

		it('sperrt den Senden-Knopf bei leerem Text', async () => {
			zeige();
			await ladeSeite([]);
			expect(sendeKnopf().disabled).toBe(true);

			tippe('   ');
			expect(sendeKnopf().disabled).toBe(true);
			tippe('Hallo');
			expect(sendeKnopf().disabled).toBe(false);
		});

		it('schickt mit dem Knopf den Text mit einer clientId; danach ist das Feld leer und die Nachricht steht unten', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')]);
			tippe(' Hallo zusammen ');
			sendeKnopf().click();

			const a = schreibeAnfrage();
			expect(a.request.body.text).toBe('Hallo zusammen');
			expect(a.request.body.clientId).toMatch(UUID);
			a.flush({ eintrag: nachricht('e2', 'Hallo zusammen', { eigen: true, absender: 'Flo M.' }), stand: 43 });
			await fertig();

			expect(feld().value).toBe('');
			expect(zeilen()).toHaveLength(2);
			expect(text(zeilen()[1]!)).toContain('Hallo zusammen');
			expect(zeilen()[1]!.classList).toContain('eigen');
		});

		it('schickt auch mit Enter', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Per Enter');
			feld().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

			const a = schreibeAnfrage();
			expect(a.request.body.text).toBe('Per Enter');
			a.flush({ eintrag: nachricht('e1', 'Per Enter', { eigen: true }), stand: 43 });
			await fertig();
		});

		it('ignoriert Enter waehrend einer Eingabemethode, ohne es zu verwerfen', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Konnichiwa');
			const enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
			feld().dispatchEvent(enter);

			// Verwirft die Seite das Enter, kann die Eingabemethode ihre Umwandlung nicht bestaetigen.
			expect(enter.defaultPrevented).toBe(false);
			http.expectNone('/demo/api/v1/threads/ck1/verlauf');
		});

		it('schickt einen leeren Text nicht', async () => {
			zeige();
			await ladeSeite([]);
			tippe('  ');
			feld().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

			http.expectNone('/demo/api/v1/threads/ck1/verlauf');
		});

		it('schickt bei einem Doppeltipp nur einmal', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Einmal');
			sendeKnopf().click();
			sendeKnopf().click();

			schreibeAnfrage().flush({ eintrag: nachricht('e1', 'Einmal', { eigen: true }), stand: 43 });
			await fertig();
			expect(zeilen()).toHaveLength(1);
		});

		it('behaelt den Text nach einem Netzfehler und wiederholt mit derselben clientId', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Hallo');
			sendeKnopf().click();
			const erste = schreibeAnfrage();
			erste.error(new ProgressEvent('error'));
			await fertig();

			expect(feld().value).toBe('Hallo');
			expect(el.querySelector('[role="alert"]')?.textContent).toContain('Keine Verbindung');
			sendeKnopf().click();
			const zweite = schreibeAnfrage();

			expect(zweite.request.body.clientId).toBe(erste.request.body.clientId);
			zweite.flush({ eintrag: nachricht('e1', 'Hallo', { eigen: true }), stand: 43 });
			await fertig();
			expect(el.querySelector('[role="alert"]')).toBeNull();
		});

		it('nimmt nach einer Aenderung des Textes eine neue clientId', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Hallo');
			sendeKnopf().click();
			const erste = schreibeAnfrage();
			erste.error(new ProgressEvent('error'));
			await fertig();
			tippe('Hallo zusammen');
			sendeKnopf().click();
			const zweite = schreibeAnfrage();

			expect(zweite.request.body.clientId).not.toBe(erste.request.body.clientId);
			zweite.flush({ eintrag: nachricht('e1', 'Hallo zusammen', { eigen: true }), stand: 43 });
			await fertig();
		});

		it('nimmt nach einer gesendeten Nachricht eine neue clientId', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Hallo');
			sendeKnopf().click();
			const erste = schreibeAnfrage();
			erste.flush({ eintrag: nachricht('e1', 'Hallo', { eigen: true }), stand: 43 });
			await fertig();
			tippe('Hallo');
			sendeKnopf().click();
			const zweite = schreibeAnfrage();

			expect(zweite.request.body.clientId).not.toBe(erste.request.body.clientId);
			zweite.flush({ eintrag: nachricht('e2', 'Hallo', { eigen: true }), stand: 44 });
			await fertig();
		});

		it('zeigt bei 409 ARCHIVIERT Der Thread ist archiviert und behaelt den Text', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Zu spaet');
			sendeKnopf().click();
			schreibeAnfrage().flush(
				{ fehler: 'Der Thread ist archiviert', code: 'ARCHIVIERT' },
				{ status: 409, statusText: 'Conflict' },
			);
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent).toContain('Der Thread ist archiviert');
			expect(feld().value).toBe('Zu spaet');
		});

		it('zeigt bei 429 die Wartezeit', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Schnell');
			sendeKnopf().click();
			schreibeAnfrage().flush(
				{ fehler: 'Zu viele Anfragen', wartenSekunden: 20 },
				{ status: 429, statusText: 'Too Many Requests' },
			);
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent).toContain(
				'Zu viele Versuche – bitte in 20 Sekunden erneut',
			);
		});

		it('sagt bei 400 am Text, dass er ungueltig oder zu lang ist', async () => {
			zeige();
			await ladeSeite([]);
			tippe('x');
			sendeKnopf().click();
			schreibeAnfrage().flush({ fehler: 'ungültig', feld: 'text' }, { status: 400, statusText: 'Bad Request' });
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent).toContain('zu lang');
		});

		it('verwirft eine Antwort, die nach dem Verlassen der Seite eintrifft', async () => {
			zeige();
			await ladeSeite([]);
			tippe('Hallo');
			sendeKnopf().click();
			const offen = schreibeAnfrage();
			fixture.destroy();
			offen.flush({ eintrag: nachricht('e1', 'Hallo', { eigen: true }), stand: 43 });
			await new Promise((r) => setTimeout(r));
		});

		it('endet mit einem Abstandhalter als letztem Element, damit die Leiste nichts verdeckt', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')]);

			expect(el.lastElementChild?.classList).toContain('abstand');
			expect(el.querySelector('form.eingabe')).not.toBeNull();
		});
	});

	describe('Live', () => {
		const inhalte = () => zeilen().map((z) => text(z).match(/Erste|Zweite|Dritte|Vierte|gelöscht/)?.[0]);

		it('fuegt einen Eintrag nach Stand und Id ein und ersetzt einen bekannten, statt ihn doppelt zu zeigen', async () => {
			zeige();
			await ladeSeite([nachricht('e3', 'Dritte', { stand: 30 }), nachricht('e1', 'Erste', { stand: 10 })]);

			fixture.componentInstance.uebernimm(nachricht('e2', 'Zweite', { stand: 20 }));
			fixture.componentInstance.uebernimm(nachricht('e4', 'Vierte', { stand: 40 }));
			fixture.componentInstance.uebernimm(nachricht('e3', 'Dritte', { stand: 30 }));
			fixture.componentInstance.uebernimm(
				nachricht('e1', null as unknown as string, { stand: 10, geloescht: 'SELBST' }),
			);
			fixture.detectChanges();

			expect(inhalte()).toEqual(['gelöscht', 'Zweite', 'Dritte', 'Vierte']);
		});

		it('laesst einen unbekannten Eintrag aelter als die geladene Seite aus, wenn es fruehere gibt', async () => {
			zeige();
			await ladeSeite([nachricht('e3', 'Dritte', { stand: 30 })], true);

			fixture.componentInstance.uebernimm(nachricht('e1', 'Erste', { stand: 10 }));
			fixture.detectChanges();

			// Sonst stuende er ueber einer Luecke, die Fruehere laden erst fuellt.
			expect(inhalte()).toEqual(['Dritte']);
		});

		it('behaelt einen Eintrag, der waehrend des ersten Ladens kam', async () => {
			zeige();
			const offen = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1/verlauf'));
			fixture.componentInstance.uebernimm(nachricht('e4', 'Vierte', { stand: 40 }));
			offen.flush({ eintraege: [nachricht('e1', 'Erste', { stand: 10 })], weitere: false });
			await quittiereGelesen();
			await fertig();

			expect(inhalte()).toEqual(['Erste', 'Vierte']);
		});

		it('meldet einen hoeheren Stand erneut, einen gleichen oder niedrigeren nicht', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')]);

			fixture.componentRef.setInput('stand', 44);
			fixture.detectChanges();
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 44 });
			await fertig();
			expect(gelesen).toBe(2);

			fixture.componentRef.setInput('stand', 44);
			fixture.componentRef.setInput('stand', 43);
			await fertig();
			http.expectNone('/demo/api/v1/threads/ck1/gelesen');
		});

		it('meldet im Hintergrund nichts und genau einmal, sobald das Dokument wieder sichtbar ist', async () => {
			const echtzeit = TestBed.inject(EchtzeitAttrappe);
			echtzeit.vordergrund.set(false);
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')], false, undefined, false);
			fixture.componentRef.setInput('stand', 44);
			await fertig();
			http.expectNone('/demo/api/v1/threads/ck1/gelesen');

			echtzeit.vordergrund.set(true);
			fixture.detectChanges();
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 44 });
			await fertig();
			http.expectNone('/demo/api/v1/threads/ck1/gelesen');
		});

		it('frischt mit der neuesten Seite auf, ohne die Liste zu leeren und ohne doppelte Zeilen', async () => {
			zeige();
			await ladeSeite([nachricht('e2', 'Zweite', { stand: 20 }), nachricht('e1', 'Erste', { stand: 10 })]);

			const fertigGefrischt = fixture.componentInstance.frischeAuf();
			fixture.detectChanges();
			// Waehrend der Anfrage bleibt die Liste stehen, kein Wird geladen.
			expect(inhalte()).toEqual(['Erste', 'Zweite']);
			expect(text()).not.toContain('Wird geladen');
			http.expectOne('/demo/api/v1/threads/ck1/verlauf').flush({
				eintraege: [nachricht('e3', 'Dritte', { stand: 30 }), nachricht('e2', 'Zweite', { stand: 20 })],
				weitere: true,
			});
			await fertigGefrischt;
			await fertig();

			expect(inhalte()).toEqual(['Erste', 'Zweite', 'Dritte']);
			// Weitere gilt fuer die aelteren Seiten, und die sind schon da.
			expect(el.querySelector('.frueher')).toBeNull();
		});

		it('ersetzt beim Auffrischen ohne Anschluss die Liste und bietet Fruehere laden an', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste', { stand: 10 })]);

			const fertigGefrischt = fixture.componentInstance.frischeAuf();
			http.expectOne('/demo/api/v1/threads/ck1/verlauf').flush({
				eintraege: [nachricht('e4', 'Vierte', { stand: 40 }), nachricht('e3', 'Dritte', { stand: 30 })],
				weitere: true,
			});
			await fertigGefrischt;
			await fertig();

			// Zwischen Erste und Dritte fehlt etwas; die Liste zeigt keine Luecke, Fruehere laden holt den Rest.
			expect(inhalte()).toEqual(['Dritte', 'Vierte']);
			expect(el.querySelector('.frueher')).not.toBeNull();
		});

		it('meldet nichts, solange ein Auffrischen aussteht oder nachdem es gescheitert ist', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')]);

			const gescheitert = fixture.componentInstance.frischeAuf();
			fixture.componentRef.setInput('stand', 44);
			await new Promise((r) => setTimeout(r));
			fixture.detectChanges();
			http.expectNone('/demo/api/v1/threads/ck1/gelesen');
			http
				.expectOne('/demo/api/v1/threads/ck1/verlauf')
				.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' });
			await gescheitert;
			await fertig();
			http.expectNone('/demo/api/v1/threads/ck1/gelesen');
			expect(el.querySelector('[role="alert"]')).toBeNull();

			const gelungen = fixture.componentInstance.frischeAuf();
			http
				.expectOne('/demo/api/v1/threads/ck1/verlauf')
				.flush({ eintraege: [nachricht('e1', 'Erste')], weitere: false });
			await gelungen;
			expect(await quittiereGelesen()).toEqual({ bereich: 'verlauf', bis: 44 });
			await fertig();
		});

		it('laesst eine live geloeschte Nachricht geloescht, auch wenn ein aelteres Auffrischen sie mit Text liefert', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')]);

			const fertigGefrischt = fixture.componentInstance.frischeAuf();
			fixture.componentInstance.uebernimm(nachricht('e1', null as unknown as string, { geloescht: 'MODERATION' }));
			http
				.expectOne('/demo/api/v1/threads/ck1/verlauf')
				.flush({ eintraege: [nachricht('e1', 'Erste')], weitere: false });
			await fertigGefrischt;
			await fertig();

			expect(text()).not.toContain('Erste');
			expect(text()).toContain('Von einem Jugendleiter entfernt');
		});

		it('laesst eine waehrend des ersten Ladens geloeschte Nachricht geloescht', async () => {
			zeige();
			const offen = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1/verlauf'));
			fixture.componentInstance.uebernimm(nachricht('e1', null as unknown as string, { geloescht: 'MODERATION' }));
			offen.flush({ eintraege: [nachricht('e1', 'Erste')], weitere: false });
			await quittiereGelesen();
			await fertig();

			expect(text()).not.toContain('Erste');
			expect(text()).toContain('Von einem Jugendleiter entfernt');
		});

		it('verwirft Fruehere laden, wenn ein Auffrischen die Liste waehrenddessen ersetzt hat', async () => {
			zeige();
			await ladeSeite([nachricht('e3', 'Dritte', { stand: 30 })], true);

			knopf(el, 'Frühere laden').click();
			const frueher = await vi.waitFor(() => http.expectOne('/demo/api/v1/threads/ck1/verlauf?vor=e3'));
			const fertigGefrischt = fixture.componentInstance.frischeAuf();
			http
				.expectOne('/demo/api/v1/threads/ck1/verlauf')
				.flush({ eintraege: [nachricht('e4', 'Vierte', { stand: 40 })], weitere: true });
			await fertigGefrischt;
			frueher.flush({ eintraege: [nachricht('e2', 'Zweite', { stand: 20 })], weitere: false });
			await fertig();

			// Zweite gehoerte vor Dritte, nicht vor Vierte; dazwischen fehlt etwas.
			expect(inhalte()).toEqual(['Vierte']);
			expect(el.querySelector('.frueher')).not.toBeNull();
		});

		it('ordnet die eigene Nachricht nach Stand ein, wenn vor der Antwort eine juengere live kam', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste', { stand: 10 })]);
			tippe('Zweite');
			sendeKnopf().click();
			const a = schreibeAnfrage();

			fixture.componentInstance.uebernimm(nachricht('e3', 'Dritte', { stand: 30 }));
			a.flush({ eintrag: nachricht('e2', 'Zweite', { eigen: true, stand: 20 }), stand: 20 });
			await fertig();

			expect(inhalte()).toEqual(['Erste', 'Zweite', 'Dritte']);
		});

		it('zeigt die eigene Nachricht einmal, auch wenn ihr Echo vor der Antwort kam', async () => {
			zeige();
			await ladeSeite([nachricht('e1', 'Erste', { stand: 10 })]);
			tippe('Zweite');
			sendeKnopf().click();
			const a = schreibeAnfrage();
			const eigene = nachricht('e2', 'Zweite', { eigen: true, stand: 20 });

			fixture.componentInstance.uebernimm(eigene);
			a.flush({ eintrag: eigene, stand: 20 });
			await fertig();

			expect(inhalte()).toEqual(['Erste', 'Zweite']);
		});

		it('schickt beim Auffrischen mit abgelaufener Sitzung zur Anmeldung', async () => {
			const navigieren = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
			zeige();
			await ladeSeite([nachricht('e1', 'Erste')]);

			const fertigGefrischt = fixture.componentInstance.frischeAuf();
			http
				.expectOne('/demo/api/v1/threads/ck1/verlauf')
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
			await fertigGefrischt;

			expect(navigieren).toHaveBeenCalledWith(expect.stringContaining('/demo/anmelden?weiter='));
			expect(inhalte()).toEqual(['Erste']);
		});
	});
});
