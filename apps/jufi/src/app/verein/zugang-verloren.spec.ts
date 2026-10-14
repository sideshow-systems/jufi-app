import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter, knopf, tippe } from '../admin/test-hilfen';
import { oeffneVereinsseite } from './test-hilfen';

const API = '/demo/api/v1';

describe('Zugang verloren', () => {
	let http: HttpTestingController;
	let harness: RouterTestingHarness;
	let seite: HTMLElement;

	beforeEach(async () => {
		TestBed.configureTestingModule({ providers: adminTestAnbieter() });
		({ harness, seite, http } = await oeffneVereinsseite('/demo/zugang-verloren'));
	});

	afterEach(() => http.verify());

	async function stabil(): Promise<void> {
		await harness.fixture.whenStable();
		harness.detectChanges();
	}

	it('zeigt den Hinweis fuer Jungfischer', () => {
		expect(seite.textContent).toContain(
			'Du bist Jungfischer? Frag deine Familie oder einen Jugendleiter nach einem neuen Link.',
		);
	});

	it('zeigt die feste Antwort, was der Server auch mit 200 liefert', async () => {
		tippe(seite, 'input[name=email]', 'flo@example.org');
		harness.detectChanges();
		knopf(seite, 'Link anfordern').click();
		const anfrage = http.expectOne(`${API}/zugang-verloren`);
		expect(anfrage.request.body).toEqual({ email: 'flo@example.org' });
		anfrage.flush({ ok: true, irgendwas: 'anderes' });
		await stabil();

		expect(seite.textContent).toContain('Falls die Adresse bekannt ist, kommt eine Mail.');
	});

	it('schickt eine leere Eingabe nicht ab', async () => {
		tippe(seite, 'input[name=email]', '   ');
		harness.detectChanges();
		knopf(seite, 'Link anfordern').click();
		await stabil();
		http.expectNone(`${API}/zugang-verloren`);
		expect(seite.textContent).not.toContain('Falls die Adresse bekannt ist');
	});

	it('429 zeigt einen Wartehinweis statt der Antwort', async () => {
		tippe(seite, 'input[name=email]', 'flo@example.org');
		harness.detectChanges();
		knopf(seite, 'Link anfordern').click();
		http
			.expectOne(`${API}/zugang-verloren`)
			.flush({ fehler: 'Zu viele Versuche', wartenSekunden: 30 }, { status: 429, statusText: 'Too Many Requests' });
		await stabil();

		expect(seite.querySelector('[role=alert]')?.textContent).toContain(
			'Zu viele Versuche – bitte in 30 Sekunden erneut',
		);
		expect(seite.textContent).not.toContain('Falls die Adresse bekannt ist');
	});
});
