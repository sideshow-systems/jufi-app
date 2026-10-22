import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	Injector,
	inject,
	input,
	output,
	signal,
} from '@angular/core';
import type { FotosModulAnsicht } from '@jufi/domain';
import { IconComponent } from '../../gestaltung/icon';
import { DateienApi } from '../dateien-api';
import { HochladenFeldComponent } from '../hochladen-feld';
import { FotoGrossansichtComponent } from './foto-grossansicht';

/**
 * Die Fotos eines Foto-Moduls auf der Thread-Seite (TP4-Spec 3): ein Raster aus Vorschaubildern,
 * ein Tipp oeffnet die Grossansicht. Wer hochladen darf (darfHochladen, vom Server gerechnet),
 * sieht darunter das Upload-Feld; der Hinweis zu Personen ohne Einwilligung steht ueber dem Raster,
 * damit er vor dem Hochladen gelesen wird und nicht erst danach.
 *
 * Nach jeder Aenderung meldet die Karte geaendert, statt ihre Liste fortzuschreiben (Begruendung wie
 * in jf-dateien-modul): Die Seite laedt den Thread dann still neu.
 *
 * Die Kacheln sind Knoepfe statt Links auf das Bild: Ein Link oeffnete das Bild in einem eigenen
 * Tab und liesse das Blaettern in der Grossansicht weg. Die Vorschau kommt aus der Vorschau-Route
 * (480 px), nie aus dem 2560er Bild: Ein Raster mit 500 Fotos liefe sonst ueber hunderte Megabyte.
 */
@Component({
	selector: 'jf-fotos-modul',
	imports: [FotoGrossansichtComponent, HochladenFeldComponent, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	// Das Modul selbst nimmt den Fokus, wenn es keine Kachel mehr gibt und keinen Upload (letztes Foto geloescht).
	host: { tabindex: '-1' },
	template: `
		@if (modul().titel; as titel) {
			<h2>{{ titel }}</h2>
		}
		@if (modul().hinweis; as hinweis) {
			<p class="hinweis">
				<jf-icon name="warnung" />
				<span>{{ hinweis }}</span>
			</p>
		}
		@if (modul().fotos.length === 0) {
			<p class="gedaempft">Noch keine Fotos.</p>
		} @else {
			<ul class="raster">
				@for (f of modul().fotos; track f.id; let i = $index) {
					<li>
						<button type="button" class="kachel" [attr.data-foto]="f.id" (click)="oeffne(i)">
							<img [src]="api.vorschauAdresse(slug(), f.id)" [alt]="'Foto von ' + f.von" loading="lazy" />
						</button>
					</li>
				}
			</ul>
			<p class="zahl gedaempft">{{ zahl() }}</p>
		}
		@if (modul().darfHochladen) {
			<jf-hochladen-feld
				[slug]="slug()"
				[ziel]="api.modulFotosAdresse(slug(), modul().id)"
				art="FOTO"
				beschriftung="Fotos hochladen"
				(hochgeladen)="geaendert.emit()"
			/>
		}
		@if (offen(); as o) {
			<jf-foto-grossansicht
				[slug]="slug()"
				[fotos]="modul().fotos"
				[index]="o.wert"
				(schliessen)="schliesse($event)"
				(geloescht)="nachLoeschen($event)"
			/>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		:host(:focus) {
			outline: none;
		}
		h2 {
			margin: 0;
			font-size: var(--schrift);
		}
		p {
			margin: 0;
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
		.zahl {
			font-size: var(--schrift-klein);
		}
		.hinweis {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: var(--a2);
			align-items: start;
			padding: var(--a3);
			border-radius: var(--radius-klein);
			background: var(--warnung-flaeche);
			color: var(--warnung);
			font-size: var(--schrift-klein);
			overflow-wrap: anywhere;
		}
		.hinweis jf-icon {
			font-size: 1.125rem;
		}
		/* minmax(0, 1fr): Ohne die Null waere die Mindestbreite eines Bildes die Untergrenze der Spalte. */
		.raster {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: var(--a1);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.kachel {
			display: block;
			width: 100%;
			aspect-ratio: 1;
			padding: 0;
			border: 0;
			border-radius: var(--radius-klein);
			background: var(--linie);
			overflow: hidden;
			cursor: pointer;
		}
		.kachel img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}
	`,
})
export class FotosModulComponent {
	readonly slug = input.required<string>();
	readonly modul = input.required<FotosModulAnsicht>();
	/** Nach Upload und Loeschen: Die Seite laedt den Thread dann neu. */
	readonly geaendert = output<void>();

	protected readonly api = inject(DateienApi);
	private readonly wirt = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly injector = inject(Injector);

	/**
	 * Das angetippte Foto, in einem Objekt: Index 0 ist falsy, und ein @if (offen(); as index) schlosse
	 * die Grossansicht beim ersten Foto sonst aus.
	 */
	protected readonly offen = signal<{ wert: number } | null>(null);

	protected zahl(): string {
		const n = this.modul().fotos.length;
		return `${n} ${n === 1 ? 'Foto' : 'Fotos'}`;
	}

	protected oeffne(index: number): void {
		this.offen.set({ wert: index });
	}

	/**
	 * Der Fokus geht auf die Kachel des Fotos zurueck, das zuletzt zu sehen war, nicht auf die
	 * angetippte: Wer geblaettert hat, will dort weitermachen. Das Modul merkt es sich selbst, statt die
	 * Grossansicht document.activeElement festhalten zu lassen: Safari und Firefox (auch iOS) fokussieren
	 * einen Knopf beim Klick nicht, dort lag der Fokus dann auf body.
	 */
	protected schliesse(id: string | null): void {
		this.offen.set(null);
		this.fokussiere(id);
	}

	/**
	 * Die Grossansicht schliesst nach dem Loeschen, statt zum naechsten Foto zu springen: Die Liste ist
	 * bis zum Neuladen noch die alte, und ein Sprung zeigte eben das Foto, das gerade weg ist. Der
	 * Fokus geht auf die Nachbarkachel (die naechste, sonst die vorige); die Zeile bleibt beim
	 * Neuladen stehen (track nach Id), der Fokus also auch. Ohne Nachbarn nimmt ihn das Upload-Feld
	 * oder das Modul.
	 */
	protected nachLoeschen(id: string): void {
		const fotos = this.modul().fotos;
		const i = fotos.findIndex((f) => f.id === id);
		const nachbar = fotos[i + 1] ?? fotos[i - 1];
		this.offen.set(null);
		this.fokussiere(nachbar && i >= 0 ? nachbar.id : null);
		this.geaendert.emit();
	}

	/** Nach dem naechsten Rendern: Die Kachel gibt es erst, wenn die Grossansicht weg ist und das Raster wieder steht. */
	private fokussiere(id: string | null): void {
		afterNextRender(
			() => {
				const wurzel = this.wirt.nativeElement;
				const kachel =
					id === null
						? undefined
						: [...wurzel.querySelectorAll<HTMLElement>('button[data-foto]')].find((k) => k.dataset['foto'] === id);
				const ziel = kachel ?? wurzel.querySelector<HTMLElement>('input[type="file"]') ?? wurzel;
				ziel.focus();
			},
			{ injector: this.injector },
		);
	}
}
