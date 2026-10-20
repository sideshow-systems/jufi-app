import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Platzhalter fuer die Antworten-Uebersicht (Task 12), damit die Route threads/:id/antworten
 * schon aufloest; Task 12 ersetzt den Inhalt.
 */
@Component({
	selector: 'jf-thread-antworten',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<h1>Antworten</h1>`,
})
export class ThreadAntwortenComponent {}
