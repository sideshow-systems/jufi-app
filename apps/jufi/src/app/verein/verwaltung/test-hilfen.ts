import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MitgliedIch } from '../mitglieder-api';

export const API = '/demo/api/v1';

export function ichMit(rechte: string[], id = 'ich-1'): MitgliedIch {
	return {
		person: { id, vorname: 'Thomas', nachname: 'Leiter', art: 'ERWACHSENER', rechte },
		kennung: 'thomas@example.org',
		passkeys: [],
		hatPasswort: true,
		hatKinder: false,
		totp: { moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 },
	};
}

/**
 * Oeffnet eine Verwaltungsseite: Der Waechter fragt GET /ich, danach laedt die Seite ihre
 * Daten (antworten: Pfad, Koerper), der Kopf den Verein. Welche Anfrage zuerst kommt,
 * ist gleich; jede wird einzeln abgewartet. Die Huelle fragt die Hinweise nur mit dem Recht
 * JUGENDLEITER_RECHTE; dann beantwortet die Hilfe sie mit hinweise (Vorgabe: keine).
 */
export async function oeffneSeite(
	url: string,
	ich: MitgliedIch,
	antworten: [pfad: string, koerper: object][],
	hinweise: { notfallLinks: object[] } = { notfallLinks: [] },
): Promise<{ harness: RouterTestingHarness; seite: HTMLElement; http: HttpTestingController }> {
	const http = TestBed.inject(HttpTestingController);
	const harness = await RouterTestingHarness.create();
	const navigation = harness.navigateByUrl(url);
	await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ich));
	await navigation;
	for (const [pfad, koerper] of antworten) {
		await vi.waitFor(() => http.expectOne(`${API}${pfad}`).flush(koerper));
	}
	if (ich.person.rechte.includes('JUGENDLEITER_RECHTE')) {
		await vi.waitFor(() => http.expectOne(`${API}/verwaltung/hinweise`).flush(hinweise));
	}
	await vi.waitFor(() =>
		http
			.expectOne(`${API}/verein`)
			.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false }),
	);
	await harness.fixture.whenStable();
	harness.detectChanges();
	return { harness, seite: harness.routeNativeElement as HTMLElement, http };
}

export async function stabil(harness: RouterTestingHarness): Promise<void> {
	await harness.fixture.whenStable();
	harness.detectChanges();
}

/** Setzt den Wert eines Auswahlfelds und meldet die Aenderung, wie es der Browser taete. */
export function waehle(wurzel: HTMLElement, selektor: string, wert: string): void {
	const feld = wurzel.querySelector<HTMLSelectElement>(selektor);
	if (!feld) throw new Error(`Feld nicht gefunden: ${selektor}`);
	feld.value = wert;
	feld.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Setzt ein Kontrollkaestchen oder einen Radioknopf wie ein Klick. */
export function hake(wurzel: HTMLElement, selektor: string, an = true): void {
	const feld = wurzel.querySelector<HTMLInputElement>(selektor);
	if (!feld) throw new Error(`Feld nicht gefunden: ${selektor}`);
	if (feld.checked !== an) feld.click();
}

const ABGELAUFEN = { fehler: 'nicht angemeldet' };

/** Beantwortet eine Anfrage mit "nicht angemeldet", wie die API bei abgelaufener Sitzung. */
export async function antworteAbgelaufen(http: HttpTestingController, pfad: string): Promise<void> {
	await vi.waitFor(() =>
		http.expectOne(`${API}${pfad}`).flush(ABGELAUFEN, { status: 401, statusText: 'Unauthorized' }),
	);
}

/**
 * Wartet, bis die Seite zur Anmeldung gefuehrt hat, mit der Seite davor als weiter. Die Huelle und
 * die Anmeldeseite haben dabei eigene Anfragen gestellt (Verein, Hinweise); sie zaehlen hier nicht.
 */
export async function erwarteAnmeldung(http: HttpTestingController, vonUrl: string): Promise<void> {
	await vi.waitFor(() =>
		expect(TestBed.inject(Router).url).toBe(`/demo/anmelden?weiter=${encodeURIComponent(vonUrl)}`),
	);
	http.match(() => true);
}

/**
 * Oeffnet eine Verwaltungsseite, deren erste Datenanfrage mit "nicht angemeldet" scheitert: Die
 * Sitzung galt beim Betreten (GET /ich), lief aber danach ab. Parallele Anfragen der Seite werden
 * verworfen.
 */
export async function oeffneAbgelaufen(url: string, rechte: string[], ladepfad: string): Promise<void> {
	const http = TestBed.inject(HttpTestingController);
	const harness = await RouterTestingHarness.create();
	const navigation = harness.navigateByUrl(url);
	await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(rechte)));
	await navigation;
	await antworteAbgelaufen(http, ladepfad);
	await erwarteAnmeldung(http, url);
}
