import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';

/**
 * Oeffnet eine Vereinsseite ohne Waechter und beantwortet den Kopf (GET /verein),
 * den beide Seiten laden. Die Anbieter kommen aus den Admin-Testhilfen: gleiche
 * Routen, gleiche gespielte HTTP-Antworten.
 */
export async function oeffneVereinsseite(
	url: string,
): Promise<{ harness: RouterTestingHarness; seite: HTMLElement; http: HttpTestingController }> {
	const http = TestBed.inject(HttpTestingController);
	const harness = await RouterTestingHarness.create();
	// Nicht auf die Navigation warten, bevor der Kopf beantwortet ist: Seine offene Anfrage haelt sie sonst auf.
	const navigation = harness.navigateByUrl(url);
	const slug = url.split('/')[1];
	await vi.waitFor(() =>
		http
			.expectOne(`/${slug}/api/v1/verein`)
			.flush({ slug, anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false, logoStand: null }),
	);
	await navigation;
	await harness.fixture.whenStable();
	harness.detectChanges();
	return { harness, seite: harness.routeNativeElement as HTMLElement, http };
}
