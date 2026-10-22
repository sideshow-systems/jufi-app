import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { FahrtModulAnsicht } from '@jufi/domain';
import { FahrtModul } from './fahrt-modul';

type Richtung = FahrtModulAnsicht['richtungen'][number];
type Auto = Richtung['autos'][number];
type Kind = Auto['mitfahrer'][number];
type Ziele = Kind['umsetzen'];
type Braucht = Richtung['brauchtMitfahrt'][number];

const KEIN_ZIEL: Ziele = { autoIds: [], selbst: false };

function kind(kindId: string, name: string, zusatz: Partial<Kind> = {}): Kind {
	return { kindId, name, nichtMehrDabei: false, darfHerausnehmen: false, umsetzen: KEIN_ZIEL, ...zusatz };
}

function braucht(kindId: string, name: string, umsetzen: Ziele = KEIN_ZIEL): Braucht {
	return { kindId, name, umsetzen };
}

function auto(id: string, zusatz: Partial<Auto> = {}): Auto {
	return {
		id,
		fahrerId: 'p-thomas',
		fahrer: 'Thomas K.',
		eigenes: false,
		darfAendern: false,
		plaetze: 2,
		frei: 2,
		abfahrtTag: '2026-10-23',
		abfahrtZeit: '15:30',
		ort: 'Vereinsheim',
		notiz: null,
		mitfahrer: [],
		...zusatz,
	};
}

const SANDRAS_AUTO = auto('a1', {
	fahrerId: 'p-sandra',
	fahrer: 'Sandra M. (Mutter von Lena)',
	eigenes: true,
	darfAendern: true,
	plaetze: 3,
	frei: 2,
	notiz: 'Kindersitze vorhanden',
	mitfahrer: [kind('k-jonas', 'Jonas B.')],
});

function hin(zusatz: Partial<Richtung> = {}): Richtung {
	return {
		richtung: 'HIN',
		vorschlagTag: '2026-10-23',
		darfAnbieten: true,
		autos: [SANDRAS_AUTO, auto('a2')],
		brauchtMitfahrt: [braucht('k-lena', 'Lena M.'), braucht('k-mia', 'Mia S.')],
		kommtSelbst: [],
		...zusatz,
	};
}

function rueck(zusatz: Partial<Richtung> = {}): Richtung {
	return {
		richtung: 'RUECK',
		vorschlagTag: '2026-10-25',
		darfAnbieten: true,
		autos: [auto('a9', { fahrer: 'Petra W.', fahrerId: 'p-petra', ort: 'Bahnhof' })],
		brauchtMitfahrt: [],
		kommtSelbst: [],
		...zusatz,
	};
}

function fahrt(zusatz: Partial<FahrtModulAnsicht> = {}): FahrtModulAnsicht {
	return {
		typ: 'FAHRT',
		id: 'm7',
		titel: null,
		richtungen: [hin()],
		kinder: [{ kindId: 'k-lena', vorname: 'Lena', selbst: false }],
		...zusatz,
	};
}

