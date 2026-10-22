import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { adminTestAnbieter } from '../../admin/test-hilfen';
import { API, ichMit, oeffneSeite, stabil } from './test-hilfen';

const LEITUNG = [
	'MITGLIEDER',
	'THREADS_ERSTELLEN',
	'ALLE_THREADS',
	'DOKUMENTE',
	'ANTWORTEN_DETAIL',
	'JUGENDLEITER_RECHTE',
	'EINSTELLUNGEN',
];

const LISTE: [string, object][] = [
	['/personen', { personen: [] }],
	['/untergruppen', { untergruppen: [] }],
];

describe('Verwaltungs-Huelle', () => {
	beforeEach(() => TestBed.configureTestingModule({ providers: adminTestAnbieter() }));
	afterEach(() => {
		vi.unstubAllGlobals();
		TestBed.inject(HttpTestingController).verify();
	});

	function punkte(seite: HTMLElement): string[] {
		return [...seite.querySelectorAll('nav[aria-label="Verwaltung"] a')].map((a) => a.textContent?.trim() ?? '');
	}

	/** Gibt vor, das Fenster sei schmaler als 768 px; alles andere (etwa die Farbwahl) bleibt falsch. */
	function schmalesFenster(): void {
		vi.stubGlobal(
			'matchMedia',
			vi.fn((abfrage: string) => ({
				matches: abfrage.includes('max-width: 767px'),
				media: abfrage,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			})),
		);
	}

	it('zeigt der Leitung sechs Punkte und Zur App', async () => {
		const { seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);

		expect(punkte(seite)).toEqual([
			'Mitglieder',
			'Threads',
			'Dokumente',
			'Untergruppen',
			'Jugendleiter & Rechte',
			'Vereinseinstellungen',
			'Zur App',
		]);
		const href = (text: string) =>
			[...seite.querySelectorAll('nav a')].find((a) => a.textContent?.includes(text))?.getAttribute('href');
		expect(href('Mitglieder')).toBe('/demo/verwaltung');
		expect(href('Threads')).toBe('/demo/verwaltung/threads');
		expect(href('Dokumente')).toBe('/demo/verwaltung/dokumente');
		expect(href('Untergruppen')).toBe('/demo/verwaltung/untergruppen');
		expect(href('Jugendleiter & Rechte')).toBe('/demo/verwaltung/rechte');
		expect(href('Vereinseinstellungen')).toBe('/demo/verwaltung/einstellungen');
		expect(href('Zur App')).toBe('/demo');
	});

	it('zeigt Logo-Abzeichen und Namen mit dem Zusatz Verwaltung', async () => {
		const { seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);

		const marke = seite.querySelector('aside')?.textContent ?? '';
		expect(marke).toContain('Jungfischer Demo');
		expect(marke).toContain('Verwaltung');
		expect(seite.querySelector('aside .abzeichen')?.textContent?.trim()).toBe('JD');
	});

	it('zeigt einem Betreuer nur Mitglieder, Threads und Zur App und fragt keine Hinweise ab', async () => {
		const { seite, http } = await oeffneSeite('/demo/verwaltung', ichMit(['ANTWORTEN_DETAIL']), LISTE);

		expect(punkte(seite)).toEqual(['Mitglieder', 'Threads', 'Zur App']);
		http.expectNone(`${API}/verwaltung/hinweise`);
	});

	it('zeigt den Punkt Dokumente nur mit dem Recht DOKUMENTE', async () => {
		const mit = await oeffneSeite('/demo/verwaltung', ichMit(['DOKUMENTE']), LISTE);
		expect(punkte(mit.seite)).toEqual(['Mitglieder', 'Threads', 'Dokumente', 'Zur App']);
	});

	it('zeigt einem Jugendleiter ohne Einstellungen keinen Punkt dafuer', async () => {
		const { seite } = await oeffneSeite('/demo/verwaltung', ichMit(['MITGLIEDER', 'JUGENDLEITER_RECHTE']), LISTE);

		expect(punkte(seite)).toEqual(['Mitglieder', 'Threads', 'Untergruppen', 'Jugendleiter & Rechte', 'Zur App']);
	});

	it('zeigt einer Person ohne Rechte Nicht gefunden ohne Leiste und laedt nichts', async () => {
		const http = TestBed.inject(HttpTestingController);
		const harness = await RouterTestingHarness.create();
		const navigation = harness.navigateByUrl('/demo/verwaltung');
		await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit([])));
		await navigation;
		await vi.waitFor(() =>
			http
				.expectOne(`${API}/verein`)
				.flush({ slug: 'demo', anzeigename: 'Jungfischer Demo', farbe: '#1d4ed8', hatLogo: false }),
		);
		await stabil(harness);
		const seite = harness.routeNativeElement as HTMLElement;

		expect(seite.querySelector('jf-nicht-gefunden')).not.toBeNull();
		expect(seite.querySelector('nav')).toBeNull();
		expect(seite.querySelector('aside')).toBeNull();
		http.expectNone(`${API}/personen`);
		http.expectNone(`${API}/verwaltung/hinweise`);
	});

	describe('Menue unter 768 px', () => {
		it('zeigt die Navigation erst nach einem Klick auf den Menueknopf', async () => {
			schmalesFenster();
			const { harness, seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);
			const knopf = seite.querySelector<HTMLButtonElement>('aside button[aria-controls]');
			const nav = seite.querySelector<HTMLElement>('nav[aria-label="Verwaltung"]');

			expect(knopf?.getAttribute('aria-controls')).toBe(nav?.id);
			expect(knopf?.getAttribute('aria-expanded')).toBe('false');
			expect(nav?.hidden).toBe(true);

			knopf?.click();
			await stabil(harness);
			expect(knopf?.getAttribute('aria-expanded')).toBe('true');
			expect(nav?.hidden).toBe(false);

			knopf?.click();
			await stabil(harness);
			expect(knopf?.getAttribute('aria-expanded')).toBe('false');
			expect(nav?.hidden).toBe(true);
		});

		it('klappt das Menue nach einem Klick auf einen Punkt wieder zu', async () => {
			schmalesFenster();
			const { harness, seite, http } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);
			seite.querySelector<HTMLButtonElement>('aside button[aria-controls]')?.click();
			await stabil(harness);

			[...seite.querySelectorAll<HTMLAnchorElement>('nav a')]
				.find((a) => a.textContent?.includes('Untergruppen'))
				?.click();
			await vi.waitFor(() => http.expectOne(`${API}/untergruppen`).flush({ untergruppen: [] }));
			await stabil(harness);

			expect(seite.querySelector('aside button[aria-controls]')?.getAttribute('aria-expanded')).toBe('false');
			expect(seite.querySelector<HTMLElement>('nav[aria-label="Verwaltung"]')?.hidden).toBe(true);
		});

		it('setzt den Fokus nach einem Klick auf einen Punkt auf den Inhalt', async () => {
			schmalesFenster();
			const { harness, seite, http } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);
			seite.querySelector<HTMLButtonElement>('aside button[aria-controls]')?.click();
			await stabil(harness);

			[...seite.querySelectorAll<HTMLAnchorElement>('nav a')]
				.find((a) => a.textContent?.includes('Untergruppen'))
				?.click();
			await vi.waitFor(() => http.expectOne(`${API}/untergruppen`).flush({ untergruppen: [] }));
			await stabil(harness);

			const haupt = seite.querySelector('main');
			expect(haupt?.getAttribute('tabindex')).toBe('-1');
			expect(document.activeElement).toBe(haupt);
		});

		it('schliesst das offene Menue mit Escape und gibt dem Menueknopf den Fokus', async () => {
			schmalesFenster();
			const { harness, seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);
			const knopf = seite.querySelector<HTMLButtonElement>('aside button[aria-controls]');
			knopf?.click();
			await stabil(harness);
			expect(knopf?.getAttribute('aria-expanded')).toBe('true');

			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			await stabil(harness);

			expect(knopf?.getAttribute('aria-expanded')).toBe('false');
			expect(seite.querySelector<HTMLElement>('nav[aria-label="Verwaltung"]')?.hidden).toBe(true);
			expect(document.activeElement).toBe(knopf);
		});

		it('laesst bei geschlossenem Menue den Fokus bei Escape in Ruhe', async () => {
			schmalesFenster();
			const { harness, seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);
			const feld = seite.querySelector<HTMLElement>('input[name="suche"]');
			feld?.focus();

			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			await stabil(harness);

			expect(document.activeElement).toBe(feld);
		});

		it('zeigt den Hinweis Am Desktop bequemer nur hier', async () => {
			schmalesFenster();
			const { seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);
			expect(seite.textContent).toContain('Am Desktop bequemer');
		});
	});

	it('hat am Desktop weder Menueknopf noch Desktop-Hinweis, und die Navigation ist sichtbar', async () => {
		const { seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);

		expect(seite.querySelector('aside button[aria-controls]')).toBeNull();
		expect(seite.querySelector<HTMLElement>('nav[aria-label="Verwaltung"]')?.hidden).toBe(false);
		expect(seite.textContent).not.toContain('Am Desktop bequemer');
	});

	describe('Notfall-Link-Hinweise', () => {
		it('zeigt je Link einen Hinweis mit Datum in Berliner Zeit und Vornamen', async () => {
			const { seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE, {
				notfallLinks: [
					{ am: '2026-10-12T10:00:00.000Z', vorname: 'Anna', nachname: 'Muster' },
					// 23:30 UTC ist in Berlin schon der naechste Tag.
					{ am: '2026-10-09T23:30:00.000Z', vorname: null, nachname: null },
				],
			});

			const hinweise = [...seite.querySelectorAll('main > [role="status"]')].map((e) =>
				e.textContent?.replace(/\s+/g, ' ').trim(),
			);
			expect(hinweise).toEqual([
				'Der Plattform-Admin hat am 12.10.2026 einen neuen Link für Anna erzeugt.',
				'Der Plattform-Admin hat am 10.10.2026 einen neuen Link für ein ehemaliges Mitglied erzeugt.',
			]);
		});

		it('zeigt ohne Notfall-Links keinen Hinweis', async () => {
			const { seite } = await oeffneSeite('/demo/verwaltung', ichMit(LEITUNG), LISTE);
			expect(seite.textContent).not.toContain('Plattform-Admin');
		});

		it('schickt bei abgelaufener Sitzung zur Anmeldung', async () => {
			const http = TestBed.inject(HttpTestingController);
			const harness = await RouterTestingHarness.create();
			const navigation = harness.navigateByUrl('/demo/verwaltung');
			await vi.waitFor(() => http.expectOne(`${API}/ich`).flush(ichMit(LEITUNG)));
			await navigation;
			await vi.waitFor(() =>
				http
					.expectOne(`${API}/verwaltung/hinweise`)
					.flush({ fehler: 'nicht angemeldet' }, { status: 401, statusText: 'Unauthorized' }),
			);
			await vi.waitFor(() => expect(TestBed.inject(Router).url).toContain('/demo/anmelden'));
			// Offene Anfragen von Seite und Kopf gehoeren nicht zu diesem Test.
			http.match(() => true);
		});
	});

	it('zeigt auf /demo/verwaltung/personen/x die Personenseite in der Huelle, Mitglieder aktiv', async () => {
		const { seite } = await oeffneSeite('/demo/verwaltung/personen/x', ichMit(['MITGLIEDER']), [
			[
				'/personen/x',
				{
					id: 'x',
					art: 'ERWACHSENER',
					vorname: 'Anna',
					nachname: 'Muster',
					geburtsdatum: null,
					jugendsprecher: false,
					rechte: [],
					untergruppen: [],
					warnhinweise: [],
					familie: [],
				},
			],
		]);

		expect(seite.querySelector('main jf-personenseite')).not.toBeNull();
		// Der Name der Person ist die Seitenueberschrift; der Vereinsname steht schon in der Leiste.
		expect([...seite.querySelectorAll('h1')].map((h) => h.textContent?.trim())).toEqual(['Anna Muster']);
		expect(seite.querySelectorAll('main').length).toBe(1);
		const aktiv = [...seite.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent?.trim());
		expect(aktiv).toEqual(['Mitglieder']);
		// Der Weg zurueck bleibt auf der Personenseite, die Huelle bietet ihn nicht an.
		expect(seite.textContent).toContain('← Zur Mitgliederliste');
	});

	it.each([
		['/demo/verwaltung/untergruppen', 'Untergruppen', [['/untergruppen', { untergruppen: [] }]]],
		[
			'/demo/verwaltung/threads',
			'Threads',
			[['/verwaltung/threads', { threads: [], untergruppen: [], darfErstellen: true }]],
		],
	] as [string, string, [string, object][]][])('macht auf %s den Punkt %s aktiv', async (url, text, daten) => {
		const { seite } = await oeffneSeite(url, ichMit(['MITGLIEDER']), daten);

		const aktiv = [...seite.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent?.trim());
		expect(aktiv).toEqual([text]);
		expect(seite.querySelectorAll('main').length).toBe(1);
		expect(seite.textContent).not.toContain('Zur Mitgliederliste');
	});

	it('macht auf dokumente den Punkt Dokumente aktiv', async () => {
		const { seite } = await oeffneSeite('/demo/verwaltung/dokumente', ichMit(['DOKUMENTE']), [
			['/dokumente', { kategorien: [], darfPflegen: true }],
			['/speicher', { verbrauchBytes: 0, grenzeMb: 5120 }],
		]);

		const aktiv = [...seite.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent?.trim());
		expect(aktiv).toEqual(['Dokumente']);
	});

	it('macht auf threads/:id/antworten den Punkt Threads aktiv', async () => {
		const { seite } = await oeffneSeite('/demo/verwaltung/threads/t1/antworten', ichMit(['MITGLIEDER']), [
			[
				'/threads/t1/antworten',
				{ threadId: 't1', segment: 't1-x', titel: 'X', darfNachtragen: false, umfragen: [], helfer: [] },
			],
		]);

		const aktiv = [...seite.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent?.trim());
		expect(aktiv).toEqual(['Threads']);
	});

	// Die Leiste nennt den Verein schon; jede Seite hat darum eine eigene Ueberschrift mit ihrem Namen (Ruling R8).
	it.each([
		['/demo/verwaltung', 'Mitglieder', LISTE],
		['/demo/verwaltung/neu', 'Person anlegen', [['/untergruppen', { untergruppen: [] }]]],
		['/demo/verwaltung/untergruppen', 'Untergruppen', [['/untergruppen', { untergruppen: [] }]]],
		[
			'/demo/verwaltung/threads',
			'Threads',
			[['/verwaltung/threads', { threads: [], untergruppen: [], darfErstellen: true }]],
		],
		['/demo/verwaltung/rechte', 'Jugendleiter & Rechte', [['/personen', { personen: [] }]]],
		[
			'/demo/verwaltung/dokumente',
			'Dokumente',
			[
				['/dokumente', { kategorien: [], darfPflegen: true }],
				['/speicher', { verbrauchBytes: 0, grenzeMb: 5120 }],
			],
		],
	] as [string, string, [string, object][]][])('hat auf %s genau die Ueberschrift %s', async (url, titel, daten) => {
		const { seite } = await oeffneSeite(url, ichMit(LEITUNG), daten);

		expect([...seite.querySelectorAll('h1')].map((h) => h.textContent?.trim())).toEqual([titel]);
		expect(seite.querySelector('jf-verein-kopf')).toBeNull();
	});
});
