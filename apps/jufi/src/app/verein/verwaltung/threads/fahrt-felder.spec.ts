import { TestBed } from '@angular/core/testing';
import type { Feldfehler, FahrtSperre, ModulEntwurf } from '@jufi/domain';
import { FahrtFelderComponent } from './fahrt-felder';
import { zeigtModulFeld } from './modul-felder';

type Fahrt = Extract<ModulEntwurf, { typ: 'FAHRT' }>;

const fahrt = (rest: Partial<Fahrt> = {}): Fahrt => ({
	typ: 'FAHRT',
	id: 'm-fahrt',
	titel: null,
	hin: true,
	rueck: true,
	...rest,
});

const GRUND = 'Hat schon Autos oder Mitfahrten.';
const NUR_HIN: FahrtSperre = { eingetragen: true, HIN: true, RUECK: false };

function tiefEingefroren<T>(w: T): T {
	if (typeof w === 'object' && w !== null) {
		Object.values(w).forEach(tiefEingefroren);
		Object.freeze(w);
	}
	return w;
}

function oeffne(modul: Fahrt, opt: { index?: number; sperre?: FahrtSperre | null; fehler?: Feldfehler[] } = {}) {
	const fixture = TestBed.createComponent(FahrtFelderComponent);
	fixture.componentRef.setInput('modul', tiefEingefroren(modul));
	fixture.componentRef.setInput('index', opt.index ?? 0);
	fixture.componentRef.setInput('sperre', opt.sperre ?? null);
	fixture.componentRef.setInput('fehler', opt.fehler ?? []);
	fixture.detectChanges();
	const gemeldet: ModulEntwurf[] = [];
	fixture.componentInstance.aendern.subscribe((m) => {
		gemeldet.push(m);
		// Der Editor haelt den Entwurf und reicht jede Aenderung zurueck (gesteuert wie jf-helfer-felder).
		fixture.componentRef.setInput('modul', tiefEingefroren(m));
		fixture.detectChanges();
	});
	const seite = fixture.nativeElement as HTMLElement;
	const el = <T extends HTMLElement = HTMLInputElement>(s: string) => seite.querySelector<T>(s);
	const text = () => (seite.textContent ?? '').replace(/\s+/g, ' ').trim();
	const letzte = () => gemeldet[gemeldet.length - 1] as Fahrt;
	return { fixture, seite, gemeldet, el, text, letzte };
}

