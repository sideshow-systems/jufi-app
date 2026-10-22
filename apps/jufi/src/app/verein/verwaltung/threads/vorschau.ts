import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ModulAnsicht, ThreadEntwurf } from '@jufi/domain';
import { DateienModulComponent } from '../../threads/dateien-modul';
import { FotosModulComponent } from '../../threads/fotos-modul';
import { HelferModul } from '../../threads/helfer-modul';
import { InfoModul } from '../../threads/info-modul';
import { TerminModul } from '../../threads/termin-modul';
import { UmfrageModul } from '../../threads/umfrage-modul';

/**
 * Der Entwurf als Module der Thread-Seite, damit die Vorschau dieselben Bauteile zeigt wie die App.
 * Ersatz-IDs statt der echten: Neue Module haben noch keine, und eine echte ID verleitete die
 * Bauteile dazu, Adressen oder Anfragen zu bauen, die es fuer den Entwurf nicht gibt. Die Umfrage
 * hat keine Zeilen und kein Ergebnis, so bietet sie keinen Knopf an, der die API riefe. Neue
 * Optionen haben noch keinen Schluessel (den vergibt der Server); ein leerer genuegt der Anzeige.
 */
export function vorschauModule(e: ThreadEntwurf, jetzt: Date): ModulAnsicht[] {
	return e.module.map((m, i): ModulAnsicht => {
		const id = `vorschau-${i}`;
		if (m.typ === 'INFO') return { typ: 'INFO', id, titel: m.titel, text: m.text };
		if (m.typ === 'TERMIN') return { typ: 'TERMIN', id, titel: m.titel, termin: { modulId: id, ...m.termin } };
		// Ohne Dateien und Fotos, ohne Rechte: Die Vorschau hat nichts hochgeladen, und ein Entwurf
		// hat auch kein gespeichertes Modul, in das sich hochladen liesse.
		if (m.typ === 'DATEIEN') return { typ: 'DATEIEN', id, titel: m.titel, dateien: [], darfAendern: false };
		if (m.typ === 'FOTOS') {
			return {
				typ: 'FOTOS',
				id,
				titel: m.titel,
				hochladen: m.hochladen,
				fotos: [],
				darfHochladen: false,
				hinweis: null,
			};
		}
		// Ohne Eintraege und ohne Zeilen wie die Umfrage: So bietet die Karte keinen Knopf an, der
		// die API riefe. Positionen ohne Schluessel tragen Ersatz-IDs wie die Optionen.
		if (m.typ === 'HELFER') {
			return {
				typ: 'HELFER',
				id,
				titel: m.titel,
				einheit: m.einheit,
				frist: m.frist,
				fristAbgelaufen: m.frist !== null && jetzt.getTime() >= Date.parse(m.frist),
				positionen: m.positionen.map((p, j) => ({
					id: `${id}-${j}`,
					text: p.text,
					anzahl: p.anzahl,
					belegt: 0,
					eintraege: [],
				})),
				zeilen: [],
			};
		}
		return {
			typ: 'UMFRAGE',
			id,
			titel: m.titel,
			frage: m.frage,
			einheit: m.einheit,
			mehrfach: m.mehrfach,
			teilnahme: m.teilnahme,
			frist: m.frist,
			fristAbgelaufen: m.frist !== null && jetzt.getTime() >= Date.parse(m.frist),
			optionen: m.optionen.map((o, j) => ({ id: `${id}-${j}`, schluessel: o.schluessel ?? '', text: o.text })),
			zeilen: [],
			ergebnis: null,
		};
	});
}

/**
 * Die Live-Vorschau des Editors im Handyrahmen (Spec 6.6): Kopf mit Titel und Zielgruppe, je
 * Modul eine Karte mit dem Bauteil der Thread-Seite, das im Formular gewaehlte hervorgehoben.
 *
 * Der Inhalt jeder Karte ist inert: Kalenderknopf, Karten-Link und Antworten der Thread-Seite
 * reagieren nicht, ein Tippen trifft die Karte und waehlt das Modul im Formular. Verworfen: die
 * Bauteile um einen Schalter "nur lesen" zu erweitern, denn das brauchte jedes Bauteil einzeln und
 * vergaesse beim naechsten neuen Bedienelement den Schalter. Die Karte ist deshalb selbst der Knopf
 * (role button, Enter und Leertaste) und traegt einen eigenen Namen, denn inerter Inhalt fehlt dem
 * Screenreader. Die Felder bleiben ueber die Modulliste des Formulars erreichbar.
 */
