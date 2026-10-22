import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { AutoEingabe } from '@jufi/domain';
import { FahrtAutoFormular, type AutoStart } from './fahrt-auto-formular';

const LEER: AutoStart = { plaetze: '', abfahrtTag: '2026-10-23', abfahrtZeit: '', ort: '', notiz: '' };

describe('jf-fahrt-auto-formular', () => {
	let fixture: ComponentFixture<FahrtAutoFormular>;
	let el: HTMLElement;
	let abgeschickt: AutoEingabe[];
	let abgebrochen: number;

	function zeige(start: AutoStart = LEER, optionen: { aendern?: boolean; gesperrt?: boolean } = {}): void {
		fixture = TestBed.createComponent(FahrtAutoFormular);
		fixture.componentRef.setInput('start', start);
		fixture.componentRef.setInput('aendern', optionen.aendern ?? false);
		fixture.componentRef.setInput('gesperrt', optionen.gesperrt ?? false);
		abgeschickt = [];
		abgebrochen = 0;
		fixture.componentInstance.abgeschickt.subscribe((a) => abgeschickt.push(a));
		fixture.componentInstance.abgebrochen.subscribe(() => abgebrochen++);
		fixture.detectChanges();
		el = fixture.nativeElement as HTMLElement;
	}

	function feld(name: string): HTMLInputElement {
		const f = el.querySelector<HTMLInputElement>(`[name="${name}"]`);
		if (!f) throw new Error(`kein Feld ${name}`);
		return f;
	}

	function tippe(name: string, wert: string): void {
		const f = feld(name);
		f.value = wert;
		f.dispatchEvent(new Event('input'));
		fixture.detectChanges();
	}

	function knopf(beschriftung: string): HTMLButtonElement {
		const k = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === beschriftung);
		if (!k) throw new Error(`kein Knopf ${beschriftung}`);
		return k;
	}

	function gruppe(name: string): string {
		return (el.querySelector(`[data-feld="${name}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
	}

	it('zeigt die Felder mit ihren Beschriftungen und der Vorbelegung', () => {
		zeige();

		expect(['plaetze', 'abfahrtTag', 'abfahrtZeit', 'ort', 'notiz'].map((n) => gruppe(n))).toEqual([
			'Plätze für Kinder',
			'Abfahrt am',
			'Uhrzeit',
			'Treffpunkt',
			'Notiz (optional)',
		]);
		expect(feld('plaetze').type).toBe('number');
		expect(feld('abfahrtTag').type).toBe('date');
		expect(feld('abfahrtZeit').type).toBe('time');
		expect(feld('abfahrtTag').value).toBe('2026-10-23');
		expect(feld('plaetze').max).toBe('8');
		expect(feld('ort').maxLength).toBe(200);
	});

	it('setzt den Fokus beim Erzeugen in das erste Feld', async () => {
		zeige();
		await fixture.whenStable();

		expect(document.activeElement).toBe(feld('plaetze'));
	});

	it('der Knopf heisst Anbieten, beim Aendern Speichern', () => {
		zeige();
		expect(knopf('Anbieten')).toBeTruthy();

		zeige(LEER, { aendern: true });
		expect(knopf('Speichern')).toBeTruthy();
	});

	it('schickt die Eingabe zugeschnitten, leere Felder als null', () => {
		zeige();
		tippe('plaetze', '3');
		tippe('abfahrtZeit', '15:30');
		tippe('ort', '  Vereinsheim ');
		knopf('Anbieten').click();

		expect(abgeschickt).toEqual([
			{ plaetze: 3, abfahrtTag: '2026-10-23', abfahrtZeit: '15:30', ort: 'Vereinsheim', notiz: null },
		]);
	});

	it.each([
		['plaetze', '', 'Bitte 1 bis 8 Plätze angeben.'],
		['plaetze', '9', 'Bitte 1 bis 8 Plätze angeben.'],
		['plaetze', '2.5', 'Bitte 1 bis 8 Plätze angeben.'],
		['abfahrtTag', '2026-13-45', 'Bitte einen gültigen Tag angeben.'],
		['abfahrtZeit', '25:00', 'Bitte die Uhrzeit als HH:MM angeben.'],
		['ort', 'x'.repeat(201), 'Höchstens 200 Zeichen, ohne Steuerzeichen.'],
		['notiz', 'a‮b', 'Höchstens 200 Zeichen, ohne Steuerzeichen.'],
	])('%s mit %j: der Satz steht am Feld und nichts wird abgeschickt', (name, wert, satz) => {
		// Die Werte kommen ueber die Vorbelegung: Ein date-Feld nimmt im DOM keinen ungueltigen Tag an.
		zeige({ ...LEER, plaetze: '3', [name]: wert });
		knopf('Anbieten').click();
		fixture.detectChanges();

		expect(abgeschickt).toEqual([]);
		expect(gruppe(name)).toContain(satz);
		expect(feld(name).getAttribute('aria-invalid')).toBe('true');
		expect(feld(name).getAttribute('aria-describedby')).toBe(el.querySelector(`[data-feld="${name}"] p`)?.id);
	});

	it('der Fehler verschwindet, wenn sich das Feld aendert', () => {
		zeige();
		knopf('Anbieten').click();
		fixture.detectChanges();
		expect(feld('plaetze').getAttribute('aria-invalid')).toBe('true');

		tippe('plaetze', '3');

		expect(feld('plaetze').getAttribute('aria-invalid')).toBeNull();
		expect(gruppe('plaetze')).not.toContain('Bitte');
	});

	it('zeigeFehler setzt den Satz an das Feld und den Fokus dorthin', async () => {
		zeige();
		fixture.componentInstance.zeigeFehler('plaetze', 'Es fährt schon 1 Kind mit.');
		fixture.detectChanges();
		await fixture.whenStable();

		expect(gruppe('plaetze')).toContain('Es fährt schon 1 Kind mit.');
		expect(document.activeElement).toBe(feld('plaetze'));

		fixture.componentInstance.zeigeFehler('abfahrtZeit');
		fixture.detectChanges();
		await fixture.whenStable();

		expect(gruppe('abfahrtZeit')).toContain('Bitte die Uhrzeit als HH:MM angeben.');
		expect(gruppe('plaetze')).not.toContain('Es fährt');
		expect(document.activeElement).toBe(feld('abfahrtZeit'));
	});

	it('Abbrechen meldet sich, ohne etwas abzuschicken', () => {
		zeige();
		knopf('Abbrechen').click();

		expect(abgebrochen).toBe(1);
		expect(abgeschickt).toEqual([]);
	});

	it('gesperrt sperrt Felder und Knoepfe und schickt nichts', () => {
		zeige({ ...LEER, plaetze: '3' }, { gesperrt: true });

		expect(Array.from(el.querySelectorAll('input, button')).every((e) => (e as HTMLInputElement).disabled)).toBe(true);
		el.querySelector('form')?.dispatchEvent(new Event('submit'));
		expect(abgeschickt).toEqual([]);
	});
});
