import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { HelferModulAnsicht } from '@jufi/domain';
import { HelferModul } from './helfer-modul';

type Position = HelferModulAnsicht['positionen'][number];
type Zeile = HelferModulAnsicht['zeilen'][number];

const SANDRA = { fuerId: 'p-sandra', name: 'Sandra M. (Mutter von Lena)', notiz: 'Marmorkuchen', eingetragenVon: null };

function position(zusatz: Partial<Position> = {}): Position {
	return { id: 'pos-kuchen', text: 'Kuchen', anzahl: 4, belegt: 1, eintraege: [SANDRA], ...zusatz };
}

function zeile(fuerId: string, vorname: string, zusatz: Partial<Zeile> = {}): Zeile {
	return { fuerId, vorname, selbst: false, darfEintragen: true, ...zusatz };
}

function helfer(zusatz: Partial<HelferModulAnsicht> = {}): HelferModulAnsicht {
	return {
		typ: 'HELFER',
		id: 'm5',
		titel: null,
		einheit: 'JUNGFISCHER',
		frist: null,
		fristAbgelaufen: false,
		positionen: [position()],
		zeilen: [zeile('k-lena', 'Lena'), zeile('k-max', 'Max')],
		...zusatz,
	};
}

/** Wie die Thread-Seite: Sie setzt die gemeldete Ansicht als neues Modul ein. */
@Component({
	imports: [HelferModul],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<jf-helfer-modul
		[modul]="modul()"
		slug="demo"
		[vorschau]="vorschau()"
		(geaendert)="geaendert($event)"
		(veraltet)="veraltet = veraltet + 1"
	/>`,
})
class Wirt {
	readonly modul = signal(helfer());
	readonly vorschau = signal(false);
	readonly gemeldet: HelferModulAnsicht[] = [];
	veraltet = 0;
	geaendert(m: HelferModulAnsicht): void {
		this.gemeldet.push(m);
		this.modul.set(m);
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Helferliste-Modul', () => {
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

	function zeige(modul: HelferModulAnsicht = helfer(), vorschau = false): void {
		fixture = TestBed.createComponent(Wirt);
		fixture.componentInstance.modul.set(modul);
		fixture.componentInstance.vorschau.set(vorschau);
		fixture.detectChanges();
		el = fixture.nativeElement as HTMLElement;
	}

	function aktualisiere(): void {
		fixture.detectChanges();
	}

	function text(wurzel: HTMLElement = el): string {
		return (wurzel.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	function stelle(): HTMLElement {
		const s = el.querySelector<HTMLElement>('.position');
		if (!s) throw new Error('keine Position');
		return s;
	}

	function knoepfe(wurzel: HTMLElement = el): HTMLButtonElement[] {
		return Array.from(wurzel.querySelectorAll('button'));
	}

	function knopfText(wurzel: HTMLElement = el): (string | undefined)[] {
		return knoepfe(wurzel).map((b) => b.textContent?.trim());
	}

	function knopf(wurzel: HTMLElement, beschriftung: string): HTMLButtonElement {
		const k = knoepfe(wurzel).find((b) => b.textContent?.trim() === beschriftung);
		if (!k) throw new Error(`kein Knopf ${beschriftung}`);
		return k;
	}

	function anfrage(methode: 'PUT' | 'DELETE', fuerId: string, positionId = 'pos-kuchen'): TestRequest {
		const a = http.expectOne(`/demo/api/v1/helfer/${positionId}/eintraege/${fuerId}`);
		expect(a.request.method).toBe(methode);
		return a;
	}

	async function fertig(): Promise<void> {
		await fixture.whenStable();
		aktualisiere();
	}

	function tippeNotiz(wert: string): void {
		const feld = el.querySelector<HTMLInputElement>('input[name="notiz"]');
		if (!feld) throw new Error('kein Notizfeld');
		feld.value = wert;
		feld.dispatchEvent(new Event('input'));
		aktualisiere();
	}

	describe('Darstellung', () => {
		it('zeigt Fuellstand und die Eingetragenen mit Notiz', () => {
			zeige();

			expect(text(stelle())).toContain('Kuchen');
			expect(text(stelle())).toContain('1/4');
			expect(text(stelle())).toContain('Sandra M. (Mutter von Lena) – Marmorkuchen');
			expect(text(stelle())).not.toContain('voll');
		});

		it('zeigt den Fuellstand auch als Balken', () => {
			zeige();

			const balken = stelle().querySelector('[role="progressbar"]');
			expect(balken?.getAttribute('aria-valuenow')).toBe('1');
			expect(balken?.getAttribute('aria-valuemax')).toBe('4');
		});

		it('ohne Notiz steht nur der Name, ohne Leerstelle dahinter', () => {
			zeige(helfer({ positionen: [position({ eintraege: [{ ...SANDRA, notiz: null }] })] }));

			const eintrag = stelle().querySelector('.eintraege li');
			expect(eintrag?.textContent?.trim()).toBe('Sandra M. (Mutter von Lena)');
		});

		it('nennt, wer eingetragen hat, unter dem Eintrag, wo der Server es mitschickt', () => {
			zeige(
				helfer({
					positionen: [position({ eintraege: [{ ...SANDRA, eingetragenVon: 'eingetragen von Thomas K.' }] })],
				}),
			);

			expect(stelle().querySelector('.von')?.textContent?.trim()).toBe('eingetragen von Thomas K.');
		});

		it('zeigt einer leeren Position Noch niemand eingetragen.', () => {
			zeige(helfer({ positionen: [position({ belegt: 0, eintraege: [] })] }));

			expect(text(stelle())).toContain('Noch niemand eingetragen.');
			expect(text(stelle())).toContain('0/4');
		});

		it('zeigt eine volle Position mit voll und ohne Eintragen-Knopf', () => {
			zeige(
				helfer({
					positionen: [position({ anzahl: 1, belegt: 1 })],
					zeilen: [zeile('k-lena', 'Lena')],
				}),
			);

			expect(text(stelle())).toContain('1/1');
			expect(text(stelle())).toContain('voll');
			expect(knopfText(stelle())).toEqual([]);
		});

		it('einer vollen Position bietet der Eingetragene weiter Austragen und Notiz aendern an', () => {
			zeige(
				helfer({
					positionen: [position({ anzahl: 1, belegt: 1, eintraege: [{ ...SANDRA, fuerId: 'k-lena' }] })],
					zeilen: [zeile('k-lena', 'Lena'), zeile('k-max', 'Max')],
				}),
			);

			expect(knopfText(stelle())).toEqual(['Lena austragen', 'Notiz ändern']);
		});

		it('hat die Ueberschrift Helferliste, mit Titel dessen Titel', () => {
			zeige();
			expect(el.querySelector('h2')?.textContent?.trim()).toBe('Helferliste');

			zeige(helfer({ titel: 'Fischerfest' }));
			expect(el.querySelector('h2')?.textContent?.trim()).toBe('Fischerfest');
		});

		it('zeigt die Frist wie die Umfrage', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
			zeige(helfer({ frist: '2026-10-22T16:00:00.000Z' }));

			expect(el.querySelector('.frist')?.textContent?.trim()).toBe('bis Do 18:00');
		});

		it('zeigt ohne Frist keine Fristzeile und nach der Frist Frist abgelaufen', () => {
			zeige();
			expect(el.querySelector('.frist')).toBeNull();

			zeige(helfer({ frist: '2026-10-19T16:00:00.000Z', fristAbgelaufen: true }));
			expect(el.querySelector('.frist')?.textContent?.trim()).toBe('Frist abgelaufen');
		});
	});

	describe('Eintragen', () => {
		it('mit einer Zeile Du heisst der Knopf Eintragen und oeffnet das Notizfeld', () => {
			zeige(helfer({ einheit: 'PERSON', zeilen: [zeile('p-flo', 'Flo', { selbst: true })] }));
			expect(knopfText(stelle())).toEqual(['Eintragen']);

			knopf(stelle(), 'Eintragen').click();
			aktualisiere();

			const feld = el.querySelector<HTMLInputElement>('input[name="notiz"]');
			expect(feld?.maxLength).toBe(80);
			expect(feld?.placeholder).toBe('z. B. Marmorkuchen');
			expect(text(el.querySelector('form') as HTMLElement)).toContain('Notiz (optional)');
		});

		it('bei Kindern gibt es je Kind einen Knopf mit dem Vornamen', () => {
			zeige();

			expect(knopfText(stelle())).toEqual(['Lena eintragen', 'Max eintragen']);
		});

		it('schickt Notiz und clientId und meldet die Ansicht der Antwort', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			tippeNotiz('Marmorkuchen');
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();

			const a = anfrage('PUT', 'k-lena');
			expect(a.request.body).toEqual({ notiz: 'Marmorkuchen', clientId: expect.stringMatching(UUID) });
			const neu = helfer({
				positionen: [
					position({
						belegt: 2,
						eintraege: [SANDRA, { fuerId: 'k-lena', name: 'Lena M.', notiz: 'Marmorkuchen', eingetragenVon: null }],
					}),
				],
			});
			a.flush({ modul: neu, stand: 50 });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toEqual([neu]);
			expect(text(stelle())).toContain('2/4');
			expect(el.querySelector('form')).toBeNull();
		});

		it('eine leere Notiz geht als null', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			tippeNotiz('   ');
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();

			const a = anfrage('PUT', 'k-lena');
			expect(a.request.body.notiz).toBeNull();
			a.flush({ modul: helfer(), stand: 50 });
			await fertig();
		});

		it('jede Anfrage bekommt eine eigene clientId', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			const erste = anfrage('PUT', 'k-lena');
			erste.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' });
			await fertig();
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			const zweite = anfrage('PUT', 'k-lena');

			expect(zweite.request.body.clientId).not.toBe(erste.request.body.clientId);
			zweite.flush({ modul: helfer(), stand: 51 });
			await fertig();
		});

		it('ein Doppeltipp schickt nur eine Anfrage; waehrend des Sendens sind die Knoepfe gesperrt', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			const absenden = knopf(el.querySelector('form') as HTMLElement, 'Eintragen');
			absenden.click();
			absenden.click();
			aktualisiere();

			const a = anfrage('PUT', 'k-lena');
			expect(knoepfe().every((b) => b.disabled)).toBe(true);
			a.flush({ modul: helfer(), stand: 50 });
			await fertig();
			expect(knoepfe().some((b) => b.disabled)).toBe(false);
		});

		it('Abbrechen schliesst das Formular ohne Anfrage', () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			knopf(el.querySelector('form') as HTMLElement, 'Abbrechen').click();
			aktualisiere();

			expect(el.querySelector('form')).toBeNull();
		});

		it('Notiz aendern oeffnet das Feld mit der bisherigen Notiz und schickt dieselbe Route', async () => {
			zeige(
				helfer({
					positionen: [position({ eintraege: [{ ...SANDRA, fuerId: 'k-lena' }] })],
				}),
			);
			expect(knopfText(stelle())).toEqual(['Lena austragen', 'Notiz ändern', 'Max eintragen']);
			knopf(stelle(), 'Notiz ändern').click();
			aktualisiere();

			const feld = el.querySelector<HTMLInputElement>('input[name="notiz"]');
			expect(feld?.value).toBe('Marmorkuchen');
			tippeNotiz('Obstkuchen');
			knopf(el.querySelector('form') as HTMLElement, 'Speichern').click();

			const a = anfrage('PUT', 'k-lena');
			expect(a.request.body.notiz).toBe('Obstkuchen');
			a.flush({ modul: helfer(), stand: 50 });
			await fertig();
		});

		describe('Fokus', () => {
			function ueberschrift(): HTMLElement {
				const h = stelle().querySelector<HTMLElement>('h3');
				if (!h) throw new Error('keine Ueberschrift');
				return h;
			}

			it('Oeffnen setzt ihn ins Notizfeld, Abbrechen auf die Ueberschrift der Position', async () => {
				zeige();
				knopf(stelle(), 'Lena eintragen').click();
				await fertig();

				expect(document.activeElement).toBe(el.querySelector('input[name="notiz"]'));

				knopf(el.querySelector('form') as HTMLElement, 'Abbrechen').click();
				await fertig();

				expect(ueberschrift().tabIndex).toBe(-1);
				expect(document.activeElement).toBe(ueberschrift());
			});

			it('Notiz aendern setzt ihn ins Notizfeld, nach dem Speichern steht er auf der Ueberschrift', async () => {
				zeige(helfer({ positionen: [position({ eintraege: [{ ...SANDRA, fuerId: 'k-lena' }] })] }));
				knopf(stelle(), 'Notiz ändern').click();
				await fertig();

				expect(document.activeElement).toBe(el.querySelector('input[name="notiz"]'));

				knopf(el.querySelector('form') as HTMLElement, 'Speichern').click();
				anfrage('PUT', 'k-lena').flush({ modul: helfer(), stand: 50 });
				await fertig();

				expect(el.querySelector('form')).toBeNull();
				expect(document.activeElement).toBe(ueberschrift());
			});

			it('schliesst eine 409 das Formular, steht er ebenfalls auf der Ueberschrift', async () => {
				zeige();
				knopf(stelle(), 'Lena eintragen').click();
				await fertig();
				knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
				anfrage('PUT', 'k-lena').flush(
					{ fehler: 'Hier sind schon alle Plätze vergeben.', code: 'VOLL' },
					{ status: 409, statusText: 'Conflict' },
				);
				await fertig();

				expect(el.querySelector('form')).toBeNull();
				expect(document.activeElement).toBe(ueberschrift());
			});
		});

		it('zeigt nur eine Zeile an, deren Eintragen der Server erlaubt', () => {
			zeige(helfer({ zeilen: [zeile('k-lena', 'Lena', { darfEintragen: false }), zeile('k-max', 'Max')] }));

			expect(knopfText(stelle())).toEqual(['Max eintragen']);
		});
	});

	describe('Austragen', () => {
		it('schickt DELETE ohne Koerper und meldet die Ansicht der Antwort', async () => {
			zeige(
				helfer({
					positionen: [position({ eintraege: [{ ...SANDRA, fuerId: 'k-lena' }] })],
				}),
			);
			knopf(stelle(), 'Lena austragen').click();

			const a = anfrage('DELETE', 'k-lena');
			expect(a.request.body).toBeNull();
			const neu = helfer({ positionen: [position({ belegt: 0, eintraege: [] })] });
			a.flush({ modul: neu, stand: 51 });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toEqual([neu]);
			expect(text(stelle())).toContain('Noch niemand eingetragen.');
		});

		it('ohne Kinder heisst der Knopf schlicht Austragen', () => {
			zeige(
				helfer({
					einheit: 'PERSON',
					positionen: [position({ eintraege: [{ ...SANDRA, fuerId: 'p-flo' }] })],
					zeilen: [zeile('p-flo', 'Flo', { selbst: true })],
				}),
			);

			expect(knopfText(stelle())).toEqual(['Austragen', 'Notiz ändern']);
		});
	});

	describe('Fehler', () => {
		it('409 VOLL: der Satz steht an der Position, die Seite wird als veraltet gemeldet', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			anfrage('PUT', 'k-lena').flush(
				{ fehler: 'Hier sind schon alle Plätze vergeben.', code: 'VOLL' },
				{ status: 409, statusText: 'Conflict' },
			);
			await fertig();

			expect(stelle().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
				'Hier sind schon alle Plätze vergeben.',
			);
			expect(fixture.componentInstance.veraltet).toBe(1);
			expect(fixture.componentInstance.gemeldet).toEqual([]);
			expect(el.querySelector('form')).toBeNull();
		});

		it('409 ARCHIVIERT zeigt den Text des Servers und meldet veraltet', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			anfrage('PUT', 'k-lena').flush(
				{ fehler: 'Dieser Thread ist archiviert.', code: 'ARCHIVIERT' },
				{ status: 409, statusText: 'Conflict' },
			);
			await fertig();

			expect(stelle().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Dieser Thread ist archiviert.');
			expect(fixture.componentInstance.veraltet).toBe(1);
		});

		it('410: Frist abgelaufen, keine Knoepfe mehr, veraltet gemeldet', async () => {
			zeige(helfer({ frist: '2026-10-22T16:00:00.000Z' }));
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			anfrage('PUT', 'k-lena').flush(
				{ fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' },
				{ status: 410, statusText: 'Gone' },
			);
			await fertig();

			expect(el.querySelector('.frist')?.textContent?.trim()).toBe('Frist abgelaufen');
			expect(stelle().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Frist abgelaufen');
			expect(knoepfe()).toHaveLength(0);
			expect(fixture.componentInstance.veraltet).toBe(1);
		});

		it('404: Satz am Modul und veraltet gemeldet, wie bei den Dateien', async () => {
			zeige(helfer({ positionen: [position({ eintraege: [{ ...SANDRA, fuerId: 'k-lena' }] })] }));
			knopf(stelle(), 'Lena austragen').click();
			anfrage('DELETE', 'k-lena').flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await fertig();

			expect(el.querySelector('jf-helfer-modul > [role="alert"]')?.textContent?.trim()).toBe(
				'Das gibt es nicht mehr, oder du darfst hier nichts ändern.',
			);
			expect(fixture.componentInstance.veraltet).toBe(1);
		});

		it('429 zeigt die Wartezeit, laesst das Formular offen und meldet nicht veraltet', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			anfrage('PUT', 'k-lena').flush(
				{ fehler: 'Zu viele Anfragen', wartenSekunden: 30 },
				{ status: 429, statusText: 'Too Many Requests' },
			);
			await fertig();

			expect(stelle().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
				'Zu viele Versuche – bitte in 30 Sekunden erneut',
			);
			expect(el.querySelector('form')).not.toBeNull();
			expect(fixture.componentInstance.veraltet).toBe(0);
			expect(knopf(el.querySelector('form') as HTMLElement, 'Eintragen').disabled).toBe(false);
		});

		it('der Fehlersatz verschwindet mit der naechsten Handlung', async () => {
			zeige();
			knopf(stelle(), 'Lena eintragen').click();
			aktualisiere();
			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			anfrage('PUT', 'k-lena').flush({ fehler: 'Kaputt' }, { status: 500, statusText: 'Fehler' });
			await fertig();
			expect(el.querySelector('[role="alert"]')).not.toBeNull();

			knopf(el.querySelector('form') as HTMLElement, 'Eintragen').click();
			aktualisiere();
			expect(el.querySelector('[role="alert"]')).toBeNull();
			anfrage('PUT', 'k-lena').flush({ modul: helfer(), stand: 50 });
			await fertig();
		});
	});

	describe('Vorschau', () => {
		it('zeigt keine Knoepfe, auch wenn Zeilen da waeren', () => {
			zeige(helfer(), true);

			expect(knoepfe()).toHaveLength(0);
			expect(text(stelle())).toContain('Kuchen');
			expect(text(stelle())).toContain('Sandra M. (Mutter von Lena) – Marmorkuchen');
		});
	});
});
