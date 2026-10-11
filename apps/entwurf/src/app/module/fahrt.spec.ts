import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { M, P, T } from '../daten/beispieldaten';
import { EntwurfStore } from '../daten/store';
import type { KostenModul } from '../daten/typen';
import { verwendungszweck } from '../regeln/fahrt-kosten';
import { person } from '../regeln/personen';
import { modulVon, threadVon } from '../regeln/testhilfe';
import { testProvider } from '../testhilfe';
import { FahrtBauteil } from './fahrt';
import { KostenBauteil } from './kosten';

function aufbauen<K>(bauteil: Type<K>, ich: string, threadId: string, modulId: string) {
	TestBed.configureTestingModule({ providers: testProvider() });
	const store = TestBed.inject(EntwurfStore);
	store.setzeIch(ich);
	const f = TestBed.createComponent(bauteil);
	const neu = () => {
		f.componentRef.setInput('thread', threadVon(store.stand(), threadId));
		f.componentRef.setInput('modul', modulVon(store.stand(), threadId, modulId));
		f.detectChanges();
	};
	neu();
	return { store, neu, el: f.nativeElement as HTMLElement };
}

const auto = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-auto="${id}"]`)!;
const knopf = (wurzel: HTMLElement, text: string) =>
	[...wurzel.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!;

describe('FahrtBauteil', () => {
	it('laesst Thomas Max in ein anderes Auto setzen', () => {
		const { el, store, neu } = aufbauen(FahrtBauteil, P.thomas, T.bowling, M.bowlingFahrt);
		store.mitfahrerSetzen(T.bowling, M.bowlingFahrt, P.max, 'a-maier', 'hin');
		neu();
		expect(auto(el, 'a-maier').textContent).toContain('Max');

		const max = [...auto(el, 'a-maier').querySelectorAll<HTMLElement>('.mitfahrer')].find((m) =>
			m.textContent?.includes('Max'),
		)!;
		knopf(max, 'In anderes Auto').click();
		neu();
		knopf(max, 'Fam. Huber').click();
		neu();

		expect(auto(el, 'a-huber-hin').textContent).toContain('Max');
		expect(auto(el, 'a-maier').textContent).not.toContain('Max');
	});

	it('laesst Thomas Max einsetzen, auch ohne Zusage und ohne bisheriges Auto', () => {
		const { el, neu } = aufbauen(FahrtBauteil, P.thomas, T.bowling, M.bowlingFahrt);
		const auswahl = auto(el, 'a-huber-hin').querySelector<HTMLSelectElement>('select[data-einsetzen]')!;
		expect([...auswahl.options].map((o) => o.textContent?.trim())).toContain('Max');

		auswahl.value = P.max;
		auswahl.dispatchEvent(new Event('change'));
		neu();

		expect(auto(el, 'a-huber-hin').textContent).toContain('Max');
	});

	it('zeigt Sandra keine Auswahl zum Einsetzen fremder Kinder', () => {
		const { el } = aufbauen(FahrtBauteil, P.sandra, T.bowling, M.bowlingFahrt);
		expect(el.querySelector('select[data-einsetzen]')).toBeNull();
	});

	it('zeigt Fahrer als Familie mit Abfahrt und freien Plaetzen', () => {
		const { el } = aufbauen(FahrtBauteil, P.sandra, T.bowling, M.bowlingFahrt);
		expect(auto(el, 'a-maier').textContent).toContain('Fam. Maier');
		expect(auto(el, 'a-maier').textContent).toContain('13:30 Kirchplatz');
		expect(auto(el, 'a-maier').textContent).toContain('1 frei');
	});
});

describe('KostenBauteil', () => {
	it('meldet Lenas Zahlung nach Max-Zusage', () => {
		const { el, store, neu } = aufbauen(KostenBauteil, P.sandra, T.bowling, M.bowlingKosten);
		store.antworten(T.bowling, M.bowlingUmfrage, P.max, ['ja']);
		neu();
		const lena = [...el.querySelectorAll<HTMLElement>('.kind')].find((k) => k.textContent?.includes('Lena'))!;
		knopf(lena, 'Habe bezahlt').click();
		neu();
		expect(modulVon<KostenModul>(store.stand(), T.bowling, M.bowlingKosten).status[P.lena]).toBe('gemeldet');
		expect(el.querySelectorAll('.kind').length).toBe(2);
	});
});

describe('verwendungszweck', () => {
	it('nimmt Titel ohne Emoji, Termin-Datum und vollen Namen', () => {
		TestBed.configureTestingModule({ providers: testProvider() });
		const stand = TestBed.inject(EntwurfStore).stand();
		const t = threadVon(stand, T.bowling);
		expect(verwendungszweck(t, person(stand, P.lena)!)).toBe('Bowling 17.10. – Lena Wagner');
	});
});
