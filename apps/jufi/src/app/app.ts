import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VereinKontext } from './verein/verein-kontext';

@Component({
	selector: 'jf-root',
	imports: [RouterOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<router-outlet />`,
})
export class App {
	// Nur holen: Der Kontext soll vor der ersten Navigation leben und nicht erst, wenn
	// eine Seite ihn zufaellig braucht. Plattform- und Admin-Seiten fragen ihn nie,
	// muessen aber das Dokument des vorigen Vereins aufraeumen.
	constructor() {
		inject(VereinKontext);
	}
}