/** Wie die Thread-Seite: Sie setzt die gemeldete Ansicht als neues Modul ein. */
@Component({
	imports: [FahrtModul],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<jf-fahrt-modul
		[modul]="modul()"
		slug="demo"
		[vorschau]="vorschau()"
		(geaendert)="geaendert($event)"
		(veraltet)="veraltet = veraltet + 1"
	/>`,
})
class Wirt {
	readonly modul = signal(fahrt());
	readonly vorschau = signal(false);
	readonly gemeldet: FahrtModulAnsicht[] = [];
	veraltet = 0;
	geaendert(m: FahrtModulAnsicht): void {
		this.gemeldet.push(m);
		this.modul.set(m);
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Fahrgemeinschaft-Modul', () => {
	let http: HttpTestingController;
	let fixture: ComponentFixture<Wirt>;
	let el: HTMLElement;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(withFetch()), provideHttpClientTesting()],
		});
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	function zeige(modul: FahrtModulAnsicht = fahrt(), vorschau = false): void {
		fixture = TestBed.createComponent(Wirt);
		fixture.componentInstance.modul.set(modul);
		fixture.componentInstance.vorschau.set(vorschau);
		fixture.detectChanges();
		el = fixture.nativeElement as HTMLElement;
	}

	function aktualisiere(): void {
		fixture.detectChanges();
	}

	async function fertig(): Promise<void> {
		await fixture.whenStable();
		aktualisiere();
	}

	function text(wurzel: Element | null = el): string {
		return (wurzel?.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	function knoepfe(wurzel: Element = el): HTMLButtonElement[] {
		return Array.from(wurzel.querySelectorAll('button'));
	}

	function knopfText(wurzel: Element = el): (string | undefined)[] {
		return knoepfe(wurzel).map((b) => b.textContent?.trim());
	}

	function knopf(wurzel: Element, beschriftung: string): HTMLButtonElement {
		const k = knoepfe(wurzel).find((b) => b.textContent?.trim() === beschriftung);
		if (!k) throw new Error(`kein Knopf ${beschriftung}`);
		return k;
	}

	function karte(id: string): HTMLElement {
		const k = el.querySelector<HTMLElement>(`[data-auto="${id}"]`);
		if (!k) throw new Error(`kein Auto ${id}`);
		return k;
	}

	function zeileVon(kindId: string): HTMLElement {
		const z = el.querySelector<HTMLElement>(`[data-kind="${kindId}"]`);
		if (!z) throw new Error(`keine Zeile ${kindId}`);
		return z;
	}

	function formular(): HTMLFormElement {
		const f = el.querySelector('form');
		if (!f) throw new Error('kein Formular');
		return f;
	}

	function feld(name: string): HTMLInputElement {
		const f = formular().querySelector<HTMLInputElement>(`[name="${name}"]`);
		if (!f) throw new Error(`kein Feld ${name}`);
		return f;
	}

	function tippe(name: string, wert: string): void {
		const f = feld(name);
		f.value = wert;
		f.dispatchEvent(new Event('input'));
		aktualisiere();
	}

	function ueberschrift(): HTMLElement {
		const h = el.querySelector<HTMLElement>('h3');
		if (!h) throw new Error('keine Ueberschrift');
		return h;
	}

	function mitfahrt(methode: 'PUT' | 'DELETE', richtung: 'hin' | 'rueck', kindId: string): TestRequest {
		const a = http.expectOne(`/demo/api/v1/fahrten/m7/${richtung}/${kindId}`);
		expect(a.request.method).toBe(methode);
		return a;
	}

	function fehler409(a: TestRequest, code: string, satz: string): void {
		a.flush({ fehler: satz, code }, { status: 409, statusText: 'Conflict' });
	}

	describe('Darstellung', () => {
		it('zeigt je Auto Fahrer, Abfahrt, Ort, Notiz, freie Plaetze und Mitfahrer', () => {
			zeige(
				fahrt({
					richtungen: [
						hin({
							autos: [
								auto('a1', {
									fahrer: 'Sandra M. (Mutter von Lena)',
									plaetze: 4,
									frei: 2,
									notiz: 'Kindersitze vorhanden',
									mitfahrer: [kind('k-lena', 'Lena M.'), kind('k-tom', 'Tom K.', { nichtMehrDabei: true })],
								}),
							],
						}),
					],
				}),
			);

			const t = text(karte('a1'));
			expect(t).toContain('Sandra M. (Mutter von Lena)');
			expect(t).toContain('Fr 23.10.');
			expect(t).toContain('15:30');
			expect(t).toContain('Vereinsheim');
			expect(t).toContain('Kindersitze vorhanden');
			expect(t).toContain('2 frei');
			expect(t).toContain('Lena M.');
			expect(text(zeileVon('k-tom'))).toContain('Tom K.');
			expect(text(zeileVon('k-tom'))).toContain('nicht mehr dabei');
			expect(text(zeileVon('k-lena'))).not.toContain('nicht mehr dabei');
		});

		it('ein Auto ohne Tag, Zeit, Ort und Notiz zeigt nur Fahrer und Platz', () => {
			zeige(
				fahrt({
					richtungen: [hin({ autos: [auto('a2', { abfahrtTag: null, abfahrtZeit: null, ort: null })] })],
				}),
			);

			expect(text(karte('a2'))).toContain('Thomas K.');
			expect(text(karte('a2'))).toContain('2 frei');
			expect(karte('a2').querySelector('.info')).toBeNull();
		});

		it('ein Auto ohne freien Platz heisst voll und bietet kein Einsteigen an', () => {
			zeige(
				fahrt({
					richtungen: [hin({ autos: [auto('a2', { plaetze: 1, frei: 0, mitfahrer: [kind('k-jonas', 'Jonas B.')] })] })],
				}),
			);

			expect(text(karte('a2'))).toContain('voll');
			expect(text(karte('a2'))).not.toContain('0 frei');
			expect(knopfText(karte('a2'))).toEqual([]);
		});

		it('zeigt unter Braucht noch Mitfahrt die Kinder ohne Eintrag, leer den Satz dafuer', () => {
			zeige();
			expect(text(el.querySelector('[data-abschnitt="braucht"]'))).toContain('Braucht noch Mitfahrt');
			expect(text(el.querySelector('[data-abschnitt="braucht"]'))).toContain('Mia S.');

			zeige(fahrt({ richtungen: [hin({ brauchtMitfahrt: [] })] }));
			expect(text(el.querySelector('[data-abschnitt="braucht"]'))).toContain('Alle haben eine Mitfahrt.');
		});

		it('zeigt Kommt selbst mit den Kindern, die dort stehen, und ohne Eintraege nur die Knoepfe dafuer', () => {
			zeige(fahrt({ richtungen: [hin({ kommtSelbst: [kind('k-max', 'Max M.')] })] }));
			expect(text(el.querySelector('[data-abschnitt="selbst"]'))).toContain('Max M.');

			zeige(fahrt({ kinder: [] }));
			expect(el.querySelector('[data-abschnitt="selbst"]')).toBeNull();
		});

		it('hat die Ueberschrift Fahrgemeinschaft, mit Titel dessen Titel', () => {
			zeige();
			expect(el.querySelector('h2')?.textContent?.trim()).toBe('Fahrgemeinschaft');

			zeige(fahrt({ titel: 'Zeltlager' }));
			expect(el.querySelector('h2')?.textContent?.trim()).toBe('Zeltlager');
		});

		it('mit nur einer Richtung steht sie als Ueberschrift da, ohne Umschalter', () => {
			zeige();
			expect(ueberschrift().textContent?.trim()).toBe('Hinfahrt');
			expect(el.querySelector('[role="tablist"]')).toBeNull();

			zeige(fahrt({ richtungen: [rueck()] }));
			expect(ueberschrift().textContent?.trim()).toBe('Rückfahrt');
			expect(el.querySelector('[role="tablist"]')).toBeNull();
		});

		it('mit zwei Richtungen wechselt der Umschalter zwischen Hin und Rueck', () => {
			zeige(fahrt({ richtungen: [hin(), rueck()] }));
			const reiter = () => Array.from(el.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]'));

			expect(reiter().map((r) => r.textContent?.trim())).toEqual(['Hin', 'Rück']);
			expect(reiter().map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false']);
			expect(ueberschrift().textContent?.trim()).toBe('Hinfahrt');
			expect(text()).toContain('Sandra M. (Mutter von Lena)');
			expect(text()).not.toContain('Petra W.');

			reiter()[1]?.click();
			aktualisiere();

			expect(reiter().map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true']);
			expect(ueberschrift().textContent?.trim()).toBe('Rückfahrt');
			expect(text()).toContain('Petra W.');
			expect(text()).not.toContain('Sandra M. (Mutter von Lena)');
		});

		it('die Pfeiltasten wechseln den Reiter und nehmen den Fokus mit', () => {
			zeige(fahrt({ richtungen: [hin(), rueck()] }));
			const reiter = () => Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));
			document.body.append(el);
			try {
				reiter()[0]?.focus();
				reiter()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
				aktualisiere();

				expect(reiter()[1]?.getAttribute('aria-selected')).toBe('true');
				expect(document.activeElement).toBe(reiter()[1]);
			} finally {
				el.remove();
			}
		});

		it('nach einer Antwort bleibt die gewaehlte Richtung stehen', async () => {
			zeige(fahrt({ richtungen: [hin(), rueck({ brauchtMitfahrt: [braucht('k-lena', 'Lena M.')] })] }));
			el.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click();
			aktualisiere();
			knopf(el.querySelector('[data-abschnitt="selbst"]') as HTMLElement, 'Lena kommt selbst').click();
			mitfahrt('PUT', 'rueck', 'k-lena').flush({
				modul: fahrt({ richtungen: [hin(), rueck()] }),
				stand: 50,
			});
			await fertig();

			expect(ueberschrift().textContent?.trim()).toBe('Rückfahrt');
		});
	});

	describe('Einsteigen und Kommt selbst', () => {
		it('Lena einsteigen schickt PUT mit autoId und clientId und meldet die Ansicht der Antwort', async () => {
			zeige();
			knopf(karte('a2'), 'Lena einsteigen').click();

			const a = mitfahrt('PUT', 'hin', 'k-lena');
			expect(a.request.body).toEqual({ autoId: 'a2', clientId: expect.stringMatching(UUID) });
			const neu = fahrt({
				richtungen: [
					hin({
						autos: [SANDRAS_AUTO, auto('a2', { frei: 1, mitfahrer: [kind('k-lena', 'Lena M.')] })],
						brauchtMitfahrt: [braucht('k-mia', 'Mia S.')],
					}),
				],
			});
			a.flush({ modul: neu, stand: 50 });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toEqual([neu]);
			expect(text(karte('a2'))).toContain('Lena M.');
			expect(document.activeElement).toBe(ueberschrift());
		});

		it('bietet Einsteigen an jedem Auto mit freiem Platz, nicht dort, wo das Kind schon sitzt', () => {
			zeige(
				fahrt({
					richtungen: [
						hin({
							autos: [
								auto('a1', { frei: 1, plaetze: 2, mitfahrer: [kind('k-lena', 'Lena M.', { darfHerausnehmen: true })] }),
								auto('a2'),
								auto('a3', { plaetze: 1, frei: 0, mitfahrer: [kind('k-jonas', 'Jonas B.')] }),
							],
							brauchtMitfahrt: [],
						}),
					],
				}),
			);

			expect(knopfText(karte('a1'))).toEqual(['Herausnehmen']);
			expect(knopfText(karte('a2'))).toEqual(['Lena einsteigen']);
			expect(knopfText(karte('a3'))).toEqual([]);
		});

		it('die Person selbst heisst schlicht Einsteigen und Kommt selbst', () => {
			zeige(
				fahrt({
					kinder: [{ kindId: 'k-flo', vorname: 'Flo', selbst: true }],
					richtungen: [hin({ autos: [auto('a2')] })],
				}),
			);

			expect(knopfText(karte('a2'))).toEqual(['Einsteigen']);
			expect(knopf(karte('a2'), 'Einsteigen').getAttribute('aria-label')).toBe('Einsteigen bei Thomas K.');
			expect(knopfText(el.querySelector('[data-abschnitt="selbst"]') as HTMLElement)).toEqual(['Kommt selbst']);
		});

		it('der zugaengliche Name von Einsteigen nennt den Fahrer wie die Karte und beginnt mit dem sichtbaren Text', () => {
			zeige();

			expect(knopf(karte('a1'), 'Lena einsteigen').getAttribute('aria-label')).toBe(
				'Lena einsteigen bei Sandra M. (Mutter von Lena)',
			);
			expect(knopf(karte('a2'), 'Lena einsteigen').getAttribute('aria-label')).toBe('Lena einsteigen bei Thomas K.');
		});

		it('Lena kommt selbst schickt autoId null; wer dort steht, bekommt den Knopf nicht mehr', async () => {
			zeige();
			const abschnitt = () => el.querySelector('[data-abschnitt="selbst"]') as HTMLElement;
			expect(knopfText(abschnitt())).toEqual(['Lena kommt selbst']);
			knopf(abschnitt(), 'Lena kommt selbst').click();

			const a = mitfahrt('PUT', 'hin', 'k-lena');
			expect(a.request.body).toEqual({ autoId: null, clientId: expect.stringMatching(UUID) });
			a.flush({
				modul: fahrt({
					richtungen: [hin({ kommtSelbst: [kind('k-lena', 'Lena M.', { darfHerausnehmen: true })] })],
				}),
				stand: 50,
			});
			await fertig();

			expect(knopfText(abschnitt())).toEqual(['Herausnehmen']);
		});

		it('Herausnehmen schickt DELETE ohne Koerper', async () => {
			zeige(
				fahrt({
					richtungen: [
						hin({
							autos: [auto('a2', { mitfahrer: [kind('k-lena', 'Lena M.', { darfHerausnehmen: true })] })],
							brauchtMitfahrt: [],
						}),
					],
				}),
			);
			knopf(zeileVon('k-lena'), 'Herausnehmen').click();

			const a = mitfahrt('DELETE', 'hin', 'k-lena');
			expect(a.request.body).toBeNull();
			a.flush({ modul: fahrt(), stand: 51 });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toHaveLength(1);
		});

		it('Herausnehmen steht nur dort, wo der Server es erlaubt', () => {
			zeige(
				fahrt({
					richtungen: [hin({ autos: [auto('a2', { mitfahrer: [kind('k-jonas', 'Jonas B.')] })] })],
				}),
			);

			expect(knopfText(zeileVon('k-jonas'))).toEqual([]);
		});

		it('die Rueckrichtung geht klein in die Adresse', async () => {
			zeige(fahrt({ richtungen: [rueck({ brauchtMitfahrt: [braucht('k-lena', 'Lena M.')] })] }));
			knopf(karte('a9'), 'Lena einsteigen').click();

			mitfahrt('PUT', 'rueck', 'k-lena').flush({ modul: fahrt(), stand: 50 });
			await fertig();
		});
	});

	describe('Auto anbieten und aendern', () => {
		it('Auto anbieten oeffnet das Formular mit dem vorgeschlagenen Tag und dem Fokus im ersten Feld', async () => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			await fertig();

			expect(text(formular())).toContain('Plätze für Kinder');
			expect(text(formular())).toContain('Abfahrt am');
			expect(text(formular())).toContain('Uhrzeit');
			expect(text(formular())).toContain('Treffpunkt');
			expect(text(formular())).toContain('Notiz (optional)');
			expect(feld('abfahrtTag').value).toBe('2026-10-23');
			expect(feld('plaetze').value).toBe('');
			expect(document.activeElement).toBe(feld('plaetze'));
			expect(knopfText(formular())).toEqual(['Anbieten', 'Abbrechen']);
		});

		it('Anbieten schickt POST mit Richtung HIN und clientId und meldet die Ansicht der Antwort', async () => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			tippe('plaetze', '3');
			tippe('abfahrtZeit', '15:30');
			tippe('ort', '  Vereinsheim ');
			knopf(formular(), 'Anbieten').click();

			const a = http.expectOne('/demo/api/v1/fahrten/m7/autos');
			expect(a.request.method).toBe('POST');
			expect(a.request.body).toEqual({
				plaetze: 3,
				abfahrtTag: '2026-10-23',
				abfahrtZeit: '15:30',
				ort: 'Vereinsheim',
				notiz: null,
				richtung: 'HIN',
				clientId: expect.stringMatching(UUID),
			});
			const neu = fahrt({ richtungen: [hin({ darfAnbieten: false })] });
			a.flush({ modul: neu, stand: 50 }, { status: 201, statusText: 'Created' });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toEqual([neu]);
			expect(el.querySelector('form')).toBeNull();
			expect(document.activeElement).toBe(ueberschrift());
		});

		it('in der Rueckrichtung geht RUECK mit und der Vorschlag ist der letzte Tag', () => {
			zeige(fahrt({ richtungen: [rueck()] }));
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			expect(feld('abfahrtTag').value).toBe('2026-10-25');
			tippe('plaetze', '2');
			knopf(formular(), 'Anbieten').click();

			const a = http.expectOne('/demo/api/v1/fahrten/m7/autos');
			expect(a.request.body.richtung).toBe('RUECK');
			a.flush({ modul: fahrt(), stand: 50 }, { status: 201, statusText: 'Created' });
		});

		it('ohne vorgeschlagenen Tag bleibt das Feld leer und der Tag geht als null', () => {
			zeige(fahrt({ richtungen: [hin({ vorschlagTag: null })] }));
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			expect(feld('abfahrtTag').value).toBe('');
			tippe('plaetze', '2');
			knopf(formular(), 'Anbieten').click();

			const a = http.expectOne('/demo/api/v1/fahrten/m7/autos');
			expect(a.request.body.abfahrtTag).toBeNull();
			a.flush({ modul: fahrt(), stand: 50 }, { status: 201, statusText: 'Created' });
		});

		it('ohne Plaetze steht der Satz am Feld und es geht keine Anfrage raus', () => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			knopf(formular(), 'Anbieten').click();
			aktualisiere();

			expect(text(formular())).toContain('Bitte 1 bis 8 Plätze angeben.');
			expect(feld('plaetze').getAttribute('aria-invalid')).toBe('true');
		});

		it('Abbrechen schliesst das Formular ohne Anfrage und gibt dem oeffnenden Knopf den Fokus zurueck', async () => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			await fertig();
			knopf(formular(), 'Abbrechen').click();
			await fertig();

			expect(el.querySelector('form')).toBeNull();
			expect(document.activeElement).toBe(knopf(el, 'Auto anbieten'));
		});

		it('Auto anbieten fehlt, wo der Server es nicht erlaubt', () => {
			zeige(fahrt({ richtungen: [hin({ darfAnbieten: false })] }));

			expect(knopfText()).not.toContain('Auto anbieten');
		});

		it('Auto aendern oeffnet dasselbe Formular mit den Werten und schickt PUT ohne Richtung und clientId', async () => {
			zeige(
				fahrt({
					richtungen: [
						hin({
							autos: [auto('a1', { eigenes: true, darfAendern: true, plaetze: 3, frei: 3, notiz: 'Kindersitze' })],
						}),
					],
				}),
			);
			knopf(karte('a1'), 'Auto ändern').click();
			await fertig();

			expect(feld('plaetze').value).toBe('3');
			expect(feld('abfahrtTag').value).toBe('2026-10-23');
			expect(feld('abfahrtZeit').value).toBe('15:30');
			expect(feld('ort').value).toBe('Vereinsheim');
			expect(feld('notiz').value).toBe('Kindersitze');
			expect(document.activeElement).toBe(feld('plaetze'));
			tippe('plaetze', '4');
			knopf(formular(), 'Speichern').click();

			const a = http.expectOne('/demo/api/v1/autos/a1');
			expect(a.request.method).toBe('PUT');
			expect(a.request.body).toEqual({
				plaetze: 4,
				abfahrtTag: '2026-10-23',
				abfahrtZeit: '15:30',
				ort: 'Vereinsheim',
				notiz: 'Kindersitze',
			});
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toHaveLength(1);
			expect(el.querySelector('form')).toBeNull();
		});

		it('Abbrechen beim Aendern gibt dem Knopf Auto aendern den Fokus zurueck', async () => {
			zeige();
			knopf(karte('a1'), 'Auto ändern').click();
			await fertig();
			knopf(formular(), 'Abbrechen').click();
			await fertig();

			expect(document.activeElement).toBe(knopf(karte('a1'), 'Auto ändern'));
		});

		it('Auto aendern und zurueckziehen stehen nur am eigenen Auto oder mit darfAendern', () => {
			zeige();

			expect(knopfText(karte('a1'))).toContain('Auto ändern');
			expect(knopfText(karte('a1'))).toContain('Auto zurückziehen');
			expect(knopfText(karte('a2'))).not.toContain('Auto ändern');
			expect(knopfText(karte('a2'))).not.toContain('Auto zurückziehen');
		});
	});

	describe('Auto zurueckziehen', () => {
		it('ohne Kinder im Auto geht DELETE sofort raus', async () => {
			zeige(fahrt({ richtungen: [hin({ autos: [auto('a1', { eigenes: true, darfAendern: true })] })] }));
			knopf(karte('a1'), 'Auto zurückziehen').click();

			const a = http.expectOne('/demo/api/v1/autos/a1');
			expect(a.request.method).toBe('DELETE');
			expect(a.request.body).toBeNull();
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();

			expect(fixture.componentInstance.gemeldet).toHaveLength(1);
		});

		it('mit Kindern fragt es nach und schickt DELETE erst nach der Bestaetigung', async () => {
			zeige(
				fahrt({
					richtungen: [
						hin({
							autos: [
								auto('a1', {
									eigenes: true,
									darfAendern: true,
									frei: 0,
									mitfahrer: [kind('k-lena', 'Lena M.'), kind('k-max', 'Max M.')],
								}),
							],
						}),
					],
				}),
			);
			knopf(karte('a1'), 'Auto zurückziehen').click();
			aktualisiere();

			const dialog = el.querySelector('jf-bestaetigung') as HTMLElement;
			expect(text(dialog)).toContain('Lena M. und Max M. brauchen dann wieder eine Mitfahrt.');
			http.expectNone('/demo/api/v1/autos/a1');

			knopf(dialog, 'Zurückziehen').click();
			const a = http.expectOne('/demo/api/v1/autos/a1');
			expect(a.request.method).toBe('DELETE');
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();

			expect(el.querySelector('jf-bestaetigung')).toBeNull();
		});

		it('Abbrechen in der Rueckfrage schickt nichts', () => {
			zeige(
				fahrt({
					richtungen: [
						hin({
							autos: [auto('a1', { darfAendern: true, mitfahrer: [kind('k-lena', 'Lena M.')] })],
						}),
					],
				}),
			);
			knopf(karte('a1'), 'Auto zurückziehen').click();
			aktualisiere();
			knopf(el.querySelector('jf-bestaetigung') as HTMLElement, 'Abbrechen').click();
			aktualisiere();

			expect(el.querySelector('jf-bestaetigung')).toBeNull();
		});

		it('bei einem Kind heisst der Satz braucht dann', () => {
			zeige(
				fahrt({
					richtungen: [hin({ autos: [auto('a1', { darfAendern: true, mitfahrer: [kind('k-lena', 'Lena M.')] })] })],
				}),
			);
			knopf(karte('a1'), 'Auto zurückziehen').click();
			aktualisiere();

			expect(text(el.querySelector('jf-bestaetigung'))).toContain('Lena M. braucht dann wieder eine Mitfahrt.');
		});
	});

	describe('Umsetzen durch die Leitung', () => {
		// Die Ziele je Kind rechnet die Domain (umsetzenZiele): Sandras Auto hat Platz, Gerds ist voll.
		function leitung(mia: Ziele = { autoIds: ['a1'], selbst: true }): FahrtModulAnsicht {
			return fahrt({
				kinder: [],
				richtungen: [
					hin({
						autos: [
							{
								...SANDRAS_AUTO,
								mitfahrer: [kind('k-jonas', 'Jonas B.', { umsetzen: { autoIds: [], selbst: true } })],
							},
							auto('a3', {
								fahrer: 'Gerd H.',
								plaetze: 1,
								frei: 0,
								mitfahrer: [
									kind('k-tom', 'Tom K.', { darfHerausnehmen: true, umsetzen: { autoIds: ['a1'], selbst: true } }),
								],
							}),
						],
						brauchtMitfahrt: [braucht('k-mia', 'Mia S.', mia)],
						kommtSelbst: [
							kind('k-max', 'Max M.', { darfHerausnehmen: true, umsetzen: { autoIds: ['a1'], selbst: false } }),
						],
					}),
				],
			});
		}

		function optionen(): string[] {
			return Array.from(formular().querySelectorAll('option')).map((o) => text(o));
		}

		it('bietet Umsetzen an jedem Kind in Autos, unter Braucht noch Mitfahrt und unter Kommt selbst', () => {
			zeige(leitung());

			expect(knopfText(zeileVon('k-jonas'))).toContain('Umsetzen');
			expect(knopfText(zeileVon('k-tom'))).toEqual(['Umsetzen', 'Herausnehmen']);
			expect(knopfText(zeileVon('k-mia'))).toEqual(['Umsetzen']);
			expect(knopfText(zeileVon('k-max'))).toEqual(['Umsetzen', 'Herausnehmen']);
		});

		it('die Auswahl nennt Autos mit freiem Platz und Kommt selbst, volle Autos fehlen', async () => {
			zeige(leitung());
			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			await fertig();

			const optionen = Array.from(formular().querySelectorAll('option')).map((o) => text(o));
			expect(optionen).toHaveLength(2);
			expect(optionen[0]).toContain('Sandra M. (Mutter von Lena)');
			expect(optionen[0]).toContain('2 frei');
			expect(optionen[1]).toBe('Kommt selbst');
			expect(text(formular())).not.toContain('Gerd H.');
			expect(text(formular())).toContain('Mia S.');
		});

		it('die Auswahl laesst das Auto aus, in dem das Kind schon sitzt, und Kommt selbst, wo es schon steht', () => {
			zeige(leitung());
			knopf(zeileVon('k-jonas'), 'Umsetzen').click();
			aktualisiere();
			expect(Array.from(formular().querySelectorAll('option')).map((o) => text(o))).toEqual(['Kommt selbst']);
			knopf(formular(), 'Abbrechen').click();
			aktualisiere();

			knopf(zeileVon('k-max'), 'Umsetzen').click();
			aktualisiere();
			expect(Array.from(formular().querySelectorAll('option')).map((o) => text(o))).toEqual([
				expect.stringContaining('Sandra M.'),
			]);
		});

		it('Speichern setzt das Kind in das gewaehlte Auto um', async () => {
			zeige(leitung());
			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			aktualisiere();
			knopf(formular(), 'Speichern').click();

			const a = mitfahrt('PUT', 'hin', 'k-mia');
			expect(a.request.body).toEqual({ autoId: 'a1', clientId: expect.stringMatching(UUID) });
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();

			expect(el.querySelector('form')).toBeNull();
			expect(fixture.componentInstance.gemeldet).toHaveLength(1);
		});

		it('Kommt selbst in der Auswahl schickt autoId null', async () => {
			zeige(leitung());
			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			aktualisiere();
			const auswahl = formular().querySelector('select') as HTMLSelectElement;
			auswahl.value = 'selbst';
			auswahl.dispatchEvent(new Event('change'));
			aktualisiere();
			knopf(formular(), 'Speichern').click();

			const a = mitfahrt('PUT', 'hin', 'k-mia');
			expect(a.request.body.autoId).toBeNull();
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();
		});

		it('Abbrechen gibt dem Knopf Umsetzen den Fokus zurueck', async () => {
			zeige(leitung());
			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			await fertig();
			expect(document.activeElement).toBe(formular().querySelector('select'));
			knopf(formular(), 'Abbrechen').click();
			await fertig();

			expect(document.activeElement).toBe(knopf(zeileVon('k-mia'), 'Umsetzen'));
		});

		it('die Leitung nimmt ein Kind heraus', async () => {
			zeige(leitung());
			knopf(zeileVon('k-tom'), 'Herausnehmen').click();

			mitfahrt('DELETE', 'hin', 'k-tom').flush({ modul: fahrt(), stand: 51 });
			await fertig();
		});

		it('ohne Leitung gibt es kein Umsetzen', () => {
			zeige();

			expect(knopfText()).not.toContain('Umsetzen');
		});

		it('ohne Ziele in der Ansicht gibt es kein Umsetzen, auch nicht fuer die Leitung (R15)', () => {
			// Tom hat abgesagt: Herausnehmen erlaubt der Server, jedes Umsetzen lehnte er mit NICHT_DABEI ab.
			const modul = leitung();
			const [sandra, gerd] = modul.richtungen[0].autos;
			zeige(
				fahrt({
					...modul,
					richtungen: [
						hin({
							autos: [
								sandra,
								{ ...gerd, mitfahrer: [kind('k-tom', 'Tom K.', { nichtMehrDabei: true, darfHerausnehmen: true })] },
							],
							brauchtMitfahrt: [],
						}),
					],
				}),
			);

			expect(knopfText(zeileVon('k-tom'))).toEqual(['Herausnehmen']);
		});

		it('ein Live-Update, in dem das gewaehlte Auto fehlt, waehlt das sichtbare Ziel und schickt es', async () => {
			zeige(leitung());
			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			aktualisiere();
			expect((formular().querySelector('select') as HTMLSelectElement).value).toBe('a1');

			// Sandras Auto ist inzwischen voll: Die neue Ansicht bietet Mia nur noch Kommt selbst an.
			const voll = leitung({ autoIds: [], selbst: true });
			voll.richtungen[0].autos[0] = { ...voll.richtungen[0].autos[0], frei: 0 };
			fixture.componentInstance.modul.set(voll);
			aktualisiere();
			expect(optionen()).toEqual(['Kommt selbst']);
			knopf(formular(), 'Speichern').click();

			const a = mitfahrt('PUT', 'hin', 'k-mia');
			expect(a.request.body).toEqual({ autoId: null, clientId: expect.stringMatching(UUID) });
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();
		});

		it('ein Live-Update behaelt die Wahl, solange sie noch angeboten wird', async () => {
			zeige(leitung());
			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			aktualisiere();
			const auswahl = formular().querySelector('select') as HTMLSelectElement;
			auswahl.value = 'selbst';
			auswahl.dispatchEvent(new Event('change'));
			aktualisiere();

			fixture.componentInstance.modul.set(leitung({ autoIds: ['a1'], selbst: true }));
			aktualisiere();
			knopf(formular(), 'Speichern').click();

			const a = mitfahrt('PUT', 'hin', 'k-mia');
			expect(a.request.body.autoId).toBeNull();
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();
		});

		it('ein Live-Update ohne Ziele schliesst das Formular und schickt nichts', () => {
			zeige(leitung());
			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			aktualisiere();

			fixture.componentInstance.modul.set(leitung(KEIN_ZIEL));
			aktualisiere();

			expect(el.querySelector('form')).toBeNull();
			expect(knopfText(zeileVon('k-mia'))).toEqual([]);
		});

		it('ein neues Formular beginnt mit dem ersten Ziel, nicht mit der Wahl des vorigen Kindes', () => {
			zeige(leitung());
			knopf(zeileVon('k-tom'), 'Umsetzen').click();
			aktualisiere();
			const auswahl = formular().querySelector('select') as HTMLSelectElement;
			auswahl.value = 'selbst';
			auswahl.dispatchEvent(new Event('change'));
			aktualisiere();
			knopf(formular(), 'Abbrechen').click();
			aktualisiere();

			knopf(zeileVon('k-mia'), 'Umsetzen').click();
			aktualisiere();
			expect((formular().querySelector('select') as HTMLSelectElement).value).toBe('a1');
		});
	});

	describe('Eine Handlung zur Zeit', () => {
		it('jede Anfrage bekommt eine eigene clientId', async () => {
			zeige();
			knopf(karte('a2'), 'Lena einsteigen').click();
			const erste = mitfahrt('PUT', 'hin', 'k-lena');
			erste.flush({ fehler: 'Unerwarteter Fehler' }, { status: 500, statusText: 'Fehler' });
			await fertig();
			knopf(karte('a2'), 'Lena einsteigen').click();
			const zweite = mitfahrt('PUT', 'hin', 'k-lena');

			expect(zweite.request.body.clientId).not.toBe(erste.request.body.clientId);
			zweite.flush({ modul: fahrt(), stand: 51 });
			await fertig();
		});

		it('ein Doppeltipp schickt nur eine Anfrage; waehrend des Sendens sind alle Knoepfe gesperrt', async () => {
			zeige();
			const einsteigen = knopf(karte('a2'), 'Lena einsteigen');
			einsteigen.click();
			einsteigen.click();
			aktualisiere();

			const a = mitfahrt('PUT', 'hin', 'k-lena');
			expect(knoepfe().every((b) => b.disabled)).toBe(true);
			a.flush({ modul: fahrt(), stand: 50 });
			await fertig();
			expect(knoepfe().some((b) => b.disabled)).toBe(false);
		});
	});

	describe('Fehler', () => {
		it('409 VOLL zeigt den Satz am Modul und meldet veraltet', async () => {
			zeige();
			knopf(karte('a2'), 'Lena einsteigen').click();
			fehler409(mitfahrt('PUT', 'hin', 'k-lena'), 'VOLL', 'In diesem Auto ist kein Platz mehr frei.');
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('In diesem Auto ist kein Platz mehr frei.');
			expect(fixture.componentInstance.veraltet).toBe(1);
			expect(fixture.componentInstance.gemeldet).toEqual([]);
			expect(document.activeElement).toBe(ueberschrift());
		});

		it.each([
			['NICHT_DABEI', 'Mitfahren kann nur, wer zugesagt hat.'],
			['ARCHIVIERT', 'Dieser Thread ist archiviert.'],
			['AUTO_SCHON_DA', 'Du bietest für diese Fahrt schon ein Auto an.'],
		])('409 %s zeigt den Satz des Servers, schliesst das Formular und meldet veraltet', async (code, satz) => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			tippe('plaetze', '3');
			knopf(formular(), 'Anbieten').click();
			fehler409(http.expectOne('/demo/api/v1/fahrten/m7/autos'), code, satz);
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(satz);
			expect(el.querySelector('form')).toBeNull();
			expect(fixture.componentInstance.veraltet).toBe(1);
		});

		it('409 PLAETZE steht am Feld, laesst das Formular offen und meldet nicht veraltet', async () => {
			zeige();
			knopf(karte('a1'), 'Auto ändern').click();
			aktualisiere();
			tippe('plaetze', '1');
			knopf(formular(), 'Speichern').click();
			fehler409(http.expectOne('/demo/api/v1/autos/a1'), 'PLAETZE', 'Es fährt schon 1 Kind mit.');
			await fertig();

			expect(text(feld('plaetze').closest('[data-feld]'))).toContain('Es fährt schon 1 Kind mit.');
			expect(feld('plaetze').getAttribute('aria-invalid')).toBe('true');
			expect(fixture.componentInstance.veraltet).toBe(0);
			expect(el.querySelector('form')).not.toBeNull();
			expect(el.querySelector('jf-fahrt-modul > [role="alert"]')).toBeNull();
			expect(document.activeElement).toBe(feld('plaetze'));
		});

		it('400 mit feld steht an diesem Feld, das Formular bleibt offen', async () => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			tippe('plaetze', '3');
			tippe('abfahrtZeit', '15:30');
			knopf(formular(), 'Anbieten').click();
			http
				.expectOne('/demo/api/v1/fahrten/m7/autos')
				.flush({ fehler: 'Ungültige Anfrage', feld: 'abfahrtZeit' }, { status: 400, statusText: 'Bad Request' });
			await fertig();

			expect(text(feld('abfahrtZeit').closest('[data-feld]'))).toContain('Bitte die Uhrzeit als HH:MM angeben.');
			expect(el.querySelector('form')).not.toBeNull();
			expect(fixture.componentInstance.veraltet).toBe(0);
		});

		it('der Fehler am Feld verschwindet, wenn es sich aendert', () => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			knopf(formular(), 'Anbieten').click();
			aktualisiere();
			expect(feld('plaetze').getAttribute('aria-invalid')).toBe('true');

			tippe('plaetze', '3');

			expect(feld('plaetze').getAttribute('aria-invalid')).toBeNull();
			expect(text(formular())).not.toContain('Bitte 1 bis 8 Plätze angeben.');
		});

		it.each(['richtung', 'autoId', 'clientId'])(
			'400 mit feld %s hat kein Eingabefeld und steht sichtbar am Modul',
			async (name) => {
				zeige();
				knopf(karte('a2'), 'Lena einsteigen').click();
				mitfahrt('PUT', 'hin', 'k-lena').flush(
					{ fehler: 'Ungültige Anfrage', feld: name },
					{ status: 400, statusText: 'Bad Request' },
				);
				await fertig();

				expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Ungültige Anfrage');
				expect(fixture.componentInstance.veraltet).toBe(0);
			},
		);

		it.each([
			['409 PLAETZE', 409, { fehler: 'Es fährt schon 1 Kind mit.', code: 'PLAETZE' }, 'Es fährt schon 1 Kind mit.'],
			['400 plaetze', 400, { fehler: 'Ungültige Anfrage', feld: 'plaetze' }, 'Bitte 1 bis 8 Plätze angeben.'],
		])(
			'%s nach einem Richtungswechsel waehrend des Sendens steht am Modul statt verloren zu gehen',
			async (_name, status, koerper, satz) => {
				zeige(fahrt({ richtungen: [hin(), rueck()] }));
				knopf(karte('a1'), 'Auto ändern').click();
				aktualisiere();
				tippe('plaetze', '1');
				knopf(formular(), 'Speichern').click();
				el.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click();
				aktualisiere();
				http.expectOne('/demo/api/v1/autos/a1').flush(koerper, { status, statusText: 'Fehler' });
				// Ohne Fokus-Zeichnung wartet whenStable nicht auf die Fehlerbehandlung nach dem Sitzungscheck.
				await new Promise((r) => setTimeout(r));
				await fertig();

				expect(el.querySelector('jf-fahrt-modul > [role="alert"]')?.textContent?.trim()).toBe(satz);
				expect(el.querySelector('form')).toBeNull();
				expect(fixture.componentInstance.veraltet).toBe(0);
			},
		);

		it('404 zeigt den Satz am Modul und meldet veraltet', async () => {
			zeige(fahrt({ richtungen: [hin({ autos: [auto('a1', { eigenes: true, darfAendern: true })] })] }));
			knopf(karte('a1'), 'Auto zurückziehen').click();
			http
				.expectOne('/demo/api/v1/autos/a1')
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await fertig();

			expect(el.querySelector('jf-fahrt-modul > [role="alert"]')?.textContent?.trim()).toBe(
				'Das gibt es nicht mehr, oder du darfst hier nichts ändern.',
			);
			expect(fixture.componentInstance.veraltet).toBe(1);
		});

		it('404 schliesst ein offenes Formular', async () => {
			zeige();
			knopf(karte('a1'), 'Auto ändern').click();
			aktualisiere();
			knopf(formular(), 'Speichern').click();
			http
				.expectOne('/demo/api/v1/autos/a1')
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
			await fertig();

			expect(el.querySelector('form')).toBeNull();
		});

		it('401 schickt zur Anmeldung und zeigt keinen Satz', async () => {
			zeige();
			const navigiere = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
			knopf(karte('a2'), 'Lena einsteigen').click();
			mitfahrt('PUT', 'hin', 'k-lena').flush(
				{ fehler: 'nicht angemeldet' },
				{ status: 401, statusText: 'Unauthorized' },
			);
			await fertig();

			expect(navigiere).toHaveBeenCalledTimes(1);
			expect(String(navigiere.mock.calls[0]?.[0])).toContain('/demo/anmelden');
			expect(el.querySelector('[role="alert"]')).toBeNull();
			expect(fixture.componentInstance.veraltet).toBe(0);
		});

		it('429 zeigt die Wartezeit, laesst das Formular offen und meldet nicht veraltet', async () => {
			zeige();
			knopf(el, 'Auto anbieten').click();
			aktualisiere();
			tippe('plaetze', '3');
			knopf(formular(), 'Anbieten').click();
			http
				.expectOne('/demo/api/v1/fahrten/m7/autos')
				.flush({ fehler: 'Zu viele Anfragen', wartenSekunden: 30 }, { status: 429, statusText: 'Too Many Requests' });
			await fertig();

			expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
				'Zu viele Versuche – bitte in 30 Sekunden erneut',
			);
			expect(el.querySelector('form')).not.toBeNull();
			expect(fixture.componentInstance.veraltet).toBe(0);
			expect(knopf(formular(), 'Anbieten').disabled).toBe(false);
		});

		it('der Fehlersatz verschwindet mit der naechsten Handlung', async () => {
			zeige();
			knopf(karte('a2'), 'Lena einsteigen').click();
			mitfahrt('PUT', 'hin', 'k-lena').flush({ fehler: 'Kaputt' }, { status: 500, statusText: 'Fehler' });
			await fertig();
			expect(el.querySelector('[role="alert"]')).not.toBeNull();

			knopf(karte('a2'), 'Lena einsteigen').click();
			aktualisiere();
			expect(el.querySelector('[role="alert"]')).toBeNull();
			mitfahrt('PUT', 'hin', 'k-lena').flush({ modul: fahrt(), stand: 50 });
			await fertig();
		});
	});

	describe('Vorschau', () => {
		it('zeigt keine Knoepfe, auch wenn die Ansicht Rechte mitbraechte', () => {
			const max = kind('k-max', 'Max M.', { darfHerausnehmen: true, umsetzen: { autoIds: ['a2'], selbst: false } });
			zeige(fahrt({ richtungen: [hin({ kommtSelbst: [max] })] }), true);

			expect(knoepfe()).toHaveLength(0);
			expect(text()).toContain('Sandra M. (Mutter von Lena)');
			expect(text()).toContain('Mia S.');
		});

		it('behaelt den Umschalter, der nichts anruft', () => {
			zeige(fahrt({ richtungen: [hin(), rueck()] }), true);

			expect(el.querySelectorAll('[role="tab"]')).toHaveLength(2);
		});
	});
});
