import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EntwurfStore } from './daten/store';
import { MeldungComponent } from './gestaltung/meldung';
import { ThemaService } from './gestaltung/thema';
import { Band } from './testmodus/band';
import { TestmodusDialoge } from './testmodus/bewertung';
import { TestmodusKnopf } from './testmodus/knopf';

@Component({
	selector: 'jf-root',
	imports: [RouterOutlet, MeldungComponent, Band, TestmodusKnopf, TestmodusDialoge],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<jf-band /><router-outlet /><jf-testmodus-knopf /><jf-testmodus-dialoge /><jf-meldung />`,
})
export class App {
	constructor() {
		const store = inject(EntwurfStore);
		const thema = inject(ThemaService);
		// Die Vereinsfarbe gilt nach jedem Laden und jeder Aenderung in den Einstellungen.
		effect(() => thema.setzeVereinsfarbe(store.stand().verein.farbe));
	}
}
