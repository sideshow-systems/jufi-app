import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { adminTestAnbieter, knopf, tippe } from '../../admin/test-hilfen';
import {
	API,
	antworteAbgelaufen,
	erwarteAnmeldung,
	hake,
	ichMit,
	oeffneAbgelaufen,
	oeffneSeite,
	stabil,
} from './test-hilfen';

const GRUPPEN = { untergruppen: [{ id: 'u1', name: 'Gruppe A', mitglieder: 1 }] };

describe('Person anlegen', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne() {
		const r = await oeffneSeite('/demo/verwaltung/neu', ichMit(['MITGLIEDER']), [['/untergruppen', GRUPPEN]]);
		const navigiert = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
		return { ...r, navigiert };
	}

	function fuelleKind(seite: HTMLElement): void {
		tippe(seite, 'input[name="vorname"]', 'Lena');
		tippe(seite, 'input[name="nachname"]', 'Muster');
		tippe(seite, 'input[name="geburtsdatum"]', '2015-05-01');
	}

	it('legt einen Jungfischer mit Untergruppe an und geht zur Personenseite', async () => {
		const { harness, seite, http, navigiert } = await oeffne();
		fuelleKind(seite);
		hake(seite, 'input[name="untergruppe-u1"]');
		await stabil(harness);
		knopf(seite, 'Anlegen').click();
		const anfrage = http.expectOne(`${API}/personen`);
		expect(anfrage.request.body).toEqual({
			art: 'JUNGFISCHER',
			vorname: 'Lena',
			nachname: 'Muster',
			geburtsdatum: '2015-05-01',
			untergruppenIds: ['u1'],
		});
		anfrage.flush({ id: 'neu-1' }, { status: 201, statusText: 'Created' });
		await stabil(harness);
		expect(navigiert).toHaveBeenCalledWith(['/', 'demo', 'verwaltung', 'personen', 'neu-1']);
	});

	it('Erwachsene haben weder Geburtsdatum noch Untergruppen', async () => {
		const { harness, seite, http } = await oeffne();
		hake(seite, 'input[name="art"][value="ERWACHSENER"]');
		await stabil(harness);
		expect(seite.querySelector('input[name="geburtsdatum"]')).toBeNull();
		expect(seite.querySelector('input[name="untergruppe-u1"]')).toBeNull();
		tippe(seite, 'input[name="vorname"]', 'Anna');
		tippe(seite, 'input[name="nachname"]', 'Muster');
		tippe(seite, 'input[name="email"]', 'anna@example.org');
		knopf(seite, 'Anlegen').click();
		const anfrage = http.expectOne(`${API}/personen`);
		expect(anfrage.request.body).toEqual({
			art: 'ERWACHSENER',
			vorname: 'Anna',
			nachname: 'Muster',
			email: 'anna@example.org',
		});
		anfrage.flush({ id: 'e-1' }, { status: 201, statusText: 'Created' });
	});

	it('Pflichtfelder fehlen: keine Anfrage, Hinweis am Feld', async () => {
		const { harness, seite, http } = await oeffne();
		knopf(seite, 'Anlegen').click();
		await stabil(harness);
		http.expectNone(`${API}/personen`);
		expect(seite.textContent).toContain('Bitte ausfüllen');
	});

	it('Dublette zeigt Warnung und Trotzdem-Knopf, der mit trotzdem:true sendet', async () => {
		const { harness, seite, http, navigiert } = await oeffne();
		fuelleKind(seite);
		knopf(seite, 'Anlegen').click();
		http.expectOne(`${API}/personen`).flush(
			{
				fehler: 'Diese Person gibt es vielleicht schon',
				code: 'DOPPELT',
				person: { id: 'k9', vorname: 'Lena', nachname: 'Muster' },
			},
			{ status: 409, statusText: 'Conflict' },
		);
		await stabil(harness);
		const warnung = seite.querySelector('[data-doppelt]')?.textContent ?? '';
		expect(warnung).toContain('Diese Person gibt es vielleicht schon');
		expect(warnung).toContain('Lena Muster');
		knopf(seite, 'Trotzdem anlegen').click();
		const zweite = http.expectOne(`${API}/personen`);
		expect(zweite.request.body.trotzdem).toBe(true);
		zweite.flush({ id: 'neu-2' }, { status: 201, statusText: 'Created' });
		await stabil(harness);
		expect(navigiert).toHaveBeenCalledWith(['/', 'demo', 'verwaltung', 'personen', 'neu-2']);
	});

	it('Serverfehler mit Feld erscheint als Text', async () => {
		const { harness, seite, http } = await oeffne();
		fuelleKind(seite);
		knopf(seite, 'Anlegen').click();
		http
			.expectOne(`${API}/personen`)
			.flush(
				{ fehler: 'Das Geburtsdatum liegt in der Zukunft oder zu weit zurück', feld: 'geburtsdatum' },
				{ status: 400, statusText: 'Bad Request' },
			);
		await stabil(harness);
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('liegt in der Zukunft');
		expect(seite.querySelector('input[name="geburtsdatum"]')?.getAttribute('aria-invalid')).toBe('true');
	});

	it('ein abgelaufenes Login beim Anlegen führt zur Anmeldung und zeigt keinen Fehler', async () => {
		const { harness, seite, http } = await oeffne();
		fuelleKind(seite);
		await stabil(harness);
		knopf(seite, 'Anlegen').click();
		await antworteAbgelaufen(http, '/personen');
		await erwarteAnmeldung(http, '/demo/verwaltung/neu');
	});

	it('ein abgelaufenes Login beim Laden der Untergruppen führt sofort zur Anmeldung', async () => {
		await oeffneAbgelaufen('/demo/verwaltung/neu', ['MITGLIEDER'], '/untergruppen');
	});
});
