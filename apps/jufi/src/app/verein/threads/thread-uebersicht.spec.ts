import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ThreadListe, ThreadZeile } from '@jufi/domain';
import { EchtzeitAttrappe, echtzeitAttrappe } from '../../admin/test-hilfen';
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
	let echtzeit: EchtzeitAttrappe;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [provideHttpClient(withFetch()), provideHttpClientTesting(), ...echtzeitAttrappe(), ThreadUebersicht],
		});
		dienst = TestBed.inject(ThreadUebersicht);
		http = TestBed.inject(HttpTestingController);
		echtzeit = TestBed.inject(EchtzeitAttrappe);
	});

	afterEach(() => {
		http.verify();
		vi.useRealTimers();
	});

	async function laden(antwort: ThreadListe): Promise<void> {
		TestBed.tick();
		http.expectOne('/demo/api/v1/threads').flush(antwort);
		await vi.waitFor(() => expect(dienst.liste.hasValue()).toBe(true));
	}

	it('fragt ohne Slug nichts', () => {
		vi.useFakeTimers();
		TestBed.tick();
		dienst.neuLaden();
		vi.advanceTimersByTime(250);
		TestBed.tick();
		http.expectNone('/demo/api/v1/threads');
		expect(dienst.punkt()).toBe(false);
	});

	it('laedt mit dem Slug die Liste und schickt mit neuLaden nach 250 ms eine zweite Anfrage', async () => {
		dienst.slug.set('demo');
		await laden({ threads: [zeile(false)], archiv: 0 });

		vi.useFakeTimers();
		dienst.neuLaden();
		vi.advanceTimersByTime(249);
		TestBed.tick();
		http.expectNone('/demo/api/v1/threads');
		vi.advanceTimersByTime(1);
		TestBed.tick();
		http.expectOne('/demo/api/v1/threads').flush({ threads: [zeile(true)], archiv: 0 });
		await vi.waitFor(() => expect(dienst.punkt()).toBe(true));
	});

	it('laedt auf jedes Echtzeit-Ereignis neu', async () => {
		dienst.slug.set('demo');
		await laden({ threads: [zeile(false)], archiv: 0 });

		vi.useFakeTimers();
		echtzeit.quelle.next({ typ: 'sync', geaendert: ['t1'], unsichtbar: [] });
		vi.advanceTimersByTime(250);
		TestBed.tick();
		http.expectOne('/demo/api/v1/threads').flush({ threads: [zeile(true)], archiv: 0 });
		await vi.waitFor(() => expect(dienst.punkt()).toBe(true));
	});

	// Rueckstand M2: reload() ist waehrend einer Anfrage wirkungslos, das Ereignis ging verloren.
	it('fragt nach einem Ereignis waehrend einer laufenden Anfrage danach genau einmal neu', async () => {
		vi.useFakeTimers();
		dienst.slug.set('demo');
		TestBed.tick();
		const erste = http.expectOne('/demo/api/v1/threads');

		echtzeit.quelle.next({ typ: 'alles' });
		vi.advanceTimersByTime(250);
		TestBed.tick();
		http.expectNone('/demo/api/v1/threads');

		erste.flush({ threads: [zeile(false)], archiv: 0 });
		await vi.waitFor(() => {
			TestBed.tick();
			http.expectOne('/demo/api/v1/threads').flush({ threads: [zeile(true)], archiv: 0 });
		});
		await vi.waitFor(() => expect(dienst.punkt()).toBe(true));

		vi.advanceTimersByTime(1000);
		TestBed.tick();
		http.expectNone('/demo/api/v1/threads');
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
