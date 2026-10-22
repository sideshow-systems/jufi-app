import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { Feldfehler, MedienZahl, ModulEntwurf } from '@jufi/domain';
import { wertVon } from '../../../gemeinsam/formular';
import { DateienApi } from '../../dateien-api';
import { HochladenFeldComponent } from '../../hochladen-feld';

type Fotos = Extract<ModulEntwurf, { typ: 'FOTOS' }>;

/**
 * Die Felder eines Foto-Moduls im Editor: Titel, der Schalter, wer Fotos hochladen darf, und, solange
 * das Modul gespeichert ist, die Zahl der Fotos samt Upload. Aufbau und Gruende wie jf-dateien-felder:
 * gesteuert, im Editor nur hochladen, ungespeichert nur der Satz.
 *
 * Der Schalter steht bei neuen Modulen aus (nur wer den Thread bearbeiten darf, laedt hoch): Wer
 * Fotos fuer alle oeffnet, soll das bewusst tun. Verworfen: ein Auswahlfeld mit zwei Werten, denn
 * der Satz darunter erklaert den Aus-Zustand besser als ein zweiter Optionstext.
 */
@Component({
	selector: 'jf-fotos-felder',
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
					[attr.aria-describedby]="titelFehler() ? 'fotos-titel-fehler' : null"
					(input)="titelSetzen(wert($event))"
				/>
			</label>
			@if (titelFehler(); as text) {
				<p class="fehler" role="alert" id="fotos-titel-fehler">{{ text }}</p>
			}
			<div class="schalter">
				<label class="haken">
					<input
						type="checkbox"
						name="hochladen"
						aria-describedby="fotos-hochladen-hinweis"
						[checked]="modul().hochladen === 'ALLE'"
						(change)="hochladenSetzen($event)"
					/>
					Alle Leser dürfen Fotos hochladen
				</label>
				<p class="gedaempft klein" id="fotos-hochladen-hinweis">Sonst nur, wer den Thread bearbeiten darf.</p>
			</div>
			@if (modul().id; as id) {
				@if (zahlText(); as text) {
					<p class="gedaempft">{{ text }}</p>
				}
				<jf-hochladen-feld
					[slug]="slug()"
					[ziel]="api.modulFotosAdresse(slug(), id)"
					art="FOTO"
					beschriftung="Fotos hochladen"
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
		.schalter {
			display: grid;
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
export class FotosFelderComponent {
	readonly modul = input.required<Fotos>();
	readonly slug = input.required<string>();
	/** Null: Die Zahl ist nicht bekannt (gerade erst hinzugefuegt); dann steht keine da. */
	readonly zahl = input.required<MedienZahl | null>();
	/** Die Fehler dieses Moduls (Pfad module.N.feld); gezeigt wird der am Titel. */
	readonly fehler = input<readonly Feldfehler[]>([]);
	readonly aendern = output<Fotos>();
	/** Nach jedem fertigen Stapel; der Editor laedt dann die Zahlen neu, nicht den Entwurf. */
	readonly hochgeladen = output<void>();

	protected readonly api = inject(DateienApi);
	protected readonly wert = wertVon;

	protected readonly titelFehler = computed(() => this.fehler().find((f) => /\.titel$/.test(f.feld))?.text);

	protected readonly zahlText = computed(() => {
		const z = this.zahl();
		if (z === null) return null;
		return z.fotos === 0 ? 'Noch keine Fotos hochgeladen.' : `${z.fotos} ${z.fotos === 1 ? 'Foto' : 'Fotos'}`;
	});

	protected titelSetzen(titel: string): void {
		this.aendern.emit({ ...this.modul(), titel: titel === '' ? null : titel });
	}

	protected hochladenSetzen(e: Event): void {
		const an = (e.target as HTMLInputElement).checked;
		this.aendern.emit({ ...this.modul(), hochladen: an ? 'ALLE' : 'JUGENDLEITER' });
	}
}
