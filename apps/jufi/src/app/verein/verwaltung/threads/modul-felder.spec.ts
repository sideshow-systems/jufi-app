import { TestBed } from '@angular/core/testing';
import type { Feldfehler, ModulEntwurf, Rollenfilter, UmfrageSperre } from '@jufi/domain';
import { ModulFelderComponent, zeigtModulFeld } from './modul-felder';

type Umfrage = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;

const info = (rest: Partial<Extract<ModulEntwurf, { typ: 'INFO' }>> = {}): ModulEntwurf => ({
	typ: 'INFO',
	id: 'm1',
	titel: null,
	text: 'Hallo',
	...rest,
});

const termin = (): ModulEntwurf => ({
	typ: 'TERMIN',
	id: 'm2',
	titel: null,
	termin: { startDatum: '2026-10-24', endDatum: null, beginn: null, ende: null, ort: null, treffpunkt: null },
});

const umfrage = (rest: Partial<Umfrage> = {}): Umfrage => ({
	typ: 'UMFRAGE',
	id: 'm3',
	titel: null,
	frage: 'Kommst du?',
	einheit: 'PERSON',
	mehrfach: false,
	teilnahme: false,
	vielleicht: true,
	frist: null,
	ergebnisse: 'ALLE',
	optionen: [
		{ schluessel: 'o1', text: 'Ja' },
		{ schluessel: 'o2', text: 'Nein' },
		{ schluessel: null, text: 'Neu' },
	],
	...rest,
});

const SPERRE_O1: UmfrageSperre = { beantwortet: true, schluessel: ['o1'], mehrfachGenutzt: false };
const HINWEIS = 'Gesperrt, weil schon Antworten da sind';

function tiefEingefroren<T>(w: T): T {
	if (typeof w === 'object' && w !== null) {
		Object.values(w).forEach(tiefEingefroren);
		Object.freeze(w);
	}
	return w;
}

function oeffne(
	modul: ModulEntwurf,
	opt: {
		index?: number;
		rollenfilter?: Rollenfilter;
		sperre?: UmfrageSperre | null;
		fehler?: Feldfehler[];
		folgt?: boolean;
	} = {},
) {
	const fixture = TestBed.createComponent(ModulFelderComponent);
	fixture.componentRef.setInput('modul', tiefEingefroren(modul));
	fixture.componentRef.setInput('index', opt.index ?? 0);
	fixture.componentRef.setInput('rollenfilter', opt.rollenfilter ?? 'JUNGFISCHER_FAMILIE');
	fixture.componentRef.setInput('sperre', opt.sperre ?? null);
	fixture.componentRef.setInput('fehler', opt.fehler ?? []);
	fixture.detectChanges();
	const gemeldet: ModulEntwurf[] = [];
	fixture.componentInstance.geaendert.subscribe((m) => {
		gemeldet.push(m);
		// Der Editor haelt den Entwurf und reicht jede Aenderung zurueck; ohne das finge jede
		// Eingabe wieder beim Ausgangsmodul an.
		if (opt.folgt !== false) {
			fixture.componentRef.setInput('modul', tiefEingefroren(m));
			fixture.detectChanges();
		}
	});
	const seite = fixture.nativeElement as HTMLElement;
	const el = <T extends HTMLElement = HTMLInputElement>(s: string) => seite.querySelector<T>(s);
	const tippe = (s: string, wert: string) => {
		const feld = el(s);
		if (!feld) throw new Error(`Feld fehlt: ${s}`);
		feld.value = wert;
		feld.dispatchEvent(new Event('input', { bubbles: true }));
		// Auswahlfelder melden ueber change, Textfelder ueber input; ein Mensch loest je nach Feld das eine aus.
		feld.dispatchEvent(new Event('change', { bubbles: true }));
	};
	const letzte = () => gemeldet[gemeldet.length - 1];
	return { fixture, seite, gemeldet, el, tippe, letzte };
}

