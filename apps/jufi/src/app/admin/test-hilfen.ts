import {
	HttpResponse,
	type HttpInterceptorFn,
	provideHttpClient,
	withFetch,
	withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { routerFeatures, routes } from '../app.routes';

/**
 * Die Huelle fragt die Thread-Liste fuer den Punkt an der Leiste, auf jeder Seite des Vereins. Diese
 * Abfrage beantwortet der Anbieter selbst mit einer leeren Liste: Sonst muesste jeder Test jeder
 * Seite sie quittieren, und die offene Anfrage hielte whenStable an. Verworfen: sie in jedem Test
 * einzeln beantworten, das waeren neun Specs mit demselben Handgriff ohne Aussage. Wer den Punkt
 * pruefen will (mitglieder-huelle.spec.ts), schaltet das mit eigeneThreadListe ab.
 * Blinder Fleck: expectNone und verify() sehen die vom Interceptor beantworteten Listenanfragen nicht;
 * Specs, die auf die Listenanfrage pruefen, muessen eigeneThreadListe: true setzen.
 */
const leereThreadListe: HttpInterceptorFn = (anfrage, weiter) =>
	anfrage.method === 'GET' && /^\/[^/]+\/api\/v1\/threads$/.test(anfrage.url)
		? of(new HttpResponse({ status: 200, body: { threads: [], archiv: 0 } }))
		: weiter(anfrage);

/**
 * Dasselbe fuer die Bloecke der Startseite (GET /start): Jede Spec, die die Startseite oeffnet,
 * bekaeme sonst eine offene Anfrage, die sie nicht betrifft. Verworfen: sie in allen Specs einzeln
 * beantworten (sieben Dateien, die vom Aufbau der Startseite nichts wissen wollen). Wer die Bloecke
 * pruefen will (start.spec.ts), schaltet das mit eigeneStart ab; dort gilt derselbe blinde Fleck.
 */
const leereStart: HttpInterceptorFn = (anfrage, weiter) =>
	anfrage.method === 'GET' && /^\/[^/]+\/api\/v1\/start$/.test(anfrage.url)
		? of(new HttpResponse({ status: 200, body: { brauchtAntwort: [], alsNaechstes: [], neu: [] } }))
		: weiter(anfrage);

/** Gemeinsame Bereitstellung der Admin-Tests: echte Routen, gespielte HTTP-Antworten. */
export function adminTestAnbieter(
	optionen: { eigeneThreadListe?: boolean; eigeneStart?: boolean } = {},
): Array<Provider | EnvironmentProviders> {
	const interceptoren = [
		...(optionen.eigeneThreadListe ? [] : [leereThreadListe]),
		...(optionen.eigeneStart ? [] : [leereStart]),
	];
	return [
		provideRouter(routes, ...routerFeatures),
		provideHttpClient(withFetch(), withInterceptors(interceptoren)),
		provideHttpClientTesting(),
	];
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
