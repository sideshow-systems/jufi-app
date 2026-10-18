import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EinladungAnzeigeComponent } from './einladung-anzeige';

@Component({
	imports: [EinladungAnzeigeComponent],
	template: `<jf-einladung-anzeige [einladung]="einladung()" />`,
})
class WirtComponent {
	readonly einladung = signal<{ link: string; text: string; ablauf?: string }>({ link: 'l', text: 't' });
}

describe('Einladungsanzeige', () => {
	function zeige(ablauf?: string): string {
		const fixture = TestBed.createComponent(WirtComponent);
		fixture.componentInstance.einladung.set({ link: 'l', text: 't', ...(ablauf ? { ablauf } : {}) });
		fixture.detectChanges();
		return (fixture.nativeElement as HTMLElement).textContent ?? '';
	}

	it('nennt bei einem Reset in einer Stunde nicht 14 Tage', () => {
		const text = zeige(new Date(Date.now() + 3600_000).toISOString());
		expect(text).not.toContain('14 Tage');
		expect(text).toMatch(/Der Link gilt bis \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} Uhr/);
	});

	it('nennt bei 14 Tagen das Datum aus der Serverantwort', () => {
		const text = zeige('2026-11-01T11:05:00.000Z');
		expect(text).toContain('Der Link gilt bis 01.11.2026, 12:05 Uhr');
	});

	it('ohne ablauf bleibt es bei 14 Tagen (Leitungseinladung)', () => {
		expect(zeige()).toContain('Der Link gilt 14 Tage');
	});
});
