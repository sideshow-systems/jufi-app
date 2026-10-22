import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { Feldfehler, MedienZahl, ModulEntwurf } from '@jufi/domain';
import { wertVon } from '../../../gemeinsam/formular';
import { DateienApi } from '../../dateien-api';
import { HochladenFeldComponent } from '../../hochladen-feld';

type Dateien = Extract<ModulEntwurf, { typ: 'DATEIEN' }>;

/**
 * Die Felder eines Datei-Moduls im Editor: der Titel und, solange das Modul gespeichert ist, die
 * Zahl der Dateien samt Upload. Eigene Komponente neben jf-modul-felder (TP4-Spec 10): Deren Datei
 * hat Umfrage, Termin und Info schon genug, und die Medien brauchen Slug, Zahl und eine Adresse,
 * die jene Felder nie kennen.
 *
 * Gesteuert wie jf-modul-felder: Jede Eingabe meldet ein neues Modul ueber aendern, der Editor
 * haelt den Entwurf. Im Editor wird nur hochgeladen (Plan-Entscheidung 10); Umbenennen und
 * Loeschen einzelner Dateien gibt es auf der Thread-Seite. Verworfen: die volle Liste auch hier,
 * sie stuende doppelt und brauchte Ansicht und Rechte im Bearbeitungsweg.
 *
 * Ungespeichert hat das Modul noch keine ID und damit keine Upload-Adresse; der Satz sagt, was zu
 * tun ist. Verworfen: das Modul beim Hinzufuegen sofort anzulegen, denn der Editor speichert sonst
 * nichts, ohne dass die Person es will.
 */
@Component({
	selector: 'jf-dateien-felder',
	imports: [HochladenFeldComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="felder">
			<label class="feld">
				Überschrift (optional)
				<input
					type="text"
					name="titel"
					autocomplete="off"
					[value]="modul().titel ?? ''"
					[attr.aria-invalid]="titelFehler() ? 'true' : null"
					[attr.aria-describedby]="titelFehler() ? 'dateien-titel-fehler' : null"
					(input)="titelSetzen(wert($event))"
				/>
			</label>
			@if (titelFehler(); as text) {
				<p class="fehler" role="alert" id="dateien-titel-fehler">{{ text }}</p>
			}
			@if (modul().id; as id) {
				@if (zahlText(); as text) {
					<p class="gedaempft">{{ text }}</p>
				}
				<jf-hochladen-feld
					[slug]="slug()"
					[ziel]="api.modulDateienAdresse(slug(), id)"
					art="DATEI"
					beschriftung="Dateien hochladen"
					(hochgeladen)="hochgeladen.emit()"
				/>
			} @else {
				<p class="gedaempft">Erst speichern, dann hochladen</p>
			}
		</div>
	`,
	styles: `
		:host {
			display: block;
		}
		.felder {
			display: grid;
			gap: var(--a3);
		}
		p {
			margin: 0;
		}
		.fehler {
			color: var(--fehler);
		}
		[aria-invalid='true'] {
			border-color: var(--fehler);
		}
	`,
})
export class DateienFelderComponent {
	readonly modul = input.required<Dateien>();
	readonly slug = input.required<string>();
	/** Null: Die Zahl ist nicht bekannt (gerade erst hinzugefuegt); dann steht keine da. */
	readonly zahl = input.required<MedienZahl | null>();
	/** Die Fehler dieses Moduls (Pfad module.N.feld); gezeigt wird der am Titel. */
	readonly fehler = input<readonly Feldfehler[]>([]);
	readonly aendern = output<Dateien>();
	/** Nach jedem fertigen Stapel; der Editor laedt dann die Zahlen neu, nicht den Entwurf. */
	readonly hochgeladen = output<void>();

	protected readonly api = inject(DateienApi);
	protected readonly wert = wertVon;

	protected readonly titelFehler = computed(() => this.fehler().find((f) => /\.titel$/.test(f.feld))?.text);

	protected readonly zahlText = computed(() => {
		const z = this.zahl();
		if (z === null) return null;
		return z.dateien === 0
			? 'Noch keine Dateien hochgeladen.'
			: `${z.dateien} ${z.dateien === 1 ? 'Datei' : 'Dateien'}`;
	});

	protected titelSetzen(titel: string): void {
		this.aendern.emit({ ...this.modul(), titel: titel === '' ? null : titel });
	}
}
