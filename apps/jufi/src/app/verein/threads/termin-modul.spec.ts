import { TestBed } from '@angular/core/testing';
import { geraetAus, kartenLink, type ModulAnsicht, type TerminDaten, terminZeit, threadSegment } from '@jufi/domain';
import { TerminModul } from './termin-modul';

type Termin = Extract<ModulAnsicht, { typ: 'TERMIN' }>;

const TERMIN: TerminDaten = {
	modulId: 'm2',
	startDatum: '2026-11-07',
	endDatum: null,
	beginn: '14:00',
	ende: '17:00',
	ort: 'Bowlingcenter Musterstadt',
	treffpunkt: 'Parkplatz am Vereinsheim',
};

const MODUL: Termin = { typ: 'TERMIN', id: 'm2', titel: 'Wann und wo', termin: TERMIN };
const THREAD = { id: 'ck1', titel: '🎳 Bowling' };

function zeige(modul: Termin = MODUL): { el: HTMLElement; aktualisiere: () => void } {
	const fixture = TestBed.createComponent(TerminModul);
	fixture.componentRef.setInput('modul', modul);
	fixture.componentRef.setInput('thread', THREAD);
	fixture.componentRef.setInput('slug', 'demo');
	fixture.detectChanges();
	return { el: fixture.nativeElement as HTMLElement, aktualisiere: () => fixture.detectChanges() };
}

const knopf = (el: HTMLElement, text: string) =>
	Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
const google = (el: HTMLElement) =>
	Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.trim() === 'Google Kalender');

function blobLesen(b: Blob): Promise<string> {
	return new Promise((fertig) => {
		const r = new FileReader();
		r.onload = () => fertig(r.result as string);
		r.readAsText(b);
	});
}

describe('Termin-Modul', () => {
	it('zeigt Titel, Zeit und Treffpunkt', () => {
		const { el } = zeige();

		expect(el.querySelector('h2')?.textContent).toBe('Wann und wo');
		expect(el.textContent).toContain(terminZeit(TERMIN));
		expect(el.textContent).toContain('Treffpunkt: Parkplatz am Vereinsheim');
	});

	it('verlinkt den Ort auf die Karten-App des Geraets', () => {
		const { el } = zeige();

		const ort = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Bowlingcenter'));
		expect(ort?.getAttribute('href')).toBe(kartenLink(TERMIN.ort!, geraetAus(navigator.userAgent)));
		// jsdom ist weder iPhone noch Android: der Google-Link, und der geht in ein neues Fenster.
		expect(ort?.getAttribute('target')).toBe('_blank');
	});

	it('laesst Ort und Treffpunkt weg, wenn sie fehlen', () => {
		const { el } = zeige({ ...MODUL, titel: null, termin: { ...TERMIN, ort: null, treffpunkt: null } });

		expect(el.querySelector('h2')).toBeNull();
		expect(el.textContent).not.toContain('Treffpunkt');
		expect(el.querySelector('a')).toBeNull();
	});

	it('klappt mit In Kalender eintragen die zwei Wege auf', () => {
		const { el, aktualisiere } = zeige();
		expect(knopf(el, 'Kalender des Telefons')).toBeUndefined();

		const eintragen = knopf(el, 'In Kalender eintragen')!;
		expect(eintragen.getAttribute('aria-expanded')).toBe('false');
		eintragen.click();
		aktualisiere();

		expect(eintragen.getAttribute('aria-expanded')).toBe('true');
		expect(knopf(el, 'Kalender des Telefons')).toBeDefined();
		expect(google(el)).toBeDefined();
	});

	it('Google Kalender ist ein Link in einem neuen Fenster mit Titel und Rueckweg in die App', () => {
		const { el, aktualisiere } = zeige();
		knopf(el, 'In Kalender eintragen')!.click();
		aktualisiere();

		const a = google(el)!;
		expect(a.getAttribute('target')).toBe('_blank');
		expect(a.getAttribute('rel')).toBe('noopener');
		const adresse = new URL(a.href);
		expect(adresse.origin + adresse.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(adresse.searchParams.get('text')).toBe('🎳 Bowling · Wann und wo');
		expect(adresse.searchParams.get('details')).toContain(`${location.origin}/demo/t/ck1/m/m2`);
	});

	describe('Kalender des Telefons', () => {
		const original = { erzeugen: URL.createObjectURL, freigeben: URL.revokeObjectURL };
		let blob: Blob | undefined;
		let geladen: HTMLAnchorElement[];

		beforeEach(() => {
			blob = undefined;
			geladen = [];
			URL.createObjectURL = vi.fn((b: Blob) => {
				blob = b;
				return 'blob:test';
			});
			URL.revokeObjectURL = vi.fn();
			// jsdom kann nicht herunterladen; festgehalten wird, welcher Link geklickt wurde.
			vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
				geladen.push(this);
			});
		});

		afterEach(() => {
			URL.createObjectURL = original.erzeugen;
			URL.revokeObjectURL = original.freigeben;
			vi.restoreAllMocks();
		});

		it('laedt eine ics-Datei mit dem Thread-Segment als Namen und der Modul-UID', async () => {
			const { el, aktualisiere } = zeige();
			knopf(el, 'In Kalender eintragen')!.click();
			aktualisiere();
			knopf(el, 'Kalender des Telefons')!.click();
			aktualisiere();

			expect(geladen).toHaveLength(1);
			expect(geladen[0]?.download).toBe(`${threadSegment('ck1', '🎳 Bowling')}.ics`);
			expect(blob?.type).toBe('text/calendar;charset=utf-8');
			const ics = (await blobLesen(blob!)).replace(/\r\n /g, '');
			expect(ics).toContain('UID:m2@jufi-app.de');
			expect(ics).toContain('SUMMARY:🎳 Bowling · Wann und wo');
			expect(ics).toContain(`${location.origin}/demo/t/ck1/m/m2`);
			// Nach dem Eintragen klappt das Menue wieder zu.
			expect(knopf(el, 'Kalender des Telefons')).toBeUndefined();
		});
	});
});
