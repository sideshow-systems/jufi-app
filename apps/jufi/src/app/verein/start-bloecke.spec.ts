import { HttpTestingController } from '@angular/common/http/testing';
import { type ComponentFixture } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type StartAnsicht, terminZeit } from '@jufi/domain';
import { EchtzeitAttrappe, echtzeitAttrappe } from '../admin/test-hilfen';
import { StartBloeckeComponent } from './start-bloecke';

const URL = '/demo/api/v1/start';

const LEER: StartAnsicht = { brauchtAntwort: [], alsNaechstes: [], neu: [] };

/** Ein Wirt statt createComponent: So laeuft die Eingabe slug wie auf der Startseite ueber die Bindung. */
@Component({
	imports: [StartBloeckeComponent],
	template: `<jf-start-bloecke [slug]="slug()" />`,
})
class Wirt {
	readonly slug = signal('demo');
}

describe('Start-Bloecke', () => {
	let http: HttpTestingController;
	let fixture: ComponentFixture<Wirt>;

	beforeEach(() => {
		// Mo 19.10.2026, 10:00 in Berlin; nur Date, damit Ressource und Zonen ihre Zeitgeber behalten.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'));
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(withFetch()), provideHttpClientTesting(), ...echtzeitAttrappe()],
		});
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		vi.useRealTimers();
		http.verify();
	});

	const text = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();

	async function oeffne(antwort: StartAnsicht | { status: number; body: object } | 'netz'): Promise<HTMLElement> {
		fixture = TestBed.createComponent(Wirt);
		fixture.detectChanges();
		await vi.waitFor(() => {
			fixture.detectChanges();
			const anfrage = http.expectOne(URL);
			if (antwort === 'netz') anfrage.error(new ProgressEvent('error'));
			else if ('status' in antwort) anfrage.flush(antwort.body, { status: antwort.status, statusText: 'Fehler' });
			else anfrage.flush(antwort);
		});
		await fixture.whenStable();
		fixture.detectChanges();
		return fixture.nativeElement.querySelector('jf-start-bloecke') as HTMLElement;
	}

	function abschnitt(seite: HTMLElement, titel: string): HTMLElement | undefined {
		return [...seite.querySelectorAll<HTMLElement>('jf-abschnitt')].find(
			(e) => e.querySelector('h2')?.textContent?.trim() === titel,
		);
	}

	const PUNKT_LENA = {
		threadId: 't1',
		segment: 't1-bowling',
		titel: 'Bowling',
		modulId: 'm1',
		fuerId: 'k1',
		vorname: 'Lena',
		frist: '2026-10-22T16:00:00.000Z',
	};
	const PUNKT_EIGEN = { ...PUNKT_LENA, fuerId: 'p1', vorname: null, frist: null };

	describe('Braucht deine Antwort', () => {
		it('zeigt eine Zeile je Antwortzeile, mit Vornamen und Frist, und verlinkt auf das Modul', async () => {
			const seite = await oeffne({ ...LEER, brauchtAntwort: [PUNKT_LENA, PUNKT_EIGEN] });

			const zeilen = [...(abschnitt(seite, 'Braucht deine Antwort') as HTMLElement).querySelectorAll('a')];
			expect(zeilen.map(text)).toEqual(['Lena: Bowling noch offen · bis Do 18:00', 'Bowling noch offen']);
			expect(zeilen[0].getAttribute('href')).toBe('/demo/t/t1-bowling/m/m1');
			expect(zeilen[1].getAttribute('href')).toBe('/demo/t/t1-bowling/m/m1');
		});
	});

	describe('Als Nächstes', () => {
		const TERMIN = {
			threadId: 't2',
			segment: 't2-zeltlager',
			titel: 'Zeltlager',
			termin: {
				modulId: 'm2',
				startDatum: '2026-10-24',
				endDatum: null,
				beginn: '14:00',
				ende: '16:00',
				ort: 'Vereinsheim',
				treffpunkt: null,
			},
		};

		it('zeigt Zeit, Ort und Thread-Titel und verlinkt auf das Modul', async () => {
			const seite = await oeffne({ ...LEER, alsNaechstes: [TERMIN] });

			const zeile = (abschnitt(seite, 'Als Nächstes') as HTMLElement).querySelector('a') as HTMLAnchorElement;
			expect(text(zeile.querySelector('.titel') as Element)).toBe('Zeltlager');
			// Die Zeit kommt aus terminZeit; der Test schreibt ihre Form nicht noch einmal hin.
			expect(text(zeile.querySelector('.zusatz') as Element)).toBe(`${terminZeit(TERMIN.termin)} · Vereinsheim`);
			expect(zeile.getAttribute('href')).toBe('/demo/t/t2-zeltlager/m/m2');
		});

		it('laesst den Ort weg, wenn keiner gesetzt ist, ohne einen losen Trenner', async () => {
			const seite = await oeffne({
				...LEER,
				alsNaechstes: [{ ...TERMIN, termin: { ...TERMIN.termin, ort: null } }],
			});

			const zeile = (abschnitt(seite, 'Als Nächstes') as HTMLElement).querySelector('a') as HTMLAnchorElement;
			expect(text(zeile.querySelector('.zusatz') as Element)).toBe(terminZeit(TERMIN.termin));
		});
	});

	describe('Neu seit deinem letzten Besuch', () => {
		it('zeigt Titel und Angabe und verlinkt auf den Thread', async () => {
			const seite = await oeffne({
				...LEER,
				neu: [{ threadId: 't3', segment: 't3-kegeln', titel: 'Kegeln', angabe: '2 neue Kommentare' }],
			});

			const zeile = (abschnitt(seite, 'Neu seit deinem letzten Besuch') as HTMLElement).querySelector(
				'a',
			) as HTMLAnchorElement;
			expect(text(zeile.querySelector('.titel') as Element)).toBe('Kegeln');
			expect(text(zeile.querySelector('.zusatz') as Element)).toBe('2 neue Kommentare');
			expect(zeile.getAttribute('href')).toBe('/demo/t/t3-kegeln');
		});
	});

	describe('leere Bloecke', () => {
		it('zeigt nur die Bloecke mit Inhalt', async () => {
			const seite = await oeffne({
				...LEER,
				neu: [{ threadId: 't3', segment: 't3-kegeln', titel: 'Kegeln', angabe: 'Neuer Thread' }],
			});

			expect(abschnitt(seite, 'Braucht deine Antwort')).toBeUndefined();
			expect(abschnitt(seite, 'Als Nächstes')).toBeUndefined();
			expect(abschnitt(seite, 'Neu seit deinem letzten Besuch')).toBeTruthy();
		});

		it('zeigt bei drei leeren Bloecken nichts, auch keine leere Karte, und nimmt keinen Platz ein', async () => {
			const seite = await oeffne(LEER);

			expect(seite.querySelector('jf-abschnitt, jf-karte')).toBeNull();
			expect(text(seite)).toBe('');
			expect(getComputedStyle(seite).display).toBe('none');
		});

		it('zeigt waehrend des Ladens nichts', async () => {
			fixture = TestBed.createComponent(Wirt);
			fixture.detectChanges();
			const seite = fixture.nativeElement.querySelector('jf-start-bloecke') as HTMLElement;

			expect(text(seite)).toBe('');
			await vi.waitFor(() => {
				fixture.detectChanges();
				http.expectOne(URL).flush(LEER);
			});
		});
	});

	describe('Fehler', () => {
		it('zeigt bei einem Netzfehler einen Fehlerblock fuer alle drei und laedt auf Wunsch neu', async () => {
			const seite = await oeffne('netz');

			expect(seite.querySelectorAll('[role="alert"]').length).toBe(1);
			expect(text(seite)).toContain('Keine Verbindung – nochmal versuchen');
			expect(abschnitt(seite, 'Braucht deine Antwort')).toBeUndefined();

			(seite.querySelector('button') as HTMLButtonElement).click();
			await vi.waitFor(() => {
				fixture.detectChanges();
				http
					.expectOne(URL)
					.flush({ ...LEER, neu: [{ threadId: 't3', segment: 't3-k', titel: 'Kegeln', angabe: 'Neuer Thread' }] });
			});
			await fixture.whenStable();
			fixture.detectChanges();

			expect(seite.querySelector('[role="alert"]')).toBeNull();
			expect(abschnitt(seite, 'Neu seit deinem letzten Besuch')).toBeTruthy();
		});

		it('schickt bei 401 zur Anmeldung statt einen Fehlerblock zu zeigen', async () => {
			const navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

			const seite = await oeffne({ status: 401, body: { fehler: 'nicht angemeldet' } });

			await vi.waitFor(() => expect(navigiert).toHaveBeenCalledTimes(1));
			expect(String(navigiert.mock.calls[0][0])).toMatch(/^\/demo\/anmelden\?weiter=/);
			expect(seite.querySelector('[role="alert"]')).toBeNull();
		});
	});

	describe('Echtzeit', () => {
		it('fragt nach einem Signal 250 ms spaeter erneut und zeigt die neue Antwort', async () => {
			const seite = await oeffne(LEER);

			TestBed.inject(EchtzeitAttrappe).quelle.next({
				typ: 'signal',
				signal: { stand: 43, threadId: 't3', art: 'THREAD', objektId: 't3' },
			});
			fixture.detectChanges();
			// Entprellt: sofort noch keine Anfrage.
			http.expectNone(URL);
			await vi.waitFor(() => {
				fixture.detectChanges();
				http
					.expectOne(URL)
					.flush({ ...LEER, neu: [{ threadId: 't3', segment: 't3-k', titel: 'Kegeln', angabe: 'Neuer Thread' }] });
			});
			await fixture.whenStable();
			fixture.detectChanges();

			expect(abschnitt(seite, 'Neu seit deinem letzten Besuch')).toBeTruthy();
		});
	});
});
