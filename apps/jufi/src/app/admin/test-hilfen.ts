import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routerFeatures, routes } from '../app.routes';

/** Gemeinsame Bereitstellung der Admin-Tests: echte Routen, gespielte HTTP-Antworten. */
export function adminTestAnbieter(): Array<Provider | EnvironmentProviders> {
	return [provideRouter(routes, ...routerFeatures), provideHttpClient(withFetch()), provideHttpClientTesting()];
}

/** Tippt in ein Feld, wie es eine Person taete: Wert setzen, input-Ereignis ausloesen. */
export function tippe(wurzel: HTMLElement, selektor: string, wert: string): void {
	const feld = wurzel.querySelector<HTMLInputElement>(selektor);
	if (!feld) throw new Error(`Feld nicht gefunden: ${selektor}`);
	feld.value = wert;
	feld.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Findet einen Knopf an seiner Beschriftung. */
export function knopf(wurzel: HTMLElement, text: string): HTMLButtonElement {
	const treffer = [...wurzel.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
	if (!treffer) throw new Error(`Knopf nicht gefunden: ${text}`);
	return treffer;
}

const API = '/admin/api/v1';

/**
 * Oeffnet eine Seite der Verwaltung wie ein angemeldeter Admin: Der Waechter fragt
 * zuerst nach der Sitzung (GET /ich); danach laedt die Seite ihre eigenen Daten.
 */
export async function oeffneVerwaltung(
	url: string,
): Promise<{ harness: RouterTestingHarness; seite: HTMLElement; http: HttpTestingController }> {
	const http = TestBed.inject(HttpTestingController);
	const harness = await RouterTestingHarness.create();
	const navigation = harness.navigateByUrl(url);
	await vi.waitFor(() =>
		http
			.expectOne(`${API}/ich`)
			.flush({ benutzername: 'flo', totpAktiv: false, passkeys: 0, wiederherstellungscodesUebrig: 0 }),
	);
	await navigation;
	return { harness, seite: harness.routeNativeElement as HTMLElement, http };
}

/** Wartet, bis alle Antworten verarbeitet und die Ansicht aktualisiert ist. */
export async function stabil(harness: RouterTestingHarness): Promise<void> {
	await harness.fixture.whenStable();
	harness.detectChanges();
}
