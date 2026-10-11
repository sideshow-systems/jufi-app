import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import type { FotosModul, Id } from '../daten/typen';
import { IconComponent } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';

/**
 * Fotoraster mit Grossansicht. Die Grossansicht ist eine Ueberlagerung statt
 * einer eigenen Route: Zurueck am Handy soll den Thread nicht verlassen, und
 * im Entwurf genuegt Schliessen per Knopf, Tippen daneben oder Escape.
 */
@Component({
	selector: 'jf-fotos',
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown.escape)': 'schliessen()' },
	template: `
		<div class="raster">
			@for (f of modul().fotos; track f.id) {
				<button type="button" (click)="oeffnen(f.id)" [attr.aria-label]="'Foto ' + ($index + 1) + ' vergrößern'">
					<img [src]="f.bild" alt="" loading="lazy" />
				</button>
			}
		</div>
		@if (!vorschau()) {
			<button type="button" class="knopf leise klein" (click)="hinzufuegen()">
				<jf-icon name="plus" /> Foto hinzufügen
			</button>
		}
		@if (gross(); as f) {
			<div class="ueberlagerung" role="dialog" aria-modal="true" aria-label="Foto" (click)="schliessen()">
				<img [src]="f.bild" alt="" (click)="$event.stopPropagation()" />
				<button type="button" class="knopf nur-icon zu" aria-label="Schließen" (click)="schliessen()">
					<jf-icon name="schliessen" />
				</button>
			</div>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		.raster {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 4px;
		}
		.raster button {
			padding: 0;
			border: 0;
			border-radius: var(--radius-klein);
			overflow: hidden;
			aspect-ratio: 1;
			background: var(--linie);
			cursor: zoom-in;
		}
		.raster img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}
		.knopf.klein {
			justify-self: start;
		}
		.ueberlagerung {
			position: fixed;
			inset: 0;
			z-index: 200;
			display: grid;
			place-items: center;
			padding: calc(var(--sicher-oben) + 56px) var(--a4) calc(var(--sicher-unten) + var(--a4));
			background: rgb(0 0 0 / 0.88);
		}
		.ueberlagerung img {
			max-width: 100%;
			max-height: 100%;
			border-radius: var(--radius-klein);
		}
		.zu {
			position: absolute;
			top: calc(var(--sicher-oben) + var(--a2));
			right: var(--a2);
			color: #fff;
			background: rgb(255 255 255 / 0.15);
		}
	`,
})
export class FotosBauteil {
	readonly modul = input.required<FotosModul>();
	readonly threadId = input.required<Id>();
	readonly vorschau = input(false);

	private readonly meldung = inject(MeldungService);
	private readonly ereignisse = inject(TESTEREIGNISSE);
	private readonly offen = signal<Id | null>(null);
	protected readonly gross = computed(() => this.modul().fotos.find((f) => f.id === this.offen()));

	protected oeffnen(id: Id): void {
		this.offen.set(id);
		this.ereignisse.next({ art: 'fotoGeoeffnet', threadId: this.threadId(), fotoId: id });
	}

	protected schliessen(): void {
		this.offen.set(null);
	}

	protected hinzufuegen(): void {
		this.meldung.zeige('Im Entwurf nicht möglich');
	}
}
