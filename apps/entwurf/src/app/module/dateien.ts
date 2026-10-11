import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { DateienModul } from '../daten/typen';
import { IconComponent } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';

/** Dateiliste; der Entwurf hat keine echten Dateien, Tippen erklaert das. */
@Component({
	selector: 'jf-dateien',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@for (d of modul().dateien; track d.id) {
			<button type="button" (click)="oeffnen()">
				<jf-icon name="datei" />
				<span class="name">{{ d.name }}</span>
				<span class="gedaempft klein">{{ d.groesse }}</span>
			</button>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a2);
		}
		button {
			display: flex;
			align-items: center;
			gap: var(--a3);
			min-height: var(--tippflaeche);
			padding: var(--a2) var(--a3);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--seite);
			color: var(--text);
			font: inherit;
			text-align: left;
			cursor: pointer;
		}
		jf-icon {
			color: var(--akzent);
			font-size: 1.25rem;
			flex: none;
		}
		.name {
			flex: 1;
			overflow-wrap: anywhere;
			font-weight: 600;
		}
	`,
})
export class DateienBauteil {
	readonly modul = input.required<DateienModul>();
	private readonly meldung = inject(MeldungService);

	protected oeffnen(): void {
		this.meldung.zeige('Im Entwurf nicht herunterladbar');
	}
}
