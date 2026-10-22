import { TestBed } from '@angular/core/testing';
import type { Feldfehler, HelferSperre, ModulEntwurf, Rollenfilter } from '@jufi/domain';
import { HelferFelderComponent } from './helfer-felder';
import { zeigtModulFeld } from './modul-felder';

type Helfer = Extract<ModulEntwurf, { typ: 'HELFER' }>;

const helfer = (rest: Partial<Helfer> = {}): Helfer => ({
	typ: 'HELFER',
	id: 'm-helfer',
	titel: null,
	einheit: 'ERWACHSENER',
	frist: null,
	positionen: [
		{ schluessel: 'k1', text: 'Kuchen', anzahl: 4 },
		{ schluessel: 'k2', text: 'Fahrer', anzahl: 2 },
		{ schluessel: null, text: 'Snacks', anzahl: 3 },
	],
	...rest,
});

const KONFLIKT_EINHEIT = 'Die Einheit lässt sich nach den ersten Einträgen nicht mehr ändern.';
const SPERRE_K1: HelferSperre = { eingetragen: true, belegt: { k1: 2 } };

function tiefEingefroren<T>(w: T): T {
	if (typeof w === 'object' && w !== null) {
		Object.values(w).forEach(tiefEingefroren);
		Object.freeze(w);
	}
	return w;
}

