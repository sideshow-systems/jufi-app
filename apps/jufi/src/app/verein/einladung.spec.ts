import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf, tippe } from '../admin/test-hilfen';
import type { EinladungInfo } from './mitglieder-api';
import { PasskeyBrowser } from '../gemeinsam/passkey-browser';

const API = '/demo/api/v1';

const ERWACHSENE: EinladungInfo = {
	vorname: 'Sandra',
	art: 'EINLADUNG',
	vereinsname: 'Jungfischer Demo',
	personArt: 'ERWACHSENER',
	kennung: { fest: false, wert: 'sandra@example.org' },
	hatZugang: false,
	einwilligungFehlt: false,
	kinder: [],
	einwilligungsText: {
		version: '1',
		text: 'Ich willige ein, dass die Jugendgruppe die Daten meines Kindes verarbeitet.',
	},
};
const MIT_KIND: EinladungInfo = {
	...ERWACHSENE,
	kinder: [{ id: 'k1', vorname: 'Lena', zugangErlaubt: false, einwilligungVorhanden: false }],
};
const JUNGFISCHER: EinladungInfo = {
	...ERWACHSENE,
	vorname: 'Lena',
	personArt: 'JUNGFISCHER',
	kennung: { fest: false, wert: 'lena2' },
};

describe('Einladung annehmen', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;
	let passkeyUnterstuetzt: boolean;
	let hinzufuegen: PasskeyBrowser['hinzufuegen'];

	beforeEach(() => {
		passkeyUnterstuetzt = true;
		hinzufuegen = async () => 'fertig';
		const passkeys: Partial<PasskeyBrowser> = {
			unterstuetzt: () => passkeyUnterstuetzt,
			hinzufuegen: (wege) => hinzufuegen(wege),
		};
		TestBed.configureTestingModule({
			providers: [...adminTestAnbieter(), { provide: PasskeyBrowser, useValue: passkeys }],
		});
		history.replaceState(null, '', '/');
	});

	afterEach(() => http.verify());

	/**
	 * Beantwortet Kopf und Pruefung gemeinsam: Die Pruefung beginnt schon beim Anlegen
	 * der Seite, und ein Warten auf Stabilitaet liefe sonst an ihrer offenen Anfrage fest.
	 */
	async function oeffne(
		antwort: EinladungInfo | { status: number; koerper: object },
		fragment = 'tok-1',
	): Promise<void> {
		http = TestBed.inject(HttpTestingController);
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl(`/demo/einladung#${fragment}`);
		await vi.waitFor(() => {
			http
				.expectOne(`${API}/verein`)
				.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false });
		});
		await vi.waitFor(() => {
			const anfrage = http.expectOne(`${API}/einladung/pruefen`);
			if ('status' in antwort) {
				anfrage.flush(antwort.koerper, { status: antwort.status, statusText: 'Fehler' });
			} else {
				anfrage.flush(antwort);
			}
		});
		await navigation;
		await stabil();
		seite = harness.routeNativeElement as HTMLElement;
	}

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	/** Wartet auf eine Aenderung der Ansicht, die erst nach mehreren Promise-Schritten ankommt. */
	async function warteAuf(bedingung: () => boolean): Promise<void> {
		await vi.waitFor(() => {
			harness.detectChanges();
			expect(bedingung()).toBe(true);
		});
	}

	async function klick(text: string): Promise<void> {
		knopf(seite, text).click();
		await stabil();
	}

	it('entfernt das Token aus der Adresse und fragt damit die Pruefung', async () => {
		http = TestBed.inject(HttpTestingController);
		harness = await RouterTestingHarness.create();
		// Der Harness setzt die Adresse selbst nie; ohne diese Zeile waere der Hash auch ohne
		// replaceState in der Seite leer und der Test ohne Beweiskraft.
		history.replaceState(null, '', '/demo/einladung#tok-1');
		expect(location.hash).toBe('#tok-1');
		const navigation = harness.navigateByUrl('/demo/einladung#tok-1');
		await vi.waitFor(() => {
			http.expectOne(`${API}/verein`).flush({ slug: 'demo', anzeigename: 'X', farbe: '#1d4ed8', hatLogo: false });
		});
		await vi.waitFor(() => {
			const anfrage = http.expectOne(`${API}/einladung/pruefen`);
			expect(anfrage.request.body).toEqual({ token: 'tok-1' });
			anfrage.flush(ERWACHSENE);
		});
		await navigation;
		expect(location.hash).toBe('');
	});

	it('begruesst mit Namen und Vereinsnamen', async () => {
		await oeffne(ERWACHSENE);
		expect(seite.textContent).toContain('Hallo Sandra, willkommen bei Jungfischer Demo.');
	});

	it('ein ungueltiger Link zeigt den Hinweis ohne Formular', async () => {
		await oeffne({ status: 404, koerper: { fehler: 'Dieser Link gilt nicht mehr' } });
		expect(seite.textContent).toContain('Dieser Link gilt nicht mehr – frag nach einem neuen.');
		expect(seite.querySelector('form')).toBeNull();
		expect(seite.querySelector('input')).toBeNull();
	});

	it('ohne Token im Link ist er ungueltig, ohne dass etwas gefragt wird', async () => {
		http = TestBed.inject(HttpTestingController);
		harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/einladung');
		await vi.waitFor(() => {
			http.expectOne(`${API}/verein`).flush({ slug: 'demo', anzeigename: 'X', farbe: '#1d4ed8', hatLogo: false });
		});
		await navigation;
		await stabil();
		http.expectNone(`${API}/einladung/pruefen`);
		expect((harness.routeNativeElement as HTMLElement).textContent).toContain('Dieser Link gilt nicht mehr');
	});

	it('fehlende Einwilligung zeigt den Hinweis statt des Formulars', async () => {
		await oeffne({ ...JUNGFISCHER, einwilligungFehlt: true });
		expect(seite.textContent).toContain('Eine erziehungsberechtigte Person muss erst einwilligen.');
		expect(seite.querySelector('form')).toBeNull();
		expect(seite.textContent).not.toContain('Weiter');
	});

	it('Erwachsene: die Adresse ist vorbelegt, eine Aenderung geht beim Einloesen mit', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		const feld = seite.querySelector<HTMLInputElement>('input[name=kennung]');
		expect(feld?.value).toBe('sandra@example.org');
		expect(feld?.type).toBe('email');
		tippe(seite, 'input[name=kennung]', 'sandra@neu.example.org');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		await klick('Zugang einrichten');
		const anfrage = http.expectOne(`${API}/einladung/einloesen`);
		expect(anfrage.request.body).toEqual({
			token: 'tok-1',
			kennung: 'sandra@neu.example.org',
			passwort: 'Forelle am Glonnbach',
		});
		anfrage.flush({ vorname: 'Sandra' });
	});

	it('eine feste Kennung blendet das Feld aus und geht nicht in den Body', async () => {
		await oeffne({ ...ERWACHSENE, hatZugang: true, art: 'RESET', kennung: { fest: true, wert: 'sandra@example.org' } });
		await klick('Weiter');
		expect(seite.querySelector('input[name=kennung]')).toBeNull();
		expect(seite.textContent).toContain('sandra@example.org');
		expect(seite.textContent).toContain('Alte Anmeldewege werden dabei gelöscht.');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		await klick('Zugang einrichten');
		expect(http.expectOne(`${API}/einladung/einloesen`).request.body).toEqual({
			token: 'tok-1',
			passwort: 'Forelle am Glonnbach',
		});
	});

	it('ohne Reset fehlt der Satz ueber geloeschte Anmeldewege', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		expect(seite.textContent).not.toContain('Alte Anmeldewege');
	});

	it('Jungfischer: der Vorschlag steht als Anmeldename im Feld', async () => {
		await oeffne(JUNGFISCHER);
		await klick('Weiter');
		const feld = seite.querySelector<HTMLInputElement>('input[name=kennung]');
		expect(feld?.value).toBe('lena2');
		expect(seite.textContent).toContain('Anmeldename');
	});

	it('eine ungueltige Kennung wird vor dem Weitergehen abgelehnt', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		tippe(seite, 'input[name=kennung]', 'sandra');
		await klick('Weiter');
		expect(seite.querySelector('input[name=kennung]')).not.toBeNull();
		expect(seite.querySelector('[role=alert]')?.textContent).toContain('gültige E-Mail-Adresse');
	});

	it('Passwort-Weg: ein zu kurzes Passwort wird ohne Anfrage abgelehnt', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'kurz');
		await klick('Zugang einrichten');
		http.expectNone(`${API}/einladung/einloesen`);
		expect(seite.textContent).toContain('Mindestens 10 Zeichen');
	});

	it('Passkey-Weg: Optionen holen, Zeremonie, Antwort als passkey im Body', async () => {
		hinzufuegen = async (wege) => {
			const optionen = await new Promise((ok, fehler) => wege.optionen().subscribe({ next: ok, error: fehler }));
			expect(optionen).toEqual({ challenge: 'c' });
			await new Promise((ok, fehler) => wege.senden({ id: 'p' }).subscribe({ next: ok, error: fehler }));
			return 'fertig';
		};
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		knopf(seite, 'Passkey einrichten').click();
		http.expectOne(`${API}/einladung/passkey-optionen`).flush({ optionen: { challenge: 'c' } });
		await vi.waitFor(() => {
			const anfrage = http.expectOne(`${API}/einladung/einloesen`);
			expect(anfrage.request.body).toEqual({
				token: 'tok-1',
				kennung: 'sandra@example.org',
				passkey: { id: 'p' },
			});
			anfrage.flush({ vorname: 'Sandra' });
		});
		await warteAuf(() => seite.textContent?.includes('Home-Bildschirm') === true);
	});

	it('Passkey-Knopf fehlt, wenn der Browser keine Passkeys kann', async () => {
		passkeyUnterstuetzt = false;
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		expect(seite.textContent).not.toContain('Passkey einrichten');
	});

	it('Passkey und Passwort zugleich gehen beide in den Body', async () => {
		hinzufuegen = async (wege) => {
			await new Promise((ok, fehler) => wege.senden({ id: 'p' }).subscribe({ next: ok, error: fehler }));
			return 'fertig';
		};
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		await klick('Passkey einrichten');
		const anfrage = http.expectOne(`${API}/einladung/einloesen`);
		expect(anfrage.request.body).toMatchObject({ passwort: 'Forelle am Glonnbach', passkey: { id: 'p' } });
		anfrage.flush({ vorname: 'Sandra' });
	});

	it('ein zweiter Klick waehrend der Anfrage startet nichts Neues', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		knopf(seite, 'Zugang einrichten').click();
		harness.detectChanges();
		expect(knopf(seite, 'Zugang einrichten').disabled).toBe(true);
		knopf(seite, 'Zugang einrichten').click();
		http.expectOne(`${API}/einladung/einloesen`).flush({ vorname: 'Sandra' });
	});

	it('409 zeigt den Text am Kennungsfeld und springt zurueck zum Schritt Kennung', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		await klick('Zugang einrichten');
		http
			.expectOne(`${API}/einladung/einloesen`)
			.flush(
				{ fehler: 'Diese Adresse ist hier schon vergeben', feld: 'kennung' },
				{ status: 409, statusText: 'Conflict' },
			);
		await stabil();
		expect(seite.querySelector('input[name=kennung]')).not.toBeNull();
		expect(seite.querySelector('[role=alert]')?.textContent).toContain('Diese Adresse ist hier schon vergeben');
	});

	it('nach einem 409 holt ein erneuter Passkey-Versuch neue Optionen', async () => {
		let aufrufe = 0;
		hinzufuegen = async (wege) => {
			aufrufe++;
			await new Promise((ok, fehler) => wege.optionen().subscribe({ next: ok, error: fehler }));
			await new Promise((ok, fehler) => wege.senden({ id: 'p' }).subscribe({ next: ok, error: fehler }));
			return 'fertig';
		};
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		knopf(seite, 'Passkey einrichten').click();
		http.expectOne(`${API}/einladung/passkey-optionen`).flush({ optionen: { challenge: 'c' } });
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/einladung/einloesen`)
				.flush(
					{ fehler: 'Diese Adresse ist hier schon vergeben', feld: 'kennung' },
					{ status: 409, statusText: 'Conflict' },
				),
		);
		await warteAuf(() => seite.querySelector('input[name=kennung]') !== null);
		await klick('Weiter');
		knopf(seite, 'Passkey einrichten').click();
		http.expectOne(`${API}/einladung/passkey-optionen`).flush({ optionen: { challenge: 'c2' } });
		await vi.waitFor(() => http.expectOne(`${API}/einladung/einloesen`).flush({ vorname: 'Sandra' }));
		expect(aufrufe).toBe(2);
	});

	it('400 beim Passkey zeigt den Servertext, der naechste Versuch holt neue Optionen', async () => {
		hinzufuegen = async (wege) => {
			await new Promise((ok, fehler) => wege.optionen().subscribe({ next: ok, error: fehler }));
			await new Promise((ok, fehler) => wege.senden({ id: 'p' }).subscribe({ next: ok, error: fehler }));
			return 'fertig';
		};
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		knopf(seite, 'Passkey einrichten').click();
		http.expectOne(`${API}/einladung/passkey-optionen`).flush({ optionen: { challenge: 'c' } });
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/einladung/einloesen`)
				.flush({ fehler: 'Der Passkey konnte nicht eingerichtet werden' }, { status: 400, statusText: 'Bad Request' }),
		);
		await warteAuf(() => seite.querySelector('[role=alert]') !== null);
		expect(seite.querySelector('[role=alert]')?.textContent).toContain('Der Passkey konnte nicht eingerichtet werden');
		await klick('Passkey einrichten');
		http.expectOne(`${API}/einladung/passkey-optionen`).flush({ optionen: { challenge: 'c2' } });
		await vi.waitFor(() => http.expectOne(`${API}/einladung/einloesen`).flush({ vorname: 'Sandra' }));
	});

	it('409 ohne Feld (Einwilligung fehlt) zeigt den Servertext im Schritt Zugang', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		await klick('Zugang einrichten');
		http
			.expectOne(`${API}/einladung/einloesen`)
			.flush({ fehler: 'Die Einwilligung der Familie fehlt noch' }, { status: 409, statusText: 'Conflict' });
		await stabil();
		expect(seite.querySelector('[role=alert]')?.textContent).toContain('Die Einwilligung der Familie fehlt noch');
		expect(seite.querySelector('input[name=kennung]')).toBeNull();
	});

	it('404 beim Einloesen zeigt den Hinweis zum ungueltigen Link', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		await klick('Zugang einrichten');
		http
			.expectOne(`${API}/einladung/einloesen`)
			.flush({ fehler: 'Dieser Link gilt nicht mehr' }, { status: 404, statusText: 'Not Found' });
		await stabil();
		expect(seite.textContent).toContain('Dieser Link gilt nicht mehr – frag nach einem neuen.');
	});

	it('Erfolg fuehrt zu Fertig mit Home-Bildschirm-Hinweis, Zur App geht zur Startseite', async () => {
		await oeffne(ERWACHSENE);
		await klick('Weiter');
		await klick('Weiter');
		tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
		await klick('Zugang einrichten');
		http.expectOne(`${API}/einladung/einloesen`).flush({ vorname: 'Sandra' });
		await stabil();
		expect(seite.textContent).toContain('Home-Bildschirm');
		expect(seite.textContent).toContain('noch einmal an');
		const navigiert = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
		await klick('Zur App');
		expect(navigiert).toHaveBeenCalledWith('/demo');
	});

	describe('Einwilligungsschritt', () => {
		function haken(name: string): HTMLInputElement {
			const feld = seite.querySelector<HTMLInputElement>(`input[name="${name}"]`);
			if (!feld) throw new Error(`Haekchen nicht gefunden: ${name}`);
			return feld;
		}

		async function setze(name: string, an: boolean): Promise<void> {
			const feld = haken(name);
			feld.checked = an;
			feld.dispatchEvent(new Event('change', { bubbles: true }));
			await stabil();
		}

		/** Vom Einwilligungsschritt aus ueber Kennung und Passwort einloesen; liefert den Body. */
		async function loeseEin(): Promise<unknown> {
			await klick('Weiter');
			await klick('Weiter');
			tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
			await klick('Zugang einrichten');
			const anfrage = http.expectOne(`${API}/einladung/einloesen`);
			const body = anfrage.request.body;
			anfrage.flush({ vorname: 'Sandra' });
			return body;
		}

		it('ohne Kinder ueberspringt die Einladung den Einwilligungsschritt', async () => {
			await oeffne(ERWACHSENE);
			await klick('Weiter');
			expect(seite.textContent).not.toContain('Einwilligung');
			expect(seite.querySelector('input[name=kennung]')).not.toBeNull();
		});

		it('ohne Kinder enthaelt der Einloesen-Body keine einwilligungen', async () => {
			await oeffne(ERWACHSENE);
			await klick('Weiter');
			await klick('Weiter');
			tippe(seite, 'input[name=passwort]', 'Forelle am Glonnbach');
			await klick('Zugang einrichten');
			const anfrage = http.expectOne(`${API}/einladung/einloesen`);
			expect(anfrage.request.body).not.toHaveProperty('einwilligungen');
			anfrage.flush({ vorname: 'Sandra' });
		});

		it('mit Kind zeigt der Schritt den Text, ein Haekchen je Kind und die Zugang-Frage vorbelegt mit ja', async () => {
			await oeffne(MIT_KIND);
			await klick('Weiter');
			expect(seite.textContent).toContain(
				'Ich willige ein, dass die Jugendgruppe die Daten meines Kindes verarbeitet.',
			);
			expect(seite.querySelector('input[name=kennung]')).toBeNull();
			const einwilligen = haken('einwilligen-k1');
			expect(einwilligen.checked).toBe(false);
			// Das Haekchen hat eine Beschriftung, die das Kind nennt.
			expect(einwilligen.closest('label')?.textContent).toContain('Ich willige ein');
			// Die Zugang-Frage erscheint erst mit der Einwilligung, dann vorbelegt mit ja.
			expect(seite.querySelector('input[name="zugang-k1"]')).toBeNull();
			await setze('einwilligen-k1', true);
			expect(seite.textContent).toContain('Soll Lena einen eigenen Zugang bekommen?');
			expect(haken('zugang-k1').checked).toBe(true);
		});

		it('Weiter ohne Haekchen sendet einwilligen:false', async () => {
			await oeffne(MIT_KIND);
			await klick('Weiter');
			const body = await loeseEin();
			expect(body).toMatchObject({ einwilligungen: [{ kindId: 'k1', einwilligen: false, zugang: false }] });
		});

		it('der Einloesen-Body enthaelt einwilligungen mit kindId, einwilligen und zugang', async () => {
			await oeffne(MIT_KIND);
			await klick('Weiter');
			await setze('einwilligen-k1', true);
			const body = await loeseEin();
			expect(body).toEqual({
				token: 'tok-1',
				kennung: 'sandra@example.org',
				passwort: 'Forelle am Glonnbach',
				einwilligungen: [{ kindId: 'k1', einwilligen: true, zugang: true }],
			});
		});

		it('die Zugang-Frage laesst sich mit nein beantworten', async () => {
			await oeffne(MIT_KIND);
			await klick('Weiter');
			await setze('einwilligen-k1', true);
			await setze('zugang-k1', false);
			const body = await loeseEin();
			expect(body).toMatchObject({ einwilligungen: [{ kindId: 'k1', einwilligen: true, zugang: false }] });
		});

		it('die Zugang-Frage verschwindet, wenn nicht eingewilligt wird', async () => {
			await oeffne(MIT_KIND);
			await klick('Weiter');
			await setze('einwilligen-k1', true);
			await setze('einwilligen-k1', false);
			expect(seite.querySelector('input[name="zugang-k1"]')).toBeNull();
			expect(seite.textContent).toContain('Die Familie handelt dann in seinem Namen.');
			// Auch eine vorher abgewaehlte oder wieder angehakte Frage zaehlt ohne Einwilligung nicht.
			const body = await loeseEin();
			expect(body).toMatchObject({ einwilligungen: [{ kindId: 'k1', einwilligen: false, zugang: false }] });
		});

		it('hat schon eine andere Person eingewilligt, steht das dort und der Schritt ist freiwillig', async () => {
			await oeffne({
				...MIT_KIND,
				kinder: [{ id: 'k1', vorname: 'Lena', zugangErlaubt: false, einwilligungVorhanden: true }],
			});
			await klick('Weiter');
			expect(seite.textContent).toContain('Für Lena hat schon jemand aus der Familie eingewilligt');
			expect(seite.textContent).toContain('freiwillig');
			// Weiter ohne Haekchen ist erlaubt.
			await klick('Weiter');
			expect(seite.querySelector('input[name=kennung]')).not.toBeNull();
		});

		it('ohne vorhandene Einwilligung fehlt der Hinweis auf Freiwilligkeit', async () => {
			await oeffne(MIT_KIND);
			await klick('Weiter');
			expect(seite.textContent).not.toContain('freiwillig');
		});

		it('mehrere Kinder werden einzeln beantwortet', async () => {
			await oeffne({
				...MIT_KIND,
				kinder: [
					{ id: 'k1', vorname: 'Lena', zugangErlaubt: false, einwilligungVorhanden: false },
					{ id: 'k2', vorname: 'Jonas', zugangErlaubt: false, einwilligungVorhanden: false },
				],
			});
			await klick('Weiter');
			await setze('einwilligen-k2', true);
			await setze('zugang-k2', false);
			const body = await loeseEin();
			expect(body).toMatchObject({
				einwilligungen: [
					{ kindId: 'k1', einwilligen: false, zugang: false },
					{ kindId: 'k2', einwilligen: true, zugang: false },
				],
			});
		});
	});
});
