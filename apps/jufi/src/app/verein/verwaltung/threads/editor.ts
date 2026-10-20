import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Platzhalter fuer den Thread-Editor (Task 11), damit die Routen threads/neu und threads/:id
 * schon aufloesen; Task 11 ersetzt den Inhalt.
 */
@Component({
	selector: 'jf-thread-editor',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<h1>Thread bearbeiten</h1>`,
})
export class ThreadEditorComponent {}
