import { TestBed } from '@angular/core/testing';
import { BestaetigungComponent } from './bestaetigung';

describe('BestaetigungComponent', () => {
	function oeffne() {
		const fixture = TestBed.createComponent(BestaetigungComponent);
		fixture.componentRef.setInput('text', 'Verein wirklich sperren?');
		fixture.detectChanges();
		return fixture.nativeElement as HTMLElement;
	}

	it('der Dialog hat einen zugaenglichen Namen aus einer Ueberschrift im Dialog', () => {
		const wurzel = oeffne();
		const dialog = wurzel.querySelector<HTMLElement>('[role=dialog]');
		const id = dialog?.getAttribute('aria-labelledby');

		expect(id).toBeTruthy();
		const ueberschrift = dialog?.querySelector<HTMLElement>(`#${id}`);
		expect(ueberschrift?.tagName).toMatch(/^H[1-6]$/);
		expect(ueberschrift?.textContent?.trim()).not.toBe('');
		// Die Beschreibung bleibt der Fragetext.
		const beschreibung = dialog?.getAttribute('aria-describedby') ?? '';
		expect(dialog?.querySelector(`#${beschreibung}`)?.textContent).toContain('Verein wirklich sperren?');
	});

	it('zwei Dialoge teilen sich keine ids', () => {
		const a = oeffne();
		const b = oeffne();
		const idA = a.querySelector('[role=dialog]')?.getAttribute('aria-labelledby');
		const idB = b.querySelector('[role=dialog]')?.getAttribute('aria-labelledby');

		expect(idA).not.toBe(idB);
		expect(a.querySelector('[role=dialog]')?.getAttribute('aria-describedby')).not.toBe(
			b.querySelector('[role=dialog]')?.getAttribute('aria-describedby'),
		);
	});
});
