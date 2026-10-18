import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
 * ist gleich; jede wird einzeln abgewartet.
 */
export async function oeffneSeite(
	url: string,
	ich: MitgliedIch,
	antworten: [pfad: string, koerper: object][],
): Promise<{ harness: RouterTestingHarness; seite: HTMLElement; http: HttpTestingController }> {
	const http = TestBed.inject(HttpTestingController);
	const harness = await RouterTestingHarness.create();
	const navigation = harness.navigateByUrl(url);
	await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ich));
	await navigation;
	for (const [pfad, koerper] of antworten) {
		await vi.waitFor(() => http.expectOne(`${API}${pfad}`).flush(koerper));
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
