import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { UmfrageAnsicht, ZeilenAnsicht } from '@jufi/domain';
import { UmfrageModul } from './umfrage-modul';

const TEILNAHME = [
	{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
	{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
	{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
];

const ESSEN = [
	{ id: 'o-pizza', schluessel: 'pizza', text: 'Pizza' },
	{ id: 'o-pasta', schluessel: 'pasta', text: 'Pasta' },
	{ id: 'o-salat', schluessel: 'salat', text: 'Salat' },
];

function zeile(fuerId: string, vorname: string, zusatz: Partial<ZeilenAnsicht> = {}): ZeilenAnsicht {
	return { fuerId, vorname, selbst: false, optionIds: [], eingetragenVon: null, darfAntworten: true, ...zusatz };
}

function umfrage(zusatz: Partial<UmfrageAnsicht> = {}): UmfrageAnsicht {
	return {
		typ: 'UMFRAGE',
		id: 'm3',
		titel: null,
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		frist: null,
		fristAbgelaufen: false,
		optionen: TEILNAHME,
		zeilen: [zeile('k-lena', 'Lena'), zeile('k-max', 'Max')],
		ergebnis: null,
		...zusatz,
	};
}

/** Wie die Thread-Seite: Sie setzt die gemeldete Umfrage als neues Modul ein. */
@Component({
	imports: [UmfrageModul],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<jf-umfrage-modul [modul]="modul()" slug="demo" (geaendert)="geaendert($event)" />`,
})
class Wirt {
	readonly modul = signal(umfrage());
	readonly gemeldet: UmfrageAnsicht[] = [];
	geaendert(m: UmfrageAnsicht): void {
		this.gemeldet.push(m);
		this.modul.set(m);
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Umfrage-Modul', () => {
	let http: HttpTestingController;
	let fixture: ComponentFixture<Wirt>;
	let el: HTMLElement;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(withFetch()), provideHttpClientTesting()],
		});
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => {
		http.verify();
		vi.useRealTimers();
	});

	function zeige(modul: UmfrageAnsicht = umfrage()): void {
		fixture = TestBed.createComponent(Wirt);
		fixture.componentInstance.modul.set(modul);
		fixture.detectChanges();
		el = fixture.nativeElement as HTMLElement;
	}

	function aktualisiere(): void {
		fixture.detectChanges();
	}

	function zeilen(): HTMLElement[] {
		return Array.from(el.querySelectorAll<HTMLElement>('.zeile'));
	}

	function zeileVon(name: string): HTMLElement {
		const z = zeilen().find((x) => x.querySelector('.name')?.textContent?.trim() === name);
		if (!z) throw new Error(`keine Zeile ${name}`);
		return z;
	}

	function knoepfe(wurzel: HTMLElement): HTMLButtonElement[] {
		return Array.from(wurzel.querySelectorAll('button'));
	}

	function knopf(wurzel: HTMLElement, text: string): HTMLButtonElement {
		const k = knoepfe(wurzel).find((b) => b.textContent?.trim() === text);
		if (!k) throw new Error(`kein Knopf ${text}`);
		return k;
	}

	function text(wurzel: HTMLElement = el): string {
		return (wurzel.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	function anfrage(fuerId: string): TestRequest {
		const a = http.expectOne(`/demo/api/v1/umfragen/m3/antworten/${fuerId}`);
		expect(a.request.method).toBe('PUT');
		return a;
	}

	async function fertig(): Promise<void> {
		await fixture.whenStable();
		aktualisiere();
	}

	describe('Teilnahme', () => {
		it('zeigt je Zeile die drei Teilnahme-Knoepfe in voller Tippflaeche', () => {
			zeige();

			expect(zeilen()).toHaveLength(2);
			for (const name of ['Lena', 'Max']) {
				const k = knoepfe(zeileVon(name));
				expect(k.map((b) => b.textContent?.trim())).toEqual(['✓ Dabei', '? Vielleicht', '✗ Abgesagt']);
				// .knopf traegt min-height: var(--tippflaeche), also 44 px.
				for (const b of k) expect(b.classList).toContain('knopf');
			}
		});

		it('laesst Vielleicht weg, wenn die Umfrage es nicht anbietet', () => {
			zeige(umfrage({ optionen: TEILNAHME.filter((o) => o.schluessel !== 'vielleicht') }));

			expect(knoepfe(zeileVon('Lena')).map((b) => b.textContent?.trim())).toEqual(['✓ Dabei', '✗ Abgesagt']);
		});

		it('ein Tipp schickt die Antwort sofort und setzt die neue Umfrage ein', async () => {
			zeige();
			knopf(zeileVon('Lena'), '✓ Dabei').click();

			const a = anfrage('k-lena');
			expect(a.request.body.optionIds).toEqual(['o-dabei']);
			expect(a.request.body.clientId).toMatch(UUID);
			const neu = umfrage({ zeilen: [zeile('k-lena', 'Lena', { optionIds: ['o-dabei'] }), zeile('k-max', 'Max')] });
			a.flush({ modul: neu, stand: 50 });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toEqual([neu]);
			const lena = zeileVon('Lena');
			expect(lena.querySelector('jf-pille')?.textContent?.trim()).toBe('✓ Dabei');
			expect(knoepfe(lena).map((b) => b.textContent?.trim())).toEqual(['ändern']);
			expect(knoepfe(zeileVon('Max'))).toHaveLength(3);
		});

		it('jede Antwort bekommt eine eigene clientId', async () => {
			zeige();
			knopf(zeileVon('Lena'), '✓ Dabei').click();
			const erste = anfrage('k-lena');
			erste.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' });
			await fertig();
			knopf(zeileVon('Lena'), '✓ Dabei').click();
			const zweite = anfrage('k-lena');

			expect(zweite.request.body.clientId).not.toBe(erste.request.body.clientId);
			zweite.flush({ modul: umfrage(), stand: 51 });
			await fertig();
		});

		it('zeigt Vielleicht und Abgesagt mit ihrem Zeichen', () => {
			zeige(
				umfrage({
					zeilen: [
						zeile('k-lena', 'Lena', { optionIds: ['o-vielleicht'] }),
						zeile('k-max', 'Max', { optionIds: ['o-abgesagt'] }),
					],
				}),
			);

			expect(zeileVon('Lena').querySelector('jf-pille')?.textContent?.trim()).toBe('? Vielleicht');
			expect(zeileVon('Max').querySelector('jf-pille')?.textContent?.trim()).toBe('✗ Abgesagt');
		});

		it('ändern zeigt die Knoepfe wieder mit der bisherigen Antwort markiert', () => {
			zeige(umfrage({ zeilen: [zeile('k-lena', 'Lena', { optionIds: ['o-abgesagt'] })] }));
			knopf(zeileVon('Lena'), 'ändern').click();
			aktualisiere();

			const k = knoepfe(zeileVon('Lena'));
			expect(k.map((b) => b.textContent?.trim())).toEqual(['✓ Dabei', '? Vielleicht', '✗ Abgesagt']);
			expect(k.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
		});
	});

	describe('Mehrfachauswahl', () => {
		const mehrfach = () =>
			umfrage({
				frage: 'Was essen wir?',
				teilnahme: false,
				mehrfach: true,
				optionen: ESSEN,
				zeilen: [zeile('p-flo', 'Flo', { selbst: true })],
			});

		it('hat je Option einen Haken; Antworten geht erst mit einer Auswahl', () => {
			zeige(mehrfach());

			const du = zeileVon('Du');
			const haken = Array.from(du.querySelectorAll<HTMLInputElement>('label.haken input[type=checkbox]'));
			expect(haken).toHaveLength(3);
			expect(knopf(du, 'Antworten').disabled).toBe(true);

			haken[0]!.click();
			aktualisiere();
			expect(knopf(du, 'Antworten').disabled).toBe(false);

			haken[0]!.click();
			aktualisiere();
			expect(knopf(du, 'Antworten').disabled).toBe(true);
		});

		it('schickt die gewaehlten Optionen gemeinsam', async () => {
			zeige(mehrfach());
			const du = zeileVon('Du');
			const haken = Array.from(du.querySelectorAll<HTMLInputElement>('label.haken input'));
			haken[2]!.click();
			haken[0]!.click();
			aktualisiere();
			knopf(du, 'Antworten').click();

			const a = anfrage('p-flo');
			expect(a.request.body.optionIds).toEqual(['o-pizza', 'o-salat']);
			a.flush({
				modul: { ...mehrfach(), zeilen: [zeile('p-flo', 'Flo', { selbst: true, optionIds: ['o-pizza', 'o-salat'] })] },
				stand: 50,
			});
			await fertig();

			expect(zeileVon('Du').querySelector('jf-pille')?.textContent?.trim()).toBe('Pizza, Salat');
		});
	});

	describe('Zeilen', () => {
		it('ohne Antwortrecht und ohne Antwort steht keine Antwort da, ohne Knoepfe', () => {
			zeige(umfrage({ zeilen: [zeile('k-lena', 'Lena', { darfAntworten: false })] }));

			const lena = zeileVon('Lena');
			expect(text(lena)).toContain('keine Antwort');
			expect(knoepfe(lena)).toHaveLength(0);
		});

		it('ohne Antwortrecht bleibt eine Antwort sichtbar, ohne ändern', () => {
			zeige(umfrage({ zeilen: [zeile('k-lena', 'Lena', { darfAntworten: false, optionIds: ['o-dabei'] })] }));

			const lena = zeileVon('Lena');
			expect(lena.querySelector('jf-pille')?.textContent?.trim()).toBe('✓ Dabei');
			expect(knoepfe(lena)).toHaveLength(0);
		});

		it('die eigene Zeile heisst Du, die anderen tragen den Vornamen', () => {
			zeige(umfrage({ einheit: 'PERSON', zeilen: [zeile('p-flo', 'Flo', { selbst: true }), zeile('k-lena', 'Lena')] }));

			expect(zeilen().map((z) => z.querySelector('.name')?.textContent?.trim())).toEqual(['Du', 'Lena']);
		});

		it('wer eingetragen hat, steht unter der Zeile', () => {
			zeige(
				umfrage({
					zeilen: [zeile('k-lena', 'Lena', { optionIds: ['o-dabei'], eingetragenVon: 'eingetragen von Thomas K.' })],
				}),
			);

			expect(zeileVon('Lena').querySelector('.von')?.textContent?.trim()).toBe('eingetragen von Thomas K.');
		});
	});

	describe('Frist und Fehler', () => {
		it('zeigt die Frist als bis Do 18:00', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
			zeige(umfrage({ frist: '2026-10-22T16:00:00.000Z' }));

			expect(el.querySelector('.frist')?.textContent?.trim()).toBe('bis Do 18:00');
		});

		it('zeigt ohne Frist keine Fristzeile', () => {
			zeige();

			expect(el.querySelector('.frist')).toBeNull();
		});

		it('meldet der Server 410, steht Frist abgelaufen da und die Knoepfe verschwinden', async () => {
			zeige(umfrage({ frist: '2026-10-22T16:00:00.000Z' }));
			knopf(zeileVon('Lena'), '✓ Dabei').click();
			anfrage('k-lena').flush(
				{ fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' },
				{ status: 410, statusText: 'Gone' },
			);
			await fertig();

			expect(el.querySelector('.frist')?.textContent?.trim()).toBe('Frist abgelaufen');
			expect(knoepfe(el)).toHaveLength(0);
			expect(text(zeileVon('Lena'))).toContain('keine Antwort');
		});

		it('nach der Frist bleiben die Knoepfe, wo der Server Nachtragen erlaubt', () => {
			zeige(umfrage({ frist: '2026-10-19T16:00:00.000Z', fristAbgelaufen: true }));

			expect(el.querySelector('.frist')?.textContent?.trim()).toBe('Frist abgelaufen');
			expect(knoepfe(zeileVon('Lena'))).toHaveLength(3);
		});

		it('zeigt bei 429 die Wartezeit und laesst wieder antworten', async () => {
			zeige();
			knopf(zeileVon('Lena'), '✓ Dabei').click();
			anfrage('k-lena').flush(
				{ fehler: 'Zu viele Anfragen', wartenSekunden: 30 },
				{ status: 429, statusText: 'Too Many Requests' },
			);
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
				'Zu viele Versuche – bitte in 30 Sekunden erneut',
			);
			expect(knopf(zeileVon('Lena'), '✓ Dabei').disabled).toBe(false);
		});

		it('ein Doppeltipp schickt nur eine Anfrage; waehrend des Sendens sind die Knoepfe gesperrt', async () => {
			zeige();
			const dabei = knopf(zeileVon('Lena'), '✓ Dabei');
			dabei.click();
			dabei.click();
			aktualisiere();

			const a = anfrage('k-lena');
			expect(knoepfe(el).every((b) => b.disabled)).toBe(true);
			a.flush({ modul: umfrage(), stand: 50 });
			await fertig();
			expect(knoepfe(el).some((b) => b.disabled)).toBe(false);
		});
	});

	describe('Ergebnis', () => {
		const namen = (...n: string[]) => n.map((name, i) => ({ fuerId: `x${i}`, name, eingetragenVon: null }));

		function ergebnisZeilen(): string[] {
			// Zahl und Namen trennt der Abstand im Stil, nicht ein Leerzeichen im Text.
			return Array.from(el.querySelectorAll('.ergebnis li')).map((li) =>
				Array.from(li.children)
					.map((teil) => text(teil as HTMLElement))
					.join(' '),
			);
		}

		it('mit Namen: je Option Anzahl und Namen, dazu Offen', () => {
			zeige(
				umfrage({
					ergebnis: {
						ansicht: 'NAMEN',
						optionen: [
							{ optionId: 'o-dabei', anzahl: 2, namen: namen('Lena M.', 'Max M.') },
							{ optionId: 'o-vielleicht', anzahl: 0, namen: [] },
							{ optionId: 'o-abgesagt', anzahl: 0, namen: [] },
						],
						offen: { anzahl: 1, namen: namen('Tim B.') },
					},
				}),
			);

			expect(ergebnisZeilen()).toEqual([
				'Dabei (2) Lena M., Max M.',
				'Vielleicht (0)',
				'Abgesagt (0)',
				'Offen (1) Tim B.',
			]);
		});

		it('nennt den Vermerk eingetragen von, wo der Server ihn mitschickt', () => {
			zeige(
				umfrage({
					ergebnis: {
						ansicht: 'NAMEN',
						optionen: [
							{
								optionId: 'o-abgesagt',
								anzahl: 1,
								namen: [{ fuerId: 'k-tim', name: 'Tim B.', eingetragenVon: 'Thomas K.' }],
							},
						],
						offen: { anzahl: 0, namen: [] },
					},
				}),
			);

			expect(ergebnisZeilen()[0]).toBe('Abgesagt (1) Tim B. (eingetragen von Thomas K.)');
		});

		it('als Summe nur Zahlen', () => {
			zeige(
				umfrage({
					ergebnis: {
						ansicht: 'SUMME',
						optionen: [
							{ optionId: 'o-dabei', anzahl: 2, namen: null },
							{ optionId: 'o-vielleicht', anzahl: 1, namen: null },
							{ optionId: 'o-abgesagt', anzahl: 0, namen: null },
						],
						offen: { anzahl: 3, namen: null },
					},
				}),
			);

			expect(ergebnisZeilen()).toEqual(['Dabei (2)', 'Vielleicht (1)', 'Abgesagt (0)', 'Offen (3)']);
		});

		it('ohne Ergebnis kein Ergebnisblock', () => {
			zeige();

			expect(el.querySelector('.ergebnis')).toBeNull();
		});
	});
});
