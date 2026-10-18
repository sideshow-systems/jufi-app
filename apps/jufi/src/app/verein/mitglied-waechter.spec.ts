import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
	convertToParamMap,
	provideRouter,
	Router,
	type ActivatedRouteSnapshot,
	type RouterStateSnapshot,
	UrlTree,
} from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { mitgliedAngemeldet } from './mitglied-waechter';

describe('mitgliedAngemeldet', () => {
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(withFetch()), provideHttpClientTesting()],
		});
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	function frage(url = '/glonntal'): Promise<boolean | UrlTree> {
		const route = { paramMap: convertToParamMap({ slug: 'glonntal' }) } as ActivatedRouteSnapshot;
		const ergebnis = TestBed.runInInjectionContext(() => mitgliedAngemeldet(route, { url } as RouterStateSnapshot));
		return firstValueFrom(ergebnis as Observable<boolean | UrlTree>);
	}

	it('laesst durch, wenn der Server die Sitzung kennt (200)', async () => {
		const ergebnis = frage();
		http.expectOne('/glonntal/api/v1/ich').flush({});
		expect(await ergebnis).toBe(true);
	});

	it('leitet bei 401 auf die Anmeldung des Vereins und gibt die aufgerufene Seite als weiter mit', async () => {
		const ergebnis = frage('/glonntal/profil');
		http
			.expectOne('/glonntal/api/v1/ich')
			.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
		const ziel = await ergebnis;
		expect(ziel).toBeInstanceOf(UrlTree);
		expect(TestBed.inject(Router).serializeUrl(ziel as UrlTree)).toBe('/glonntal/anmelden?weiter=%2Fglonntal%2Fprofil');
	});

	it('leitet bei 404 auf die Nicht-gefunden-Seite', async () => {
		const ergebnis = frage();
		http
			.expectOne('/glonntal/api/v1/ich')
			.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		const ziel = await ergebnis;
		expect(TestBed.inject(Router).serializeUrl(ziel as UrlTree)).toBe('/glonntal/nicht-gefunden');
	});

	it('reicht andere Fehler weiter statt zur Anmeldung zu leiten', async () => {
		const ergebnis = frage();
		http.expectOne('/glonntal/api/v1/ich').flush({ fehler: 'kaputt' }, { status: 500, statusText: 'Server Error' });
		await expect(ergebnis).rejects.toMatchObject({ status: 500 });
	});
});
