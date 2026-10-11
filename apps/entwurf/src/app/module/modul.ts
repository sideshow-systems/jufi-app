import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Modul, Thread } from '../daten/typen';
import { DateienBauteil } from './dateien';
import { FotosBauteil } from './fotos';
import { HelferBauteil } from './helfer';
import { InfoBauteil } from './info';
import { TerminBauteil } from './termin';
import { UmfrageBauteil } from './umfrage';

/**
 * Waehlt das Bauteil zum Modultyp. vorschau macht alles nur lesend, damit der
 * Editor dieselben Bauteile zeigen kann, ohne dass ein Klick Daten aendert.
 */
@Component({
	selector: 'jf-modul',
	imports: [InfoBauteil, TerminBauteil, DateienBauteil, FotosBauteil, UmfrageBauteil, HelferBauteil],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let m = modul();
		@switch (m.typ) {
			@case ('info') {
				<jf-info [modul]="m" />
			}
			@case ('termin') {
				<jf-termin [modul]="m" />
			}
			@case ('dateien') {
				<jf-dateien [modul]="m" />
			}
			@case ('umfrage') {
				<jf-umfrage [thread]="thread()" [modul]="m" [vorschau]="vorschau()" />
			}
			@case ('helfer') {
				<jf-helfer [thread]="thread()" [modul]="m" [vorschau]="vorschau()" />
			}
			@case ('fotos') {
				<jf-fotos [modul]="m" [threadId]="thread().id" [vorschau]="vorschau()" />
			}
			@default {
				<p class="gedaempft">{{ m.typ }}</p>
			}
		}
	`,
})
export class ModulWeiche {
	readonly thread = input.required<Thread>();
	readonly modul = input.required<Modul>();
	readonly vorschau = input(false);
}