function oeffne(
	modul: Helfer,
	opt: { index?: number; rollenfilter?: Rollenfilter; sperre?: HelferSperre | null; fehler?: Feldfehler[] } = {},
) {
	const fixture = TestBed.createComponent(HelferFelderComponent);
	fixture.componentRef.setInput('modul', tiefEingefroren(modul));
	fixture.componentRef.setInput('index', opt.index ?? 0);
	fixture.componentRef.setInput('rollenfilter', opt.rollenfilter ?? 'JUNGFISCHER_FAMILIE');
	fixture.componentRef.setInput('sperre', opt.sperre ?? null);
	fixture.componentRef.setInput('fehler', opt.fehler ?? []);
	fixture.detectChanges();
	const gemeldet: ModulEntwurf[] = [];
	fixture.componentInstance.aendern.subscribe((m) => {
		gemeldet.push(m);
		// Der Editor haelt den Entwurf und reicht jede Aenderung zurueck (gesteuert wie jf-modul-felder).
		fixture.componentRef.setInput('modul', tiefEingefroren(m));
		fixture.detectChanges();
	});
	const seite = fixture.nativeElement as HTMLElement;
	const el = <T extends HTMLElement = HTMLInputElement>(s: string) => seite.querySelector<T>(s);
	const tippe = (s: string, wert: string) => {
		const feld = el(s);
		if (!feld) throw new Error(`Feld fehlt: ${s}`);
		feld.value = wert;
		feld.dispatchEvent(new Event('input', { bubbles: true }));
		feld.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const zeile = (i: number) => seite.querySelectorAll<HTMLElement>('li[data-position]')[i]!;
	const knopfIn = (i: number, beginn: string) =>
		zeile(i).querySelector<HTMLButtonElement>(`button[aria-label^="${beginn}"]`)!;
	const letzte = () => gemeldet[gemeldet.length - 1] as Helfer;
	return { fixture, seite, gemeldet, el, tippe, zeile, knopfIn, letzte };
}

describe('jf-helfer-felder', () => {
	describe('Titel', () => {
		it('meldet die Ueberschrift, leer als null', () => {
			const r = oeffne(helfer({ titel: 'Mitbringen' }));
			expect(r.el('input[name="titel"]')?.value).toBe('Mitbringen');
			r.tippe('input[name="titel"]', 'Fischerfest');
			expect(r.letzte()).toMatchObject({ titel: 'Fischerfest' });
			r.tippe('input[name="titel"]', '');
			expect(r.letzte()).toMatchObject({ titel: null });
		});
	});

	describe('Einheit', () => {
		const einheiten = (r: ReturnType<typeof oeffne>) =>
			[...r.seite.querySelectorAll('select[name="einheit"] option')].map((o) => o.textContent?.trim());

		it('bietet bei "Nur Familie" "Pro Jungfischer" nicht an', () => {
			expect(einheiten(oeffne(helfer(), { rollenfilter: 'NUR_FAMILIE' }))).toEqual(['Pro Erwachsenem', 'Pro Person']);
			expect(einheiten(oeffne(helfer()))).toEqual(['Pro Jungfischer', 'Pro Erwachsenem', 'Pro Person']);
		});

		it('zeigt die gespeicherte Einheit und meldet eine neue', () => {
			const r = oeffne(helfer());
			expect(r.el<HTMLSelectElement>('select[name="einheit"]')?.value).toBe('ERWACHSENER');
			r.tippe('select[name="einheit"]', 'PERSON');
			expect(r.letzte()).toMatchObject({ einheit: 'PERSON' });
		});

		it('zeigt eine nicht mehr passende Einheit markiert mit ihrem Fehler', () => {
			const r = oeffne(helfer({ einheit: 'JUNGFISCHER' }), {
				rollenfilter: 'NUR_FAMILIE',
				fehler: [{ feld: 'module.0.einheit', text: 'Diese Einheit fragt bei dieser Zielgruppe niemanden.' }],
			});
			const auswahl = r.el<HTMLSelectElement>('select[name="einheit"]')!;
			expect(auswahl.selectedOptions[0]?.textContent).toContain('passt nicht');
			expect(auswahl.getAttribute('aria-invalid')).toBe('true');
			expect(r.seite.querySelector(`#${auswahl.getAttribute('aria-describedby')}`)?.textContent).toContain(
				'fragt bei dieser Zielgruppe niemanden',
			);
		});
	});

	describe('Positionen', () => {
		it('zeigt je Position Text (hoechstens 80) und Anzahl (1 bis 99)', () => {
			const r = oeffne(helfer());
			expect(r.seite.querySelectorAll('li[data-position]')).toHaveLength(3);
			const text = r.zeile(0).querySelector<HTMLInputElement>('input[type="text"]')!;
			const anzahl = r.zeile(0).querySelector<HTMLInputElement>('input[type="number"]')!;
			expect(text.value).toBe('Kuchen');
			expect(text.maxLength).toBe(80);
			expect(anzahl.value).toBe('4');
			expect(anzahl.min).toBe('1');
			expect(anzahl.max).toBe('99');
		});

		it('"Position hinzufügen" haengt eine leere Position mit Anzahl 1 an, bei 30 ist Schluss', () => {
			const r = oeffne(helfer());
			[...r.seite.querySelectorAll<HTMLButtonElement>('button')]
				.find((b) => b.textContent?.includes('Position hinzufügen'))
				?.click();
			expect(r.letzte().positionen).toHaveLength(4);
			expect(r.letzte().positionen[3]).toEqual({ schluessel: null, text: '', anzahl: 1 });

			const voll = Array.from({ length: 30 }, (_, i) => ({ schluessel: null, text: `p${i}`, anzahl: 1 }));
			const v = oeffne(helfer({ positionen: voll }));
			const knopf = [...v.seite.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
				b.textContent?.includes('Position hinzufügen'),
			);
			expect(knopf?.disabled).toBe(true);
		});

		it('Umbenennen und Anzahl aendern behalten den Schluessel', () => {
			const r = oeffne(helfer());
			r.tippe('input[name="position-0"]', 'Marmorkuchen');
			r.tippe('input[name="anzahl-0"]', '5');
			expect(r.letzte().positionen[0]).toEqual({ schluessel: 'k1', text: 'Marmorkuchen', anzahl: 5 });
		});

		it('ein leeres Anzahlfeld mitten im Tippen meldet nichts und springt beim Verlassen zurueck', () => {
			const r = oeffne(helfer());
			r.tippe('input[name="anzahl-0"]', '');
			expect(r.gemeldet).toEqual([]);
			r.el('input[name="anzahl-0"]')?.dispatchEvent(new Event('blur'));
			expect(r.el('input[name="anzahl-0"]')?.value).toBe('4');
		});

		it('Hoch und Runter tauschen Nachbarn mit ihren Schluesseln, am Rand gesperrt', () => {
			const r = oeffne(helfer());
			expect(r.knopfIn(0, 'Nach oben').disabled).toBe(true);
			expect(r.knopfIn(2, 'Nach unten').disabled).toBe(true);
			r.knopfIn(1, 'Nach oben').click();
			expect(r.letzte().positionen.map((p) => p.schluessel)).toEqual(['k2', 'k1', null]);
			r.knopfIn(1, 'Nach unten').click();
			expect(r.letzte().positionen.map((p) => p.text)).toEqual(['Fahrer', 'Snacks', 'Kuchen']);
			expect(r.letzte().positionen.map((p) => p.schluessel)).toEqual(['k2', null, 'k1']);
		});

		it('Entfernen nimmt genau diese Position heraus, die anderen behalten ihre Schluessel', () => {
			const r = oeffne(helfer());
			r.knopfIn(1, 'Entfernen').click();
			expect(r.letzte().positionen).toEqual([
				{ schluessel: 'k1', text: 'Kuchen', anzahl: 4 },
				{ schluessel: null, text: 'Snacks', anzahl: 3 },
			]);
		});

		it('benennt die Knoepfe je Position fuer Screenreader', () => {
			const r = oeffne(helfer());
			const namen = [...r.zeile(0).querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
			expect(namen).toEqual(['Nach oben: Position 1', 'Nach unten: Position 1', 'Entfernen: Position 1']);
			expect(r.el('input[name="position-0"]')?.getAttribute('aria-label')).toBe('Position 1');
			expect(r.el('input[name="anzahl-0"]')?.getAttribute('aria-label')).toBe('Anzahl: Position 1');
		});
	});

	describe('Sperre durch Eintraege', () => {
		it('mit Eintraegen in k1: Entfernen von k1 aus mit Grund, Anzahl-min 2, Einheit aus mit Konflikttext', () => {
			const r = oeffne(helfer(), { sperre: SPERRE_K1 });
			const entfernen = r.knopfIn(0, 'Entfernen');
			expect(entfernen.disabled).toBe(true);
			expect(r.seite.querySelector(`#${entfernen.getAttribute('aria-describedby')}`)?.textContent?.trim()).toBe(
				'Hat schon Einträge',
			);
			expect(r.knopfIn(1, 'Entfernen').disabled).toBe(false);
			expect(r.knopfIn(1, 'Entfernen').getAttribute('aria-describedby')).toBeNull();

			expect(r.el('input[name="anzahl-0"]')?.min).toBe('2');
			expect(r.el('input[name="anzahl-1"]')?.min).toBe('1');

			expect(r.el<HTMLSelectElement>('select[name="einheit"]')?.disabled).toBe(true);
			expect(r.seite.textContent).toContain(KONFLIKT_EINHEIT);
		});

		it('ohne Sperre ist nichts gesperrt und kein Hinweis da', () => {
			const r = oeffne(helfer());
			expect(r.knopfIn(0, 'Entfernen').disabled).toBe(false);
			expect(r.el<HTMLSelectElement>('select[name="einheit"]')?.disabled).toBe(false);
			expect(r.seite.textContent).not.toContain(KONFLIKT_EINHEIT);
			expect(r.seite.textContent).not.toContain('Hat schon Einträge');
		});

		it('Umsortieren und Umbenennen bleiben trotz Eintraegen frei', () => {
			const r = oeffne(helfer(), { sperre: SPERRE_K1 });
			expect(r.el('input[name="position-0"]')?.disabled).toBe(false);
			r.knopfIn(0, 'Nach unten').click();
			expect(r.letzte().positionen.map((p) => p.schluessel)).toEqual(['k2', 'k1', null]);
			// Die Sperre haengt am Schluessel, nicht an der Stelle.
			expect(r.knopfIn(1, 'Entfernen').disabled).toBe(true);
			expect(r.el('input[name="anzahl-1"]')?.min).toBe('2');
		});
	});

	describe('Fehler am Feld', () => {
		it('ein 409 an module.0.positionen steht an den Positionen', () => {
			const text = 'Für „Kuchen“ sind schon 2 eingetragen.';
			const r = oeffne(helfer(), { fehler: [{ feld: 'module.0.positionen', text, konflikt: true }] });
			const hinweis = r.seite.querySelector('p.fehler[role="alert"]');
			expect(hinweis?.textContent).toContain(text);
			const feld = r.el('input[name="position-0"]')!;
			expect(feld.getAttribute('aria-invalid')).toBe('true');
			expect(feld.getAttribute('aria-describedby')).toBe(hinweis?.id);
			expect(r.el('input[name="anzahl-0"]')?.getAttribute('aria-invalid')).toBe('true');
		});

		it('Fehler anderer Module stehen nicht hier', () => {
			const r = oeffne(helfer(), { index: 1, fehler: [{ feld: 'module.0.positionen', text: 'anderes Modul' }] });
			expect(r.seite.querySelector('p.fehler')).toBeNull();
		});

		it('zeigt genau die Felder, die zeigtModulFeld nennt', () => {
			const ALLE = ['typ', 'id', 'titel', 'einheit', 'frist', 'positionen', 'optionen', 'frage', 'text'];
			const ergebnis = ALLE.map((feld) => {
				const r = oeffne(helfer(), { fehler: [{ feld: `module.0.${feld}`, text: `Fehler ${feld}` }] });
				return { feld, sichtbar: r.seite.textContent?.includes(`Fehler ${feld}`) ?? false };
			});
			expect(ergebnis).toEqual(ALLE.map((feld) => ({ feld, sichtbar: zeigtModulFeld(helfer(), feld) })));
			expect(ALLE.filter((feld) => zeigtModulFeld(helfer(), feld))).toEqual([
				'titel',
				'einheit',
				'frist',
				'positionen',
			]);
		});
	});

	describe('Frist', () => {
		it('meldet eine eingegebene Frist als UTC und "ohne Frist" als null', () => {
			const r = oeffne(helfer());
			expect(r.el('input[name="ohneFrist"]')?.checked).toBe(true);
			r.el('input[name="ohneFrist"]')?.click();
			r.tippe('input[name="fristTag"]', '2026-10-27');
			expect(r.letzte()).toMatchObject({ frist: '2026-10-27T17:00:00.000Z' });
			r.el('input[name="ohneFrist"]')?.click();
			expect(r.letzte()).toMatchObject({ frist: null });
		});

		it('zeigt eine gespeicherte Frist als Berliner Datum und Uhrzeit', () => {
			const r = oeffne(helfer({ frist: '2026-10-22T22:30:00.000Z' }));
			expect(r.el('input[name="fristTag"]')?.value).toBe('2026-10-23');
			expect(r.el('input[name="fristZeit"]')?.value).toBe('00:30');
		});
	});
});
