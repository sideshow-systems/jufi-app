import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { AntwortenUebersicht, UmfrageUebersicht } from '@jufi/domain';
import { adminTestAnbieter, knopf } from '../../../admin/test-hilfen';
import { API, ichMit, oeffneAbgelaufen, oeffneSeite, stabil } from '../test-hilfen';

const UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const BOWLING: UmfrageUebersicht = {
	modulId: 'm-umfrage',
	frage: 'Kommst du mit?',
	frist: '2099-10-22T16:00:00.000Z',
	fristAbgelaufen: false,
	mehrfach: false,
	teilnahme: true,
	optionen: [
		{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
		{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
		{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
	],
	zeilen: [
		{ fuerId: 'k-lena', name: 'Lena', optionIds: ['o-dabei'], eingetragenVon: null },
		{ fuerId: 'k-max', name: 'Max', optionIds: ['o-dabei'], eingetragenVon: 'Thomas' },
		{ fuerId: 'k-anna', name: 'Anna', optionIds: ['o-abgesagt'], eingetragenVon: null },
		{ fuerId: 'k-tom', name: 'Tom', optionIds: [], eingetragenVon: null },
	],
	offen: 1,
};

function uebersicht(rest: Partial<AntwortenUebersicht> = {}): AntwortenUebersicht {
	return {
		threadId: 't1',
		segment: 't1-bowling',
		titel: '🎳 Bowling',
		darfNachtragen: true,
		umfragen: [BOWLING],
		...rest,
	};
}

describe('Antworten-Uebersicht der Verwaltung', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => {
		TestBed.inject(HttpTestingController).verify();
		vi.restoreAllMocks();
	});

	async function oeffne(u: AntwortenUebersicht = uebersicht()) {
		const r = await oeffneSeite('/demo/verwaltung/threads/t1/antworten', ichMit(['ANTWORTEN_DETAIL']), [
			['/threads/t1/antworten', u],
		]);
		const zeile = (name: string) =>
			[...r.seite.querySelectorAll<HTMLElement>('li.person')].find(
				(li) => li.querySelector('.name')?.textContent === name,
			);
		const namen = (gruppe: string) =>
			[...r.seite.querySelectorAll(`[data-gruppe="${gruppe}"] li.person .name`)].map((e) => e.textContent?.trim());
		return { ...r, zeile, namen };
	}

	it('zeigt Frage, Frist und je Option die Namen mit Anzahl', async () => {
		const { seite, namen } = await oeffne();
		expect(seite.querySelector('h1')?.textContent).toContain('Bowling');
		expect(seite.textContent).toContain('Kommst du mit?');
		expect(seite.textContent).toMatch(/Frist|bis /);
		expect(seite.querySelector('[data-gruppe="o-dabei"] h3')?.textContent?.trim()).toBe('✓ Dabei (2)');
		expect(seite.querySelector('[data-gruppe="o-abgesagt"] h3')?.textContent?.trim()).toBe('✗ Abgesagt (1)');
		expect(seite.querySelector('[data-gruppe="o-vielleicht"] h3')?.textContent?.trim()).toBe('? Vielleicht (0)');
		expect(namen('o-dabei')).toEqual(['Lena', 'Max']);
		expect(namen('o-abgesagt')).toEqual(['Anna']);
		expect(namen('o-vielleicht')).toEqual([]);
	});

	it('zeigt Noch offen (1) mit den Namen', async () => {
		const { seite, namen } = await oeffne();
		expect(seite.querySelector('[data-gruppe="offen"] h3')?.textContent?.trim()).toBe('Noch offen (1)');
		expect(namen('offen')).toEqual(['Tom']);
	});

	it('vermerkt, wer eine Antwort eingetragen hat, auch bei einer leeren', async () => {
		const leer: UmfrageUebersicht = {
			...BOWLING,
			zeilen: [{ fuerId: 'k-tom', name: 'Tom', optionIds: [], eingetragenVon: 'Thomas' }],
			offen: 1,
		};
		const { seite, zeile } = await oeffne(uebersicht({ umfragen: [leer] }));
		expect(zeile('Tom')?.textContent).toContain('eingetragen von Thomas');
		// Wer selbst geantwortet hat, traegt keinen Vermerk.
		expect(seite.textContent).not.toContain('eingetragen von Lena');
	});

	it('vermerkt bei Max, dass Thomas ihn eingetragen hat, bei Lena nichts', async () => {
		const { zeile } = await oeffne();
		expect(zeile('Max')?.textContent).toContain('eingetragen von Thomas');
		expect(zeile('Lena')?.textContent).not.toContain('eingetragen von');
	});

	it('hat ohne darfNachtragen kein Eintragen', async () => {
		const { seite } = await oeffne(uebersicht({ darfNachtragen: false }));
		expect(seite.textContent).toContain('Lena');
		expect(() => knopf(seite, 'Eintragen')).toThrow();
	});

	it('klappt Eintragen nur fuer die eine Zeile auf und die naechste die vorige zu', async () => {
		const { harness, seite, zeile } = await oeffne();
		expect(seite.querySelector('.optionen')).toBeNull();

		knopf(zeile('Tom')!, 'Eintragen').click();
		await stabil(harness);
		expect(zeile('Tom')?.querySelectorAll('.optionen button').length).toBe(3);
		expect(seite.querySelectorAll('.optionen').length).toBe(1);

		knopf(zeile('Lena')!, 'Eintragen').click();
		await stabil(harness);
		expect(zeile('Tom')?.querySelector('.optionen')).toBeNull();
		expect(zeile('Lena')?.querySelectorAll('.optionen button').length).toBe(3);
		expect(seite.querySelectorAll('.optionen').length).toBe(1);
	});

	it('traegt mit Eintragen und einer Option nach und laedt danach neu', async () => {
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(UUID);
		const { harness, http, seite, zeile } = await oeffne();
		knopf(zeile('Tom')!, 'Eintragen').click();
		await stabil(harness);
		knopf(zeile('Tom')!, '✗ Abgesagt').click();

		await vi.waitFor(() => {
			const anfrage = http.expectOne(`${API}/umfragen/m-umfrage/antworten/k-tom`);
			expect(anfrage.request.method).toBe('PUT');
			expect(anfrage.request.body).toEqual({ optionIds: ['o-abgesagt'], clientId: UUID });
			anfrage.flush({ modul: {}, stand: 7 });
		});

		const neu: UmfrageUebersicht = {
			...BOWLING,
			zeilen: BOWLING.zeilen.map((z) =>
				z.fuerId === 'k-tom' ? { ...z, optionIds: ['o-abgesagt'], eingetragenVon: 'Thomas' } : z,
			),
			offen: 0,
		};
		await vi.waitFor(() => http.expectOne(`${API}/threads/t1/antworten`).flush(uebersicht({ umfragen: [neu] })));
		await stabil(harness);

		expect(seite.querySelector('[data-gruppe="offen"]')).toBeNull();
		expect(seite.querySelector('[data-gruppe="o-abgesagt"] h3')?.textContent?.trim()).toBe('✗ Abgesagt (2)');
		expect(seite.querySelector('.optionen')).toBeNull();
	});

	it('schickt auch bei mehrfach nur die eine angetippte Option', async () => {
		const mehrfach: UmfrageUebersicht = {
			...BOWLING,
			mehrfach: true,
			teilnahme: false,
			optionen: [
				{ id: 'o-a', schluessel: 'a', text: 'Samstag' },
				{ id: 'o-b', schluessel: 'b', text: 'Sonntag' },
			],
			zeilen: [{ fuerId: 'k-tom', name: 'Tom', optionIds: [], eingetragenVon: null }],
			offen: 1,
		};
		const { harness, http, zeile } = await oeffne(uebersicht({ umfragen: [mehrfach] }));
		knopf(zeile('Tom')!, 'Eintragen').click();
		await stabil(harness);
		knopf(zeile('Tom')!, 'Sonntag').click();
		await vi.waitFor(() => {
			const anfrage = http.expectOne(`${API}/umfragen/m-umfrage/antworten/k-tom`);
			expect(anfrage.request.body).toMatchObject({ optionIds: ['o-b'] });
			anfrage.flush({ modul: {}, stand: 7 });
		});
		await vi.waitFor(() => http.expectOne(`${API}/threads/t1/antworten`).flush(uebersicht({ umfragen: [mehrfach] })));
		await stabil(harness);
	});

	it('zeigt einen Fehler beim Nachtragen und laesst die Optionen offen', async () => {
		const { harness, http, seite, zeile } = await oeffne();
		knopf(zeile('Tom')!, 'Eintragen').click();
		await stabil(harness);
		knopf(zeile('Tom')!, '✓ Dabei').click();
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/umfragen/m-umfrage/antworten/k-tom`)
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
		);
		await stabil(harness);
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		expect(zeile('Tom')?.querySelector('.optionen')).not.toBeNull();
	});

	it('sagt bei einem Thread ohne Umfrage, dass es nichts zu sehen gibt', async () => {
		const { seite } = await oeffne(uebersicht({ umfragen: [] }));
		expect(seite.textContent).toContain('keine Umfrage');
		expect(seite.querySelector('[data-gruppe]')).toBeNull();
	});

	it('zeigt bei 404 Nicht gefunden oder keine Berechtigung und kann neu laden', async () => {
		const http = TestBed.inject(HttpTestingController);
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/verwaltung/threads/t1/antworten');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(['ANTWORTEN_DETAIL'])));
		await navigation;
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/threads/t1/antworten`)
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
		);
		await vi.waitFor(() =>
			http.expectOne(`${API}/verein`).flush({ slug: 'demo', anzeigename: 'Demo', farbe: '#1d4ed8', hatLogo: false }),
		);
		await stabil(harness);
		const seite = harness.routeNativeElement as HTMLElement;
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Nicht gefunden oder keine Berechtigung');

		knopf(seite, 'Nochmal versuchen').click();
		await vi.waitFor(() => http.expectOne(`${API}/threads/t1/antworten`).flush(uebersicht()));
		await stabil(harness);
		expect(seite.querySelector('[role="alert"]')).toBeNull();
		expect(seite.textContent).toContain('Kommst du mit?');
	});

	it('ein abgelaufenes Login beim Laden fuehrt zur Anmeldung', async () => {
		await oeffneAbgelaufen('/demo/verwaltung/threads/t1/antworten', ['ANTWORTEN_DETAIL'], '/threads/t1/antworten');
	});
});
