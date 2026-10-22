import { HttpClient, HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FEHLER_TEXT, GRENZE_BYTES } from '@jufi/domain';
import { Hochladeschlange, type Hochladung } from './hochladeschlange';

const URL_A = '/demo/api/v1/module/m1/dateien';
const URL_FOTOS = '/demo/api/v1/module/m1/fotos';

function datei(name: string, bytes = 10, typ = 'application/pdf'): File {
	return new File([new Uint8Array(bytes)], name, { type: typ });
}

describe('Hochladeschlange', () => {
	let client: HttpClient;
	let http: HttpTestingController;
	let erfolge: Array<{ h: Hochladung; antwort: unknown }>;
	let erstellt: string[];
	let freigegeben: string[];
	let schlangen: Hochladeschlange[];

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		client = TestBed.inject(HttpClient);
		http = TestBed.inject(HttpTestingController);
		erfolge = [];
		erstellt = [];
		freigegeben = [];
		schlangen = [];
		// jsdom kennt keine Objekt-URLs; gezaehlt wird, was erzeugt und freigegeben wird.
		URL.createObjectURL = vi.fn(() => {
			const u = `blob:test/${erstellt.length}`;
			erstellt.push(u);
			return u;
		});
		URL.revokeObjectURL = vi.fn((u: string) => void freigegeben.push(u));
	});

	afterEach(() => {
		schlangen.forEach((s) => s.beende());
		vi.useRealTimers();
		http.verify();
	});

	function neu(art: 'DATEI' | 'FOTO' = 'DATEI', beiNichtAngemeldet?: () => void): Hochladeschlange {
		const s = new Hochladeschlange({
			http: client,
			art,
			nachErfolg: (h, antwort) => erfolge.push({ h, antwort }),
			...(beiNichtAngemeldet ? { beiNichtAngemeldet } : {}),
		});
		schlangen.push(s);
		return s;
	}

	const zustaende = (s: Hochladeschlange) => s.reihe().map((h) => h.zustand);

	it('laedt drei Dateien nacheinander, nie zwei zugleich', () => {
		const s = neu();
		s.fuegeHinzu([datei('a.pdf'), datei('b.pdf'), datei('c.pdf')], URL_A);

		expect(zustaende(s)).toEqual(['laeuft', 'wartet', 'wartet']);
		for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) {
			const anfrage = http.expectOne(URL_A);
			expect(anfrage.request.headers.get('X-Dateiname')).toBe(name);
			expect(s.reihe().filter((h) => h.zustand === 'laeuft')).toHaveLength(1);
			anfrage.flush({ id: name }, { status: 201, statusText: 'Created' });
		}

		expect(s.reihe()).toEqual([]);
		expect(erfolge.map((e) => e.antwort)).toEqual([{ id: 'a.pdf' }, { id: 'b.pdf' }, { id: 'c.pdf' }]);
	});

	it('meldet den Anteil der laufenden Datei', () => {
		const s = neu();
		s.fuegeHinzu([datei('a.pdf')], URL_A);

		http.expectOne(URL_A).event({ type: HttpEventType.UploadProgress, loaded: 25, total: 100 });

		expect(s.reihe()[0]?.anteil).toBe(0.25);
	});

	it('nimmt PUT fuer das Ersetzen', () => {
		const s = neu();
		s.fuegeHinzu([datei('a.pdf')], URL_A, 'PUT');

		const anfrage = http.expectOne(URL_A);
		expect(anfrage.request.method).toBe('PUT');
		anfrage.flush({});
	});

	it('laesst einen Fehler mit Text stehen, und nochmal laedt neu', () => {
		const s = neu();
		s.fuegeHinzu([datei('a.pdf'), datei('b.pdf')], URL_A);
		http
			.expectOne(URL_A)
			.flush({ fehler: FEHLER_TEXT.TYP.DATEI, code: 'TYP' }, { status: 415, statusText: 'Unsupported Media Type' });

		// Die zweite Datei kommt trotz des Fehlers der ersten dran.
		expect(s.reihe()[0]).toMatchObject({ zustand: 'fehler', fehler: FEHLER_TEXT.TYP.DATEI, code: 'TYP' });
		expect(s.reihe()[1]?.zustand).toBe('laeuft');
		http.expectOne(URL_A).flush({}, { status: 201, statusText: 'Created' });

		const schluessel = s.reihe()[0]?.schluessel as number;
		s.nochmal(schluessel);
		expect(s.reihe()[0]).toMatchObject({ zustand: 'laeuft', fehler: null, code: null, anteil: 0 });
		const wieder = http.expectOne(URL_A);
		expect(wieder.request.headers.get('X-Dateiname')).toBe('a.pdf');
		wieder.flush({}, { status: 201, statusText: 'Created' });
		expect(s.reihe()).toEqual([]);
	});

	it('weist eine zu grosse Datei ohne Anfrage ab, je nach Art mit der Grenze der Art', () => {
		const s = neu('FOTO');
		s.fuegeHinzu([datei('gross.jpg', GRENZE_BYTES.FOTO + 1, 'image/jpeg')], URL_FOTOS);

		http.expectNone(() => true);
		expect(s.reihe()[0]).toMatchObject({ zustand: 'fehler', fehler: FEHLER_TEXT.GROESSE.FOTO, code: 'GROESSE' });
	});

	it('verwirft eine Zeile', () => {
		const s = neu();
		s.fuegeHinzu([datei('a.pdf', GRENZE_BYTES.DATEI + 1)], URL_A);

		s.verwirf(s.reihe()[0]?.schluessel as number);

		expect(s.reihe()).toEqual([]);
	});

	it('bricht beim Verwerfen der laufenden Datei diese ab und macht mit der naechsten weiter', () => {
		const s = neu();
		s.fuegeHinzu([datei('a.pdf'), datei('b.pdf')], URL_A);
		const erste = http.expectOne(URL_A);

		s.verwirf(s.reihe()[0]?.schluessel as number);

		expect(erste.cancelled).toBe(true);
		expect(s.reihe().map((h) => h.datei.name)).toEqual(['b.pdf']);
		expect(zustaende(s)).toEqual(['laeuft']);
		http.expectOne(URL_A).flush({});
	});

	describe('volle Foto-Warteschlange (503)', () => {
		const belegt = { fehler: FEHLER_TEXT.BESCHAEFTIGT, code: 'BESCHAEFTIGT' };
		const sperre = (retryAfter = '2') => ({
			status: 503,
			statusText: 'Service Unavailable',
			headers: { 'Retry-After': retryAfter },
		});

		it('wiederholt nach Retry-After von selbst, ohne dass ein Fehler sichtbar wird', () => {
			vi.useFakeTimers();
			const s = neu('FOTO');
			s.fuegeHinzu([datei('a.jpg', 10, 'image/jpeg')], URL_FOTOS);

			http.expectOne(URL_FOTOS).flush(belegt, sperre());
			expect(s.reihe()[0]).toMatchObject({ zustand: 'wartet', fehler: null });
			http.expectNone(URL_FOTOS);

			vi.advanceTimersByTime(1999);
			http.expectNone(URL_FOTOS);
			vi.advanceTimersByTime(1);
			http.expectOne(URL_FOTOS).flush(belegt, sperre());
			expect(s.reihe()[0]).toMatchObject({ zustand: 'wartet', fehler: null });

			vi.advanceTimersByTime(2000);
			http.expectOne(URL_FOTOS).flush({ id: 'f1' }, { status: 201, statusText: 'Created' });

			expect(s.reihe()).toEqual([]);
			expect(erfolge).toHaveLength(1);
		});

		it('folgt der Zeit aus Retry-After', () => {
			vi.useFakeTimers();
			const s = neu('FOTO');
			s.fuegeHinzu([datei('a.jpg', 10, 'image/jpeg')], URL_FOTOS);

			http.expectOne(URL_FOTOS).flush(belegt, sperre('5'));
			vi.advanceTimersByTime(4999);
			http.expectNone(URL_FOTOS);
			vi.advanceTimersByTime(1);
			http.expectOne(URL_FOTOS).flush({}, { status: 201, statusText: 'Created' });
		});

		it('zeigt nach dem vierten Versuch den Fehler mit Text', () => {
			vi.useFakeTimers();
			const s = neu('FOTO');
			s.fuegeHinzu([datei('a.jpg', 10, 'image/jpeg')], URL_FOTOS);

			for (let i = 0; i < 3; i++) {
				http.expectOne(URL_FOTOS).flush(belegt, sperre());
				expect(s.reihe()[0]?.zustand).toBe('wartet');
				vi.advanceTimersByTime(2000);
			}
			http.expectOne(URL_FOTOS).flush(belegt, sperre());

			expect(s.reihe()[0]).toMatchObject({ zustand: 'fehler', fehler: FEHLER_TEXT.BESCHAEFTIGT, code: 'BESCHAEFTIGT' });
			vi.advanceTimersByTime(10_000);
			http.expectNone(URL_FOTOS);
		});

		it('beginnt nach Nochmal wieder mit drei Wiederholungen', () => {
			vi.useFakeTimers();
			const s = neu('FOTO');
			s.fuegeHinzu([datei('a.jpg', 10, 'image/jpeg')], URL_FOTOS);
			for (let i = 0; i < 3; i++) {
				http.expectOne(URL_FOTOS).flush(belegt, sperre());
				vi.advanceTimersByTime(2000);
			}
			http.expectOne(URL_FOTOS).flush(belegt, sperre());

			s.nochmal(s.reihe()[0]?.schluessel as number);
			http.expectOne(URL_FOTOS).flush(belegt, sperre());

			expect(s.reihe()[0]?.zustand).toBe('wartet');
		});

		it('haelt die Reihe an, solange eine Datei auf den Server wartet', () => {
			vi.useFakeTimers();
			const s = neu('FOTO');
			s.fuegeHinzu([datei('a.jpg', 10, 'image/jpeg'), datei('b.jpg', 10, 'image/jpeg')], URL_FOTOS);

			http.expectOne(URL_FOTOS).flush(belegt, sperre());
			http.expectNone(URL_FOTOS);
			vi.advanceTimersByTime(2000);

			const wieder = http.expectOne(URL_FOTOS);
			expect(wieder.request.headers.get('X-Dateiname')).toBe('a.jpg');
			wieder.flush({}, { status: 201, statusText: 'Created' });
			const zweite = http.expectOne(URL_FOTOS);
			expect(zweite.request.headers.get('X-Dateiname')).toBe('b.jpg');
			zweite.flush({}, { status: 201, statusText: 'Created' });
		});

		it('wiederholt nicht, wenn die Zeile waehrenddessen verworfen wird', () => {
			vi.useFakeTimers();
			const s = neu('FOTO');
			s.fuegeHinzu([datei('a.jpg', 10, 'image/jpeg')], URL_FOTOS);
			http.expectOne(URL_FOTOS).flush(belegt, sperre());

			s.verwirf(s.reihe()[0]?.schluessel as number);
			vi.advanceTimersByTime(10_000);

			http.expectNone(URL_FOTOS);
		});
	});

	describe('Vorschau', () => {
		const bild = () => datei('a.jpg', 10, 'image/jpeg');

		it('gibt es nur fuer Fotos', () => {
			const s = neu('DATEI');
			s.fuegeHinzu([datei('a.pdf')], URL_A);

			expect(s.reihe()[0]?.vorschau).toBeNull();
			expect(erstellt).toEqual([]);
			http.expectOne(URL_A).flush({});
		});

		it('gibt die Adresse bei fertig frei', () => {
			const s = neu('FOTO');
			s.fuegeHinzu([bild()], URL_FOTOS);
			expect(s.reihe()[0]?.vorschau).toBe(erstellt[0]);
			expect(freigegeben).toEqual([]);

			http.expectOne(URL_FOTOS).flush({}, { status: 201, statusText: 'Created' });

			expect(freigegeben).toEqual(erstellt);
		});

		it('gibt die Adresse bei verwirf frei', () => {
			const s = neu('FOTO');
			s.fuegeHinzu([bild()], URL_FOTOS);
			http.expectOne(URL_FOTOS);

			s.verwirf(s.reihe()[0]?.schluessel as number);

			expect(freigegeben).toEqual(erstellt);
		});

		it('gibt alle Adressen bei beende frei, auch die wartenden', () => {
			const s = neu('FOTO');
			s.fuegeHinzu([bild(), bild(), bild()], URL_FOTOS);
			http.expectOne(URL_FOTOS);

			s.beende();

			expect(erstellt).toHaveLength(3);
			expect(freigegeben.sort()).toEqual([...erstellt].sort());
		});

		it('behaelt die Adresse eines Fehlers fuer Nochmal und gibt sie erst danach frei', () => {
			const s = neu('FOTO');
			s.fuegeHinzu([bild()], URL_FOTOS);
			http.expectOne(URL_FOTOS).flush({ fehler: 'x', code: 'TYP' }, { status: 415, statusText: 'x' });
			expect(freigegeben).toEqual([]);

			s.nochmal(s.reihe()[0]?.schluessel as number);
			http.expectOne(URL_FOTOS).flush({}, { status: 201, statusText: 'Created' });

			expect(freigegeben).toEqual(erstellt);
		});
	});

	describe('beende', () => {
		it('bricht die laufende Anfrage ab und startet nichts mehr', () => {
			const s = neu();
			s.fuegeHinzu([datei('a.pdf'), datei('b.pdf')], URL_A);
			const erste = http.expectOne(URL_A);

			s.beende();

			expect(erste.cancelled).toBe(true);
			http.expectNone(URL_A);
		});

		it('laesst keine Wiederholung mehr zu', () => {
			vi.useFakeTimers();
			const s = neu('FOTO');
			s.fuegeHinzu([datei('a.jpg', 10, 'image/jpeg')], URL_FOTOS);
			http
				.expectOne(URL_FOTOS)
				.flush(
					{ fehler: FEHLER_TEXT.BESCHAEFTIGT, code: 'BESCHAEFTIGT' },
					{ status: 503, statusText: 'Service Unavailable', headers: { 'Retry-After': '2' } },
				);

			s.beende();
			vi.advanceTimersByTime(10_000);

			http.expectNone(URL_FOTOS);
		});
	});

	describe('abgelaufene Sitzung', () => {
		it('ruft den Weg zur Anmeldung genau einmal, auch bei mehreren Dateien', () => {
			const weg = vi.fn();
			const s = neu('DATEI', weg);
			s.fuegeHinzu([datei('a.pdf'), datei('b.pdf')], URL_A);

			http.expectOne(URL_A).flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });
			http.expectOne(URL_A).flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });

			expect(weg).toHaveBeenCalledTimes(1);
			expect(s.reihe().map((h) => h.code)).toEqual(['NICHT_ANGEMELDET', 'NICHT_ANGEMELDET']);
		});
	});
});
