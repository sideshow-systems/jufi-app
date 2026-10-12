import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { M, P, T } from '../daten/beispieldaten';
import { type Testereignis, TESTEREIGNISSE } from '../daten/ereignisse';
import { EntwurfStore } from '../daten/store';
import { testProvider } from '../testhilfe';

async function oeffne(url: string, ich: string) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [provideRouter(routes, withComponentInputBinding()), ...testProvider()],
	});
	TestBed.inject(EntwurfStore).setzeIch(ich);
	const gemeldet: Testereignis[] = [];
	TestBed.inject(TESTEREIGNISSE).subscribe((e) => gemeldet.push(e));
	const harness = await RouterTestingHarness.create(url);
	harness.detectChanges();
	return { harness, el: harness.routeNativeElement as HTMLElement, gemeldet };
}

const knopf = (wurzel: Element, text: string) =>
	[...wurzel.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const google = (wurzel: Element) =>
	[...wurzel.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Google Kalender')!;

function blobLesen(b: Blob): Promise<string> {
	return new Promise((fertig) => {
		const r = new FileReader();
		r.onload = () => fertig(r.result as string);
		r.readAsText(b);
	});
}

describe('Kalender-Knopf', () => {
	let blob: Blob | undefined;
	const original = { erzeugen: URL.createObjectURL, freigeben: URL.revokeObjectURL };

	beforeEach(() => {
		blob = undefined;
		URL.createObjectURL = vi.fn((b: Blob) => {
			blob = b;
			return 'blob:test';
		});
		URL.revokeObjectURL = vi.fn();
		// jsdom kann nicht navigieren; der Download-Klick soll nur stattfinden.
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
	});

	afterEach(() => {
		URL.createObjectURL = original.erzeugen;
		URL.revokeObjectURL = original.freigeben;
		vi.restoreAllMocks();
	});

	async function aufgeklappt() {
		const o = await oeffne('/glonntal/t/2-bowling', P.sandra);
		knopf(o.el, 'In Kalender eintragen').click();
		o.harness.detectChanges();
		return o;
	}

	it('klappt die zwei Wege auf', async () => {
		const { el } = await aufgeklappt();
		expect(knopf(el, 'In Kalender eintragen').getAttribute('aria-expanded')).toBe('true');
		expect(knopf(el, 'Kalender des Telefons')).toBeTruthy();
		const g = google(el);
		expect(g.target).toBe('_blank');
		expect(g.rel).toContain('noopener');
		expect(g.href).toContain('calendar.google.com');
		expect(new URL(g.href).searchParams.get('text')).toMatch(/^\[Entwurf\] /);
	});

	it('laedt eine ics-Datei mit Thread-Titel und App-Link und meldet das Testereignis', async () => {
		const { el, gemeldet } = await aufgeklappt();
		knopf(el, 'Kalender des Telefons').click();
		const text = await blobLesen(blob!);
		expect(text).toContain('SUMMARY:[Entwurf] 🎳 Bowling');
		expect(text.replace(/\r\n /g, '')).toContain(
			'DESCRIPTION:Testeintrag aus dem JuFi-Entwurf – kann gelöscht werden.\\n',
		);
		expect(text.replace(/\r\n /g, '')).toContain(
			`${location.origin}/entwurf/glonntal/t/2-bowling/m/${M.bowlingTermin}`,
		);
		expect(blob!.type).toBe('text/calendar;charset=utf-8');
		expect(gemeldet).toEqual([
			{ art: 'kalenderEingetragen', threadId: T.bowling, modulId: M.bowlingTermin, weg: 'ics' },
		]);
	});

	it('meldet den Google-Weg und klappt danach zu', async () => {
		const { harness, el, gemeldet } = await aufgeklappt();
		const g = google(el);
		g.addEventListener('click', (e) => e.preventDefault());
		g.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		harness.detectChanges();
		expect(gemeldet.map((e) => e.art === 'kalenderEingetragen' && e.weg)).toEqual(['google']);
		expect(knopf(el, 'In Kalender eintragen').getAttribute('aria-expanded')).toBe('false');
	});

	it('ist in der Editor-Vorschau gesperrt', async () => {
		const { harness, el } = await oeffne('/glonntal/verwaltung/threads/neu', P.thomas);
		knopf(el.querySelector('.hinzufuegen')!, 'Termin').click();
		harness.detectChanges();
		expect(knopf(el.querySelector('.vorschau')!, 'In Kalender eintragen').disabled).toBe(true);
	});

	it('enthaelt keine Personennamen', async () => {
		const { el } = await aufgeklappt();
		const link = decodeURIComponent(google(el).href);
		knopf(el, 'Kalender des Telefons').click();
		const text = await blobLesen(blob!);
		expect(text).not.toMatch(/Sandra|Lena|Max|Thomas|Katrin/);
		expect(link).not.toMatch(/Sandra|Lena|Max|Thomas|Katrin/);
	});
});
