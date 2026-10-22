import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ThreadEntwurf, UmfrageAnsicht } from '@jufi/domain';
import { ThreadVorschauComponent, vorschauModule } from './vorschau';

// Bowling aus Spec 1.1: Info, Termin und die Teilnahme-Umfrage, das gespeicherte Modul mit ID.
function bowling(): ThreadEntwurf {
	return {
		titel: '🎳 Bowling',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		alleUntergruppen: true,
		untergruppenIds: [],
		module: [
			{ typ: 'INFO', id: 'm-info', titel: null, text: 'Wir treffen uns an der Bahn.' },
			{
				typ: 'TERMIN',
				id: null,
				titel: 'Bahn 3',
				termin: {
					startDatum: '2026-10-24',
					endDatum: null,
					beginn: '18:00',
					ende: '20:00',
					ort: 'Bowlingcenter',
					treffpunkt: null,
				},
			},
			{
				typ: 'UMFRAGE',
				id: 'm-umfrage',
				titel: null,
				frage: 'Kommst du mit?',
				einheit: 'JUNGFISCHER',
				mehrfach: false,
				teilnahme: true,
				vielleicht: true,
				frist: '2026-10-22T16:00:00.000Z',
				ergebnisse: 'ALLE',
				optionen: [
					{ schluessel: 'dabei', text: 'Dabei' },
					{ schluessel: 'vielleicht', text: 'Vielleicht' },
					{ schluessel: 'abgesagt', text: 'Abgesagt' },
				],
			},
		],
	};
}

const VORHER = new Date('2026-10-22T10:00:00Z');
const NACHHER = new Date('2026-10-22T16:00:00Z');

describe('vorschauModule', () => {
	it('macht aus dem Bowling-Entwurf drei Module mit Ersatz-IDs', () => {
		const m = vorschauModule(bowling(), VORHER);
		expect(m.map((x) => [x.typ, x.id])).toEqual([
			['INFO', 'vorschau-0'],
			['TERMIN', 'vorschau-1'],
			['UMFRAGE', 'vorschau-2'],
		]);
		expect(m[0]).toEqual({ typ: 'INFO', id: 'vorschau-0', titel: null, text: 'Wir treffen uns an der Bahn.' });
		expect(m[1]).toEqual({
			typ: 'TERMIN',
			id: 'vorschau-1',
			titel: 'Bahn 3',
			termin: {
				modulId: 'vorschau-1',
				startDatum: '2026-10-24',
				endDatum: null,
				beginn: '18:00',
				ende: '20:00',
				ort: 'Bowlingcenter',
				treffpunkt: null,
			},
		});
	});

	it('zeigt die Umfrage ohne Zeilen und Ergebnis, mit Frist als ISO und Ersatz-IDs der Optionen', () => {
		const u = vorschauModule(bowling(), VORHER)[2] as UmfrageAnsicht;
		expect(u).toEqual({
			typ: 'UMFRAGE',
			id: 'vorschau-2',
			titel: null,
			frage: 'Kommst du mit?',
			einheit: 'JUNGFISCHER',
			mehrfach: false,
			teilnahme: true,
			frist: '2026-10-22T16:00:00.000Z',
			fristAbgelaufen: false,
			optionen: [
				{ id: 'vorschau-2-0', schluessel: 'dabei', text: 'Dabei' },
				{ id: 'vorschau-2-1', schluessel: 'vielleicht', text: 'Vielleicht' },
				{ id: 'vorschau-2-2', schluessel: 'abgesagt', text: 'Abgesagt' },
			],
			zeilen: [],
			ergebnis: null,
		});
	});

	it('rechnet fristAbgelaufen nach jetzt, ab dem Zeitpunkt der Frist', () => {
		expect((vorschauModule(bowling(), NACHHER)[2] as UmfrageAnsicht).fristAbgelaufen).toBe(true);
	});

	it('gibt neuen Optionen ohne Schluessel einen leeren Schluessel', () => {
		const e = bowling();
		e.module[2] = {
			...(e.module[2] as Extract<ThreadEntwurf['module'][number], { typ: 'UMFRAGE' }>),
			teilnahme: false,
			frist: null,
			optionen: [
				{ schluessel: null, text: 'Pizza' },
				{ schluessel: 'o12345678', text: 'Pasta' },
			],
		};
		const u = vorschauModule(e, VORHER)[2] as UmfrageAnsicht;
		expect(u.fristAbgelaufen).toBe(false);
		expect(u.optionen.map((o) => o.schluessel)).toEqual(['', 'o12345678']);
	});
});