describe('jf-fahrt-felder', () => {
	describe('Titel', () => {
		it('meldet die Ueberschrift, leer als null', () => {
			const r = oeffne(fahrt({ titel: 'Anreise' }));
			const feld = r.el('input[name="titel"]')!;
			expect(feld.value).toBe('Anreise');
			feld.value = 'Fahrt zum See';
			feld.dispatchEvent(new Event('input', { bubbles: true }));
			expect(r.letzte()).toMatchObject({ titel: 'Fahrt zum See' });
			feld.value = '';
			feld.dispatchEvent(new Event('input', { bubbles: true }));
			expect(r.letzte()).toMatchObject({ titel: null });
		});
	});

	describe('Richtungen', () => {
		it('zeigt Hinfahrt und Rueckfahrt als Kaestchen mit dem Stand des Moduls', () => {
			const r = oeffne(fahrt({ rueck: false }));
			expect(r.seite.querySelector('label.haken')?.textContent).toContain('Hinfahrt');
			expect(r.seite.querySelectorAll('label.haken')[1]?.textContent).toContain('Rückfahrt');
			expect(r.el('input[name="hin"]')?.checked).toBe(true);
			expect(r.el('input[name="rueck"]')?.checked).toBe(false);
		});

		it('meldet das Abwaehlen als neues Modul, ohne das alte anzufassen', () => {
			const r = oeffne(fahrt());
			r.el('input[name="hin"]')?.click();
			expect(r.letzte()).toEqual(fahrt({ hin: false }));
			r.el('input[name="rueck"]')?.click();
			expect(r.letzte()).toEqual(fahrt({ hin: false, rueck: false }));
		});

		it('ohne Sperre sind beide Kaestchen frei und ohne Satz', () => {
			const r = oeffne(fahrt(), { sperre: null });
			expect(r.el('input[name="hin"]')?.disabled).toBe(false);
			expect(r.el('input[name="rueck"]')?.disabled).toBe(false);
			expect(r.text()).not.toContain(GRUND);
		});
	});

	describe('Sperre', () => {
		it('sperrt nur die Richtung mit Eintraegen und nennt den Grund sichtbar daneben', () => {
			const r = oeffne(fahrt(), { sperre: NUR_HIN });
			const hin = r.el('input[name="hin"]')!;
			expect(hin.disabled).toBe(true);
			expect(hin.checked).toBe(true);
			expect(r.el('input[name="rueck"]')?.disabled).toBe(false);

			const grund = r.seite.querySelector(`#${hin.getAttribute('aria-describedby')}`);
			expect(grund?.textContent?.trim()).toBe(GRUND);
			// Sichtbar, nicht nur fuer Screenreader: Ein graues Kaestchen ohne Satz laesst Sehende raten.
			expect(grund?.classList.contains('unsichtbar')).toBe(false);
			expect(r.text().split(GRUND)).toHaveLength(2);
			expect(r.el('input[name="rueck"]')?.hasAttribute('aria-describedby')).toBe(false);
		});

		it('sperrt beide Richtungen mit je einem Satz', () => {
			const r = oeffne(fahrt(), { sperre: { eingetragen: true, HIN: true, RUECK: true } });
			expect(r.el('input[name="hin"]')?.disabled).toBe(true);
			expect(r.el('input[name="rueck"]')?.disabled).toBe(true);
			expect(r.text().split(GRUND)).toHaveLength(3);
		});

		it('eine gesperrte Richtung laesst sich nicht abwaehlen', () => {
			const r = oeffne(fahrt(), { sperre: NUR_HIN });
			r.el('input[name="hin"]')?.click();
			expect(r.gemeldet).toEqual([]);
		});
	});

	describe('Fehler am Feld', () => {
		it('der Serversatz "Bitte mindestens eine Richtung." steht am Feld', () => {
			const text = 'Bitte mindestens eine Richtung.';
			const r = oeffne(fahrt({ hin: false, rueck: false }), { fehler: [{ feld: 'module.0.hin', text }] });
			const hinweis = r.seite.querySelector('p.fehler[role="alert"]');
			expect(hinweis?.textContent).toContain(text);
			const hin = r.el('input[name="hin"]')!;
			expect(hin.getAttribute('aria-invalid')).toBe('true');
			expect(hin.getAttribute('aria-describedby')).toBe(hinweis?.id);
		});

		it('ein 409 an module.0.hin steht am Hin-Kaestchen, einer an module.0.rueck am Rueck-Kaestchen', () => {
			const hin = 'Für die Hinfahrt gibt es schon Autos oder Mitfahrten.';
			const rueck = 'Für die Rückfahrt gibt es schon Autos oder Mitfahrten.';
			const a = oeffne(fahrt({ hin: false }), { fehler: [{ feld: 'module.0.hin', text: hin, konflikt: true }] });
			expect(a.el('input[name="hin"]')?.getAttribute('aria-invalid')).toBe('true');
			expect(a.el('input[name="rueck"]')?.hasAttribute('aria-invalid')).toBe(false);
			expect(a.seite.querySelector('p.fehler')?.textContent).toContain(hin);

			const b = oeffne(fahrt({ rueck: false }), { fehler: [{ feld: 'module.0.rueck', text: rueck, konflikt: true }] });
			expect(b.el('input[name="rueck"]')?.getAttribute('aria-invalid')).toBe('true');
			expect(b.el('input[name="hin"]')?.hasAttribute('aria-invalid')).toBe(false);
			expect(b.seite.querySelector('p.fehler')?.textContent).toContain(rueck);
		});

		it('"Es gibt schon eine Fahrgemeinschaft." (typ) steht als Satz am Modul', () => {
			const text = 'Es gibt schon eine Fahrgemeinschaft.';
			const r = oeffne(fahrt(), { fehler: [{ feld: 'module.0.typ', text, konflikt: true }] });
			expect(r.seite.querySelector('p.fehler[role="alert"]')?.textContent).toContain(text);
		});

		it('der Fehler am Titel steht am Titel', () => {
			const r = oeffne(fahrt(), { fehler: [{ feld: 'module.0.titel', text: 'Der Titel ist zu lang.' }] });
			const feld = r.el('input[name="titel"]')!;
			expect(feld.getAttribute('aria-invalid')).toBe('true');
			expect(r.seite.querySelector(`#${feld.getAttribute('aria-describedby')}`)?.textContent).toContain(
				'Der Titel ist zu lang.',
			);
		});

		it('Fehler anderer Module stehen nicht hier', () => {
			const r = oeffne(fahrt(), { index: 1, fehler: [{ feld: 'module.0.hin', text: 'anderes Modul' }] });
			expect(r.seite.querySelector('p.fehler')).toBeNull();
			expect(r.el('input[name="hin"]')?.hasAttribute('aria-invalid')).toBe(false);
		});

		it('zeigt genau die Felder, die zeigtModulFeld nennt', () => {
			const ALLE = ['typ', 'id', 'titel', 'hin', 'rueck', 'einheit', 'frist', 'positionen', 'text'];
			const ergebnis = ALLE.map((feld) => {
				const r = oeffne(fahrt(), { fehler: [{ feld: `module.0.${feld}`, text: `Fehler ${feld}` }] });
				return { feld, sichtbar: r.seite.textContent?.includes(`Fehler ${feld}`) ?? false };
			});
			expect(ergebnis).toEqual(ALLE.map((feld) => ({ feld, sichtbar: zeigtModulFeld(fahrt(), feld) })));
			expect(ALLE.filter((feld) => zeigtModulFeld(fahrt(), feld))).toEqual(['typ', 'titel', 'hin', 'rueck']);
		});
	});
});
