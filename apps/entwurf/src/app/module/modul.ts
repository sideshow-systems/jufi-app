import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Modul, Thread } from '../daten/typen';
import { DateienBauteil } from './dateien';
import { FahrtBauteil } from './fahrt';
import { FotosBauteil } from './fotos';
import { HelferBauteil } from './helfer';
import { InfoBauteil } from './info';
import { KostenBauteil } from './kosten';
import { TerminBauteil } from './termin';
import { UmfrageBauteil } from './umfrage';

/**
 * Waehlt das Bauteil zum Modultyp. vorschau macht alles nur lesend, damit der
 * Editor dieselben Bauteile zeigen kann, ohne dass ein Klick Daten aendert.
 */
@Component({
	selector: 'jf-modul',
	imports: [
		InfoBauteil,
		TerminBauteil,
		DateienBauteil,
		FotosBauteil,
		UmfrageBauteil,
		HelferBauteil,
		FahrtBauteil,
		KostenBauteil,
	],
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
			@case ('fahrt') {
				<jf-fahrt [thread]="thread()" [modul]="m" [vorschau]="vorschau()" />
			}
			@case ('kosten') {
				<jf-kosten [thread]="thread()" [modul]="m" [vorschau]="vorschau()" />
			}
			@case ('fotos') {
				<jf-fotos [modul]="m" [threadId]="thread().id" [vorschau]="vorschau()" />
			}
		}
	`,
})
export class ModulWeiche {
	readonly thread = input.required<Thread>();
	readonly modul = input.required<Modul>();
	readonly vorschau = input(false);
}
