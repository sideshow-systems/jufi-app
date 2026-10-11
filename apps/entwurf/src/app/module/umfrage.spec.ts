import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { M, P, T } from '../daten/beispieldaten';
import { EntwurfStore } from '../daten/store';
import type { HelferModul, UmfrageModul } from '../daten/typen';
import { modulVon, threadVon } from '../regeln/testhilfe';
import { testProvider } from '../testhilfe';
import { HelferBauteil } from './helfer';
import { UmfrageBauteil } from './umfrage';

function aufbauen<K>(bauteil: Type<K>, threadId: string, modulId: string) {
	TestBed.configureTestingModule({ providers: testProvider() });
	const store = TestBed.inject(EntwurfStore);
	const f = TestBed.createComponent(bauteil);
	const neu = () => {
		f.componentRef.setInput('thread', threadVon(store.stand(), threadId));
		f.componentRef.setInput('modul', modulVon(store.stand(), threadId, modulId));
		f.detectChanges();
	};
	neu();
	return { f, store, neu, el: f.nativeElement as HTMLElement };
}

const zeile = (el: HTMLElement, label: string) =>
	[...el.querySelectorAll<HTMLElement>('.zeile')].find(
		(z) => z.querySelector('.label')?.textContent?.trim() === label,
	)!;

describe('UmfrageBauteil', () => {
	it('zeigt Sandra je Kind eine Zeile und traegt fuer Max ein', () => {
		const { el, store, neu } = aufbauen(UmfrageBauteil, T.bowling, M.bowlingUmfrage);
		expect(zeile(el, 'Lena')).toBeTruthy();
		expect(zeile(el, 'Max')).toBeTruthy();
		expect(zeile(el, 'Lena').textContent).toContain('✓');
		expect(zeile(el, 'Lena').textContent).not.toContain('eingetragen von');

		const ja = [...zeile(el, 'Max').querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Ja')!;
		ja.click();
		neu();

		const m = modulVon<UmfrageModul>(store.stand(), T.bowling, M.bowlingUmfrage);
		expect(m.antworten).toContainEqual(expect.objectContaining({ fuer: P.max, von: P.sandra, optionen: ['ja'] }));
		expect(zeile(el, 'Max').textContent).toContain('von dir eingetragen');
	});

	it('zeigt "eingetragen von", wenn ein Elternteil fuer das Kind geantwortet hat', () => {
		const { el, store, neu } = aufbauen(UmfrageBauteil, T.bowling, M.bowlingUmfrage);
		store.setzeIch(P.thomas);
		store.antworten(T.bowling, M.bowlingUmfrage, P.jonas, ['nein']);
		store.setzeIch(P.jonas);
		neu();
		expect(zeile(el, 'Jonas').textContent).toContain('eingetragen von Thomas');
	});

	it('zeigt nach der Frist nur noch die Antwort', () => {
		const { el, store, f } = aufbauen(UmfrageBauteil, T.bowling, M.bowlingUmfrage);
		const m = modulVon<UmfrageModul>(store.stand(), T.bowling, M.bowlingUmfrage);
		f.componentRef.setInput('modul', { ...m, frist: '2026-10-01T20:00' });
		f.detectChanges();
		expect(el.textContent).toContain('Frist abgelaufen');
		expect(zeile(el, 'Max').querySelectorAll('button').length).toBe(0);
	});

	it('zeigt Summen und Namen bei Ergebnissen fuer alle', () => {
		const { el } = aufbauen(UmfrageBauteil, T.bowling, M.bowlingUmfrage);
		expect(el.textContent).toContain('Ja (2)');
		expect(el.textContent).toContain('Lena, Paul');
	});
});

describe('HelferBauteil', () => {
	it('traegt Sandra beim Kuchen ein und zeigt 4/5', () => {
		const { el, store, neu } = aufbauen(HelferBauteil, T.herbstfest, M.herbstHelfer);
		expect(el.textContent).toContain('3/5');
		const platz = [...el.querySelectorAll<HTMLElement>('.platz')].find((p) => p.textContent?.includes('Kuchen'))!;
		platz.querySelector<HTMLButtonElement>('button')!.click();
		neu();
		expect(el.textContent).toContain('4/5');
		const m = modulVon<HelferModul>(store.stand(), T.herbstfest, M.herbstHelfer);
		expect(m.plaetze[0].eintraege).toContainEqual({ fuer: P.sandra, von: P.sandra });
		expect(platz.textContent).toContain('Austragen');
	});

	it('sperrt einen vollen Platz', () => {
		const { el, store, neu } = aufbauen(HelferBauteil, T.herbstfest, M.herbstHelfer);
		for (const id of ['e-stefan', 'e-sabine']) store.helferEintragen(T.herbstfest, M.herbstHelfer, 'h-kuchen', id);
		neu();
		const platz = [...el.querySelectorAll<HTMLElement>('.platz')].find((p) => p.textContent?.includes('Kuchen'))!;
		const knopf = platz.querySelector<HTMLButtonElement>('button')!;
		expect(knopf.disabled).toBe(true);
		expect(knopf.textContent).toContain('voll');
	});
});
