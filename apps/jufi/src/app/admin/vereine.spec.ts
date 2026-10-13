import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { adminTestAnbieter, oeffneVerwaltung, stabil } from './test-hilfen';

const API = '/admin/api/v1';

describe('Vereinsliste', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	function zellen(zeile: Element): string[] {
		return [...zeile.querySelectorAll('td')].map((z) => z.textContent?.trim() ?? '');
	}

	it('zeigt je Verein eine Zeile mit Kennzahlen', async () => {
		const { harness, seite, http } = await oeffneVerwaltung('/admin/vereine');
		http.expectOne(`${API}/vereine`).flush({
			vereine: [
				{
					id: 'v1',
					slug: 'jungfischer-musterstadt',
					anzeigename: 'Jungfischer Musterstadt',
					status: 'AKTIV',
					kennzahlen: {
						jungfischer: 12,
						erwachsene: 20,
						zugaenge: 8,
						offeneEinladungen: 3,
						letzteAnmeldung: '2026-10-12',
					},
				},
				{
					id: 'v2',
					slug: 'angelfreunde',
					anzeigename: 'Angelfreunde',
					status: 'GESPERRT',
					kennzahlen: { jungfischer: 0, erwachsene: 1, zugaenge: 0, offeneEinladungen: 1, letzteAnmeldung: null },
				},
			],
		});
		await stabil(harness);

		const zeilen = [...seite.querySelectorAll('tbody tr')];
		expect(zeilen).toHaveLength(2);
		expect(zellen(zeilen[0])).toEqual([
			'Jungfischer Musterstadt',
			'jungfischer-musterstadt',
			'Aktiv',
			'12',
			'20',
			'8',
			'3',
			'12.10.2026',
		]);
		expect(zellen(zeilen[1])).toEqual(['Angelfreunde', 'angelfreunde', 'Gesperrt', '0', '1', '0', '1', '—']);
		expect(zeilen[0].querySelector('a')?.getAttribute('href')).toBe('/admin/vereine/v1');
		expect(
			[...seite.querySelectorAll('a')].find((a) => a.textContent?.includes('Verein anlegen'))?.getAttribute('href'),
		).toBe('/admin/vereine/neu');
	});

	it('leerer Zustand', async () => {
		const { harness, seite, http } = await oeffneVerwaltung('/admin/vereine');
		http.expectOne(`${API}/vereine`).flush({ vereine: [] });
		await stabil(harness);

		expect(seite.textContent).toContain('Noch kein Verein angelegt.');
		expect(seite.querySelector('table')).toBeNull();
	});

	it('eine abgelaufene Sitzung fuehrt zur Anmeldung', async () => {
		const { harness, seite, http } = await oeffneVerwaltung('/admin/vereine');
		http.expectOne(`${API}/vereine`).flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
		await stabil(harness);
		await harness.fixture.whenStable();

		expect(TestBed.inject(Router).url).toBe('/admin/anmelden');
		expect(seite.textContent).not.toContain('konnten nicht geladen werden');
	});

	it('ein Serverfehler zeigt seinen Text', async () => {
		const { harness, seite, http } = await oeffneVerwaltung('/admin/vereine');
		http.expectOne(`${API}/vereine`).flush({ fehler: 'kaputt' }, { status: 500, statusText: 'Server Error' });
		await stabil(harness);
		expect(seite.textContent).toContain('Die Vereine konnten nicht geladen werden: kaputt');
	});
});
