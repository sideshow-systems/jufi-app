import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeldungService } from '../gestaltung/meldung';
import { adminTestAnbieter, knopf, oeffneVerwaltung, stabil, tippe } from './test-hilfen';

const API = '/admin/api/v1';
const EINLADUNG = {
	link: 'http://localhost:4200/jungfischer-mueller/einladung#abc',
	text: 'Hallo Thomas,\n\ndein Link: http://localhost:4200/jungfischer-mueller/einladung#abc',
};

describe('Verein anlegen', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => {
		vi.restoreAllMocks();
		TestBed.inject(HttpTestingController).verify();
	});

	async function oeffne() {
		const o = await oeffneVerwaltung('/admin/vereine/neu');
		const wert = (name: string) => o.seite.querySelector<HTMLInputElement>(`input[name=${name}]`)?.value;
		return { ...o, wert };
	}

	async function fuelleAus(o: Awaited<ReturnType<typeof oeffne>>, email = 'thomas@example.org'): Promise<void> {
		tippe(o.seite, 'input[name=name]', 'Jungfischer Mueller e. V.');
		tippe(o.seite, 'input[name=anzeigename]', 'Jungfischer Müller');
		tippe(o.seite, 'input[name=vorname]', 'Thomas');
		tippe(o.seite, 'input[name=nachname]', 'Beispiel');
		tippe(o.seite, 'input[name=email]', email);
		await stabil(o.harness);
	}

	it('Slug folgt dem Anzeigenamen, bis er von Hand geaendert wird', async () => {
		const o = await oeffne();
		tippe(o.seite, 'input[name=anzeigename]', 'Jungfischer Müller');
		await stabil(o.harness);
		expect(o.wert('slug')).toBe('jungfischer-mueller');
		expect(o.seite.textContent).toContain('18/24');
		expect(o.seite.textContent).toContain(`${location.origin}/jungfischer-mueller/`);

		tippe(o.seite, 'input[name=slug]', 'eigener-slug');
		tippe(o.seite, 'input[name=anzeigename]', 'Ganz Anders');
		await stabil(o.harness);
		expect(o.wert('slug')).toBe('eigener-slug');
		expect(o.seite.textContent).toContain(`${location.origin}/eigener-slug/`);

		// Leer geraeumt, folgt er wieder.
		tippe(o.seite, 'input[name=slug]', '');
		tippe(o.seite, 'input[name=anzeigename]', 'Noch Einer');
		await stabil(o.harness);
		expect(o.wert('slug')).toBe('noch-einer');
	});

	it('die Startfarbe ist das Teal des Stils', async () => {
		const o = await oeffne();
		expect(o.wert('farbe')).toBe('#0f766e');
	});

	it('Slug demo wird schon im Formular als reserviert markiert', async () => {
		const o = await oeffne();
		tippe(o.seite, 'input[name=slug]', 'demo');
		await stabil(o.harness);

		expect(o.seite.querySelector('#fehler-slug')?.textContent).toContain('Dieser Slug ist reserviert');
	});

	it('eine ungueltige E-Mail wird gar nicht erst gesendet', async () => {
		const o = await oeffne();
		await fuelleAus(o, 'thomas');
		knopf(o.seite, 'Verein anlegen').click();
		await stabil(o.harness);

		// afterEach prueft per verify(), dass keine Anfrage offen ist.
		expect(o.seite.querySelector('#fehler-email')?.textContent).toContain('Keine gültige E-Mail-Adresse');
	});

	it('400 mit feld email zeigt den Fehler am E-Mail-Feld', async () => {
		const o = await oeffne();
		await fuelleAus(o);
		knopf(o.seite, 'Verein anlegen').click();

		const anfrage = o.http.expectOne(`${API}/vereine`);
		expect(anfrage.request.body).toEqual({
			name: 'Jungfischer Mueller e. V.',
			anzeigename: 'Jungfischer Müller',
			slug: 'jungfischer-mueller',
			farbe: '#0f766e',
			leitung: { vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas@example.org' },
		});
		anfrage.flush(
			{ fehler: 'Keine gültige E-Mail-Adresse', feld: 'email' },
			{ status: 400, statusText: 'Bad Request' },
		);
		await stabil(o.harness);

		const fehler = o.seite.querySelector('#fehler-email');
		expect(fehler?.textContent).toContain('Keine gültige E-Mail-Adresse');
		expect(o.seite.querySelector('input[name=email]')?.getAttribute('aria-describedby')).toBe('fehler-email');
		// Das Formular bleibt stehen, nichts ist angelegt.
		expect(o.seite.querySelector('input[name=email]')).not.toBeNull();
	});

	it('ohne gesetztes Kaestchen fehlt perMail im Body', async () => {
		const o = await oeffne();
		await fuelleAus(o);
		expect(o.seite.textContent).toContain('Zusätzlich per Mail senden');
		expect(o.seite.querySelector<HTMLInputElement>('input[name=per-mail]')?.checked).toBe(false);
		knopf(o.seite, 'Verein anlegen').click();

		const anfrage = o.http.expectOne(`${API}/vereine`);
		expect('perMail' in anfrage.request.body).toBe(false);
		anfrage.flush({ id: 'neu-1', slug: 'jungfischer-mueller', einladung: EINLADUNG, mailEingereiht: false });
		await stabil(o.harness);

		expect(o.seite.textContent).not.toContain('Mail ist eingereiht');
	});

	it('mit gesetztem Kaestchen geht perMail true mit, und die Antwort zeigt den Hinweis', async () => {
		const o = await oeffne();
		await fuelleAus(o);
		o.seite.querySelector<HTMLInputElement>('input[name=per-mail]')?.click();
		await stabil(o.harness);
		knopf(o.seite, 'Verein anlegen').click();

		const anfrage = o.http.expectOne(`${API}/vereine`);
		expect(anfrage.request.body.perMail).toBe(true);
		anfrage.flush({ id: 'neu-1', slug: 'jungfischer-mueller', einladung: EINLADUNG, mailEingereiht: true });
		await stabil(o.harness);

		expect(o.seite.textContent).toContain('Mail ist eingereiht');
		// Der Text bleibt trotzdem stehen: Die Mail ist ein zusaetzlicher Weg, kein Ersatz.
		expect(o.seite.textContent).toContain('dein Link');
	});

	it('409 beim Slug zeigt den Fehler am Slug-Feld', async () => {
		const o = await oeffne();
		await fuelleAus(o);
		knopf(o.seite, 'Verein anlegen').click();
		o.http
			.expectOne(`${API}/vereine`)
			.flush({ fehler: 'Dieser Slug ist vergeben', feld: 'slug' }, { status: 409, statusText: 'Conflict' });
		await stabil(o.harness);

		expect(o.seite.querySelector('#fehler-slug')?.textContent).toContain('Dieser Slug ist vergeben');
	});

	it('eine abgelaufene Sitzung fuehrt zur Anmeldung', async () => {
		const o = await oeffne();
		await fuelleAus(o);
		knopf(o.seite, 'Verein anlegen').click();
		o.http
			.expectOne(`${API}/vereine`)
			.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
		await stabil(o.harness);
		await o.harness.fixture.whenStable();

		expect(TestBed.inject(Router).url).toBe('/admin/anmelden');
	});

	it('nach dem Anlegen erscheinen Text und Kopierknoepfe', async () => {
		const schreibe = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText: schreibe }, configurable: true });
		const o = await oeffne();
		await fuelleAus(o);
		knopf(o.seite, 'Verein anlegen').click();
		o.http.expectOne(`${API}/vereine`).flush({ id: 'neu-1', slug: 'jungfischer-mueller', einladung: EINLADUNG });
		await stabil(o.harness);

		// Das Formular ist weg, der Text steht da.
		expect(o.seite.querySelector('input[name=anzeigename]')).toBeNull();
		expect(o.seite.textContent).toContain('Hallo Thomas,');
		expect(o.seite.textContent).toContain('Der Link gilt 14 Tage.');
		expect(
			[...o.seite.querySelectorAll('a')].find((a) => a.textContent?.includes('Zur Vereinsseite'))?.getAttribute('href'),
		).toBe('/admin/vereine/neu-1');

		knopf(o.seite, 'Text kopieren').click();
		await vi.waitFor(() => expect(schreibe).toHaveBeenCalledWith(EINLADUNG.text));
		await vi.waitFor(() => expect(TestBed.inject(MeldungService).text()).toBe('Kopiert'));

		knopf(o.seite, 'Link kopieren').click();
		await vi.waitFor(() => expect(schreibe).toHaveBeenLastCalledWith(EINLADUNG.link));
	});

	it('ohne Zwischenablage bleibt der Hinweis, von Hand zu kopieren', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: vi.fn().mockRejectedValue(new Error('verweigert')) },
			configurable: true,
		});
		const o = await oeffne();
		await fuelleAus(o);
		knopf(o.seite, 'Verein anlegen').click();
		o.http.expectOne(`${API}/vereine`).flush({ id: 'neu-1', slug: 'jungfischer-mueller', einladung: EINLADUNG });
		await stabil(o.harness);

		knopf(o.seite, 'Text kopieren').click();
		await vi.waitFor(async () => {
			await stabil(o.harness);
			expect(o.seite.querySelector('[role=alert]')?.textContent).toContain('von Hand');
		});
	});
});
