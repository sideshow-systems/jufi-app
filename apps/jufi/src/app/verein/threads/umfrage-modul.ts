import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UmfrageAnsicht } from '@jufi/domain';

/** Platzhalter: Task 9 ersetzt die Datei durch das echte Umfrage-Modul (Antworten, Frist, Ergebnis). */
@Component({
	selector: 'jf-umfrage-modul',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<h2>{{ modul().titel ?? modul().frage }}</h2>`,
	styles: `
		h2 {
			margin: 0;
			font-size: var(--schrift);
		}
	`,
})
export class UmfrageModul {
	readonly modul = input.required<UmfrageAnsicht>();
}
