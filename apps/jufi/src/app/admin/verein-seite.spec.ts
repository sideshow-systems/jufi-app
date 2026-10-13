import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { VereinDetails } from './admin-api';
import { adminTestAnbieter, knopf, oeffneVerwaltung, stabil, tippe } from './test-hilfen';

const API = '/admin/api/v1';
const EINLADUNG = {
	link: 'http://localhost:4200/jungfischer-musterstadt/einladung#neu',
	text: 'Hallo Thomas,\n\nneuer Link: http://localhost:4200/jungfischer-musterstadt/einladung#neu',
};

function verein(ueberschreibe: Partial<VereinDetails> = {}): VereinDetails {
	return {
		id: 'v1',
		slug: 'jungfischer-musterstadt',
		name: 'Jungfischer Musterstadt e. V.',
		anzeigename: 'Jungfischer Musterstadt',
		farbe: '#0f766e',
		status: 'AKTIV',
		angelegtAm: '2026-10-01T08:00:00.000Z',
		kennzahlen: { jungfischer: 12, erwachsene: 20, zugaenge: 0, offeneEinladungen: 1, letzteAnmeldung: null },
		ansprechpartner: [{ personId: 'p1', vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas@example.org' }],
		ersteLeitung: { personId: 'p1', vorname: 'Thomas', nachname: 'Beispiel' },
		slugAenderbar: true,
		protokoll: [
			{ zeitpunkt: '2026-10-01T12:05:00.000Z', aktion: 'VEREIN_ANGELEGT', admin: 'flo' },
			{ zeitpunkt: '2026-10-02T09:00:00.000Z', aktion: 'ERSTE_EINLADUNG_ERNEUERT', admin: 'flo' },
		],
		...ueberschreibe,
	};
}

describe('Vereinsseite', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne(details: VereinDetails = verein()) {
		const o = await oeffneVerwaltung('/admin/vereine/v1');
		o.http.expectOne(`${API}/vereine/v1`).flush(details);
		await stabil(o.harness);
		return o;
	}

	/** Die Seite laedt nach jeder Handlung neu. */
	async function laedtNeu(o: Awaited<ReturnType<typeof oeffne>>, details: VereinDetails): Promise<void> {
		await vi.waitFor(() => o.http.expectOne(`${API}/vereine/v1`).flush(details));
		await stabil(o.harness);
	}

	const dialog = (seite: HTMLElement) => seite.querySelector<HTMLElement>('[role=dialog]');

	it('zeigt Kopf, Kennzahlen, Ansprechpartner und Protokoll', async () => {
		const { seite } = await oeffne();

		expect(seite.querySelector('h1')?.textContent).toBe('Jungfischer Musterstadt');
		expect(seite.textContent).toContain('Jungfischer Musterstadt e. V.');
		expect(seite.textContent).toContain('jungfischer-musterstadt');
		expect(seite.textContent).toContain('Aktiv');
		expect(seite.textContent).toContain('Thomas Beispiel');
		expect(seite.textContent).toContain('thomas@example.org');
		const protokoll = [...seite.querySelectorAll('tbody tr')].map((z) =>
			[...z.querySelectorAll('td')].map((c) => c.textContent?.trim()),
		);
		// Berliner Zeit: Sommerzeit, also UTC plus zwei Stunden.
		expect(protokoll).toEqual([
			['01.10.2026 14:05', 'Verein angelegt', 'flo'],
			['02.10.2026 11:00', 'Einladung der ersten Leitung erneuert', 'flo'],
		]);
	});

	it('Slug-Feld und Erneuern nur solange nichts angenommen ist', async () => {
		const { seite } = await oeffne();

		expect(seite.querySelector('input[name=slug]')).not.toBeNull();
		expect(knopf(seite, 'Einladung für Thomas erneuern')).toBeTruthy();
	});

	it('nach der Annahme fehlen Slug-Feld und Erneuern', async () => {
		const { seite } = await oeffne(verein({ slugAenderbar: false, ersteLeitung: null }));

		expect(seite.querySelector('input[name=slug]')).toBeNull();
		expect(seite.textContent).not.toContain('erneuern');
	});

	it('Sperren fragt nach und sendet erst nach Bestaetigung', async () => {
		const o = await oeffne();
		const { seite, http, harness } = o;

		knopf(seite, 'Sperren').click();
		await stabil(harness);
		expect(dialog(seite)?.textContent).toContain('sperren?');
		http.expectNone(`${API}/vereine/v1/sperren`);

		// Abbrechen schliesst und sendet nichts.
		knopf(dialog(seite) as HTMLElement, 'Abbrechen').click();
		await stabil(harness);
		expect(dialog(seite)).toBeNull();
		http.expectNone(`${API}/vereine/v1/sperren`);

		// Erst die Bestaetigung sendet.
		knopf(seite, 'Sperren').click();
		await stabil(harness);
		knopf(dialog(seite) as HTMLElement, 'Sperren').click();
		await stabil(harness);
		expect(dialog(seite)).toBeNull();
		await vi.waitFor(() => http.expectOne(`${API}/vereine/v1/sperren`).flush({ status: 'GESPERRT' }));
		await laedtNeu(o, verein({ status: 'GESPERRT' }));

		expect(seite.textContent).toContain('Gesperrt');
		expect(knopf(seite, 'Entsperren')).toBeTruthy();
	});

	it('Escape schliesst die Rueckfrage, der Fokus landet erst im Dialog und kehrt zurueck', async () => {
		const { seite, harness, http } = await oeffne();
		const ausloeser = knopf(seite, 'Sperren');
		ausloeser.focus();

		ausloeser.click();
		await stabil(harness);
		await vi.waitFor(() => expect(document.activeElement).toBe(dialog(seite)));

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await stabil(harness);
		expect(dialog(seite)).toBeNull();
		expect(document.activeElement).toBe(ausloeser);
		http.expectNone(`${API}/vereine/v1/sperren`);
	});

	it('Notfall-Link zeigt danach den Text', async () => {
		const o = await oeffne();
		const { seite, http, harness } = o;

		knopf(seite, 'Notfall-Link erzeugen').click();
		await stabil(harness);
		expect(dialog(seite)?.textContent).toContain(
			'Neuen Einladungslink für Thomas erzeugen? Der Verein sieht das in seiner Verwaltung.',
		);
		knopf(dialog(seite) as HTMLElement, 'Link erzeugen').click();

		await vi.waitFor(() => {
			const anfrage = http.expectOne(`${API}/vereine/v1/notfall-link`);
			expect(anfrage.request.body).toEqual({ personId: 'p1' });
			anfrage.flush({ einladung: EINLADUNG });
		});
		await laedtNeu(o, verein());

		expect(seite.textContent).toContain('neuer Link: http://localhost:4200/jungfischer-musterstadt/einladung#neu');
		expect(knopf(seite, 'Text kopieren')).toBeTruthy();
	});

	it('Slug korrigieren sendet den neuen Slug und zeigt die neue Einladung', async () => {
		const o = await oeffne();
		const { seite, http, harness } = o;

		tippe(seite, 'input[name=slug]', 'musterstadt');
		await stabil(harness);
		knopf(seite, 'Slug ändern').click();

		await vi.waitFor(() => {
			const anfrage = http.expectOne(`${API}/vereine/v1/slug`);
			expect(anfrage.request.body).toEqual({ slug: 'musterstadt' });
			anfrage.flush({ slug: 'musterstadt', einladung: EINLADUNG });
		});
		await laedtNeu(o, verein({ slug: 'musterstadt' }));

		expect(seite.textContent).toContain('neuer Link');
		expect(seite.querySelector<HTMLInputElement>('input[name=slug]')?.value).toBe('musterstadt');
	});

	it('ein vergebener Slug steht am Slug-Feld', async () => {
		const { seite, http, harness } = await oeffne();

		tippe(seite, 'input[name=slug]', 'angelfreunde');
		await stabil(harness);
		knopf(seite, 'Slug ändern').click();
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/vereine/v1/slug`)
				.flush({ fehler: 'Dieser Slug ist vergeben', feld: 'slug' }, { status: 409, statusText: 'Conflict' }),
		);
		await stabil(harness);

		expect(seite.querySelector('#fehler-slug')?.textContent).toContain('Dieser Slug ist vergeben');
	});

	it('ein reservierter oder unveraenderter Slug laesst sich nicht absenden', async () => {
		const { seite, harness } = await oeffne();
		const absenden = knopf(seite, 'Slug ändern');
		expect(absenden.disabled).toBe(true);

		tippe(seite, 'input[name=slug]', 'demo');
		await stabil(harness);
		expect(absenden.disabled).toBe(true);
		expect(seite.querySelector('#fehler-slug')?.textContent).toContain('Dieser Slug ist reserviert');
	});

	it('Einladung erneuern zeigt den neuen Text', async () => {
		const o = await oeffne();

		knopf(o.seite, 'Einladung für Thomas erneuern').click();
		await vi.waitFor(() => o.http.expectOne(`${API}/vereine/v1/einladung-erneuern`).flush({ einladung: EINLADUNG }));
		await laedtNeu(o, verein());

		expect(o.seite.textContent).toContain('neuer Link');
	});

	it('ein unbekannter Verein ist nicht gefunden', async () => {
		const o = await oeffneVerwaltung('/admin/vereine/v1');
		o.http.expectOne(`${API}/vereine/v1`).flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await stabil(o.harness);

		expect(o.seite.textContent).toContain('Verein nicht gefunden.');
	});

	it('eine abgelaufene Sitzung fuehrt zur Anmeldung', async () => {
		const o = await oeffneVerwaltung('/admin/vereine/v1');
		o.http
			.expectOne(`${API}/vereine/v1`)
			.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
		await stabil(o.harness);
		await o.harness.fixture.whenStable();

		expect(TestBed.inject(Router).url).toBe('/admin/anmelden');
	});
});
