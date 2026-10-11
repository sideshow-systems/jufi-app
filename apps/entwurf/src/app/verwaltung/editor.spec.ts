import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { P } from '../daten/beispieldaten';
import { EntwurfStore } from '../daten/store';
import { siehtThread } from '../regeln/sichtbarkeit';
import { testProvider } from '../testhilfe';
import { leererThread } from './editor';

async function oeffne(url: string, ich: string) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [provideRouter(routes, withComponentInputBinding()), ...testProvider()],
	});
	const store = TestBed.inject(EntwurfStore);
	store.setzeIch(ich);
	const harness = await RouterTestingHarness.create(url);
	harness.detectChanges();
	return { store, harness, el: harness.routeNativeElement as HTMLElement };
}

const knopf = (wurzel: Element, text: string) =>
	[...wurzel.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('leererThread', () => {
	it('richtet sich an alle Jungfischer und Eltern und ist unveroeffentlicht', () => {
		const t = leererThread(P.thomas);
		expect(t.id).toBe('');
		expect(t.zielgruppe).toEqual({ untergruppen: 'alle', rollen: 'jungfischerUndEltern' });
		expect(t.veroeffentlicht).toBe(false);
		expect(t.erstelltVon).toBe(P.thomas);
		expect(t.module).toEqual([]);
	});
});

describe('Verwaltung', () => {
	it('legt als Thomas die Weihnachtsfeier mit Termin und Umfrage an', async () => {
		const { store, harness, el } = await oeffne('/glonntal/verwaltung/threads/neu', P.thomas);
		const titel = el.querySelector<HTMLInputElement>('input[name="titel"]')!;
		titel.value = '🎄 Weihnachtsfeier';
		titel.dispatchEvent(new Event('input'));
		harness.detectChanges();

		const hinzu = el.querySelector('.hinzufuegen')!;
		knopf(hinzu, 'Termin').click();
		harness.detectChanges();
		knopf(hinzu, 'Umfrage').click();
		harness.detectChanges();
		expect(el.querySelector('.vorschau')?.textContent).toContain('Weihnachtsfeier');

		knopf(el, 'Veröffentlichen').click();
		await harness.fixture.whenStable();

		const t = store.stand().threads.find((x) => x.titel.includes('Weihnachtsfeier'))!;
		expect(t.nr).toBe(9);
		expect(t.veroeffentlicht).toBe(true);
		expect(t.module.map((m) => m.typ)).toEqual(['termin', 'umfrage']);
		expect(siehtThread(store.stand(), P.sandra, t)).toBe(true);
	});

	it('bleibt Sandra verborgen', async () => {
		const { el } = await oeffne('/glonntal/verwaltung', P.sandra);
		expect(el.textContent).toContain('Nicht gefunden oder keine Berechtigung');
	});

	it('zeigt Thomas die Uebersicht', async () => {
		const { el } = await oeffne('/glonntal/verwaltung', P.thomas);
		expect(el.textContent).toContain('Übersicht');
		expect(el.textContent).toContain('Jugendleiter & Rechte');
	});

	it('schuetzt das letzte Recht "Rechte verwalten"', async () => {
		const { el } = await oeffne('/glonntal/verwaltung/rechte', P.thomas);
		const geschuetzt = el.querySelector<HTMLInputElement>(
			`input[data-person="${P.thomas}"][data-recht="rechteVerwalten"]`,
		)!;
		expect(geschuetzt.disabled).toBe(true);
		expect(el.textContent).toContain('Mindestens eine Person muss Rechte verwalten können');
	});
});
