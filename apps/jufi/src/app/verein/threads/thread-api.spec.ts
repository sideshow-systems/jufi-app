import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ApiFehler } from '../../gemeinsam/api-fehler';
import { ThreadApi } from './thread-api';

describe('ThreadApi', () => {
	let api: ThreadApi;
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(withFetch()), provideHttpClientTesting()] });
		api = TestBed.inject(ThreadApi);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it('thread ist GET /threads/:id', () => {
		let antwort: unknown;
		api.thread('demo', 'ck1').subscribe((a) => (antwort = a));
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1');
		expect(anfrage.request.method).toBe('GET');
		anfrage.flush({ id: 'ck1' });
		expect(antwort).toEqual({ id: 'ck1' });
	});

	it('liste kodiert die Suche und schickt archiv nur, wenn es gesetzt ist', () => {
		api.liste('demo', { suche: '100%', archiv: true }).subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads?suche=100%25&archiv=1');
		expect(anfrage.request.method).toBe('GET');
		anfrage.flush({ threads: [], archiv: 0 });
	});

	it('liste ohne Filter hat keinen Abfrageteil', () => {
		api.liste('demo', {}).subscribe();
		http.expectOne('/demo/api/v1/threads').flush({ threads: [], archiv: 0 });
	});

	it('start ist GET /start', () => {
		api.start('demo').subscribe();
		const anfrage = http.expectOne('/demo/api/v1/start');
		expect(anfrage.request.method).toBe('GET');
		anfrage.flush({});
	});

	it('termine schickt den Monat', () => {
		api.termine('demo', '2026-10').subscribe();
		http.expectOne('/demo/api/v1/termine?monat=2026-10').flush({ termine: [] });
	});

	it('kodiert Slug und Id im Pfad', () => {
		api.thread('a b', 'x/y').subscribe();
		http.expectOne('/a%20b/api/v1/threads/x%2Fy').flush({});
	});

	it('verlauf schickt vor nur, wenn es gesetzt ist', () => {
		api.verlauf('demo', 'ck1').subscribe();
		const ohne = http.expectOne('/demo/api/v1/threads/ck1/verlauf');
		expect(ohne.request.method).toBe('GET');
		ohne.flush({ eintraege: [], weitere: false });

		api.verlauf('demo', 'ck1', 'e 1').subscribe();
		http.expectOne('/demo/api/v1/threads/ck1/verlauf?vor=e%201').flush({ eintraege: [], weitere: false });
	});

	it('schreibe ist POST /threads/:id/verlauf mit Text und clientId', () => {
		let antwort: unknown;
		api.schreibe('demo', 'ck1', { text: 'Hallo', clientId: 'c-1' }).subscribe((a) => (antwort = a));
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1/verlauf');
		expect(anfrage.request.method).toBe('POST');
		expect(anfrage.request.body).toEqual({ text: 'Hallo', clientId: 'c-1' });
		anfrage.flush({ eintrag: { id: 'e1' }, stand: 7 });
		expect(antwort).toEqual({ eintrag: { id: 'e1' }, stand: 7 });
	});

	it('loescheNachricht ist DELETE /verlauf/:eintragId', () => {
		api.loescheNachricht('demo', 'e/1').subscribe();
		const anfrage = http.expectOne('/demo/api/v1/verlauf/e%2F1');
		expect(anfrage.request.method).toBe('DELETE');
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
	});

	it('gelesen ist PUT /threads/:id/gelesen mit Bereich und Stand', () => {
		api.gelesen('demo', 'ck1', { bereich: 'uebersicht', bis: 12 }).subscribe();
		const anfrage = http.expectOne('/demo/api/v1/threads/ck1/gelesen');
		expect(anfrage.request.method).toBe('PUT');
		expect(anfrage.request.body).toEqual({ bereich: 'uebersicht', bis: 12 });
		anfrage.flush(null, { status: 204, statusText: 'No Content' });
	});

	it('antworte ist PUT /umfragen/:modulId/antworten/:fuerId', () => {
		let antwort: unknown;
		api.antworte('demo', 'm 3', 'p/1', { optionIds: ['o1'], clientId: 'c-2' }).subscribe((a) => (antwort = a));
		const anfrage = http.expectOne('/demo/api/v1/umfragen/m%203/antworten/p%2F1');
		expect(anfrage.request.method).toBe('PUT');
		expect(anfrage.request.body).toEqual({ optionIds: ['o1'], clientId: 'c-2' });
		anfrage.flush({ modul: { id: 'm 3' }, stand: 9 });
		expect(antwort).toEqual({ modul: { id: 'm 3' }, stand: 9 });
	});

	it('Fehler kommen als ApiFehler an', () => {
		let fehler: ApiFehler | undefined;
		api
			.antworte('demo', 'm1', 'p1', { optionIds: [], clientId: 'c' })
			.subscribe({ error: (e: ApiFehler) => (fehler = e) });
		http
			.expectOne('/demo/api/v1/umfragen/m1/antworten/p1')
			.flush({ fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' }, { status: 410, statusText: 'Gone' });
		expect(fehler).toEqual({ status: 410, fehler: 'Frist abgelaufen', code: 'FRIST_ABGELAUFEN' });
	});

	it('ein 404 kommt als ApiFehler an', () => {
		let fehler: ApiFehler | undefined;
		api.thread('demo', 'ck1').subscribe({ error: (e: ApiFehler) => (fehler = e) });
		http
			.expectOne('/demo/api/v1/threads/ck1')
			.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		expect(fehler).toEqual({ status: 404, fehler: 'nicht gefunden' });
	});
});
