import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ModulAnsicht } from '@jufi/domain';

/** Platzhalter: Task 9 ersetzt die Datei durch das echte Termin-Modul (Zeit, Ort, Kalender). */
@Component({
	selector: 'jf-termin-modul',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `@if (modul().titel; as titel) {
		<h2>{{ titel }}</h2>
	}`,
	styles: `
		h2 {
			margin: 0;
			font-size: var(--schrift);
		}
	`,
})
export class TerminModul {
	readonly modul = input.required<Extract<ModulAnsicht, { typ: 'TERMIN' }>>();
}
