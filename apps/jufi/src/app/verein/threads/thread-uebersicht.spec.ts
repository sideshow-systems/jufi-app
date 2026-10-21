import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ThreadListe, ThreadZeile } from '@jufi/domain';
import { ThreadUebersicht } from './thread-uebersicht';

function zeile(neu: boolean): ThreadZeile {
	return {
		id: 't1',
		titel: 'Kegeln',
		segment: 't1-kegeln',
		angepinnt: false,
		archiviert: false,
		entwurf: false,
		naechsterTermin: null,
		neu,
	};
}

describe('ThreadUebersicht', () => {
	let dienst: ThreadUebersicht;
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), ThreadUebersicht],
		});
		dienst = TestBed.inject(ThreadUebersicht);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	async function laden(antwort: ThreadListe): Promise<void> {
		TestBed.tick();
		http.expectOne('/demo/api/v1/threads').flush(antwort);
		await vi.waitFor(() => expect(dienst.liste.hasValue()).toBe(true));
	}

	it('fragt ohne Slug nichts', () => {
		TestBed.tick();
		dienst.neuLaden();
		TestBed.tick();
		http.expectNone('/demo/api/v1/threads');
		expect(dienst.punkt()).toBe(false);
	});

	it('laedt mit dem Slug die Liste und schickt mit neuLaden eine zweite Anfrage', async () => {
		dienst.slug.set('demo');
		await laden({ threads: [zeile(false)], archiv: 0 });

		dienst.neuLaden();
		TestBed.tick();
		http.expectOne('/demo/api/v1/threads').flush({ threads: [zeile(true)], archiv: 0 });
		await vi.waitFor(() => expect(dienst.punkt()).toBe(true));
	});

	it('hat einen Punkt nur, wenn irgendeine Zeile neu ist', async () => {
		dienst.slug.set('demo');
		await laden({ threads: [zeile(false), zeile(true)], archiv: 0 });
		expect(dienst.punkt()).toBe(true);
	});

	it('hat keinen Punkt, wenn keine Zeile neu ist', async () => {
		dienst.slug.set('demo');
		await laden({ threads: [zeile(false)], archiv: 0 });
		expect(dienst.punkt()).toBe(false);
	});
});
