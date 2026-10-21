import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { EchtzeitSignal, SyncAntwort } from '@jufi/domain';
import { betrifft, Echtzeit, type EchtzeitEreignis, WEB_SOCKET } from './echtzeit';
import { MitgliedSitzung } from './mitglied-waechter';

const SYNC = '/demo/api/v1/sync';

/** Steht fuer den WebSocket des Browsers; der Test oeffnet, sendet und schliesst von Hand. */
class FalscherSocket {
	static alle: FalscherSocket[] = [];
	onopen: WebSocket['onopen'] = null;
	onmessage: WebSocket['onmessage'] = null;
	onclose: WebSocket['onclose'] = null;
	geschlossenMit: number | null = null;

	constructor(readonly url: string) {
		FalscherSocket.alle.push(this);
	}

	close(code?: number): void {
		this.geschlossenMit = code ?? 1005;
	}

	oeffne(): void {
		this.onopen?.call(this as never, new Event('open'));
	}

	sende(signal: EchtzeitSignal): void {
		this.onmessage?.call(this as never, new MessageEvent('message', { data: JSON.stringify(signal) }));
	}

	brichAb(code: number): void {
		this.onclose?.call(this as never, { code } as CloseEvent);
	}
}

const zuletzt = (): FalscherSocket => {
	const s = FalscherSocket.alle.at(-1);
	if (!s) throw new Error('kein Socket');
	return s;
};

const antwort = (teil: Partial<SyncAntwort>): SyncAntwort => ({
	stand: 5,
	geaendert: [],
	unsichtbar: [],
	vollstaendig: false,
	...teil,
});

const signal = (teil: Partial<EchtzeitSignal>): EchtzeitSignal => ({
	stand: 7,
	threadId: 't1',
	art: 'MODUL',
	objektId: 'm1',
	...teil,
});

