import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Platzhalter der Route threads; die Liste selbst kommt mit Task 7. */
@Component({
	selector: 'jf-thread-liste',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<h1>Threads</h1>`,
})
export class ThreadListeComponent {}
