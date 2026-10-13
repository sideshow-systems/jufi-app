import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Steht auf den Vereins-Routen, bis die Seiten kommen (Vereinsliste, Anlegen,
 * Vereinsseite). Damit /admin schon jetzt irgendwohin fuehrt, wo der Rahmen
 * und der Waechter greifen.
 */
@Component({
	selector: 'jf-admin-platzhalter',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `<p class="gedaempft">Die Vereinsverwaltung folgt.</p>`,
})
export class AdminPlatzhalterComponent {}
