import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { type DateienModulAnsicht, type DateiZeile, speicherText } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { BestaetigungComponent } from '../../admin/bestaetigung';
import { alsApiFehler, type ApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { IconComponent } from '../../gestaltung/icon';
import { DateienApi } from '../dateien-api';
import { dateiLink, typKuerzel } from '../dateien-anzeige';
import { HochladenFeldComponent } from '../hochladen-feld';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';

/** Wie lang ein Name sein darf (pruefeDateiname im Server): Das Feld schneidet nicht, es zeigt nur die Grenze. */
const MAX_NAME = 120;

/**
 * Die Dateien eines Datei-Moduls auf der Thread-Seite (TP4-Spec 3): je Datei eine Zeile im Stil der
 * Medien-Dokumente. Wer den Thread bearbeiten darf (darfAendern, vom Server gerechnet), sieht dazu
 * Umbenennen, Loeschen und den Upload; alle anderen nur die Liste.
 *
 * Nach jeder Aenderung meldet die Karte geaendert, statt ihre Liste selbst fortzuschreiben: Die
 * Seite laedt den Thread dann still neu, wie nach einer Umfrage-Antwort, und die Karte zeichnet, was
 * der Server hat. Verworfen: die Zeile lokal ersetzen oder entfernen. Der Server haengt Endung und
 * Reihenfolge an, und ein nachgefuehrter Stand stimmte nach der ersten fremden Aenderung nicht mehr.
 */
@Component({
	selector: 'jf-dateien-modul',
	imports: [BestaetigungComponent, HochladenFeldComponent, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (modul().titel; as titel) {
			<h2>{{ titel }}</h2>
		}
		@if (modul().dateien.length === 0) {
			<p class="gedaempft">Noch keine Dateien.</p>
		} @else {
			<ul>
				@for (d of modul().dateien; track d.id) {
					<li [attr.data-datei]="d.id">
						@if (istInBearbeitung(d.id)) {
							<form aria-label="Datei umbenennen" (submit)="speichere($event, d)">
								<label class="feld">
									Neuer Name
									<input
										type="text"
										name="name"
										autocomplete="off"
										[attr.maxlength]="maxName"
										[value]="umbenennung()?.wert"
										[attr.aria-invalid]="fehlerBei(d.id) ? 'true' : null"
										(input)="setzeName($event)"
									/>
								</label>
								@if (fehlerBei(d.id); as text) {
									<p class="fehler" role="alert">{{ text }}</p>
								}
								<div class="reihe">
									<button type="submit" class="knopf primaer" [disabled]="laeuft()">Speichern</button>
									<button type="button" class="knopf" [disabled]="laeuft()" (click)="umbenennung.set(null)">
										Abbrechen
									</button>
								</div>
							</form>
						} @else {
							@let link = dateiLink(slug(), d);
							<a
								class="datei"
								[href]="link.href"
								[attr.target]="link.neuerTab ? '_blank' : null"
								[attr.rel]="link.neuerTab ? 'noopener' : null"
							>
								<jf-icon name="dokument" />
								<span class="titel">{{ d.name }}</span>
								<span class="zusatz">{{ typKuerzel(d.typ) }} · {{ groesse(d.groesse) }}</span>
							</a>
							@if (modul().darfAendern) {
								<div class="reihe">
									<button
										type="button"
										class="knopf klein"
										[attr.aria-label]="'„' + d.name + '“ umbenennen'"
										[disabled]="laeuft()"
										(click)="beginne(d)"
									>
										Umbenennen
									</button>
									<button
										type="button"
										class="knopf klein"
										[attr.aria-label]="'„' + d.name + '“ löschen'"
										[disabled]="laeuft()"
										(click)="frage.set(d)"
									>
										Löschen
									</button>
								</div>
								@if (fehlerBei(d.id); as text) {
									<p class="fehler" role="alert">{{ text }}</p>
								}
							}
						}
					</li>
				}
			</ul>
		}
		@if (modul().darfAendern) {
			@if (fehlerBei('modul'); as text) {
				<p class="fehler" role="alert">{{ text }}</p>
			}
			<jf-hochladen-feld
				[slug]="slug()"
				[ziel]="api.modulDateienAdresse(slug(), modul().id)"
				art="DATEI"
				beschriftung="Dateien hochladen"
				(hochgeladen)="geaendert.emit()"
			/>
		}
		@if (frage(); as d) {
			<jf-bestaetigung
				titel="Datei löschen"
				[text]="'‚' + d.name + '‘ löschen?'"
				bestaetigung="Löschen"
				(bestaetigt)="loesche(d)"
				(abgebrochen)="frage.set(null)"
			/>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		h2 {
			margin: 0;
			font-size: var(--schrift);
		}
		p {
			margin: 0;
		}
		ul {
			display: grid;
			gap: var(--a2);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		li {
			display: grid;
			gap: var(--a2);
			overflow-wrap: anywhere;
		}
		/* Icon links ueber beide Textzeilen: Name und Zusatz bleiben bei langen Namen beieinander. */
		.datei {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: var(--a3);
			align-items: center;
			min-height: var(--tippflaeche);
			padding: var(--a3) var(--a4);
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			color: var(--text);
			text-decoration: none;
		}
		.datei jf-icon {
			grid-row: 1 / span 2;
			font-size: 1.375rem;
			color: var(--text-gedaempft);
		}
		.titel {
			font-weight: 600;
		}
		.zusatz {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		form {
			display: grid;
			gap: var(--a3);
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		.fehler {
			color: var(--fehler);
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
	`,
})
export class DateienModulComponent {
	readonly slug = input.required<string>();
	readonly modul = input.required<DateienModulAnsicht>();
	/** Nach Upload, Umbenennen und Loeschen (auch nach einem 404): Die Seite laedt den Thread dann neu. */
	readonly geaendert = output<void>();

	protected readonly api = inject(DateienApi);
	private readonly router = inject(Router);

	protected readonly dateiLink = dateiLink;
	protected readonly typKuerzel = typKuerzel;
	protected readonly maxName = MAX_NAME;

	protected readonly umbenennung = signal<{ id: string; wert: string } | null>(null);
	protected readonly frage = signal<DateiZeile | null>(null);
	/** Eine Handlung zur Zeit: Zwei schnelle Klicks schickten sonst zwei Anfragen auf dieselbe Zeile. */
	protected readonly laeuft = signal(false);
	/** Wo ein Fehler steht: die Id der Datei oder modul (wenn das Ziel nicht mehr da ist). */
	protected readonly fehler = signal<{ ort: string; text: string } | null>(null);
	/** Eine Antwort, die erst nach dem Verlassen der Seite eintrifft, soll nichts mehr ausloesen. */
	private weg = false;

	constructor() {
		inject(DestroyRef).onDestroy(() => (this.weg = true));
	}

	protected groesse(bytes: number): string {
		return speicherText(bytes);
	}

	protected fehlerBei(ort: string): string | null {
		const f = this.fehler();
		return f?.ort === ort ? f.text : null;
	}

	protected istInBearbeitung(id: string): boolean {
		return this.umbenennung()?.id === id;
	}

	protected beginne(d: DateiZeile): void {
		this.fehler.set(null);
		this.umbenennung.set({ id: d.id, wert: d.name });
	}

	protected setzeName(ereignis: Event): void {
		const wert = wertVon(ereignis);
		this.umbenennung.update((u) => u && { ...u, wert });
	}

	protected async speichere(ereignis: Event, d: DateiZeile): Promise<void> {
		ereignis.preventDefault();
		const u = this.umbenennung();
		if (!u || this.laeuft()) return;
		const name = u.wert.trim();
		if (!name) {
			this.fehler.set({ ort: d.id, text: 'Bitte einen Namen eingeben' });
			return;
		}
		if (await this.fuehreAus(d.id, () => firstValueFrom(this.api.benenneDatei(this.slug(), d.id, name)))) {
			this.umbenennung.set(null);
		}
	}

	protected async loesche(d: DateiZeile): Promise<void> {
		await this.fuehreAus(d.id, () => firstValueFrom(this.api.loescheDatei(this.slug(), d.id)));
	}

	/**
	 * Aktion, danach geaendert. Die Rueckfrage schliesst in jedem Fall. Bei 404 ist die Datei schon weg
	 * oder das Recht entzogen: Der Satz steht dann oben am Modul (die Zeile verschwindet mit der neuen
	 * Ansicht), und die Seite laedt trotzdem neu, damit die Karte nicht weiter etwas zeigt, das es nicht gibt.
	 */
	private async fuehreAus(ort: string, aktion: () => Promise<unknown>): Promise<boolean> {
		if (this.laeuft()) return false;
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			await aktion();
			this.frage.set(null);
			if (!this.weg) this.geaendert.emit();
			return true;
		} catch (ursache) {
			this.frage.set(null);
			if (this.weg) return false;
			const f = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), f)) return false;
			if (f.status === 404) {
				this.umbenennung.set(null);
				this.fehler.set({ ort: 'modul', text: aktionsfehler(f) });
				this.geaendert.emit();
			} else {
				this.fehler.set({ ort, text: aktionsfehler(f) });
			}
			return false;
		} finally {
			this.laeuft.set(false);
		}
	}
}

/** Der Satz zu einem Fehler einer Aktion; 404 heisst, dass das Ziel in der Zwischenzeit weg ist. */
function aktionsfehler(f: ApiFehler): string {
	if (f.status === 404) return 'Das gibt es nicht mehr, oder du darfst hier nichts ändern.';
	return fehlertext(f);
}
