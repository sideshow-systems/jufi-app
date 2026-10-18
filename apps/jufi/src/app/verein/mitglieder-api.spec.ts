import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ApiFehler } from '../gemeinsam/api-fehler';
import { MitgliederApi } from './mitglieder-api';

describe('MitgliederApi', () => {
	let api: MitgliederApi;
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(withFetch()), provideHttpClientTesting()] });
		api = TestBed.inject(MitgliederApi);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it('anmelden ruft POST /glonntal/api/v1/anmelden mit dem Body auf', () => {
		let antwort: unknown;
		api.anmelden('glonntal', 'flo@example.org', 'geheim').subscribe((a) => (antwort = a));
		const anfrage = http.expectOne('/glonntal/api/v1/anmelden');
		expect(anfrage.request.method).toBe('POST');
		expect(anfrage.request.body).toEqual({ kennung: 'flo@example.org', passwort: 'geheim' });
		anfrage.flush({ schritt: 'fertig' });
		expect(antwort).toEqual({ schritt: 'fertig' });
	});

	it('ein 429-Body kommt als ApiFehler mit wartenSekunden an', () => {
		let fehler: ApiFehler | undefined;
		api.anmelden('glonntal', 'a', 'b').subscribe({ error: (e: ApiFehler) => (fehler = e) });
		http
			.expectOne('/glonntal/api/v1/anmelden')
			.flush({ fehler: 'Zu viele Versuche', wartenSekunden: 42 }, { status: 429, statusText: 'Too Many Requests' });
		expect(fehler).toEqual({ status: 429, fehler: 'Zu viele Versuche', wartenSekunden: 42 });
	});

	it('ich ist ein GET und der Slug wird im Pfad kodiert', () => {
		api.ich('a b').subscribe();
		const anfrage = http.expectOne('/a%20b/api/v1/ich');
		expect(anfrage.request.method).toBe('GET');
		anfrage.flush({});
	});

	it('die Methoden treffen die Pfade der Server-Routen', () => {
		const faelle: Array<[() => unknown, string, string, unknown?]> = [
			[() => api.abmelden('v'), 'POST', '/v/api/v1/abmelden'],
			[() => api.abmeldenAlle('v'), 'POST', '/v/api/v1/abmelden/alle'],
			[() => api.einladungPruefen('v', 't'), 'POST', '/v/api/v1/einladung/pruefen', { token: 't' }],
			[() => api.einladungPasskeyOptionen('v', 't'), 'POST', '/v/api/v1/einladung/passkey-optionen', { token: 't' }],
			[
				() => api.anmeldenTotp('v', 'z', { code: '1' }),
				'POST',
				'/v/api/v1/anmelden/totp',
				{ zwischenmarke: 'z', code: '1' },
			],
			[() => api.passkeyOptionen('v'), 'POST', '/v/api/v1/anmelden/passkey-optionen'],
			[() => api.anmeldenPasskey('v', { x: 1 }), 'POST', '/v/api/v1/anmelden/passkey', { antwort: { x: 1 } }],
			[() => api.zugangVerloren('v', 'a@b.de'), 'POST', '/v/api/v1/zugang-verloren', { email: 'a@b.de' }],
			[() => api.passwortAendern('v', 'alt', 'neu'), 'POST', '/v/api/v1/profil/passwort', { alt: 'alt', neu: 'neu' }],
			[() => api.passkeyHinzufuegenOptionen('v'), 'POST', '/v/api/v1/profil/passkeys/optionen'],
			[
				() => api.passkeyHinzufuegen('v', 'Handy', { x: 1 }),
				'POST',
				'/v/api/v1/profil/passkeys',
				{ name: 'Handy', antwort: { x: 1 } },
			],
			[() => api.passkeyUmbenennen('v', 'p/1', 'Neu'), 'PATCH', '/v/api/v1/profil/passkeys/p%2F1', { label: 'Neu' }],
			[() => api.passkeyEntfernen('v', 'p1'), 'DELETE', '/v/api/v1/profil/passkeys/p1'],
			[() => api.totpStart('v'), 'POST', '/v/api/v1/profil/totp/start'],
			[
				() => api.totpBestaetigen('v', 'm', '123456'),
				'POST',
				'/v/api/v1/profil/totp/bestaetigen',
				{ marke: 'm', code: '123456' },
			],
			[() => api.personen('v'), 'GET', '/v/api/v1/personen'],
			[() => api.person('v', 'p/1'), 'GET', '/v/api/v1/personen/p%2F1'],
			[
				() =>
					api.legePersonAn('v', { art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Bach', geburtsdatum: '2015-05-01' }),
				'POST',
				'/v/api/v1/personen',
				{ art: 'JUNGFISCHER', vorname: 'Lena', nachname: 'Bach', geburtsdatum: '2015-05-01' },
			],
			[() => api.aenderePerson('v', 'p1', { vorname: 'Lea' }), 'PATCH', '/v/api/v1/personen/p1', { vorname: 'Lea' }],
			[() => api.entfernePerson('v', 'p1'), 'DELETE', '/v/api/v1/personen/p1'],
			[() => api.volljaehrigBelassen('v', 'p1'), 'POST', '/v/api/v1/personen/p1/volljaehrig-belassen', {}],
			[
				() => api.setzeFamilie('v', 'k1', 'e1', { beziehung: 'MUTTER' }),
				'PUT',
				'/v/api/v1/personen/k1/familie/e1',
				{ beziehung: 'MUTTER' },
			],
			[() => api.loeseFamilie('v', 'k1', 'e1'), 'DELETE', '/v/api/v1/personen/k1/familie/e1'],
			[() => api.untergruppen('v'), 'GET', '/v/api/v1/untergruppen'],
			[() => api.legeUntergruppeAn('v', 'Hechte'), 'POST', '/v/api/v1/untergruppen', { name: 'Hechte' }],
			[
				() => api.benenneUntergruppeUm('v', 'u1', 'Forellen'),
				'PATCH',
				'/v/api/v1/untergruppen/u1',
				{ name: 'Forellen' },
			],
			[() => api.loescheUntergruppe('v', 'u1'), 'DELETE', '/v/api/v1/untergruppen/u1'],
			[
				() => api.setzeUntergruppen('v', 'k1', ['u1']),
				'PUT',
				'/v/api/v1/personen/k1/untergruppen',
				{ untergruppenIds: ['u1'] },
			],
			[
				() => api.setzeRechte('v', 'e1', ['MITGLIEDER']),
				'PUT',
				'/v/api/v1/personen/e1/rechte',
				{ rechte: ['MITGLIEDER'] },
			],
			[() => api.ladePersonEin('v', 'p1'), 'POST', '/v/api/v1/personen/p1/einladung', { mail: false }],
			[() => api.ladePersonEin('v', 'p1', true), 'POST', '/v/api/v1/personen/p1/einladung', { mail: true }],
			[() => api.meineJungfischer('v'), 'GET', '/v/api/v1/meine-jungfischer'],
			[() => api.setzeKindZugang('v', 'k1', true), 'POST', '/v/api/v1/meine-jungfischer/k1/zugang', { erlaubt: true }],
			[() => api.kindEinladung('v', 'k1'), 'POST', '/v/api/v1/meine-jungfischer/k1/einladung', {}],
			[
				() => api.kindEinwilligung('v', 'k1', false),
				'POST',
				'/v/api/v1/meine-jungfischer/k1/einwilligung',
				{ erteilen: false },
			],
		];
		for (const [aufruf, methode, url, body] of faelle) {
			(aufruf() as { subscribe: (o: object) => void }).subscribe({});
			const anfrage = http.expectOne(url);
			expect(anfrage.request.method).toBe(methode);
			if (body !== undefined) expect(anfrage.request.body).toEqual(body);
			anfrage.flush({});
		}
	});
});
