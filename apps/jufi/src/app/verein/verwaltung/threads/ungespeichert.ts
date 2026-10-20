import type { CanDeactivateFn } from '@angular/router';

/**
 * Fragt vor dem Verlassen einer Seite mit ungespeicherten Aenderungen nach (Review-Fokus 5). Er
 * deckt die Wege innerhalb der App ab (Links, Seitenleiste, Zurueck im Browser); Neuladen und
 * Schliessen des Tabs faengt die Seite selbst mit beforeunload ab, das erreicht kein Waechter.
 *
 * window.confirm statt jf-bestaetigung: Ein Waechter muss synchron oder mit einem Observable
 * antworten, und ein Dialog im DOM braeuchte dafuer einen eigenen Dienst samt Ueberlagerung ausserhalb
 * der Seite. Der Browserdialog ist hier vertretbar, weil er nur bei einer echten Rueckfrage erscheint
 * und Tests ihn ueber window.confirm steuern koennen.
 */
export const ungespeichertWaechter: CanDeactivateFn<{ ungespeichert(): boolean }> = (seite) =>
	!seite.ungespeichert() || window.confirm('Ungespeicherte Änderungen verwerfen?');
