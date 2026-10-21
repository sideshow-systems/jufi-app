import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MeldungComponent } from './gestaltung/meldung';
import { VereinKontext } from './verein/verein-kontext';

/**
 * Die Meldung (MeldungService) steht einmal hier an der Wurzel und nicht in jeder Huelle: Admin-Rahmen,
 * Mitglieder-Huelle und Verwaltungs-Huelle riefen alle zeige, aber nur der Admin-Rahmen zeigte sie
 * an, sodass Kopiert nach dem Teilen und Gespeichert in den Einstellungen unsichtbar blieben. Ein
 * Wirt an der Wurzel deckt jede Huelle ab, auch kuenftige. Verworfen: ein Wirt je Huelle; jede neue
 * Huelle muesste ihn daran denken, und das Vergessen faellt erst auf, wenn jemand die Meldung vermisst.
 */
@Component({
	selector: 'jf-root',
	imports: [MeldungComponent, RouterOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<router-outlet />
		<jf-meldung />
	`,
})
export class App {
	// Nur holen: Der Kontext soll vor der ersten Navigation leben und nicht erst, wenn
	// eine Seite ihn zufaellig braucht. Plattform- und Admin-Seiten fragen ihn nie,
	// muessen aber das Dokument des vorigen Vereins aufraeumen.
	constructor() {
		inject(VereinKontext);
	}
}