@Component({
	selector: 'jf-thread-vorschau',
	imports: [DateienModulComponent, FotosModulComponent, HelferModul, InfoModul, TerminModul, UmfrageModul],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rahmen" role="region" aria-label="Vorschau am Handy">
			<div class="kopf">
				<strong class="titel">{{ titel() }}</strong>
				<span class="gedaempft klein">{{ zielgruppe() }}</span>
			</div>
			@for (m of module(); track m.id; let i = $index) {
				<div
					class="karte"
					role="button"
					tabindex="0"
					[class.markiert]="markiert() === i"
					[attr.aria-current]="markiert() === i ? 'true' : null"
					[attr.aria-label]="'Modul ' + (i + 1) + ' bearbeiten'"
					(click)="waehle.emit(i)"
					(keydown.enter)="waehle.emit(i)"
					(keydown.space)="$event.preventDefault(); waehle.emit(i)"
				>
					<div class="inhalt" inert>
						@switch (m.typ) {
							@case ('INFO') {
								<jf-info-modul [modul]="m" />
							}
							@case ('TERMIN') {
								<!-- slug leer: Der Kalenderknopf baut daraus seinen Rueckweg, ist hier aber inert. -->
								<jf-termin-modul [modul]="m" [thread]="{ id: 'vorschau', titel: titel() }" slug="" />
							}
							@case ('UMFRAGE') {
								<jf-umfrage-modul [modul]="m" slug="" [vorschau]="true" />
							}
							@case ('HELFER') {
								<jf-helfer-modul [modul]="m" slug="" [vorschau]="true" />
							}
							<!-- Leere Listen ohne Rechte: kein Upload, kein Hinweis, und slug leer wie beim Termin. -->
							@case ('DATEIEN') {
								<jf-dateien-modul [modul]="m" slug="" />
							}
							@case ('FOTOS') {
								<jf-fotos-modul [modul]="m" slug="" />
							}
						}
					</div>
				</div>
			} @empty {
				<p class="gedaempft klein">Noch keine Module.</p>
			}
		</div>
	`,
	styles: `
		:host {
			display: block;
			min-width: 0;
		}
		.rahmen {
			display: grid;
			gap: var(--a3);
			align-content: start;
			width: 375px;
			max-width: 100%;
			padding: var(--a4) var(--a3);
			border: 8px solid var(--text);
			border-radius: 32px;
			background: var(--seite);
			overflow-wrap: anywhere;
		}
		.kopf {
			display: grid;
			gap: var(--a1);
		}
		.titel {
			font-size: var(--schrift-gross);
		}
		.karte {
			padding: var(--a4);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			background: var(--karte);
			cursor: pointer;
		}
		.karte.markiert {
			border-color: var(--akzent);
			box-shadow: 0 0 0 2px var(--akzent);
		}
		p {
			margin: 0;
		}
	`,
})
export class ThreadVorschauComponent {
	readonly entwurf = input.required<ThreadEntwurf>();
	/** Der fertige Text (zielgruppeText); die Namen der Untergruppen kennt nur der Editor. */
	readonly zielgruppe = input.required<string>();
	/** Index des im Formular gewaehlten Moduls. */
	readonly markiert = input.required<number | null>();
	readonly waehle = output<number>();

	protected readonly titel = computed(() => this.entwurf().titel.trim() || 'Ohne Titel');

	// Kein Uhr-Token in der App: Die Bauteile der Thread-Seite nehmen ebenfalls die Uhr des Geraets.
	// Gerechnet wird bei jeder Aenderung des Entwurfs, nicht laufend; eine Frist, die bei offener
	// Vorschau ablaeuft, zeigt die naechste Eingabe.
	protected readonly module = computed(() => vorschauModule(this.entwurf(), new Date()));
}
