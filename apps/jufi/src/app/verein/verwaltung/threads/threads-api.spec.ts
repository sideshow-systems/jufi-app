import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ThreadEntwurf } from '@jufi/domain';
import type { ApiFehler } from '../../../gemeinsam/api-fehler';
import { VerwaltungThreadsApi } from './threads-api';

const ENTWURF = { titel: 'Zeltlager' } as unknown as ThreadEntwurf;

describe('VerwaltungThreadsApi', () => {
	let api: VerwaltungThreadsApi;
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(withFetch()), provideHttpClientTesting()] });
		api = TestBed.inject(VerwaltungThreadsApi);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it('liste ist GET /verwaltung/threads', () => {
		let antwort: unknown;
		api.liste('demo').subscribe((a) => (antwort = a));
		const anfrage = http.expectOne('/demo/api/v1/verwaltung/threads');
		expect(anfrage.request.method).toBe('GET');
		anfrage.flush({ threads: [], untergruppen: [], darfErstellen: true });
		expect(antwort).toEqual({ threads: [], untergruppen: [], darfErstellen: true });
	});

	it('bearbeitung ist GET /threads/:id/bearbeitung', () => {
		api.bearbeitung('demo', 'ck1').subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1/bearbeitung');
		expect(anfrage.request.method).toBe('GET');
		anfrage.flush({});
	});

	it('antworten ist GET /threads/:id/antworten', () => {
		api.antworten('demo', 'ck1').subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1/antworten');
		expect(anfrage.request.method).toBe('GET');
		anfrage.flush({});
	});

	it('lege ist POST /threads mit dem Entwurf als Koerper', () => {
		api.lege('demo', ENTWURF).subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads');
		expect(anfrage.request.method).toBe('POST');
		expect(anfrage.request.body).toEqual({ entwurf: ENTWURF });
		anfrage.flush({}, { status: 201, statusText: 'Created' });
	});

	it('ersetze ist PUT /threads/:id mit Version und Entwurf', () => {
		api.ersetze('demo', 'ck1', 4, ENTWURF).subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1');
		expect(anfrage.request.method).toBe('PUT');
		expect(anfrage.request.body).toEqual({ version: 4, entwurf: ENTWURF });
		anfrage.flush({});
	});

	it('veroeffentliche ist POST /threads/:id/veroeffentlichen ohne Koerper', () => {
		api.veroeffentliche('demo', 'ck1').subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1/veroeffentlichen');
		expect(anfrage.request.method).toBe('POST');
		expect(anfrage.request.body).toBeNull();
		anfrage.flush({});
	});

	it('archiviere ist PUT /threads/:id/archiv mit archiviert', () => {
		api.archiviere('demo', 'ck1', true).subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1/archiv');
		expect(anfrage.request.method).toBe('PUT');
		expect(anfrage.request.body).toEqual({ archiviert: true });
		anfrage.flush({});
	});

	it('pinne ist PUT /threads/:id/angepinnt mit angepinnt', () => {
		api.pinne('demo', 'ck1', false).subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1/angepinnt');
		expect(anfrage.request.method).toBe('PUT');
		expect(anfrage.request.body).toEqual({ angepinnt: false });
		anfrage.flush({});
	});

	it('loesche ist DELETE /threads/:id', () => {
		api.loesche('demo', 'ck1').subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1');
		expect(anfrage.request.method).toBe('DELETE');
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
	});

	it('kodiert Slug und Id im Pfad', () => {
		api.bearbeitung('a b', 'x/y').subscribe();
		http.expectOne('/a%20b/api/v1/threads/x%2Fy/bearbeitung').flush({});
	});

	it('macht aus einem 409 mit Code einen ApiFehler', () => {
		let fehler: ApiFehler | undefined;
		api.ersetze('demo', 'ck1', 1, ENTWURF).subscribe({ error: (e: ApiFehler) => (fehler = e) });
		http
			.expectOne('/demo/api/v1/threads/ck1')
			.flush({ fehler: 'Stand ist veraltet', code: 'VERALTET' }, { status: 409, statusText: 'Conflict' });
		expect(fehler).toMatchObject({ status: 409, code: 'VERALTET', fehler: 'Stand ist veraltet' });
	});
});
