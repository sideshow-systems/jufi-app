import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf, tippe } from '../../admin/test-hilfen';
import { vereinsfarben } from '../../gestaltung/farben';
import { MeldungService } from '../../gestaltung/meldung';
import { API, ichMit, oeffneSeite, stabil } from './test-hilfen';

const EINSTELLUNGEN = {
	slug: 'demo',
	name: 'Jungfischer Demo e. V.',
	anzeigename: 'Jungfischer Demo',
	kontakt: 'Thomas Leiter, 0171 1234567',
	farbe: '#1d4ed8',
	logoStand: null as string | null,
};

const VEREIN = { slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null };

/** Der Wert der Eigenschaft auf html, wie ihn die ganze App sieht. */
function akzentHell(): string {
	return document.documentElement.style.getPropertyValue('--akzent-hell');
}

function datei(bytes: number, typ = 'image/png', name = 'logo.png'): File {
	return new File([new Uint8Array(bytes)], name, { type: typ });
}

describe('Vereinseinstellungen', () => {
	beforeEach(() => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		document.documentElement.removeAttribute('style');
	});
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne(einstellungen: object = EINSTELLUNGEN, rechte = ['EINSTELLUNGEN']) {
		return oeffneSeite('/demo/verwaltung/einstellungen', ichMit(rechte), [['/einstellungen', einstellungen]]);
	}

	/** Beantwortet das Neuladen des Vereins nach dem Speichern: genau eine Anfrage. */
	async function vereinNeu(http: HttpTestingController, harness: RouterTestingHarness, verein: object = VEREIN) {
		await vi.waitFor(() => http.expectOne(`${API}/verein`).flush(verein));
		await stabil(harness);
	}

	function feld<T extends HTMLElement>(seite: HTMLElement, selektor: string): T {
		const treffer = seite.querySelector<T>(selektor);
		if (!treffer) throw new Error(`Nicht gefunden: ${selektor}`);
		return treffer;
	}

	function speichern(seite: HTMLElement, karte: 'Verein' | 'Vereinsfarbe'): HTMLButtonElement {
		return feld<HTMLButtonElement>(seite, `form[aria-label="${karte}"] button[type="submit"]`);
	}

	function waehleDatei(seite: HTMLElement, wahl: File): void {
		const eingabe = feld<HTMLInputElement>(seite, 'input[type="file"]');
		Object.defineProperty(eingabe, 'files', { value: [wahl], configurable: true });
		eingabe.dispatchEvent(new Event('change', { bubbles: true }));
	}

	describe('Verein', () => {
		it('belegt die Felder aus GET /einstellungen vor', async () => {
			const { seite } = await oeffne();
			expect(seite.querySelector('h1')?.textContent).toContain('Vereinseinstellungen');
			expect(feld<HTMLInputElement>(seite, 'input[name="anzeigename"]').value).toBe('Jungfischer Demo');
			expect(feld<HTMLInputElement>(seite, 'input[name="name"]').value).toBe('Jungfischer Demo e. V.');
			expect(feld<HTMLTextAreaElement>(seite, 'textarea[name="kontakt"]').value).toBe('Thomas Leiter, 0171 1234567');
			expect(feld<HTMLInputElement>(seite, 'input[name="farbe"]').value).toBe('#1d4ed8');
		});

		it('begrenzt Anzeigename auf 24 und Kontakt auf 500 Zeichen und zählt den Anzeigenamen', async () => {
			const { harness, seite } = await oeffne();
			expect(feld(seite, 'input[name="anzeigename"]').getAttribute('maxlength')).toBe('24');
			expect(feld(seite, 'textarea[name="kontakt"]').getAttribute('maxlength')).toBe('500');
			expect(seite.textContent).toContain('16/24');
			tippe(seite, 'input[name="anzeigename"]', 'Fischer');
			await stabil(harness);
			expect(seite.textContent).toContain('7/24');
		});

		it('zählt den Anzeigenamen wie der Server: Codepoints des getrimmten Texts', async () => {
			const { harness, seite } = await oeffne();
			tippe(seite, 'input[name="anzeigename"]', '  Fischer  ');
			await stabil(harness);
			expect(seite.textContent).toContain('7/24');
			// Ein Emoji ist ein Codepoint, aber zwei UTF-16-Einheiten.
			tippe(seite, 'input[name="anzeigename"]', 'Fische 🐟');
			await stabil(harness);
			expect(seite.textContent).toContain('8/24');
		});

		it('sperrt die Felder des Vereins, solange gespeichert wird, und gibt sie danach frei', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="anzeigename"]', 'Fischer');
			await stabil(harness);
			speichern(seite, 'Verein').click();
			harness.detectChanges();
			for (const sel of ['input[name="anzeigename"]', 'input[name="name"]', 'textarea[name="kontakt"]']) {
				expect(feld<HTMLInputElement>(seite, sel).readOnly).toBe(true);
			}
			http.expectOne(`${API}/einstellungen`).flush({ ...EINSTELLUNGEN, anzeigename: 'Fischer' });
			await vereinNeu(http, harness, { ...VEREIN, anzeigename: 'Fischer' });
			expect(feld<HTMLInputElement>(seite, 'input[name="anzeigename"]').readOnly).toBe(false);
		});

		it('die beiden Speichern-Knöpfe haben unterscheidbare Namen', async () => {
			const { seite } = await oeffne();
			expect(speichern(seite, 'Verein').getAttribute('aria-label')).toBe('Vereinsangaben speichern');
			expect(speichern(seite, 'Vereinsfarbe').getAttribute('aria-label')).toBe('Vereinsfarbe speichern');
			expect(speichern(seite, 'Verein').textContent?.trim()).toBe('Speichern');
		});

		it('zeigt die Adresse nur lesend und sagt, dass sie sich nicht ändern lässt', async () => {
			const { seite } = await oeffne();
			const adresse = feld<HTMLInputElement>(seite, 'input[name="slug"]');
			expect(adresse.value).toBe('demo');
			expect(adresse.readOnly).toBe(true);
			expect(seite.textContent).toContain('Die Adresse lässt sich nicht ändern.');
		});

		it('Speichern ist ohne Änderung gesperrt', async () => {
			const { seite } = await oeffne();
			expect(speichern(seite, 'Verein').disabled).toBe(true);
		});

		it('Speichern schickt nur geänderte Felder, danach genau eine Anfrage an /verein und die Meldung', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="anzeigename"]', '  Fischer  ');
			await stabil(harness);
			speichern(seite, 'Verein').click();
			const anfrage = http.expectOne(`${API}/einstellungen`);
			expect(anfrage.request.method).toBe('PATCH');
			expect(anfrage.request.body).toEqual({ anzeigename: 'Fischer' });
			anfrage.flush({ ...EINSTELLUNGEN, anzeigename: 'Fischer' });
			// expectOne scheitert bei zwei Anfragen: Es soll genau eine kommen.
			await vereinNeu(http, harness, { ...VEREIN, anzeigename: 'Fischer' });
			expect(TestBed.inject(MeldungService).text()).toBe('Gespeichert');
			expect(speichern(seite, 'Verein').disabled).toBe(true);
			expect(feld<HTMLInputElement>(seite, 'input[name="anzeigename"]').value).toBe('Fischer');
		});

		it('ein leerer Kontakt geht als null', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'textarea[name="kontakt"]', '   ');
			await stabil(harness);
			speichern(seite, 'Verein').click();
			const anfrage = http.expectOne(`${API}/einstellungen`);
			expect(anfrage.request.body).toEqual({ kontakt: null });
			anfrage.flush({ ...EINSTELLUNGEN, kontakt: null });
			await vereinNeu(http, harness);
		});

		it('eine 400 mit feld anzeigename zeigt den Text am Feld', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="anzeigename"]', 'Ein ziemlich langer Anzeigename');
			await stabil(harness);
			speichern(seite, 'Verein').click();
			http
				.expectOne(`${API}/einstellungen`)
				.flush(
					{ fehler: 'Der Anzeigename darf höchstens 24 Zeichen haben', feld: 'anzeigename' },
					{ status: 400, statusText: 'Bad Request' },
				);
			await stabil(harness);
			const eingabe = feld<HTMLInputElement>(seite, 'input[name="anzeigename"]');
			expect(eingabe.getAttribute('aria-invalid')).toBe('true');
			const meldungId = eingabe.getAttribute('aria-describedby') ?? '';
			expect(meldungId).toContain('anzeigename-fehler');
			expect(feld(seite, '#anzeigename-fehler').textContent).toContain('höchstens 24 Zeichen');
			expect(feld(seite, '#anzeigename-fehler').getAttribute('role')).toBe('alert');
			// Nichts gespeichert: kein Neuladen, keine Meldung.
			http.expectNone(`${API}/verein`);
			expect(TestBed.inject(MeldungService).text()).toBeNull();
		});

		it('ein Fehler ohne Feld steht unter dem Formular, ein neues Speichern räumt ihn ab', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="name"]', 'Neuer Name e. V.');
			await stabil(harness);
			speichern(seite, 'Verein').click();
			http.expectOne(`${API}/einstellungen`).error(new ProgressEvent('error'));
			await stabil(harness);
			expect(feld(seite, 'form[aria-label="Verein"] [role="alert"]').textContent).toBeTruthy();
			speichern(seite, 'Verein').click();
			harness.detectChanges();
			expect(seite.querySelector('form[aria-label="Verein"] [role="alert"]')).toBeNull();
			http.expectOne(`${API}/einstellungen`).flush({ ...EINSTELLUNGEN, name: 'Neuer Name e. V.' });
			await vereinNeu(http, harness);
		});

		it('ein abgelaufenes Login führt zur Anmeldung mit dieser Seite als weiter', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="anzeigename"]', 'Fischer');
			await stabil(harness);
			speichern(seite, 'Verein').click();
			http
				.expectOne(`${API}/einstellungen`)
				.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
			await vi.waitFor(() =>
				expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fverwaltung%2Feinstellungen'),
			);
			// Die Anmeldeseite laedt ihren Vereinskopf; hier zaehlt nur das Ziel der Umleitung.
			http.match(`${API}/verein`);
			await stabil(harness);
		});
	});

	describe('Vereinsfarbe', () => {
		it('eine Farbänderung setzt die Farbe sofort in der ganzen App', async () => {
			const { harness, seite } = await oeffne();
			tippe(seite, 'input[name="farbe"]', '#e11d48');
			expect(akzentHell()).toBe(vereinsfarben('#e11d48').hell.akzent);
			await stabil(harness);
			expect(seite.textContent).toContain('#e11d48');
		});

		it('zeigt zwei Muster aus akzent und aufAkzent', async () => {
			const { harness, seite } = await oeffne();
			tippe(seite, 'input[name="farbe"]', '#e11d48');
			await stabil(harness);
			const satz = vereinsfarben('#e11d48');
			const hell = feld<HTMLElement>(seite, '.muster.hell');
			const dunkel = feld<HTMLElement>(seite, '.muster.dunkel');
			expect(hell.textContent?.trim()).toBe('Hell');
			expect(dunkel.textContent?.trim()).toBe('Dunkel');
			// jsdom und Browser normalisieren Farben unterschiedlich; ein Vergleich im Browserformat genuegt hier.
			const wie = (hex: string) => {
				const probe = document.createElement('span');
				probe.style.color = hex;
				return probe.style.color;
			};
			expect(hell.style.backgroundColor).toBe(wie(satz.hell.akzent));
			expect(hell.style.color).toBe(wie(satz.hell.aufAkzent));
			expect(dunkel.style.backgroundColor).toBe(wie(satz.dunkel.akzent));
			expect(dunkel.style.color).toBe(wie(satz.dunkel.aufAkzent));
		});

		// Die Muster zeigen den Ton, den die App wirklich nimmt; ein Satz darueber erschiene bei jeder Farbe
		// (AA auf Weiss und AA auf der dunklen Karte schliessen sich aus) und sagte darum nichts.
		it('schreibt keinen Hinweis zu angepassten Tönen, auch nicht bei Gelb', async () => {
			const { harness, seite } = await oeffne();
			tippe(seite, 'input[name="farbe"]', '#ffff00');
			await stabil(harness);
			expect(seite.textContent).not.toContain('Lesbarkeit');
			expect(seite.textContent).not.toContain('angepassten Ton');
			expect(seite.querySelector('#farbe-hinweis-hell')).toBeNull();
			expect(seite.querySelector('#farbe-hinweis-dunkel')).toBeNull();
			// Hell und Dunkel zeigen den Ton selbst, der sich von der Eingabe unterscheiden darf.
			const satz = vereinsfarben('#ffff00');
			expect(feld(seite, '.muster.hell').textContent?.trim()).toBe('Hell');
			expect(feld(seite, '.muster.dunkel').textContent?.trim()).toBe('Dunkel');
			expect(satz.hell.akzent).not.toBe('#ffff00');
		});

		it('verknüpft Vorschau-Hinweis und Fehler mit dem Farbwähler', async () => {
			const { harness, seite, http } = await oeffne();
			const waehler = feld<HTMLInputElement>(seite, 'input[name="farbe"]');
			tippe(seite, 'input[name="farbe"]', '#ffff00');
			await stabil(harness);
			const beschreibung = waehler.getAttribute('aria-describedby') ?? '';
			expect(beschreibung).toBe('farbe-hinweis');
			expect(waehler.getAttribute('aria-invalid')).toBeNull();
			speichern(seite, 'Vereinsfarbe').click();
			http
				.expectOne(`${API}/einstellungen`)
				.flush(
					{ fehler: 'Bitte eine Farbe als #rrggbb angeben', feld: 'farbe' },
					{ status: 400, statusText: 'Bad Request' },
				);
			await stabil(harness);
			expect(waehler.getAttribute('aria-invalid')).toBe('true');
			expect(waehler.getAttribute('aria-describedby')).toContain('farbe-fehler');
			expect(feld(seite, '#farbe-fehler').textContent).toContain('#rrggbb');
		});

		it('sperrt den Farbwähler, solange die Farbe gespeichert wird', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="farbe"]', '#e11d48');
			await stabil(harness);
			speichern(seite, 'Vereinsfarbe').click();
			harness.detectChanges();
			expect(feld<HTMLInputElement>(seite, 'input[name="farbe"]').disabled).toBe(true);
			http.expectOne(`${API}/einstellungen`).flush({ ...EINSTELLUNGEN, farbe: '#e11d48' });
			await vereinNeu(http, harness, { ...VEREIN, farbe: '#e11d48' });
			expect(feld<HTMLInputElement>(seite, 'input[name="farbe"]').disabled).toBe(false);
		});

		it('Speichern übernimmt die Farbe, lädt den Verein neu und meldet Gespeichert', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="farbe"]', '#e11d48');
			await stabil(harness);
			speichern(seite, 'Vereinsfarbe').click();
			const anfrage = http.expectOne(`${API}/einstellungen`);
			expect(anfrage.request.body).toEqual({ farbe: '#e11d48' });
			anfrage.flush({ ...EINSTELLUNGEN, farbe: '#e11d48' });
			await vereinNeu(http, harness, { ...VEREIN, farbe: '#e11d48' });
			expect(TestBed.inject(MeldungService).text()).toBe('Gespeichert');
			expect(akzentHell()).toBe(vereinsfarben('#e11d48').hell.akzent);
			expect(speichern(seite, 'Vereinsfarbe').disabled).toBe(true);
		});

		it('verlässt man die Seite ohne Speichern, gilt wieder die gespeicherte Farbe', async () => {
			const { harness, seite } = await oeffne();
			const gespeichert = vereinsfarben('#1d4ed8').hell.akzent;
			expect(akzentHell()).toBe(gespeichert);
			tippe(seite, 'input[name="farbe"]', '#e11d48');
			expect(akzentHell()).not.toBe(gespeichert);
			harness.fixture.destroy();
			expect(akzentHell()).toBe(gespeichert);
		});

		it('eine ungespeicherte Farbe bleibt, wenn der Verein nach dem Speichern des Namens neu geladen wird', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="farbe"]', '#e11d48');
			tippe(seite, 'input[name="name"]', 'Neuer Name e. V.');
			await stabil(harness);
			speichern(seite, 'Verein').click();
			http.expectOne(`${API}/einstellungen`).flush({ ...EINSTELLUNGEN, name: 'Neuer Name e. V.' });
			await vereinNeu(http, harness);
			expect(akzentHell()).toBe(vereinsfarben('#e11d48').hell.akzent);
			expect(feld<HTMLInputElement>(seite, 'input[name="farbe"]').value).toBe('#e11d48');
		});

		it('eine 400 zur Farbe steht in der Farbkarte', async () => {
			const { harness, seite, http } = await oeffne();
			tippe(seite, 'input[name="farbe"]', '#e11d48');
			await stabil(harness);
			speichern(seite, 'Vereinsfarbe').click();
			http
				.expectOne(`${API}/einstellungen`)
				.flush(
					{ fehler: 'Bitte eine Farbe als #rrggbb angeben', feld: 'farbe' },
					{ status: 400, statusText: 'Bad Request' },
				);
			await stabil(harness);
			expect(feld(seite, 'form[aria-label="Vereinsfarbe"] [role="alert"]').textContent).toContain('#rrggbb');
		});
	});

	describe('Logo', () => {
		it('zeigt ohne Logo die Initialen und keinen Knopf zum Entfernen', async () => {
			const { seite } = await oeffne();
			expect(feld(seite, '[data-karte="logo"] .abzeichen').textContent?.trim()).toBe('JD');
			expect(seite.querySelector('[data-karte="logo"] img.logo')).toBeNull();
			expect([...seite.querySelectorAll('button')].some((b) => b.textContent?.includes('Logo entfernen'))).toBe(false);
		});

		it('zeigt das aktuelle Logo mit 96 px und der Version aus logoStand', async () => {
			const { seite } = await oeffne({ ...EINSTELLUNGEN, logoStand: '2026-10-18T10:00:00.000Z' });
			const bild = feld<HTMLImageElement>(seite, '[data-karte="logo"] img.logo');
			expect(bild.getAttribute('src')).toBe('/demo/api/v1/verein/logo?v=2026-10-18T10%3A00%3A00.000Z');
			expect(bild.getAttribute('width')).toBe('96');
			expect(bild.getAttribute('height')).toBe('96');
			expect(seite.querySelector('[data-karte="logo"] .abzeichen')).toBeNull();
		});

		it('nimmt nur PNG und JPEG an', async () => {
			const { seite } = await oeffne();
			expect(feld(seite, 'input[type="file"]').getAttribute('accept')).toBe('image/png,image/jpeg');
		});

		it('eine Datei mit 1,5 MB erzeugt keine Anfrage und zeigt die Meldung', async () => {
			const { harness, seite, http } = await oeffne();
			waehleDatei(seite, datei(1.5 * 1024 * 1024));
			await stabil(harness);
			http.expectNone(`${API}/einstellungen/logo`);
			expect(feld(seite, '[data-karte="logo"] [role="alert"]').textContent).toContain(
				'Das Bild ist zu groß (höchstens 1 MB)',
			);
			http.expectNone(`${API}/verein`);
			const eingabe = feld<HTMLInputElement>(seite, 'input[type="file"]');
			expect(eingabe.getAttribute('aria-invalid')).toBe('true');
			expect(eingabe.getAttribute('aria-describedby')).toContain('logo-fehler');
			expect(feld(seite, '#logo-fehler').textContent).toContain('zu groß');
		});

		it('genau 1 MB geht noch durch', async () => {
			const { harness, seite, http } = await oeffne();
			waehleDatei(seite, datei(1024 * 1024));
			http.expectOne(`${API}/einstellungen/logo`).flush({ logoStand: '2026-10-18T11:00:00.000Z' });
			await vereinNeu(http, harness);
		});

		it('ein PNG schickt PUT /einstellungen/logo mit image/png und der Datei als Body', async () => {
			const { harness, seite, http } = await oeffne();
			const png = datei(2000);
			waehleDatei(seite, png);
			const anfrage = http.expectOne(`${API}/einstellungen/logo`);
			expect(anfrage.request.method).toBe('PUT');
			expect(anfrage.request.headers.get('Content-Type')).toBe('image/png');
			expect(anfrage.request.body).toBe(png);
			anfrage.flush({ logoStand: '2026-10-18T11:00:00.000Z' });
			await vereinNeu(http, harness, { ...VEREIN, hatLogo: true, logoStand: '2026-10-18T11:00:00.000Z' });
			expect(TestBed.inject(MeldungService).text()).toBe('Gespeichert');
			expect(feld<HTMLImageElement>(seite, '[data-karte="logo"] img.logo').getAttribute('src')).toContain(
				'?v=2026-10-18T11',
			);
		});

		it('eine 415 zeigt den Text des Servers', async () => {
			const { harness, seite, http } = await oeffne();
			waehleDatei(seite, datei(50, 'image/png', 'kein-bild.png'));
			http
				.expectOne(`${API}/einstellungen/logo`)
				.flush(
					{ fehler: 'Bitte ein PNG- oder JPEG-Bild wählen' },
					{ status: 415, statusText: 'Unsupported Media Type' },
				);
			await stabil(harness);
			expect(feld(seite, '[data-karte="logo"] [role="alert"]').textContent).toContain(
				'Bitte ein PNG- oder JPEG-Bild wählen',
			);
			http.expectNone(`${API}/verein`);
			expect(TestBed.inject(MeldungService).text()).toBeNull();
		});

		it('eine 413 des Servers zeigt ebenfalls seinen Text', async () => {
			const { harness, seite, http } = await oeffne();
			waehleDatei(seite, datei(50));
			http
				.expectOne(`${API}/einstellungen/logo`)
				.flush({ fehler: 'Das Bild ist zu groß (höchstens 1 MB)' }, { status: 413, statusText: 'Payload Too Large' });
			await stabil(harness);
			expect(feld(seite, '[data-karte="logo"] [role="alert"]').textContent).toContain('zu groß');
		});

		it('Logo entfernen schickt DELETE, lädt den Verein neu und meldet Gespeichert', async () => {
			const { harness, seite, http } = await oeffne({ ...EINSTELLUNGEN, logoStand: '2026-10-18T10:00:00.000Z' });
			knopf(seite, 'Logo entfernen').click();
			const anfrage = http.expectOne(`${API}/einstellungen/logo`);
			expect(anfrage.request.method).toBe('DELETE');
			anfrage.flush({ logoStand: null });
			await vereinNeu(http, harness);
			expect(TestBed.inject(MeldungService).text()).toBe('Gespeichert');
			expect(seite.querySelector('[data-karte="logo"] img.logo')).toBeNull();
			expect(feld(seite, '[data-karte="logo"] .abzeichen').textContent?.trim()).toBe('JD');
		});
	});

	describe('ohne Berechtigung und bei Fehlern', () => {
		async function oeffneMitAntwort(status: number, koerper: object) {
			const http = TestBed.inject(HttpTestingController);
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/verwaltung/einstellungen');
			await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(['MITGLIEDER'])));
			await navigation;
			await vi.waitFor(() => http.expectOne(`${API}/einstellungen`).flush(koerper, { status, statusText: 'Fehler' }));
			await vi.waitFor(() => http.expectOne(`${API}/verein`).flush(VEREIN));
			await stabil(harness);
			return { harness, seite: harness.routeNativeElement as HTMLElement, http };
		}

		it('ein 404 auf GET /einstellungen zeigt Nicht gefunden oder keine Berechtigung', async () => {
			const { seite } = await oeffneMitAntwort(404, { fehler: 'nicht gefunden' });
			expect(seite.textContent).toContain('Nicht gefunden oder keine Berechtigung');
			expect(seite.querySelector('input')).toBeNull();
		});

		it('ein anderer Ladefehler zeigt den Text und erlaubt einen neuen Versuch', async () => {
			const { harness, seite, http } = await oeffneMitAntwort(500, { fehler: 'Unerwarteter Fehler' });
			expect(feld(seite, '[role="alert"]').textContent).toContain('Unerwarteter Fehler');
			knopf(seite, 'Nochmal versuchen').click();
			http.expectOne(`${API}/einstellungen`).flush(EINSTELLUNGEN);
			await stabil(harness);
			expect(feld<HTMLInputElement>(seite, 'input[name="anzeigename"]').value).toBe('Jungfischer Demo');
		});

		it('ein abgelaufenes Login beim Laden führt zur Anmeldung', async () => {
			const http = TestBed.inject(HttpTestingController);
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/verwaltung/einstellungen');
			await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(['EINSTELLUNGEN'])));
			await navigation;
			await vi.waitFor(() =>
				http
					.expectOne(`${API}/einstellungen`)
					.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
			);
			await vi.waitFor(() =>
				expect(TestBed.inject(Router).url).toBe('/demo/anmelden?weiter=%2Fdemo%2Fverwaltung%2Feinstellungen'),
			);
			http.match(`${API}/verein`);
		});
	});
});
