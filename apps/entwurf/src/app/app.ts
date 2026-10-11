import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EntwurfStore } from './daten/store';
import { ThemaService } from './gestaltung/thema';

@Component({
	selector: 'jf-root',
	imports: [RouterOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<router-outlet />`,
})
export class App {
	constructor() {
		const store = inject(EntwurfStore);
		const thema = inject(ThemaService);
		// Die Vereinsfarbe gilt nach jedem Laden und jeder Aenderung in den Einstellungen.
		effect(() => thema.setzeVereinsfarbe(store.stand().verein.farbe));
	}
}
