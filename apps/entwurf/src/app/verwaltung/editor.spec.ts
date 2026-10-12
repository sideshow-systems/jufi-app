import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { P } from '../daten/beispieldaten';
import { EntwurfStore } from '../daten/store';
import { ThemaService } from '../gestaltung/thema';
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

	it('zeigt im Modus-Feld den Modus, der gespeichert wird', async () => {
		const { el } = await oeffne('/glonntal/verwaltung/threads/neu', P.thomas);
		const modus = [...el.querySelectorAll('label.feld')].find((l) => l.textContent?.includes('Modus'))!;
		expect(modus.querySelector('select')!.value).toBe(leererThread(P.thomas).modus);
	});

	it('zeigt in der Rechte-Vorlage die Vorlage der Person', async () => {
		const { el } = await oeffne('/glonntal/verwaltung/rechte', P.thomas);
		const karte = [...el.querySelectorAll('jf-karte')].find((k) =>
			k.querySelector('h2')?.textContent?.includes('Katrin'),
		)!;
		expect(karte.querySelector('select')!.value).toBe('jugendleiter');
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
		// Als Katrin: die eigenen Rechte sind ohnehin gesperrt, der Schutz zeigt sich nur von aussen.
		const { el } = await oeffne('/glonntal/verwaltung/rechte', P.katrin);
		const geschuetzt = el.querySelector<HTMLInputElement>(
			`input[data-person="${P.thomas}"][data-recht="rechteVerwalten"]`,
		)!;
		expect(geschuetzt.disabled).toBe(true);
		expect(el.textContent).toContain('Mindestens eine Person muss Rechte verwalten können');
	});

	it('laesst Thomas die eigenen Rechte nicht aendern, die von Katrin schon', async () => {
		const { el } = await oeffne('/glonntal/verwaltung/rechte', P.thomas);
		const eigene = el.querySelectorAll<HTMLInputElement>(`input[data-person="${P.thomas}"]`);
		expect([...eigene].every((i) => i.disabled)).toBe(true);
		expect(
			el.querySelector<HTMLInputElement>(`input[data-person="${P.katrin}"][data-recht="mitglieder"]`)!.disabled,
		).toBe(false);
		expect(el.textContent).toContain('Deine eigenen Rechte');
	});

	it('verweigert dem Store eine Aenderung der eigenen Rechte', async () => {
		const { store } = await oeffne('/glonntal/verwaltung/rechte', P.thomas);
		store.rechteSetzen(P.thomas, []);
		expect(store.person().rechte).toHaveLength(7);
	});

	it('erzeugt Einladungen in diesen Entwurf statt auf jufi-app.de', async () => {
		const { harness, el } = await oeffne(`/glonntal/verwaltung/personen/${P.max}`, P.thomas);
		knopf(el, 'Einladungslink erzeugen').click();
		harness.detectChanges();
		const link = el.querySelector('.einladung .link')!.textContent!;
		expect(link.startsWith(`${location.origin}/entwurf/glonntal?einladung=`)).toBe(true);
		expect(el.querySelector('.einladung .text')!.textContent).toContain(link);
	});

	it('bietet in den Einstellungen Hell, Dunkel und System an', async () => {
		const { harness, el } = await oeffne('/glonntal/verwaltung/einstellungen', P.thomas);
		knopf(el.querySelector('[aria-label="Darstellung"]')!, 'Dunkel').click();
		harness.detectChanges();
		expect(TestBed.inject(ThemaService).wahl()).toBe('dunkel');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		TestBed.inject(ThemaService).setzeWahl('system');
		localStorage.removeItem('jufi-entwurf:thema');
	});
});

describe('Thread-Editor', () => {
	async function mitUmfrage() {
		const o = await oeffne('/glonntal/verwaltung/threads/neu', P.thomas);
		const titel = o.el.querySelector<HTMLInputElement>('input[name="titel"]')!;
		titel.value = 'Test';
		titel.dispatchEvent(new Event('input'));
		knopf(o.el.querySelector('.hinzufuegen')!, 'Umfrage').click();
		o.harness.detectChanges();
		return o;
	}
	const feld = (el: HTMLElement, text: string) =>
		[...el.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(text))!;
	function waehle(el: HTMLElement, text: string, wert: string) {
		const s = feld(el, text).querySelector('select')!;
		s.value = wert;
		s.dispatchEvent(new Event('change'));
	}
	function eigene(el: HTMLElement, text: string) {
		const t = feld(el, 'Eigene Antworten').querySelector('textarea')!;
		t.value = text;
		t.dispatchEvent(new Event('change'));
	}

	it('behaelt die Kennung unveraenderter eigener Antworten', async () => {
		const { store, harness, el } = await mitUmfrage();
		waehle(el, 'Antworten', 'eigene');
		harness.detectChanges();
		eigene(el, 'Pizza\nDöner');
		harness.detectChanges();
		eigene(el, 'Döner\nSalat\nPizza');
		harness.detectChanges();
		knopf(el, 'Entwurf speichern').click();
		await harness.fixture.whenStable();
		const m = store.stand().threads.find((t) => t.titel === 'Test')!.module[0];
		// o1 und o2 sind die Platzhalter beim Umschalten; Pizza und Doener behalten o3 und o4.
		expect(m.typ === 'umfrage' && m.optionen).toEqual([
			{ id: 'o4', text: 'Döner' },
			{ id: 'o5', text: 'Salat' },
			{ id: 'o3', text: 'Pizza' },
		]);
	});

	it('sagt, warum eigene Antworten keine Teilnahme-Umfrage sein koennen', async () => {
		const { harness, el } = await mitUmfrage();
		const teilnahme = () => feld(el, 'Ist Teilnahme-Umfrage').querySelector('input')!;
		expect(teilnahme().checked).toBe(true);
		waehle(el, 'Antworten', 'eigene');
		harness.detectChanges();
		expect(teilnahme().checked).toBe(false);
		expect(teilnahme().disabled).toBe(true);
		expect(feld(el, 'Ist Teilnahme-Umfrage').parentElement!.textContent).toContain('nur mit Ja / Nein');
	});

	it('speichert ohne gewaehlte Untergruppe nicht, statt an alle zu gehen', async () => {
		const { store, harness, el } = await mitUmfrage();
		const gruppe = el.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')[1];
		gruppe.click();
		harness.detectChanges();
		gruppe.click();
		harness.detectChanges();
		expect(el.querySelector<HTMLInputElement>('fieldset input[type="checkbox"]')!.checked).toBe(false);
		const vorher = store.stand().threads.length;
		knopf(el, 'Entwurf speichern').click();
		await harness.fixture.whenStable();
		expect(store.stand().threads).toHaveLength(vorher);
		expect(el.textContent).toContain('Wer soll den Thread sehen');
	});
});
