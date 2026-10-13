import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from '../app.routes';

/** Gemeinsame Bereitstellung der Admin-Tests: echte Routen, gespielte HTTP-Antworten. */
export function adminTestAnbieter(): Array<Provider | EnvironmentProviders> {
	return [
		provideRouter(routes, withComponentInputBinding()),
		provideHttpClient(withFetch()),
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
