import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import type { VerwaltungListe, VerwaltungThread } from '@jufi/domain';
import { adminTestAnbieter, knopf } from '../../../admin/test-hilfen';
import { API, ichMit, oeffneAbgelaufen, oeffneSeite, stabil } from '../test-hilfen';

function thread(rest: Partial<VerwaltungThread> & { id: string; titel: string }): VerwaltungThread {
	return {
		segment: `${rest.id}-${rest.titel.toLowerCase()}`,
		art: 'NORMAL',
		entwurf: false,
		archiviert: false,
		angepinnt: false,
		zielgruppe: 'Alle · Jungfischer + Familie',
		keineZielgruppe: false,
		naechsterTermin: null,
		darfBearbeiten: true,
		hatUmfrage: false,
		...rest,
	};
}

const LISTE: VerwaltungListe = {
	threads: [
		thread({ id: 't-entwurf', titel: 'Entwurf', entwurf: true }),
		thread({
			id: 't-leer',
			titel: 'Verwaist',
			entwurf: true,
			zielgruppe: 'Keine Zielgruppe mehr',
			keineZielgruppe: true,
		}),
		thread({ id: 't-normal', titel: 'Hallo', darfBearbeiten: false }),
		thread({
			id: 't-pin',
			titel: 'Zeltlager',
			angepinnt: true,
			hatUmfrage: true,
			naechsterTermin: 'Sa., 12.09. · 10:00',
			zielgruppe: 'Gruppe A · Nur Familie',
		}),
		thread({ id: 't-alt', titel: 'Fruehling', archiviert: true }),
	],
	untergruppen: [{ id: 'u1', name: 'Gruppe A' }],
	darfErstellen: true,
};

describe('Thread-Liste der Verwaltung', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function oeffne(liste: VerwaltungListe = LISTE, rechte = ['THREADS_ERSTELLEN']) {
		const r = await oeffneSeite('/demo/verwaltung/threads', ichMit(rechte), [['/verwaltung/threads', liste]]);
		return {
			...r,
			abschnitt: (titel: string) =>
				[...r.seite.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.trim() === titel),
			titel: (wurzel: ParentNode | undefined) =>
				[...(wurzel?.querySelectorAll('[data-thread] .titel') ?? [])].map((e) => e.textContent?.trim()),
		};
	}

	it('gliedert in Entwuerfe und Aktiv, Angepinnte zuerst, das Archiv ist eingeklappt', async () => {
		const { abschnitt, titel, seite } = await oeffne();
		expect(titel(abschnitt('Entwürfe'))).toEqual(['Entwurf', 'Verwaist']);
		expect(titel(abschnitt('Aktiv'))).toEqual(['Zeltlager', 'Hallo']);
		expect(abschnitt('Archiv')).toBeUndefined();
		expect(knopf(seite, 'Archiv zeigen (1)')).toBeTruthy();
		expect(seite.textContent).not.toContain('Fruehling');
	});

	it('zeigt das Archiv erst nach dem Klick', async () => {
		const { harness, abschnitt, titel, seite } = await oeffne();
		knopf(seite, 'Archiv zeigen (1)').click();
		await stabil(harness);
		expect(titel(abschnitt('Archiv'))).toEqual(['Fruehling']);
		expect(knopf(seite, 'Archiv verbergen (1)')).toBeTruthy();
	});

	it('zeigt Pin-Symbol, Zielgruppe und naechsten Termin', async () => {
		const { seite } = await oeffne();
		const pin = seite.querySelector('[data-thread="t-pin"]');
		expect(pin?.querySelector('jf-icon[name="pin"]')).toBeTruthy();
		expect(pin?.textContent).toContain('Gruppe A · Nur Familie');
		expect(pin?.textContent).toContain('Sa., 12.09. · 10:00');
		expect(seite.querySelector('[data-thread="t-normal"] jf-icon[name="pin"]')).toBeNull();
	});

	it('warnt bei Keine Zielgruppe mehr', async () => {
		const { seite } = await oeffne();
		const zeile = seite.querySelector('[data-thread="t-leer"]');
		expect(zeile?.querySelector('.warnung')?.textContent).toContain('Keine Zielgruppe mehr');
		expect(seite.querySelector('[data-thread="t-entwurf"] .warnung')).toBeNull();
	});

	it('verlinkt den Titel in den Editor, ohne Bearbeitungsrecht in den Thread', async () => {
		const { seite } = await oeffne();
		const href = (id: string) => seite.querySelector(`[data-thread="${id}"] a.titel`)?.getAttribute('href');
		expect(href('t-pin')).toBe('/demo/verwaltung/threads/t-pin');
		expect(href('t-normal')).toBe('/demo/t/t-normal-hallo');
	});

	it('hat den Antworten-Link nur bei einer Umfrage', async () => {
		const { seite } = await oeffne();
		const antworten = (id: string) =>
			seite.querySelector(`[data-thread="${id}"] a.antworten`)?.getAttribute('href') ?? null;
		expect(antworten('t-pin')).toBe('/demo/verwaltung/threads/t-pin/antworten');
		expect(antworten('t-normal')).toBeNull();
	});

	it('zeigt Neuer Thread mit darfErstellen und verlinkt in den Editor', async () => {
		const { seite } = await oeffne();
		expect(seite.querySelector('a[href="/demo/verwaltung/threads/neu"]')?.textContent).toContain('Neuer Thread');
	});

	it('zeigt ohne darfErstellen kein Neuer Thread', async () => {
		const { seite } = await oeffne({ ...LISTE, darfErstellen: false }, ['ANTWORTEN_DETAIL']);
		expect(seite.querySelector('a[href="/demo/verwaltung/threads/neu"]')).toBeNull();
		expect(seite.textContent).toContain('Hallo');
	});

	it('sagt bei einem leeren Verein, dass es noch keine Threads gibt', async () => {
		const { seite } = await oeffne({ ...LISTE, threads: [] });
		expect(seite.textContent).toContain('Noch keine Threads');
	});

	it('zeigt bei 404 Nicht gefunden oder keine Berechtigung und kann neu laden', async () => {
		const http = TestBed.inject(HttpTestingController);
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/verwaltung/threads');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(['ANTWORTEN_DETAIL'])));
		await navigation;
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/verwaltung/threads`)
				.flush({ fehler: 'nicht gefunden' }, { status: 404, statusText: 'Not Found' }),
		);
		await vi.waitFor(() =>
			http.expectOne(`${API}/verein`).flush({ slug: 'demo', anzeigename: 'Demo', farbe: '#1d4ed8', hatLogo: false }),
		);
		await stabil(harness);
		const seite = harness.routeNativeElement as HTMLElement;
		expect(seite.querySelector('[role="alert"]')?.textContent).toContain('Nicht gefunden oder keine Berechtigung');
		expect(seite.querySelector('[data-thread]')).toBeNull();

		knopf(seite, 'Nochmal versuchen').click();
		await vi.waitFor(() => http.expectOne(`${API}/verwaltung/threads`).flush(LISTE));
		await stabil(harness);
		expect(seite.querySelector('[role="alert"]')).toBeNull();
		expect(seite.textContent).toContain('Zeltlager');
	});

	it('ein abgelaufenes Login beim Laden fuehrt zur Anmeldung', async () => {
		await oeffneAbgelaufen('/demo/verwaltung/threads', ['THREADS_ERSTELLEN'], '/verwaltung/threads');
	});
});
