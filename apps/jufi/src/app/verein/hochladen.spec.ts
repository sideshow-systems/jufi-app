import { HttpClient, HttpEventType } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FEHLER_TEXT, GRENZE_BYTES } from '@jufi/domain';
import { type HochladenStand, ladeHoch } from './hochladen';

function datei(bytes: number, name = 'Satzung.pdf'): File {
	return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

describe('ladeHoch', () => {
	let client: HttpClient;
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		client = TestBed.inject(HttpClient);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	function starte(d: File, methode: 'POST' | 'PUT' = 'POST', art?: 'DATEI' | 'FOTO'): HochladenStand[] {
		const staende: HochladenStand[] = [];
		ladeHoch('/demo/api/v1/dokumente?kategorie=k1', d, methode, client, art).subscribe((s) => staende.push(s));
		return staende;
	}

	it('schickt die Datei roh mit octet-stream und prozentkodiertem Namen', () => {
		starte(datei(10, 'Übersicht "Zelt" 2027.pdf'));

		const anfrage = http.expectOne('/demo/api/v1/dokumente?kategorie=k1');
		expect(anfrage.request.method).toBe('POST');
		expect(anfrage.request.headers.get('Content-Type')).toBe('application/octet-stream');
		expect(anfrage.request.headers.get('X-Dateiname')).toBe(encodeURIComponent('Übersicht "Zelt" 2027.pdf'));
		expect(anfrage.request.body).toBeInstanceOf(File);
		expect(anfrage.request.reportProgress).toBe(true);
		anfrage.flush({});
	});

	it('nimmt die Methode fuer das Ersetzen', () => {
		starte(datei(10), 'PUT');

		const anfrage = http.expectOne('/demo/api/v1/dokumente?kategorie=k1');
		expect(anfrage.request.method).toBe('PUT');
		anfrage.flush({});
	});

	it('meldet den Anteil aus UploadProgress und zuletzt die Antwort', () => {
		const staende = starte(datei(10));
		const anfrage = http.expectOne('/demo/api/v1/dokumente?kategorie=k1');

		anfrage.event({ type: HttpEventType.UploadProgress, loaded: 25, total: 100 });
		anfrage.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 });
		anfrage.flush({ id: 'x' });

		expect(staende).toEqual([
			{ art: 'fortschritt', anteil: 0.25 },
			{ art: 'fortschritt', anteil: 1 },
			{ art: 'fertig', antwort: { id: 'x' } },
		]);
	});

	it('rechnet ohne bekannte Gesamtgroesse mit Anteil 0 statt NaN', () => {
		const staende = starte(datei(10));
		const anfrage = http.expectOne('/demo/api/v1/dokumente?kategorie=k1');

		anfrage.event({ type: HttpEventType.UploadProgress, loaded: 25 });
		anfrage.flush({});

		expect(staende[0]).toEqual({ art: 'fortschritt', anteil: 0 });
	});

	it('gibt Text und code aus dem Server-JSON weiter', () => {
		const staende = starte(datei(10));

		http
			.expectOne('/demo/api/v1/dokumente?kategorie=k1')
			.flush({ fehler: FEHLER_TEXT.TYP.DATEI, code: 'TYP' }, { status: 415, statusText: 'Unsupported Media Type' });

		expect(staende).toEqual([{ art: 'fehler', text: FEHLER_TEXT.TYP.DATEI, code: 'TYP' }]);
	});

	it('zeigt bei 429 die Wartezeit', () => {
		const staende = starte(datei(10));

		http
			.expectOne('/demo/api/v1/dokumente?kategorie=k1')
			.flush({ fehler: 'Zu viele', wartenSekunden: 30 }, { status: 429, statusText: 'Too Many Requests' });

		expect(staende).toEqual([{ art: 'fehler', text: 'Zu viele Versuche – bitte in 30 Sekunden erneut' }]);
	});

	it('uebersetzt einen abgebrochenen Aufbau (Status 0) in einen deutschen Satz', () => {
		const staende = starte(datei(10));

		http.expectOne('/demo/api/v1/dokumente?kategorie=k1').error(new ProgressEvent('error'));

		expect(staende).toEqual([{ art: 'fehler', text: 'Die Verbindung ist abgebrochen. Bitte versuch es nochmal.' }]);
	});

	it('weist eine zu grosse Datei ohne Anfrage ab', () => {
		const staende = starte(datei(GRENZE_BYTES.DATEI + 1));

		http.expectNone(() => true);
		expect(staende).toEqual([{ art: 'fehler', text: FEHLER_TEXT.GROESSE.DATEI, code: 'GROESSE' }]);
	});

	it('laesst eine Datei genau an der Grenze durch', () => {
		const staende = starte(datei(GRENZE_BYTES.DATEI));

		http.expectOne('/demo/api/v1/dokumente?kategorie=k1').flush({});
		expect(staende).toEqual([{ art: 'fertig', antwort: {} }]);
	});

	it('prueft ein Foto gegen die Grenze fuer Fotos und nennt den Text fuer Fotos', () => {
		const staende = starte(datei(GRENZE_BYTES.FOTO + 1, 'a.jpg'), 'POST', 'FOTO');

		http.expectNone(() => true);
		expect(staende).toEqual([{ art: 'fehler', text: FEHLER_TEXT.GROESSE.FOTO, code: 'GROESSE' }]);
	});

	it('laesst ein Foto zwischen den Grenzen fuer Fotos und Dateien nicht durch', () => {
		const staende = starte(datei(GRENZE_BYTES.FOTO + 1, 'a.jpg'), 'POST', 'DATEI');

		http.expectOne('/demo/api/v1/dokumente?kategorie=k1').flush({});
		expect(staende).toEqual([{ art: 'fertig', antwort: {} }]);
	});

	it('meldet Retry-After eines 503 als wiederholenNach', () => {
		const staende = starte(datei(10));

		http
			.expectOne('/demo/api/v1/dokumente?kategorie=k1')
			.flush(
				{ fehler: FEHLER_TEXT.BESCHAEFTIGT, code: 'BESCHAEFTIGT' },
				{ status: 503, statusText: 'Service Unavailable', headers: { 'Retry-After': '5' } },
			);

		expect(staende).toEqual([
			{ art: 'fehler', text: FEHLER_TEXT.BESCHAEFTIGT, code: 'BESCHAEFTIGT', wiederholenNach: 5 },
		]);
	});

	it('meldet eine abgelaufene Sitzung als Code NICHT_ANGEMELDET, nicht als Text des Servers', () => {
		const staende = starte(datei(10));

		http
			.expectOne('/demo/api/v1/dokumente?kategorie=k1')
			.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });

		expect(staende).toEqual([
			{ art: 'fehler', text: 'Deine Sitzung ist abgelaufen. Bitte melde dich neu an.', code: 'NICHT_ANGEMELDET' },
		]);
	});
});