describe('jf-modul-felder', () => {
	describe('Einheit', () => {
		function einheiten(r: ReturnType<typeof oeffne>) {
			return [...r.seite.querySelectorAll('select[name="einheit"] option')].map((o) => o.textContent?.trim());
		}

		it('bietet bei "Nur Familie" "Pro Jungfischer" nicht an', () => {
			const r = oeffne(umfrage(), { rollenfilter: 'NUR_FAMILIE' });
			expect(einheiten(r)).toEqual(['Pro Erwachsenem', 'Pro Person']);
		});

		it('bietet bei "Jungfischer + Familie" alle drei an', () => {
			const r = oeffne(umfrage(), { rollenfilter: 'JUNGFISCHER_FAMILIE' });
			expect(einheiten(r)).toEqual(['Pro Jungfischer', 'Pro Erwachsenem', 'Pro Person']);
		});

		it('zeigt eine nicht mehr passende Einheit markiert an, damit ihr Fehler sichtbar bleibt', () => {
			const r = oeffne(umfrage({ einheit: 'JUNGFISCHER' }), {
				rollenfilter: 'NUR_FAMILIE',
				fehler: [{ feld: 'module.0.einheit', text: 'Diese Einheit fragt bei dieser Zielgruppe niemanden.' }],
			});
			const gewaehlt = r.el<HTMLSelectElement>('select[name="einheit"]')?.selectedOptions[0];
			expect(gewaehlt?.value).toBe('JUNGFISCHER');
			expect(gewaehlt?.textContent).toContain('Pro Jungfischer');
			expect(gewaehlt?.textContent).toContain('passt nicht');
			expect(r.seite.textContent).toContain('fragt bei dieser Zielgruppe niemanden');
			expect(r.gemeldet).toEqual([]);
		});

		it('meldet die gewaehlte Einheit', () => {
			const r = oeffne(umfrage());
			r.tippe('select[name="einheit"]', 'ERWACHSENER');
			expect(r.letzte()).toMatchObject({ einheit: 'ERWACHSENER' });
		});
	});

	describe('Frist', () => {
		it('rechnet Datum und Uhrzeit in Berlin nach UTC um', () => {
			const r = oeffne(umfrage());
			r.tippe('input[name="fristTag"]', '2026-10-22');
			r.tippe('input[name="fristZeit"]', '18:00');
			expect(r.letzte()).toMatchObject({ frist: '2026-10-22T16:00:00.000Z' });
		});

		it('gilt im Winter mit einer Stunde Versatz', () => {
			const r = oeffne(umfrage());
			r.tippe('input[name="fristTag"]', '2026-12-01');
			r.tippe('input[name="fristZeit"]', '18:00');
			expect(r.letzte()).toMatchObject({ frist: '2026-12-01T17:00:00.000Z' });
		});

		it('ein Datum allein bekommt eine sichtbare Uhrzeit statt einer stillen', () => {
			const r = oeffne(umfrage());
			r.tippe('input[name="fristTag"]', '2026-10-22');
			expect(r.el('input[name="fristZeit"]')?.value).toBe('18:00');
			expect(r.letzte()).toMatchObject({ frist: '2026-10-22T16:00:00.000Z' });
		});

		it('eine neue Uhrzeit aendert nur die Uhrzeit', () => {
			const r = oeffne(umfrage({ frist: '2026-10-22T16:00:00.000Z' }));
			r.tippe('input[name="fristZeit"]', '09:30');
			expect(r.letzte()).toMatchObject({ frist: '2026-10-22T07:30:00.000Z' });
		});

		it('zeigt eine gespeicherte Frist als Berliner Datum und Uhrzeit', () => {
			const r = oeffne(umfrage({ frist: '2026-10-22T22:30:00.000Z' }));
			expect(r.el('input[name="fristTag"]')?.value).toBe('2026-10-23');
			expect(r.el('input[name="fristZeit"]')?.value).toBe('00:30');
			expect(r.el('input[name="ohneFrist"]')?.checked).toBe(false);
		});

		it('"ohne Frist" ist ohne Frist angehakt und entfernt eine gesetzte Frist', () => {
			expect(oeffne(umfrage()).el('input[name="ohneFrist"]')?.checked).toBe(true);
			const r = oeffne(umfrage({ frist: '2026-10-22T16:00:00.000Z' }));
			r.el('input[name="ohneFrist"]')?.click();
			expect(r.letzte()).toMatchObject({ frist: null });
		});

		const MIT_FRIST = '2026-10-22T16:00:00.000Z';

		it('ein leeres Datumsfeld mitten im Tippen ist nicht "ohne Frist"', () => {
			const r = oeffne(umfrage({ frist: MIT_FRIST }));
			r.tippe('input[name="fristTag"]', '');
			expect(r.gemeldet).toEqual([]);
			expect(r.el('input[name="ohneFrist"]')?.checked).toBe(false);
			expect(r.el('input[name="fristTag"]')?.disabled).toBe(false);
			expect(r.el('input[name="fristZeit"]')?.value).toBe('18:00');
		});

		it('ein unfertiges Jahr wird weder gemeldet noch ins Feld zurueckgeschrieben', () => {
			const r = oeffne(umfrage({ frist: MIT_FRIST }));
			for (const roh of ['0002-10-22', '0020-10-22', '0202-10-22']) {
				r.tippe('input[name="fristTag"]', roh);
				expect(r.el('input[name="fristTag"]')?.value).toBe(roh);
			}
			expect(r.gemeldet).toEqual([]);
			r.tippe('input[name="fristTag"]', '2027-10-22');
			expect(r.letzte()).toMatchObject({ frist: '2027-10-22T16:00:00.000Z' });
		});

		it('ein unfertiges Feld springt erst beim Verlassen auf den Stand des Moduls zurueck', () => {
			const r = oeffne(umfrage({ frist: MIT_FRIST }));
			r.tippe('input[name="fristTag"]', '0002-10-22');
			r.el('input[name="fristTag"]')?.dispatchEvent(new Event('blur'));
			expect(r.el('input[name="fristTag"]')?.value).toBe('2026-10-22');
			r.tippe('input[name="fristZeit"]', '');
			expect(r.el('input[name="fristZeit"]')?.value).toBe('');
			r.el('input[name="fristZeit"]')?.dispatchEvent(new Event('blur'));
			expect(r.el('input[name="fristZeit"]')?.value).toBe('18:00');
			expect(r.gemeldet).toEqual([]);
		});

		it('eine geleerte Uhrzeit aendert die Frist nicht', () => {
			const r = oeffne(umfrage({ frist: MIT_FRIST }));
			r.tippe('input[name="fristZeit"]', '');
			expect(r.gemeldet).toEqual([]);
			expect(r.el('input[name="ohneFrist"]')?.checked).toBe(false);
		});

		it('"ohne Frist" abwaehlen schaltet die Felder frei und das bleibt bei anderen Eingaben so', () => {
			const r = oeffne(umfrage());
			r.el('input[name="ohneFrist"]')?.click();
			r.fixture.detectChanges();
			expect(r.gemeldet).toEqual([]);
			expect(r.el('input[name="fristTag"]')?.disabled).toBe(false);
			r.tippe('input[name="frage"]', 'Wer kommt?');
			expect(r.el('input[name="ohneFrist"]')?.checked).toBe(false);
			expect(r.el('input[name="fristTag"]')?.disabled).toBe(false);
		});

		it('eine Uhrzeit ohne Datum bleibt bei anderen Eingaben stehen und gilt, sobald das Datum kommt', () => {
			const r = oeffne(umfrage());
			r.el('input[name="ohneFrist"]')?.click();
			r.tippe('input[name="fristZeit"]', '09:30');
			expect(r.gemeldet).toEqual([]);
			r.tippe('input[name="frage"]', 'Wer kommt?');
			expect(r.el('input[name="fristZeit"]')?.value).toBe('09:30');
			r.tippe('input[name="fristTag"]', '2026-10-22');
			expect(r.letzte()).toMatchObject({ frist: '2026-10-22T07:30:00.000Z' });
		});

		it('eine eingegebene Frist bleibt bei anderen Eingaben stehen', () => {
			const r = oeffne(umfrage({ frist: MIT_FRIST }));
			r.tippe('input[name="frage"]', 'Wer kommt?');
			expect(r.el('input[name="fristTag"]')?.value).toBe('2026-10-22');
			expect(r.el('input[name="ohneFrist"]')?.checked).toBe(false);
		});

		it('zeigt den Fehler an der Frist', () => {
			const r = oeffne(umfrage({ frist: '2026-10-22T16:00:00.000Z' }), {
				fehler: [{ feld: 'module.0.frist', text: 'Frist kaputt' }],
			});
			expect(r.el('input[name="fristTag"]')?.getAttribute('aria-invalid')).toBe('true');
			expect(r.seite.querySelector('p.fehler[role="alert"]')?.textContent).toContain('Frist kaputt');
		});
	});

	describe('Sperre durch Antworten', () => {
		it('sperrt Teilnahme und Einheit und sagt warum', () => {
			const r = oeffne(umfrage({ teilnahme: true }), { sperre: SPERRE_O1 });
			expect(r.el('input[name="teilnahme"]')?.disabled).toBe(true);
			expect(r.el('select[name="einheit"]')?.hasAttribute('disabled')).toBe(true);
			expect(r.seite.textContent).toContain(HINWEIS);
		});

		it('ohne Antwort mit Option bleibt alles frei, auch wenn eine Antwort ohne Option da ist', () => {
			const r = oeffne(umfrage({ teilnahme: true }), {
				sperre: { beantwortet: true, schluessel: [], mehrfachGenutzt: false },
			});
			expect(r.el('input[name="teilnahme"]')?.disabled).toBe(false);
			expect(r.el('select[name="einheit"]')?.hasAttribute('disabled')).toBe(false);
			expect(r.seite.textContent).not.toContain(HINWEIS);
		});

		it('ohne Sperre ist nichts gesperrt', () => {
			const r = oeffne(umfrage());
			expect(r.el('input[name="teilnahme"]')?.disabled).toBe(false);
			expect(r.seite.textContent).not.toContain(HINWEIS);
		});

		it('"Entfernen" fehlt an beantworteten Optionen und nur dort', () => {
			const r = oeffne(umfrage(), { sperre: SPERRE_O1 });
			const entfernen = [...r.seite.querySelectorAll('li[data-option]')].map(
				(li) => li.querySelector('button[aria-label^="Entfernen"]') !== null,
			);
			expect(entfernen).toEqual([false, true, true]);
		});

		it('"Mehrfachauswahl" laesst sich bei genutzter Mehrfachauswahl nicht abschalten', () => {
			const gesperrt = { beantwortet: true, schluessel: [], mehrfachGenutzt: true };
			const r = oeffne(umfrage({ mehrfach: true }), { sperre: gesperrt });
			expect(r.el('input[name="mehrfach"]')?.disabled).toBe(true);
			expect(r.seite.textContent).toContain(HINWEIS);
		});

		it('"Mehrfachauswahl" laesst sich einschalten, auch wenn sie nie genutzt wurde', () => {
			const frei = { beantwortet: true, schluessel: ['o1'], mehrfachGenutzt: true };
			const r = oeffne(umfrage({ mehrfach: false }), { sperre: frei });
			expect(r.el('input[name="mehrfach"]')?.disabled).toBe(false);
		});

		it('"Mehrfachauswahl" bleibt frei, solange sie nicht genutzt wurde', () => {
			const r = oeffne(umfrage({ mehrfach: true }), { sperre: SPERRE_O1 });
			expect(r.el('input[name="mehrfach"]')?.disabled).toBe(false);
		});

		it('"Vielleicht anbieten" ist gesperrt, wenn jemand "Vielleicht" gewaehlt hat', () => {
			const sperre = { beantwortet: true, schluessel: ['vielleicht'], mehrfachGenutzt: false };
			const r = oeffne(umfrage({ teilnahme: true, vielleicht: true }), { sperre });
			expect(r.el('input[name="vielleicht"]')?.disabled).toBe(true);
		});
	});

	describe('Fehler am Feld', () => {
		it('ein Fehler an module.1.termin erscheint am Termin des Moduls mit Index 1', () => {
			const r = oeffne(termin(), {
				index: 1,
				fehler: [{ feld: 'module.1.termin', text: 'Das Ende liegt vor dem Beginn.' }],
			});
			const hinweis = r.seite.querySelector('p.fehler[role="alert"]');
			expect(hinweis?.textContent).toContain('Das Ende liegt vor dem Beginn.');
			expect(r.el('input[name="startDatum"]')?.getAttribute('aria-invalid')).toBe('true');
			expect(r.el('input[name="beginn"]')?.getAttribute('aria-invalid')).toBe('true');
			expect(r.el('input[name="ort"]')?.getAttribute('aria-invalid')).toBeNull();
		});

		it('Fehler anderer Module und anderer Felder erscheinen nicht', () => {
			const r = oeffne(termin(), {
				index: 1,
				fehler: [
					{ feld: 'module.0.termin', text: 'anderes Modul' },
					{ feld: 'module.1.ort', text: 'Ort zu lang' },
					{ feld: 'titel', text: 'Titel des Threads' },
				],
			});
			const texte = [...r.seite.querySelectorAll('p.fehler')].map((p) => p.textContent?.trim());
			expect(texte).toEqual(['Ort zu lang']);
			expect(r.el('input[name="ort"]')?.getAttribute('aria-invalid')).toBe('true');
		});

		it('zeigt je Feld die Fehler von Titel, Text, Frage und Optionen', () => {
			const fehler = ['titel', 'frage', 'optionen'].map((f) => ({ feld: `module.2.${f}`, text: `Fehler ${f}` }));
			const r = oeffne(umfrage(), { index: 2, fehler });
			const texte = [...r.seite.querySelectorAll('p.fehler')].map((p) => p.textContent?.trim()).sort();
			expect(texte).toEqual(['Fehler frage', 'Fehler optionen', 'Fehler titel']);
			const info2 = oeffne(info(), { index: 2, fehler: [{ feld: 'module.2.text', text: 'Fehler text' }] });
			expect(info2.el('textarea')?.getAttribute('aria-invalid')).toBe('true');
		});

		it('verbindet Eingabe und Fehlertext ueber aria-describedby', () => {
			const r = oeffne(info(), { fehler: [{ feld: 'module.0.titel', text: 'zu lang' }] });
			const kennung = r.el('input[name="titel"]')?.getAttribute('aria-describedby');
			expect(kennung).toBeTruthy();
			expect(r.seite.querySelector(`#${kennung}`)?.textContent).toContain('zu lang');
		});

		it('zeigt den Konflikt an den Optionen auch bei einer Teilnahme-Umfrage, an "Vielleicht anbieten"', () => {
			const text = 'Auf „Vielleicht“ hat schon jemand geantwortet.';
			const r = oeffne(umfrage({ teilnahme: true, vielleicht: false }), {
				fehler: [{ feld: 'module.0.optionen', text }],
			});
			expect(r.seite.querySelector('p.fehler[role="alert"]')?.textContent).toContain(text);
			const vielleicht = r.el('input[name="vielleicht"]');
			expect(vielleicht?.getAttribute('aria-invalid')).toBe('true');
			expect(r.seite.querySelector(`#${vielleicht?.getAttribute('aria-describedby')}`)?.textContent).toContain(text);
		});
	});

	describe('zeigtModulFeld', () => {
		// Jedes Feld, das der Server je an einem Modul nennen kann (entwurfAus, entwurfFehler, vergleich.ts).
		const ALLE = [
			'typ',
			'id',
			'titel',
			'text',
			'termin',
			'ort',
			'treffpunkt',
			'frage',
			'teilnahme',
			'vielleicht',
			'mehrfach',
			'einheit',
			'frist',
			'ergebnisse',
			'optionen',
		];
		const FAELLE: [string, ModulEntwurf][] = [
			['Info', info()],
			['Termin', termin()],
			['Umfrage', umfrage()],
			['Teilnahme', umfrage({ teilnahme: true })],
		];

		it.each(FAELLE)('%s: genau die genannten Felder zeigen ihren Fehler', (_, modul) => {
			const ergebnis = ALLE.map((feld) => {
				const r = oeffne(modul, { fehler: [{ feld: `module.0.${feld}`, text: `Fehler ${feld}` }] });
				return { feld, sichtbar: r.seite.textContent?.includes(`Fehler ${feld}`) ?? false };
			});
			expect(ergebnis).toEqual(ALLE.map((feld) => ({ feld, sichtbar: zeigtModulFeld(modul, feld) })));
		});

		it('kennt die Optionen einer Teilnahme, aber weder Mehrfachauswahl noch Vielleicht noch Ergebnisse', () => {
			const teilnahme = umfrage({ teilnahme: true });
			expect(zeigtModulFeld(teilnahme, 'optionen')).toBe(true);
			expect(zeigtModulFeld(teilnahme, 'mehrfach')).toBe(false);
			expect(zeigtModulFeld(teilnahme, 'vielleicht')).toBe(false);
			expect(zeigtModulFeld(umfrage(), 'mehrfach')).toBe(true);
			expect(zeigtModulFeld(umfrage(), 'ergebnisse')).toBe(false);
			expect(zeigtModulFeld(info(), 'optionen')).toBe(false);
			expect(zeigtModulFeld(termin(), 'ort')).toBe(true);
		});
	});

	describe('gesteuert', () => {
		it('veraendert das uebergebene Modul nicht, sondern meldet ein neues', () => {
			const r = oeffne(info({ text: 'alt' }), { folgt: false });
			r.tippe('textarea', 'neu');
			expect(r.letzte()).toMatchObject({ typ: 'INFO', id: 'm1', text: 'neu' });
			expect(r.fixture.componentInstance.modul()).toMatchObject({ text: 'alt' });
			expect(r.letzte()).not.toBe(r.fixture.componentInstance.modul());
		});

		it('eine leere Ueberschrift wird null', () => {
			const r = oeffne(info({ titel: 'Alt' }));
			r.tippe('input[name="titel"]', '');
			expect(r.letzte()).toMatchObject({ titel: null });
		});
	});

	describe('Info', () => {
		it('zaehlt Zeichen erst ab 9 000', () => {
			expect(oeffne(info({ text: 'a'.repeat(8999) })).seite.querySelector('.zaehler')).toBeNull();
			const r = oeffne(info({ text: 'a'.repeat(9000) }));
			expect(r.seite.querySelector('.zaehler')?.textContent).toContain('9.000');
			expect(r.seite.querySelector('.zaehler')?.textContent).toContain('10.000');
		});

		it('zaehlt Zeichen, nicht UTF-16-Einheiten', () => {
			const r = oeffne(info({ text: '🐟'.repeat(9000) }));
			expect(r.seite.querySelector('.zaehler')?.textContent).toContain('9.000 von');
		});

		it('hat die Knopfleiste, und ein Klick darauf meldet den neuen Text', () => {
			const r = oeffne(info({ text: 'Hallo Welt' }));
			const textarea = r.el<HTMLTextAreaElement>('textarea');
			textarea?.setSelectionRange(0, 5);
			r.el('button[aria-label="Fett"]')?.click();
			expect(r.letzte()).toMatchObject({ text: '**Hallo** Welt' });
		});
	});

	describe('Termin', () => {
		it('meldet Start, Ende und Uhrzeiten; leere optionale Felder werden null', () => {
			const r = oeffne(termin());
			r.tippe('input[name="startDatum"]', '2026-11-01');
			expect(r.letzte()).toMatchObject({ termin: { startDatum: '2026-11-01', endDatum: null } });
			r.tippe('input[name="endDatum"]', '2026-11-02');
			r.tippe('input[name="beginn"]', '10:00');
			r.tippe('input[name="ende"]', '12:00');
			r.tippe('input[name="ort"]', 'Teich');
			r.tippe('input[name="treffpunkt"]', 'Parkplatz');
			expect(r.letzte()).toMatchObject({
				termin: { endDatum: '2026-11-02', beginn: '10:00', ende: '12:00', ort: 'Teich', treffpunkt: 'Parkplatz' },
			});
			r.tippe('input[name="ort"]', '');
			expect(r.letzte()).toMatchObject({ termin: { ort: null } });
		});
	});

	describe('Umfrage', () => {
		it('mit Teilnahme gibt es "Vielleicht anbieten" statt einer Optionsliste', () => {
			const r = oeffne(umfrage({ teilnahme: true }));
			expect(r.el('input[name="vielleicht"]')).not.toBeNull();
			expect(r.seite.querySelector('li[data-option]')).toBeNull();
			expect(r.seite.querySelector('input[name="mehrfach"]')).toBeNull();
		});

		it('ohne Teilnahme gibt es die Optionsliste und kein "Vielleicht anbieten"', () => {
			const r = oeffne(umfrage());
			expect(r.el('input[name="vielleicht"]')).toBeNull();
			expect(r.seite.querySelectorAll('li[data-option]').length).toBe(3);
		});

		it('Teilnahme einschalten setzt die festen Antworten, ausschalten gibt eine Ausgangsliste', () => {
			const an = oeffne(umfrage());
			an.el('input[name="teilnahme"]')?.click();
			const m = an.letzte() as Umfrage;
			expect(m.teilnahme).toBe(true);
			expect(m.optionen.map((o) => o.text)).toEqual(['Dabei', 'Vielleicht', 'Abgesagt']);

			const aus = oeffne(umfrage({ teilnahme: true }));
			aus.el('input[name="teilnahme"]')?.click();
			const n = aus.letzte() as Umfrage;
			expect(n.teilnahme).toBe(false);
			expect(n.optionen.map((o) => o.schluessel)).toEqual([null, null]);
		});

		it('Teilnahme einschalten nimmt eine versteckte Mehrfachauswahl mit', () => {
			const r = oeffne(umfrage({ mehrfach: true }));
			r.el('input[name="teilnahme"]')?.click();
			expect(r.letzte()).toMatchObject({ teilnahme: true, mehrfach: false });
		});

		it('"Vielleicht anbieten" ausschalten nimmt "Vielleicht" aus den Antworten', () => {
			const r = oeffne(umfrage({ teilnahme: true, vielleicht: true }));
			r.el('input[name="vielleicht"]')?.click();
			const m = r.letzte() as Umfrage;
			expect(m.vielleicht).toBe(false);
			expect(m.optionen.map((o) => o.text)).toEqual(['Dabei', 'Abgesagt']);
		});

		it('Hinzufuegen haengt eine neue Option ohne Schluessel an', () => {
			const r = oeffne(umfrage());
			r.seite.querySelector<HTMLButtonElement>('button.hinzufuegen')?.click();
			const m = r.letzte() as Umfrage;
			expect(m.optionen.length).toBe(4);
			expect(m.optionen[3]).toEqual({ schluessel: null, text: '' });
		});

		it('Hinzufuegen ist bei 20 Optionen gesperrt', () => {
			const optionen = Array.from({ length: 20 }, (_, i) => ({ schluessel: null, text: `o${i}` }));
			const r = oeffne(umfrage({ optionen }));
			expect(r.seite.querySelector<HTMLButtonElement>('button.hinzufuegen')?.disabled).toBe(true);
		});

		it('Hoch und Runter tauschen Nachbarn, am Rand sind sie gesperrt', () => {
			const r = oeffne(umfrage());
			const zeile = (i: number) => r.seite.querySelectorAll('li[data-option]')[i];
			expect(zeile(0).querySelector<HTMLButtonElement>('button[aria-label^="Nach oben"]')?.disabled).toBe(true);
			expect(zeile(2).querySelector<HTMLButtonElement>('button[aria-label^="Nach unten"]')?.disabled).toBe(true);
			zeile(1).querySelector<HTMLButtonElement>('button[aria-label^="Nach oben"]')?.click();
			expect((r.letzte() as Umfrage).optionen.map((o) => o.text)).toEqual(['Nein', 'Ja', 'Neu']);
			zeile(0).querySelector<HTMLButtonElement>('button[aria-label^="Nach unten"]')?.click();
			expect((r.letzte() as Umfrage).optionen.map((o) => o.text)).toEqual(['Ja', 'Nein', 'Neu']);
		});

		it('Entfernen nimmt genau diese Option heraus', () => {
			const r = oeffne(umfrage());
			r.seite
				.querySelectorAll('li[data-option]')[1]
				.querySelector<HTMLButtonElement>('button[aria-label^="Entfernen"]')
				?.click();
			expect((r.letzte() as Umfrage).optionen.map((o) => o.text)).toEqual(['Ja', 'Neu']);
		});

		it('Umbenennen einer Option behaelt ihren Schluessel', () => {
			const r = oeffne(umfrage());
			r.tippe('input[name="option-0"]', 'Klar');
			expect((r.letzte() as Umfrage).optionen[0]).toEqual({ schluessel: 'o1', text: 'Klar' });
		});

		it('meldet Frage, Ergebnisse und Mehrfachauswahl', () => {
			const r = oeffne(umfrage());
			r.tippe('input[name="frage"]', 'Wer kommt?');
			expect(r.letzte()).toMatchObject({ frage: 'Wer kommt?' });
			r.tippe('select[name="ergebnisse"]', 'SUMME');
			expect(r.letzte()).toMatchObject({ ergebnisse: 'SUMME' });
			r.el('input[name="mehrfach"]')?.click();
			expect(r.letzte()).toMatchObject({ mehrfach: true });
		});

		it('beschriftet die Ergebnisse mit den Texten der Domaene', () => {
			const r = oeffne(umfrage());
			const texte = [...r.seite.querySelectorAll('select[name="ergebnisse"] option')].map((o) => o.textContent?.trim());
			expect(texte).toEqual(['Für alle', 'Nur als Summe', 'Nur Jugendleiter']);
		});
	});
});