describe('Thread-Vorschau', () => {
	beforeEach(() =>
		TestBed.configureTestingModule({
			providers: [provideRouter([]), provideHttpClient(withFetch()), provideHttpClientTesting()],
		}),
	);
	// Die Vorschau ruft nie die API, auch nicht ueber die Bauteile der Thread-Seite.
	afterEach(() => TestBed.inject(HttpTestingController).verify());

	async function zeige(markiert: number | null = null) {
		const fixture = TestBed.createComponent(ThreadVorschauComponent);
		fixture.componentRef.setInput('entwurf', bowling());
		fixture.componentRef.setInput('zielgruppe', 'Alle · Jungfischer + Familie');
		fixture.componentRef.setInput('markiert', markiert);
		const gewaehlt: number[] = [];
		fixture.componentInstance.waehle.subscribe((i) => gewaehlt.push(i));
		fixture.detectChanges();
		await fixture.whenStable();
		fixture.detectChanges();
		const el = fixture.nativeElement as HTMLElement;
		return { fixture, el, gewaehlt, karten: () => [...el.querySelectorAll<HTMLElement>('.karte')] };
	}

	it('zeigt Titel, Zielgruppe und je Modul eine Karte mit dem Bauteil der Thread-Seite', async () => {
		const { el, karten } = await zeige();
		expect(el.querySelector('.kopf')?.textContent).toContain('🎳 Bowling');
		expect(el.querySelector('.kopf')?.textContent).toContain('Alle · Jungfischer + Familie');
		const k = karten();
		expect(k).toHaveLength(3);
		expect(k[0]?.querySelector('jf-info-modul')).toBeTruthy();
		expect(k[1]?.querySelector('jf-termin-modul')?.textContent).toContain('Bowlingcenter');
		expect(k[2]?.querySelector('jf-umfrage-modul')?.textContent).toContain('Kommst du mit?');
	});

	it('zeigt Datei- und Foto-Modul mit leeren Listen, ohne Upload und ohne Hinweis', async () => {
		const fixture = TestBed.createComponent(ThreadVorschauComponent);
		const e = bowling();
		e.module = [
			{ typ: 'DATEIEN', id: null, titel: null },
			{ typ: 'FOTOS', id: 'm-fotos', titel: 'Zeltlager', hochladen: 'ALLE' },
		];
		fixture.componentRef.setInput('entwurf', e);
		fixture.componentRef.setInput('zielgruppe', 'Alle');
		fixture.componentRef.setInput('markiert', null);
		fixture.detectChanges();
		await fixture.whenStable();
		const el = fixture.nativeElement as HTMLElement;
		const karten = [...el.querySelectorAll<HTMLElement>('.karte')];

		expect(karten[0]?.querySelector('jf-dateien-modul')?.textContent).toContain('Noch keine Dateien.');
		expect(karten[1]?.querySelector('jf-fotos-modul')?.textContent).toContain('Zeltlager');
		expect(karten[1]?.textContent).toContain('Noch keine Fotos.');
		expect(el.querySelector('jf-hochladen-feld')).toBeNull();
		expect(el.querySelector('.hinweis')).toBeNull();
		expect(el.querySelector('img')).toBeNull();
	});

	it('zeigt die Antworten der Umfrage, aber man kann nicht abstimmen', async () => {
		const { karten } = await zeige();
		const knoepfe = [...(karten()[2]?.querySelectorAll<HTMLButtonElement>('jf-umfrage-modul button') ?? [])];
		expect(knoepfe.map((b) => b.textContent?.trim())).toEqual(['✓ Dabei', '? Vielleicht', '✗ Abgesagt']);
		expect(knoepfe.every((b) => b.disabled)).toBe(true);
	});

	it('zeigt die Helferliste mit ihren Positionen, ohne Knoepfe', async () => {
		const fixture = TestBed.createComponent(ThreadVorschauComponent);
		const e = bowling();
		e.module = [
			{
				typ: 'HELFER',
				id: null,
				titel: null,
				einheit: 'JUNGFISCHER',
				frist: null,
				positionen: [{ schluessel: null, text: 'Kuchen', anzahl: 4 }],
			},
		];
		fixture.componentRef.setInput('entwurf', e);
		fixture.componentRef.setInput('zielgruppe', 'Alle');
		fixture.componentRef.setInput('markiert', null);
		fixture.detectChanges();
		await fixture.whenStable();
		const el = fixture.nativeElement as HTMLElement;

		expect(el.querySelector('.karte jf-helfer-modul')?.textContent).toContain('Kuchen');
		expect(el.querySelector('.karte jf-helfer-modul')?.textContent).toContain('0/4');
		expect(el.querySelector('jf-helfer-modul button')).toBeNull();
	});

	it('macht den Inhalt der Karten inert, damit Tippen nur waehlt', async () => {
		const { karten } = await zeige();
		expect(karten().every((k) => k.querySelector(':scope > .inhalt')?.hasAttribute('inert'))).toBe(true);
	});

	it('hebt das markierte Modul hervor', async () => {
		const { karten } = await zeige(1);
		expect(karten().map((k) => k.classList.contains('markiert'))).toEqual([false, true, false]);
		expect(karten()[1]?.getAttribute('aria-current')).toBe('true');
		expect(karten()[0]?.getAttribute('aria-current')).toBeNull();
	});

	it('meldet beim Tippen und mit Enter oder Leertaste das Modul', async () => {
		const { karten, gewaehlt } = await zeige();
		karten()[2]?.click();
		karten()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		karten()[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		expect(gewaehlt).toEqual([2, 0, 1]);
	});

	it('nennt einen Thread ohne Titel und ohne Module', async () => {
		const fixture = TestBed.createComponent(ThreadVorschauComponent);
		fixture.componentRef.setInput('entwurf', { ...bowling(), titel: '  ', module: [] });
		fixture.componentRef.setInput('zielgruppe', 'Alle · Nur Familie');
		fixture.componentRef.setInput('markiert', null);
		fixture.detectChanges();
		const el = fixture.nativeElement as HTMLElement;
		expect(el.querySelector('.kopf')?.textContent).toContain('Ohne Titel');
		expect(el.textContent).toContain('Noch keine Module.');
	});
});