describe('Echtzeit', () => {
	let http: HttpTestingController;
	let echtzeit: Echtzeit;
	let ereignisse: EchtzeitEreignis[];
	let sichtbarkeit: DocumentVisibilityState;

	function bereite(plattform: 'browser' | 'server' = 'browser'): void {
		TestBed.configureTestingModule({
			providers: [
				provideHttpClient(withFetch()),
				provideHttpClientTesting(),
				provideRouter([]),
				{ provide: WEB_SOCKET, useValue: FalscherSocket },
				{ provide: PLATFORM_ID, useValue: plattform },
				Echtzeit,
			],
		});
		http = TestBed.inject(HttpTestingController);
		echtzeit = TestBed.inject(Echtzeit);
		ereignisse = [];
		echtzeit.ereignisse.subscribe((e) => ereignisse.push(e));
	}

	/** Startet, oeffnet und beantwortet den ersten Abgleich (ohne seit, also alles). */
	function verbinde(stand = 5): FalscherSocket {
		echtzeit.starte('demo');
		const s = zuletzt();
		s.oeffne();
		http.expectOne(SYNC).flush(antwort({ stand, vollstaendig: true }));
		return s;
	}

	function zeige(zustand: DocumentVisibilityState): void {
		sichtbarkeit = zustand;
		document.dispatchEvent(new Event('visibilitychange'));
	}

	beforeEach(() => {
		vi.useFakeTimers();
		FalscherSocket.alle = [];
		sichtbarkeit = 'visible';
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => sichtbarkeit });
	});

	// Aufraeumen auch, wenn verify scheitert: Sonst liefe der naechste Test mit falscher Uhr und altem Dienst.
	afterEach(() => {
		try {
			http.verify();
		} finally {
			TestBed.resetTestingModule();
			Reflect.deleteProperty(document, 'visibilityState');
			vi.restoreAllMocks();
			vi.useRealTimers();
		}
	});

	it('oeffnet /<slug>/ws ohne Abfrageteil und gleicht nach dem Oeffnen ohne seit ab, das heisst alles', () => {
		bereite();
		echtzeit.starte('demo');

		expect(FalscherSocket.alle.length).toBe(1);
		expect(zuletzt().url).toBe(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/demo/ws`);
		http.expectNone(SYNC);

		// Verbunden heisst: Inhalte sind abgeglichen, nicht nur der Socket ist offen.
		zuletzt().oeffne();
		expect(echtzeit.verbunden()).toBe(false);
		http.expectOne(SYNC).flush(antwort({ stand: 5, vollstaendig: true }));
		expect(echtzeit.verbunden()).toBe(true);
		expect(ereignisse).toEqual([{ typ: 'alles' }]);
	});

	it('reicht Signale weiter und gleicht danach ab dem hoechsten Stand ab', () => {
		bereite();
		const s = verbinde(5);

		s.sende(signal({ stand: 7 }));
		s.sende(signal({ stand: 6, threadId: null, art: 'SICHTBARKEIT' }));
		expect(ereignisse.slice(1)).toEqual([
			{ typ: 'signal', signal: signal({ stand: 7 }) },
			{ typ: 'signal', signal: signal({ stand: 6, threadId: null, art: 'SICHTBARKEIT' }) },
		]);

		s.brichAb(1006);
		http
			.expectOne(`${SYNC}?seit=7`)
			.flush(antwort({ stand: 9, geaendert: ['t1'], unsichtbar: ['t2'], vollstaendig: false }));
		expect(ereignisse.at(-1)).toEqual({ typ: 'sync', geaendert: ['t1'], unsichtbar: ['t2'] });

		// Mit dem neuen Stand und ohne Aenderung kommt kein Ereignis.
		vi.advanceTimersByTime(1200);
		zuletzt().oeffne();
		http.expectOne(`${SYNC}?seit=9`).flush(antwort({ stand: 9 }));
		expect(ereignisse.length).toBe(4);
	});

	it('uebernimmt nach "alles" den Stand des Servers, auch wenn er niedriger ist (Datenbank aus der Sicherung)', () => {
		bereite();
		const s = verbinde(5);
		s.sende(signal({ stand: 40 }));

		zeige('visible');
		http.expectOne(`${SYNC}?seit=40`).flush(antwort({ stand: 12, vollstaendig: true }));
		expect(ereignisse.at(-1)).toEqual({ typ: 'alles' });

		zeige('visible');
		http.expectOne(`${SYNC}?seit=12`).flush(antwort({ stand: 12 }));
	});

	// Review Important 1: Ein gescheiterter Abgleich bei offenem Socket darf die Luecke nicht verschlucken.
	// Prueft das Schliessen nach dem Fehler: Das Signal danach kommt ueber den geschlossenen Socket und
	// faellt schon am Waechter fuer ersetzte Sockets weg. Den Merker "Abgleich offen" prueft der naechste Test.
	it('schliesst den Socket nach einem gescheiterten ersten Abgleich und fragt beim naechsten Versuch wieder ohne seit', () => {
		bereite();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		echtzeit.starte('demo');
		const s = zuletzt();
		s.oeffne();
		http.expectOne(SYNC).flush({ fehler: 'kaputt' }, { status: 500, statusText: 'Server Error' });
		expect(s.geschlossenMit).toBe(1000);
		s.sende(signal({ stand: 9 }));

		vi.advanceTimersByTime(1000);
		expect(FalscherSocket.alle.length).toBe(2);
		zuletzt().oeffne();
		http.expectNone(`${SYNC}?seit=9`);
		http.expectOne(SYNC).flush(antwort({ stand: 9, vollstaendig: true }));
		expect(ereignisse.at(-1)).toEqual({ typ: 'alles' });
	});

	// Review Fix-Runde 1: Ein offener Socket mit dauernd scheiterndem Abgleich darf den Backoff nicht zuruecksetzen.
	it('verdoppelt die Wartezeit, wenn der Abgleich nach dem Oeffnen wiederholt scheitert, und zeigt den Hinweis', () => {
		bereite();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const kaputt = () => http.expectOne(SYNC).flush({ fehler: 'kaputt' }, { status: 500, statusText: 'Server Error' });
		echtzeit.starte('demo');

		zuletzt().oeffne();
		kaputt();
		vi.advanceTimersByTime(1000);
		expect(FalscherSocket.alle.length).toBe(2);
		zuletzt().oeffne();
		kaputt();

		vi.advanceTimersByTime(1999);
		expect(FalscherSocket.alle.length).toBe(2);
		vi.advanceTimersByTime(1);
		expect(FalscherSocket.alle.length).toBe(3);
		expect(echtzeit.getrennt()).toBe(true);
		expect(echtzeit.verbunden()).toBe(false);
	});

	// Ein aelterer Abgleich, der nach dem Erfolg eines juengeren scheitert, sagt nichts mehr ueber den Socket.
	it('laesst den Socket offen, wenn ein ueberholter Abgleich scheitert', () => {
		bereite();
		const s = verbinde(5);

		zeige('visible');
		const alt = http.expectOne(`${SYNC}?seit=5`);
		zeige('visible');
		http.expectOne(`${SYNC}?seit=5`).flush(antwort({ stand: 6 }));
		alt.error(new ProgressEvent('error'));

		expect(s.geschlossenMit).toBeNull();
		expect(echtzeit.verbunden()).toBe(true);
		vi.advanceTimersByTime(60_000);
		expect(FalscherSocket.alle.length).toBe(1);
	});

	it('hebt den Stand nicht ueber ein Signal, das waehrend eines spaeter gescheiterten Abgleichs kam', () => {
		bereite();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const s = verbinde(5);

		zeige('visible');
		const offen = http.expectOne(`${SYNC}?seit=5`);
		s.sende(signal({ stand: 9 }));
		offen.error(new ProgressEvent('error'));

		// Der Socket ist zu, der Hinweis kommt wie nach jedem Abbruch, und der naechste Versuch gleicht ab 5 ab.
		expect(s.geschlossenMit).toBe(1000);
		expect(echtzeit.verbunden()).toBe(false);
		vi.advanceTimersByTime(1000);
		expect(FalscherSocket.alle.length).toBe(2);
		zuletzt().oeffne();
		http.expectOne(`${SYNC}?seit=5`).flush(antwort({ stand: 9, geaendert: ['t1'] }));
		expect(ereignisse.at(-1)).toEqual({ typ: 'sync', geaendert: ['t1'], unsichtbar: [] });
		vi.advanceTimersByTime(2000);
		expect(echtzeit.getrennt()).toBe(false);
	});

	it('zeigt den Hinweis, wenn der Abgleich im Vordergrund mit 404 endet', () => {
		bereite();
		verbinde(5);

		zeige('visible');
		http.expectOne(`${SYNC}?seit=5`).flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });
		expect(echtzeit.verbunden()).toBe(false);
		vi.advanceTimersByTime(2000);
		expect(echtzeit.getrennt()).toBe(true);
		vi.advanceTimersByTime(60_000);
		expect(FalscherSocket.alle.length).toBe(1);
	});

	it('wechselt bei einem anderen Slug den Socket und faengt ohne Stand an', () => {
		bereite();
		const alt = verbinde(5);

		echtzeit.starte('andere');
		expect(alt.geschlossenMit).toBe(1000);
		expect(zuletzt().url).toBe(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/andere/ws`);
		zuletzt().oeffne();
		http.expectOne('/andere/api/v1/sync').flush(antwort({ stand: 2, vollstaendig: true }));
	});

	it('uebergeht alles, was ein ersetzter Socket noch meldet', () => {
		bereite();
		const alt = verbinde(5);
		echtzeit.starte('andere');
		const neu = zuletzt();
		const vorher = ereignisse.length;

		alt.oeffne();
		alt.sende(signal({ stand: 40 }));
		alt.brichAb(1006);
		expect(ereignisse.length).toBe(vorher);
		expect(echtzeit.verbunden()).toBe(false);
		http.expectNone(() => true);

		neu.oeffne();
		http.expectOne('/andere/api/v1/sync').flush(antwort({ vollstaendig: true }));
		alt.brichAb(1012);
		expect(echtzeit.verbunden()).toBe(true);
		vi.advanceTimersByTime(60_000);
		expect(FalscherSocket.alle.length).toBe(2);
	});

	it('schickt nach einem Abbruch und 401 zur Anmeldung und verbindet sich nicht mehr', () => {
		bereite();
		const router = TestBed.inject(Router);
		const navigiere = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
		verbinde();

		zuletzt().brichAb(1006);
		expect(echtzeit.verbunden()).toBe(false);
		http.expectOne(`${SYNC}?seit=5`).flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' });

		expect(navigiere).toHaveBeenCalledExactlyOnceWith('/demo/anmelden?weiter=%2F');
		vi.advanceTimersByTime(60_000);
		zeige('visible');
		expect(FalscherSocket.alle.length).toBe(1);
		http.expectNone(() => true);
	});

	it('verbindet sich nach einem Abbruch und 404 nicht mehr', () => {
		bereite();
		const navigiere = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
		verbinde();

		zuletzt().brichAb(4401);
		http.expectOne(`${SYNC}?seit=5`).flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' });

		vi.advanceTimersByTime(60_000);
		expect(FalscherSocket.alle.length).toBe(1);
		expect(navigiere).not.toHaveBeenCalled();
	});

	it('verbindet sich nach einem Abbruch ohne Antwort des Servers mit Backoff neu', () => {
		bereite();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		verbinde();

		zuletzt().brichAb(1006);
		http.expectOne(`${SYNC}?seit=5`).error(new ProgressEvent('error'));
		vi.advanceTimersByTime(999);
		expect(FalscherSocket.alle.length).toBe(1);
		vi.advanceTimersByTime(1);
		expect(FalscherSocket.alle.length).toBe(2);
	});

	it.each([
		[0, 800, 1600],
		[0.9999, 1200, 2400],
	])('verbindet sich bei 1012 ohne Abgleich neu, Zufall %s: nach %i ms, dann nach %i ms', (zufall, erst, dann) => {
		bereite();
		vi.spyOn(Math, 'random').mockReturnValue(zufall);
		verbinde();

		zuletzt().brichAb(1012);
		http.expectNone(() => true);
		vi.advanceTimersByTime(erst - 1);
		expect(FalscherSocket.alle.length).toBe(1);
		vi.advanceTimersByTime(1);
		expect(FalscherSocket.alle.length).toBe(2);

		// Der zweite Versuch scheitert vor dem Oeffnen: Die Wartezeit verdoppelt sich.
		zuletzt().brichAb(1012);
		vi.advanceTimersByTime(dann - 1);
		expect(FalscherSocket.alle.length).toBe(2);
		vi.advanceTimersByTime(1);
		expect(FalscherSocket.alle.length).toBe(3);
	});

	it('wartet hoechstens 30 s und faengt nach einem erfolgreichen Oeffnen wieder bei 1 s an', () => {
		bereite();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		echtzeit.starte('demo');

		// 1, 2, 4, 8, 16, 30, 30 s
		for (const warten of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
			const vorher = FalscherSocket.alle.length;
			zuletzt().brichAb(1012);
			vi.advanceTimersByTime(warten - 1);
			expect(FalscherSocket.alle.length).toBe(vorher);
			vi.advanceTimersByTime(1);
			expect(FalscherSocket.alle.length).toBe(vorher + 1);
		}

		zuletzt().oeffne();
		http.expectOne(SYNC).flush(antwort({ vollstaendig: true }));
		zuletzt().brichAb(1012);
		vi.advanceTimersByTime(1000);
		expect(FalscherSocket.alle.length).toBe(9);
	});

	it('meldet getrennt erst nach 2 s ohne Verbindung', () => {
		bereite();
		echtzeit.starte('demo');
		vi.advanceTimersByTime(1999);
		expect(echtzeit.getrennt()).toBe(false);
		vi.advanceTimersByTime(1);
		expect(echtzeit.getrennt()).toBe(true);

		zuletzt().oeffne();
		http.expectOne(SYNC).flush(antwort({ vollstaendig: true }));
		expect(echtzeit.getrennt()).toBe(false);

		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		zuletzt().brichAb(1012);
		vi.advanceTimersByTime(1000);
		zuletzt().oeffne();
		http.expectOne(`${SYNC}?seit=5`).flush(antwort({}));
		// Wieder verbunden, bevor die 2 s um waren: Der Hinweis bleibt aus.
		vi.advanceTimersByTime(5000);
		expect(echtzeit.getrennt()).toBe(false);
	});

	it('oeffnet im Server-Rendering keinen Socket und stellt keinen Zeitgeber', () => {
		bereite('server');
		echtzeit.starte('demo');
		vi.advanceTimersByTime(60_000);

		expect(FalscherSocket.alle.length).toBe(0);
		expect(echtzeit.getrennt()).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('schliesst bei stoppe ohne neu zu verbinden', () => {
		bereite();
		const s = verbinde();

		echtzeit.stoppe();
		expect(s.geschlossenMit).toBe(1000);
		expect(echtzeit.verbunden()).toBe(false);
		vi.advanceTimersByTime(60_000);
		zeige('visible');
		expect(FalscherSocket.alle.length).toBe(1);
		expect(echtzeit.getrennt()).toBe(false);
	});

	// Der Wettlauf aus dem Ende-zu-Ende-Lauf: Nach POST /abmelden schliesst der Hub den Socket, der Abgleich
	// danach bekam 401 und schickte zur Anmeldung mit weiter auf die alte Seite, schneller als das Abmelden.
	for (const [ueberall, pfad] of [
		[false, '/demo/api/v1/abmelden'],
		[true, '/demo/api/v1/abmelden/alle'],
	] as const) {
		it(`haelt vor dem Abmelden an, ohne Abgleich und ohne weiter (ueberall: ${ueberall})`, async () => {
			bereite();
			const navigiere = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
			const s = verbinde();

			const fertig = TestBed.inject(MitgliedSitzung).abmelden('demo', ueberall);
			// Zu, bevor die Anfrage beantwortet ist; was der alte Socket danach meldet, zaehlt nicht mehr.
			expect(s.geschlossenMit).toBe(1000);
			s.brichAb(4401);
			http.expectNone(`${SYNC}?seit=5`);
			http.expectOne(pfad).flush(null, { status: 204, statusText: 'No Content' });
			await fertig;

			expect(navigiere).toHaveBeenCalledExactlyOnceWith('/demo/anmelden');
			vi.advanceTimersByTime(60_000);
			expect(FalscherSocket.alle.length).toBe(1);
			expect(echtzeit.getrennt()).toBe(false);
			http.expectNone(() => true);
		});
	}

	it('verbindet sich wieder, wenn das Abmelden scheitert', async () => {
		bereite();
		const navigiere = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
		const s = verbinde();

		const fertig = TestBed.inject(MitgliedSitzung).abmelden('demo');
		expect(s.geschlossenMit).toBe(1000);
		http.expectOne('/demo/api/v1/abmelden').flush({ fehler: 'kaputt' }, { status: 500, statusText: 'Error' });
		await expect(fertig).rejects.toMatchObject({ status: 500 });

		// Die Person bleibt angemeldet auf der Seite; ohne neuen Socket stuende sie still.
		expect(FalscherSocket.alle.length).toBe(2);
		zuletzt().oeffne();
		http.expectOne(SYNC).flush(antwort({ stand: 6, vollstaendig: true }));
		expect(echtzeit.verbunden()).toBe(true);
		expect(navigiere).not.toHaveBeenCalled();
	});

	it('bleibt verbunden, wenn sich jemand in einem anderen Verein abmeldet', async () => {
		bereite();
		vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
		const s = verbinde();

		const fertig = TestBed.inject(MitgliedSitzung).abmelden('anderer');
		http.expectOne('/anderer/api/v1/abmelden').flush(null, { status: 204, statusText: 'No Content' });
		await fertig;

		expect(s.geschlossenMit).toBeNull();
		expect(echtzeit.verbunden()).toBe(true);
	});

	it('gleicht beim Zurueckkommen in den Vordergrund ab und folgt dem Dokument', () => {
		bereite();
		verbinde();
		expect(echtzeit.vordergrund()).toBe(true);

		zeige('hidden');
		expect(echtzeit.vordergrund()).toBe(false);
		http.expectNone(() => true);

		zeige('visible');
		expect(echtzeit.vordergrund()).toBe(true);
		http.expectOne(`${SYNC}?seit=5`).flush(antwort({}));
	});

	it('verbindet sich beim Zurueckkommen in den Vordergrund sofort, wenn es getrennt ist', () => {
		bereite();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		verbinde();
		zuletzt().brichAb(1012);
		zeige('hidden');
		vi.advanceTimersByTime(500);
		expect(FalscherSocket.alle.length).toBe(1);

		zeige('visible');
		expect(FalscherSocket.alle.length).toBe(2);
		// Der geplante Versuch faellt weg.
		vi.advanceTimersByTime(5000);
		expect(FalscherSocket.alle.length).toBe(2);
	});
});

describe('betrifft', () => {
	const sig = (threadId: string | null): EchtzeitEreignis => ({ typ: 'signal', signal: signal({ threadId }) });

	it('trifft Signale des Threads und solche ohne Thread', () => {
		expect(betrifft(sig('t1'), 't1')).toBe(true);
		expect(betrifft(sig(null), 't1')).toBe(true);
		expect(betrifft(sig('t2'), 't1')).toBe(false);
	});

	it('trifft einen Abgleich, der den Thread in einer der Listen nennt', () => {
		expect(betrifft({ typ: 'sync', geaendert: ['t1'], unsichtbar: [] }, 't1')).toBe(true);
		expect(betrifft({ typ: 'sync', geaendert: [], unsichtbar: ['t1'] }, 't1')).toBe(true);
		expect(betrifft({ typ: 'sync', geaendert: ['t2'], unsichtbar: ['t3'] }, 't1')).toBe(false);
	});

	it('trifft "alles" immer', () => {
		expect(betrifft({ typ: 'alles' }, 't1')).toBe(true);
	});
});
