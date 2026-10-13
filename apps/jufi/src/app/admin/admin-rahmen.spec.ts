import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { adminTestAnbieter, oeffneVerwaltung, stabil } from './test-hilfen';

const API = '/admin/api/v1';

describe('Admin-Rahmen', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne() {
		const o = await oeffneVerwaltung('/admin/vereine');
		o.http.expectOne(`${API}/vereine`).flush({ vereine: [] });
		await stabil(o.harness);
		return o;
	}

	function abmelden(seite: HTMLElement): void {
		const knopf = [...seite.querySelectorAll<HTMLButtonElement>('header button')].find((b) =>
			b.textContent?.includes('Abmelden'),
		);
		if (!knopf) throw new Error('Abmelden nicht gefunden');
		knopf.click();
	}

	it('Abmelden fuehrt zur Anmeldung', async () => {
		const { seite, http, harness } = await oeffne();

		abmelden(seite);
		http.expectOne(`${API}/abmelden`).flush(null);
		await stabil(harness);

		await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/admin/anmelden'));
	});

	it('Abmelden bei abgelaufener Sitzung (401) gilt als abgemeldet', async () => {
		const { seite, http, harness } = await oeffne();

		abmelden(seite);
		http
			.expectOne(`${API}/abmelden`)
			.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
		await stabil(harness);

		await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/admin/anmelden'));
	});

	it('Abmelden ohne Verbindung bleibt auf der Seite und meldet den Fehler', async () => {
		const { seite, http, harness } = await oeffne();

		abmelden(seite);
		http.expectOne(`${API}/abmelden`).error(new ProgressEvent('error'));
		await stabil(harness);

		expect(seite.querySelector('header [role=alert]')?.textContent).toContain('Abmelden fehlgeschlagen');
		expect(TestBed.inject(Router).url).toBe('/admin/vereine');
	});
});
