import { TestBed } from '@angular/core/testing';
import { formatiere, KnopfleisteComponent } from './knopfleiste';

describe('formatiere', () => {
	it('fett umschliesst die Auswahl und markiert sie weiter', () => {
		expect(formatiere('Hallo Welt', 0, 5, 'fett')).toEqual({ text: '**Hallo** Welt', start: 2, ende: 7 });
	});

	it('kursiv ohne Auswahl setzt den Platzhalter und markiert ihn', () => {
		const r = formatiere('', 0, 0, 'kursiv');
		expect(r.text).toBe('_Text_');
		expect(r.text.slice(r.start, r.ende)).toBe('Text');
	});

	it('fett mitten im Text ohne Auswahl behaelt Anfang und Rest', () => {
		const r = formatiere('ab cd', 3, 3, 'fett');
		expect(r.text).toBe('ab **Text**cd');
		expect(r.text.slice(r.start, r.ende)).toBe('Text');
	});

	it('Liste setzt vor jede beruehrte Zeile einen Strich', () => {
		const r = formatiere('a\nb', 0, 3, 'liste');
		expect(r.text).toBe('- a\n- b');
		expect(r.text.slice(r.start, r.ende)).toBe('a\n- b');
	});

	it('Liste laesst Zeilen ausserhalb der Auswahl in Ruhe', () => {
		expect(formatiere('a\nb\nc', 2, 3, 'liste').text).toBe('a\n- b\nc');
	});

	it('Liste: eine Auswahl, die am Zeilenende samt Umbruch aufhoert, beruehrt die naechste Zeile nicht', () => {
		expect(formatiere('a\nb', 0, 2, 'liste').text).toBe('- a\nb');
	});

	it('Liste mit Cursor mitten in der Zeile faengt die Zeile am Anfang an', () => {
		const r = formatiere('eins\nzwei', 7, 7, 'liste');
		expect(r.text).toBe('eins\n- zwei');
		expect(r).toMatchObject({ start: 9, ende: 9 });
	});

	it('Liste im leeren Text', () => {
		expect(formatiere('', 0, 0, 'liste')).toEqual({ text: '- ', start: 2, ende: 2 });
	});

	it('Liste: ein Umbruch am Textanfang gehoert nicht zur Zeile davor', () => {
		expect(formatiere('\nb', 0, 0, 'liste').text).toBe('- \nb');
	});

	it('Link ohne Auswahl: Platzhalter, https:// markiert', () => {
		const r = formatiere('', 0, 0, 'link');
		expect(r.text).toBe('[Text](https://)');
		expect(r.text.slice(r.start, r.ende)).toBe('https://');
	});

	it('Link macht die Auswahl zum Linktext', () => {
		const r = formatiere('siehe Seite hier', 6, 11, 'link');
		expect(r.text).toBe('siehe [Seite](https://) hier');
		expect(r.text.slice(r.start, r.ende)).toBe('https://');
	});

	it('eine verkehrt herum gezogene Auswahl wird wie eine normale behandelt', () => {
		expect(formatiere('Hallo Welt', 5, 0, 'fett').text).toBe('**Hallo** Welt');
	});
});

describe('jf-knopfleiste', () => {
	function oeffne(inhalt: string, von: number, bis: number) {
		const textarea = document.createElement('textarea');
		document.body.append(textarea);
		textarea.value = inhalt;
		textarea.setSelectionRange(von, bis);
		const fixture = TestBed.createComponent(KnopfleisteComponent);
		fixture.componentRef.setInput('textarea', textarea);
		fixture.detectChanges();
		const gemeldet: string[] = [];
		fixture.componentInstance.geaendert.subscribe((t) => gemeldet.push(t));
		const knopf = (name: string) =>
			(fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
		return { textarea, gemeldet, knopf };
	}

	afterEach(() => document.querySelectorAll('textarea').forEach((t) => t.remove()));

	it('hat vier Knoepfe mit Beschriftung', () => {
		const { knopf } = oeffne('', 0, 0);
		for (const name of ['Fett', 'Kursiv', 'Liste', 'Link']) expect(knopf(name), name).not.toBeNull();
	});

	it('Fett setzt Text und Auswahl im Feld und meldet den neuen Text', () => {
		const { textarea, gemeldet, knopf } = oeffne('Hallo Welt', 0, 5);
		knopf('Fett')?.click();
		expect(textarea.value).toBe('**Hallo** Welt');
		expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 7]);
		expect(gemeldet).toEqual(['**Hallo** Welt']);
	});

	it('Link markiert https:// im Feld', () => {
		const { textarea, knopf } = oeffne('', 0, 0);
		knopf('Link')?.click();
		expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('https://');
	});

	it('der Mausdruck auf einen Knopf nimmt dem Feld den Fokus nicht', () => {
		const { knopf } = oeffne('x', 0, 1);
		const ereignis = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		knopf('Kursiv')?.dispatchEvent(ereignis);
		expect(ereignis.defaultPrevented).toBe(true);
	});
});
