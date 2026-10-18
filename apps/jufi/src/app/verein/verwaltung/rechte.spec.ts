import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { ALLE_RECHTE, RECHTE_VORLAGEN } from '@jufi/domain';
import { adminTestAnbieter, knopf } from '../../admin/test-hilfen';
import type { PersonListe } from '../mitglieder-api';
import { API, hake, ichMit, oeffneAbgelaufen, oeffneSeite, stabil, waehle } from './test-hilfen';

const PERSONEN: { personen: PersonListe[] } = {
	personen: [
		{ id: 'ich-1', art: 'ERWACHSENER', vorname: 'Thomas', nachname: 'Leiter', rechte: [...ALLE_RECHTE] },
		{ id: 'e2', art: 'ERWACHSENER', vorname: 'Rosa', nachname: 'Betreuer', rechte: ['ANTWORTEN_DETAIL'] },
		{ id: 'e3', art: 'ERWACHSENER', vorname: 'Anna', nachname: 'Muster', rechte: [] },
		{ id: 'k1', art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Muster', rechte: [] },
	],
};

describe('Rechte', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne(rechte: string[] = [...ALLE_RECHTE]) {
		return oeffneSeite('/demo/verwaltung/rechte', ichMit(rechte), [['/personen', PERSONEN]]);
	}

	function haken(seite: HTMLElement): string[] {
		return [...seite.querySelectorAll<HTMLInputElement>('input[name^="recht-"]')]
			.filter((i) => i.checked)
			.map((i) => i.name.replace('recht-', ''))
			.sort();
	}

	async function bearbeite(harness: RouterTestingHarness, seite: HTMLElement, id: string) {
		seite.querySelector<HTMLButtonElement>(`[data-person="${id}"] button.bearbeiten`)?.click();
		await stabil(harness);
	}

	it('zeigt nur Erwachsene mit Rechten', async () => {
		const { seite } = await oeffne();
		const liste = seite.querySelector('.mit-rechten')?.textContent ?? '';
		expect(liste).toContain('Thomas Leiter');
		expect(liste).toContain('Rosa Betreuer');
		expect(liste).not.toContain('Anna Muster');
		expect(liste).not.toContain('Lena');
	});

	it('Vorlage Jugendleiter setzt alle Häkchen außer JUGENDLEITER_RECHTE und EINSTELLUNGEN', async () => {
		const { harness, seite } = await oeffne();
		await bearbeite(harness, seite, 'e2');
		knopf(seite, 'Jugendleiter').click();
		await stabil(harness);
		expect(haken(seite)).toEqual([...RECHTE_VORLAGEN.JUGENDLEITER].sort());
		expect(haken(seite)).not.toContain('JUGENDLEITER_RECHTE');
		expect(haken(seite)).not.toContain('EINSTELLUNGEN');
	});

	it('Einzelhäkchen lassen sich danach ändern und werden als Ganzes gespeichert', async () => {
		const { harness, seite, http } = await oeffne();
		await bearbeite(harness, seite, 'e2');
		knopf(seite, 'Jugendleiter').click();
		await stabil(harness);
		hake(seite, 'input[name="recht-DOKUMENTE"]', false);
		hake(seite, 'input[name="recht-EINSTELLUNGEN"]', true);
		await stabil(harness);
		knopf(seite, 'Rechte speichern').click();
		const anfrage = http.expectOne(`${API}/personen/e2/rechte`);
		expect(anfrage.request.method).toBe('PUT');
		expect([...anfrage.request.body.rechte].sort()).toEqual(
			['ALLE_THREADS', 'ANTWORTEN_DETAIL', 'EINSTELLUNGEN', 'MITGLIEDER', 'THREADS_ERSTELLEN'].sort(),
		);
		anfrage.flush({ rechte: anfrage.request.body.rechte });
		await vi.waitFor(() => http.expectOne(`${API}/personen`).flush(PERSONEN));
		await stabil(harness);
		expect(seite.querySelector('input[name^="recht-"]')).toBeNull();
	});

	it('LETZTE_LEITUNG erscheint als Text', async () => {
		const { harness, seite, http } = await oeffne();
		await bearbeite(harness, seite, 'ich-1');
		knopf(seite, 'Betreuer').click();
		await stabil(harness);
		knopf(seite, 'Rechte speichern').click();
		await stabil(harness);
		// Wer sich selbst die Leitung nimmt, wird erst gefragt.
		knopf(seite, 'Ja, Rechte ändern').click();
		http
			.expectOne(`${API}/personen/ich-1/rechte`)
			.flush({ fehler: 'Der Verein braucht ...', code: 'LETZTE_LEITUNG' }, { status: 409, statusText: 'Conflict' });
		await stabil(harness);
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain(
			'Mindestens eine Person muss Jugendleiter & Rechte verwalten dürfen.',
		);
	});

	it('gibt einer weiteren Person Rechte über die Auswahl', async () => {
		const { harness, seite, http } = await oeffne();
		expect([...seite.querySelectorAll('select[name="weitere"] option')].map((o) => o.textContent?.trim())).toEqual([
			'Person wählen',
			'Anna Muster',
		]);
		waehle(seite, 'select[name="weitere"]', 'e3');
		await stabil(harness);
		knopf(seite, 'Rechte geben').click();
		await stabil(harness);
		expect(haken(seite)).toEqual([]);
		knopf(seite, 'Betreuer').click();
		await stabil(harness);
		knopf(seite, 'Rechte speichern').click();
		const anfrage = http.expectOne(`${API}/personen/e3/rechte`);
		expect(anfrage.request.body).toEqual({ rechte: ['ANTWORTEN_DETAIL'] });
		anfrage.flush({ rechte: ['ANTWORTEN_DETAIL'] });
		await vi.waitFor(() => http.expectOne(`${API}/personen`).flush(PERSONEN));
		await stabil(harness);
	});

	it('nach dem Speichern steht die Auswahl wieder leer und der Knopf ist gesperrt', async () => {
		const { harness, seite, http } = await oeffne();
		waehle(seite, 'select[name="weitere"]', 'e3');
		await stabil(harness);
		knopf(seite, 'Rechte geben').click();
		await stabil(harness);
		knopf(seite, 'Betreuer').click();
		await stabil(harness);
		knopf(seite, 'Rechte speichern').click();
		http.expectOne(`${API}/personen/e3/rechte`).flush({ rechte: ['ANTWORTEN_DETAIL'] });
		await vi.waitFor(() => http.expectOne(`${API}/personen`).flush(PERSONEN));
		await stabil(harness);
		expect(seite.querySelector<HTMLSelectElement>('select[name="weitere"]')?.value).toBe('');
		expect(knopf(seite, 'Rechte geben').disabled).toBe(true);
	});

	it('ohne gewähltes Recht lässt sich einer Person ohne Rechte nichts speichern', async () => {
		const { harness, seite, http } = await oeffne();
		waehle(seite, 'select[name="weitere"]', 'e3');
		await stabil(harness);
		knopf(seite, 'Rechte geben').click();
		await stabil(harness);
		expect(knopf(seite, 'Rechte speichern').disabled).toBe(true);
		expect(seite.textContent).toContain('Bitte mindestens ein Recht wählen');
		http.expectNone(`${API}/personen/e3/rechte`);
	});

	it('Selbstentzug von JUGENDLEITER_RECHTE zieht die Sitzung nach und zeigt "Nicht gefunden"', async () => {
		const { harness, seite, http } = await oeffne();
		await bearbeite(harness, seite, 'ich-1');
		hake(seite, 'input[name="recht-JUGENDLEITER_RECHTE"]', false);
		knopf(seite, 'Rechte speichern').click();
		await stabil(harness);
		knopf(seite, 'Ja, Rechte ändern').click();
		const anfrage = http.expectOne(`${API}/personen/ich-1/rechte`);
		anfrage.flush({ rechte: anfrage.request.body.rechte });
		await stabil(harness);
		expect(seite.textContent).toContain('Nicht gefunden');
		expect(seite.querySelector('input')).toBeNull();
		http.expectNone(`${API}/personen`);
	});

	it('Rechte entziehen fragt nach', async () => {
		const { harness, seite, http } = await oeffne();
		await bearbeite(harness, seite, 'e2');
		hake(seite, 'input[name="recht-ANTWORTEN_DETAIL"]', false);
		knopf(seite, 'Rechte speichern').click();
		await stabil(harness);
		http.expectNone(`${API}/personen/e2/rechte`);
		const dialog = seite.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).toContain('Rosa Betreuer');
		expect(document.activeElement).toBe(dialog);
		knopf(seite, 'Ja, Rechte ändern').click();
		const anfrage = http.expectOne(`${API}/personen/e2/rechte`);
		expect(anfrage.request.body).toEqual({ rechte: [] });
		anfrage.flush({ rechte: [] });
		await vi.waitFor(() => http.expectOne(`${API}/personen`).flush(PERSONEN));
		await stabil(harness);
	});

	it('ohne JUGENDLEITER_RECHTE zeigt die Rechteseite nur den Hinweis "Nicht gefunden"', async () => {
		const http = TestBed.inject(HttpTestingController);
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/verwaltung/rechte');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(['MITGLIEDER'])));
		await navigation;
		await vi.waitFor(() =>
			http.expectOne(`${API}/verein`).flush({ slug: 'demo', anzeigename: 'Demo', farbe: '#1d4ed8', hatLogo: false }),
		);
		await stabil(harness);
		const seite = harness.routeNativeElement as HTMLElement;
		expect(seite.textContent).toContain('Nicht gefunden');
		expect(seite.querySelector('input')).toBeNull();
		http.expectNone(`${API}/personen`);
	});

	it('ein abgelaufenes Login beim Laden führt zur Anmeldung', async () => {
		await oeffneAbgelaufen('/demo/verwaltung/rechte', [...ALLE_RECHTE], '/personen');
	});
});
