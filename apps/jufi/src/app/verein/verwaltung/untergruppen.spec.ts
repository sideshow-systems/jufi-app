import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { adminTestAnbieter, knopf, tippe } from '../../admin/test-hilfen';
import { API, ichMit, oeffneSeite, stabil } from './test-hilfen';

const GRUPPEN = {
	untergruppen: [
		{ id: 'u1', name: 'Gruppe A', mitglieder: 3 },
		{ id: 'u2', name: 'Gruppe B', mitglieder: 0 },
	],
};

describe('Untergruppen', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne(rechte = ['MITGLIEDER']) {
		return oeffneSeite('/demo/verwaltung/untergruppen', ichMit(rechte), [['/untergruppen', GRUPPEN]]);
	}

	/** Beantwortet das Neuladen der Liste nach einer Aktion. */
	async function neuGeladen(http: HttpTestingController, harness: Parameters<typeof stabil>[0], antwort: object) {
		await vi.waitFor(() => http.expectOne(`${API}/untergruppen`).flush(antwort));
		await stabil(harness);
	}

	it('zeigt die Untergruppen mit Anzahl', async () => {
		const { seite } = await oeffne();
		const text = seite.textContent ?? '';
		expect(text).toContain('Gruppe A');
		expect(text).toContain('3 Mitglieder');
		expect(text).toContain('0 Mitglieder');
	});

	it('legt eine Untergruppe an und lädt die Liste neu', async () => {
		const { harness, seite, http } = await oeffne();
		tippe(seite, 'input[name="neuerName"]', 'Gruppe C');
		knopf(seite, 'Anlegen').click();
		const anfrage = http.expectOne(`${API}/untergruppen`);
		expect(anfrage.request.method).toBe('POST');
		expect(anfrage.request.body).toEqual({ name: 'Gruppe C' });
		anfrage.flush({ id: 'u3' }, { status: 201, statusText: 'Created' });
		await neuGeladen(http, harness, {
			untergruppen: [...GRUPPEN.untergruppen, { id: 'u3', name: 'Gruppe C', mitglieder: 0 }],
		});
		expect(seite.textContent).toContain('Gruppe C');
		expect((seite.querySelector('input[name="neuerName"]') as HTMLInputElement).value).toBe('');
	});

	it('NAME_VERGEBEN erscheint als Text am Feld', async () => {
		const { harness, seite, http } = await oeffne();
		tippe(seite, 'input[name="neuerName"]', 'Gruppe A');
		knopf(seite, 'Anlegen').click();
		http
			.expectOne(`${API}/untergruppen`)
			.flush(
				{ fehler: 'Diese Untergruppe gibt es schon', code: 'NAME_VERGEBEN', feld: 'name' },
				{ status: 409, statusText: 'Conflict' },
			);
		await stabil(harness);
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('gibt es schon');
		expect(seite.querySelector('input[name="neuerName"]')?.getAttribute('aria-invalid')).toBe('true');
	});

	it('benennt eine Untergruppe um', async () => {
		const { harness, seite, http } = await oeffne();
		seite.querySelector<HTMLButtonElement>('[data-gruppe="u1"] button.umbenennen')?.click();
		await stabil(harness);
		tippe(seite, 'input[name="umbenennen"]', 'Hechte');
		knopf(seite, 'Speichern').click();
		const anfrage = http.expectOne(`${API}/untergruppen/u1`);
		expect(anfrage.request.method).toBe('PATCH');
		expect(anfrage.request.body).toEqual({ name: 'Hechte' });
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
		await neuGeladen(http, harness, {
			untergruppen: [{ id: 'u1', name: 'Hechte', mitglieder: 3 }, GRUPPEN.untergruppen[1]],
		});
		expect(seite.textContent).toContain('Hechte');
		expect(seite.querySelector('input[name="umbenennen"]')).toBeNull();
	});

	it('Untergruppe löschen fragt nach und sagt, dass keine Personen entfernt werden', async () => {
		const { harness, seite, http } = await oeffne();
		seite.querySelector<HTMLButtonElement>('[data-gruppe="u1"] button.loeschen')?.click();
		await stabil(harness);
		http.expectNone(`${API}/untergruppen/u1`);
		const dialog = seite.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).toContain('Gruppe A');
		expect(dialog?.textContent).toContain('Das Löschen entfernt keine Personen');
		expect(document.activeElement).toBe(dialog);
		knopf(seite, 'Ja, löschen').click();
		const anfrage = http.expectOne(`${API}/untergruppen/u1`);
		expect(anfrage.request.method).toBe('DELETE');
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
		await neuGeladen(http, harness, { untergruppen: [GRUPPEN.untergruppen[1]] });
		expect(seite.textContent).not.toContain('Gruppe A');
		expect(seite.querySelector('[role="alertdialog"]')).toBeNull();
	});

	it('Abbrechen schließt die Rückfrage ohne Anfrage', async () => {
		const { harness, seite, http } = await oeffne();
		seite.querySelector<HTMLButtonElement>('[data-gruppe="u1"] button.loeschen')?.click();
		await stabil(harness);
		knopf(seite, 'Abbrechen').click();
		await stabil(harness);
		expect(seite.querySelector('[role="alertdialog"]')).toBeNull();
		http.expectNone(`${API}/untergruppen/u1`);
	});

	it('404 beim Umbenennen zeigt die Meldung oben bei der Liste und lädt neu', async () => {
		const { harness, seite, http } = await oeffne();
		seite.querySelector<HTMLButtonElement>('[data-gruppe="u1"] button.umbenennen')?.click();
		await stabil(harness);
		tippe(seite, 'input[name="umbenennen"]', 'Hechte');
		knopf(seite, 'Speichern').click();
		http
			.expectOne(`${API}/untergruppen/u1`)
			.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		await neuGeladen(http, harness, { untergruppen: [GRUPPEN.untergruppen[1]] });
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('nicht mehr');
	});

	it('begrenzt die Namensfelder auf 40 Zeichen', async () => {
		const { seite } = await oeffne();
		expect(seite.querySelector('input[name="neuerName"]')?.getAttribute('maxlength')).toBe('40');
	});

	it('Betreuer sieht die Liste ohne Knöpfe', async () => {
		const { seite } = await oeffne(['ANTWORTEN_DETAIL']);
		expect(seite.textContent).toContain('Gruppe A');
		expect(seite.querySelectorAll('button').length).toBe(0);
		expect(seite.querySelector('input')).toBeNull();
	});

	it('ohne Rechte zeigt sie nur den Hinweis "Nicht gefunden"', async () => {
		const http = TestBed.inject(HttpTestingController);
		const { RouterTestingHarness } = await import('@angular/router/testing');
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/verwaltung/untergruppen');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit([])));
		await navigation;
		await vi.waitFor(() =>
			http.expectOne(`${API}/verein`).flush({ slug: 'demo', anzeigename: 'Demo', farbe: '#1d4ed8', hatLogo: false }),
		);
		await stabil(harness);
		expect((harness.routeNativeElement as HTMLElement).textContent).toContain('Nicht gefunden');
	});
});
