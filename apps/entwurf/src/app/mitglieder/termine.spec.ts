import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { type Testereignis, TESTEREIGNISSE } from '../daten/ereignisse';
import { P } from '../daten/beispieldaten';
import { EntwurfStore } from '../daten/store';
import { testProvider } from '../testhilfe';
import { monatsRaster } from './termine';

async function oeffne(url: string) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [provideRouter(routes, withComponentInputBinding()), ...testProvider()],
	});
	const ereignisse: Testereignis[] = [];
	TestBed.inject(TESTEREIGNISSE).subscribe((e) => ereignisse.push(e));
	const harness = await RouterTestingHarness.create(url);
	harness.detectChanges();
	return { harness, ereignisse, el: harness.routeNativeElement as HTMLElement };
}

describe('monatsRaster', () => {
	it('beginnt am Montag und hat 42 Felder', () => {
		const r = monatsRaster(2026, 9);
		expect(r.length).toBe(42);
		expect(r.slice(0, 3)).toEqual([null, null, null]);
		expect(r[3]).toBe(1);
		expect(r.filter((x) => x !== null).at(-1)).toBe(31);
		expect(r[3 + 30]).toBe(31);
	});

	it('faengt einen Monat, der am Montag beginnt, im ersten Feld an', () => {
		expect(monatsRaster(2026, 5)[0]).toBe(1);
	});
});

describe('Seiten', () => {
	it('Termine zeigt den Monat des Bezugstags mit Bowling', async () => {
		const { el } = await oeffne('/glonntal/termine');
		expect(el.textContent).toContain('Oktober 2026');
		expect(el.textContent).toContain('🎳 Bowling');
	});

	it('Dokumente meldet das Oeffnen an den Testmodus', async () => {
		const { el, ereignisse, harness } = await oeffne('/glonntal/dokumente');
		expect(el.textContent).toContain('Ordnungen');
		const knopf = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Jugendfischereiordnung'))!;
		knopf.click();
		harness.detectChanges();
		expect(ereignisse).toContainEqual({ art: 'dokumentGeoeffnet', id: 'g-jfo' });
	});

	it('Medien zeigt nur sichtbare Threads', async () => {
		const { el } = await oeffne('/glonntal/medien');
		expect(el.textContent).toContain('Hegefischen');
		expect(el.textContent).not.toContain('Fischerprüfung');
	});

	it('Mehr setzt die Foto-Einwilligung und erzeugt eine Einladung', async () => {
		const { el, ereignisse, harness } = await oeffne('/glonntal/mehr');
		const store = TestBed.inject(EntwurfStore);
		const schalter = el.querySelector<HTMLInputElement>(`input[data-einwilligung="${P.max}"]`)!;
		schalter.click();
		harness.detectChanges();
		expect(store.stand().personen.find((p) => p.id === P.max)?.fotoEinwilligung).toBe(true);

		const einladen = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Zugang für Max'))!;
		einladen.click();
		harness.detectChanges();
		expect(ereignisse).toContainEqual({ art: 'einladungErzeugt', personId: P.max });
		expect(el.textContent).toContain('/entwurf/glonntal');
	});
});
