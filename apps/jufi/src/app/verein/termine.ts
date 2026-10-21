import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Platzhalter der Route termine; der Kalender kommt mit Task 9. */
@Component({
	selector: 'jf-termine',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<h1>Termine</h1>`,
})
export class TermineComponent {}
