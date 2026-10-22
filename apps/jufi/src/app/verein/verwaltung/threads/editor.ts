import {
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	inject,
	input,
	signal,
	untracked,
} from '@angular/core';
import { type Navigation, Router, RouterLink } from '@angular/router';
import {
	einheitenFuer,
	entwurfFehler,
	type Feldfehler,
	GRENZEN,
	type HelferSperre,
	KEINE_MEDIEN,
	type MedienZahl,
	medienZahlText,
	type ModulEntwurf,
	MODUS_TEXT,
	neuesModul,
	ROLLENFILTER_TEXT,
	type Rollenfilter,
	terminZeit,
	type ThreadBearbeitung,
	type ThreadEntwurf,
	type ThreadModus,
	type UmfrageSperre,
	zielgruppeText,
} from '@jufi/domain';
import { firstValueFrom, type Observable } from 'rxjs';
import { BestaetigungComponent } from '../../../admin/bestaetigung';
import { alsApiFehler, fehlertextNichtGefunden } from '../../../gemeinsam/api-fehler';
import { wertVon } from '../../../gemeinsam/formular';
import { IconComponent } from '../../../gestaltung/icon';
import { KarteComponent, PilleComponent } from '../../../gestaltung/ui';
import { beiAbgelaufenerSitzung } from '../../sitzung-abgelaufen';
import { DateienFelderComponent } from './dateien-felder';
import { FotosFelderComponent } from './fotos-felder';
import { HelferFelderComponent } from './helfer-felder';
import { ModulFelderComponent, zeigtModulFeld } from './modul-felder';
import { VerwaltungThreadsApi } from './threads-api';
import { ThreadVorschauComponent } from './vorschau';

type ModulTyp = ModulEntwurf['typ'];
type Kopf = Omit<ThreadEntwurf, 'module'>;
type Zustand = 'laedt' | 'bereit' | 'nicht-gefunden' | 'fehler';

const TYPEN: readonly { typ: ModulTyp; text: string }[] = [
	{ typ: 'INFO', text: 'Info-Text' },
	{ typ: 'TERMIN', text: 'Termin' },
	{ typ: 'UMFRAGE', text: 'Umfrage' },
	{ typ: 'DATEIEN', text: 'Dateien' },
	{ typ: 'FOTOS', text: 'Fotos' },
	{ typ: 'HELFER', text: 'Helferliste' },
];

/** Gleiche Grenze wie die Media Query in den Stilen: darunter Umschalter statt zwei Spalten (Spec 6.6). */
const SCHMAL = '(max-width: 1023px)';

/** Schluessel der Uebergabe im Navigationszustand, siehe uebergabeAus. */
const UEBERGABE = 'threadEditor';

/**
 * Ein Modul der Arbeitskopie mit einem Schluessel, der es ueber Umsortieren hinweg erkennt. Die
 * Felder eines Moduls halten lokalen Zustand (halbe Frist-Eingabe); nach der Position getrackt
 * behielte ein Bauteil beim Verschieben den Zustand seines Nachbarn. Gespeicherte Module nehmen
 * ihre ID, neue einen lokalen Schluessel, der den Browser nie verlaesst: Er steht neben dem Modul,
 * nicht darin.
 */
interface Eintrag {
	schluessel: string;
	modul: ModulEntwurf;
}

interface Arbeit {
	kopf: Kopf;
	module: Eintrag[];
}

/** Was die Seite nach dem Anlegen an die Seite des neuen Threads weitergibt (siehe uebergabeAus). */
interface Uebergabe {
	bearbeitung: ThreadBearbeitung;
	status: string | null;
	meldung: string | null;
	serverFehler: Feldfehler | null;
}

let lokaleNummer = 0;
const lokalerSchluessel = (): string => `neu-${++lokaleNummer}`;

function arbeitAus(e: ThreadEntwurf): Arbeit {
	const { module, ...kopf } = e;
	return { kopf, module: module.map((modul) => ({ schluessel: modul.id ?? lokalerSchluessel(), modul })) };
}

// Spec 3.1: Ein neuer Thread geht an alle, mit Kommentaren. Verworfen: ohne Zielgruppe beginnen,
// denn der haeufigste Thread richtet sich an den ganzen Verein, und eine leere Auswahl waere
// sofort ein Fehler.
function leererEntwurf(): ThreadEntwurf {
	return {
		titel: '',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		alleUntergruppen: true,
		untergruppenIds: [],
		module: [],
	};
}

function istUebergabe(w: unknown): w is Uebergabe {
	const b = (w as Partial<Uebergabe> | null)?.bearbeitung;
	return typeof b === 'object' && b !== null && typeof b.id === 'string';
}

/**
 * Nimmt die Uebergabe nur aus der Navigation, die der Editor nach dem Anlegen selbst ausloest.
 * Der Navigationszustand liegt danach in history.state, und Zurueck oder Neuladen braechten ihn
 * wieder: popstate und die erste Navigation (ohne Vorgaenger) laden deshalb vom Server.
 */
function uebergabeAus(nav: Navigation | null): Uebergabe | null {
	if (!nav || nav.trigger !== 'imperative' || nav.previousNavigation === null) return null;
	const w: unknown = nav.extras.state?.[UEBERGABE];
	return istUebergabe(w) ? w : null;
}

const KEINE_FEHLER: Feldfehler[] = [];
const MODULFEHLER = /^module\.(\d+)\./;

/**
 * Ein Feldfehler des Servers, an einem Modul ueber dessen Schluessel statt ueber den Index: Der
 * Server nennt die Position zum Zeitpunkt der Anfrage, danach kann die Person umsortieren,
 * entfernen oder hinzufuegen, und der Fehler stuende am Nachbarn. Verworfen: den Index beim
 * Umsortieren mitzufuehren, denn das muesste jede Aenderung der Modulliste wissen.
 * schluessel null: ein Feld des Threads (titel, zielgruppe, module), feld ist dann der ganze Pfad.
 */
interface ServerFehler {
	schluessel: string | null;
	feld: string;
	text: string;
}

/**
 * Der Thread-Editor der Verwaltung (Spec 6.6): links das Formular, rechts die Live-Vorschau,
 * unter 1024 px ein Umschalter statt zwei Spalten. Vorlage fuer Anordnung und Bedienung ist der
 * Editor im Entwurf.
 *
 * Die Arbeitskopie ist ein Signal; ungespeichert heisst, dass sie als JSON vom zuletzt geladenen
 * oder gespeicherten Stand abweicht. Verworfen: ein Schmutz-Merker je Eingabe, der eine
 * zurueckgenommene Aenderung nicht erkennt. Nach jedem Speichern ist der Stand des Servers die neue
 * Basis, denn erst er traegt die IDs neuer Module und Optionen; deshalb ist das Formular gesperrt,
 * solange eine Anfrage laeuft, sonst ueberschriebe die Antwort, was inzwischen getippt wurde.
 *
 * Gespeichert wird erst nach der Pruefung mit entwurfFehler, derselben Funktion wie auf dem Server:
 * Er nennt nur den ersten Fehler, der Editor alle am Feld, und ein fehlerhafter Entwurf geht nie
 * hinaus. Veroeffentlichen speichert zuerst; scheitert das, wird nichts veroeffentlicht, und die
 * Eingaben bleiben stehen (Review-Fokus 5).
 *
 * threads/neu und threads/:id sind zwei Routen, der Router baut die Seite beim Wechsel neu. Nach
 * dem Anlegen gibt sie deshalb den Stand aus der Antwort samt Meldungen an die neue Seite weiter,
 * statt ihn noch einmal zu laden. Verworfen: eine Route fuer beide mit "neu" als ID, denn dann
 * wuerde "neu" zur gueltigen Thread-ID der Seite und jeder Link muesste das wissen.
 */
@Component({
	selector: 'jf-thread-editor',
	imports: [
		BestaetigungComponent,
		DateienFelderComponent,
		FotosFelderComponent,
		HelferFelderComponent,
		IconComponent,
		KarteComponent,
		ModulFelderComponent,
		PilleComponent,
		RouterLink,
		ThreadVorschauComponent,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(window:beforeunload)': 'vorDemVerlassen($event)' },
	template: `
		@switch (zustand()) {
			@case ('bereit') {
				<div class="titelzeile">
					<h1>{{ neu() ? 'Neuer Thread' : 'Thread bearbeiten' }}</h1>
					@if (!neu() && !veroeffentlicht()) {
						<jf-pille art="offen">Entwurf</jf-pille>
					}
					<a class="knopf leise zur-liste" [routerLink]="listeLink()">Zur Liste</a>
				</div>

				@if (schmal()) {
					<div class="umschalter" role="group" aria-label="Ansicht">
						<button
							type="button"
							class="knopf"
							[class.primaer]="ansicht() === 'bearbeiten'"
							[attr.aria-pressed]="ansicht() === 'bearbeiten'"
							(click)="ansicht.set('bearbeiten')"
						>
							Bearbeiten
						</button>
						<button
							type="button"
							class="knopf"
							[class.primaer]="ansicht() === 'vorschau'"
							[attr.aria-pressed]="ansicht() === 'vorschau'"
							(click)="ansicht.set('vorschau')"
						>
							Vorschau
						</button>
					</div>
				}

				<div class="spalten">
					<fieldset class="formular" [disabled]="laeuft()" [hidden]="schmal() && ansicht() === 'vorschau'">
						<legend class="unsichtbar">Thread</legend>
						<jf-karte class="block">
							<label class="feld">
								Titel
								<input
									id="thread-titel"
									type="text"
									autocomplete="off"
									[value]="kopf().titel"
									[attr.aria-invalid]="fehlerAn('titel') ? 'true' : null"
									[attr.aria-describedby]="fehlerAn('titel') ? 'thread-titel-fehler' : null"
									(input)="setzeKopf({ titel: wert($event) })"
								/>
							</label>
							@if (fehlerAn('titel'); as text) {
								<p class="fehler" role="alert" id="thread-titel-fehler">{{ text }}</p>
							}

							@if (austausch()) {
								<p class="hinweis gedaempft">Zielgruppe und Module des Austauschs stehen fest.</p>
							} @else {
								<fieldset class="gruppe" [attr.aria-describedby]="fehlerAn('zielgruppe') ? 'zielgruppe-fehler' : null">
									<legend>Zielgruppe</legend>
									<label class="haken">
										<input
											type="checkbox"
											name="alleUntergruppen"
											[checked]="kopf().alleUntergruppen"
											(change)="alleSetzen(haken($event))"
										/>
										Alle
									</label>
									@for (u of untergruppen(); track u.id) {
										<label class="haken">
											<input
												type="checkbox"
												name="untergruppe"
												[value]="u.id"
												[checked]="!kopf().alleUntergruppen && kopf().untergruppenIds.includes(u.id)"
												(change)="untergruppeSetzen(u.id, haken($event))"
											/>
											{{ u.name }}
										</label>
									}
									@if (fehlerAn('zielgruppe'); as text) {
										<p class="fehler" role="alert" id="zielgruppe-fehler">{{ text }}</p>
									}
									<label class="feld">
										Rollen
										<select name="rollenfilter" (change)="rollenfilterSetzen(wertAlsRollenfilter($event))">
											@for (r of rollenfilter; track r.wert) {
												<option [value]="r.wert" [selected]="r.wert === kopf().rollenfilter">{{ r.text }}</option>
											}
										</select>
									</label>
									<p class="gedaempft klein">{{ zielgruppe() }}</p>
								</fieldset>
							}

							<label class="feld">
								Modus
								<select
									name="modus"
									[attr.aria-invalid]="fehlerAn('modus') ? 'true' : null"
									(change)="setzeKopf({ modus: wertAlsModus($event) })"
								>
									@for (m of modi; track m.wert) {
										<option [value]="m.wert" [selected]="m.wert === kopf().modus">{{ m.text }}</option>
									}
								</select>
							</label>
							@if (fehlerAn('modus'); as text) {
								<p class="fehler" role="alert">{{ text }}</p>
							}

							<div class="benachrichtigen">
								<label class="haken">
									<input type="checkbox" name="benachrichtigen" disabled aria-describedby="benachrichtigen-hinweis" />
									Mitglieder benachrichtigen
								</label>
								<p class="gedaempft klein" id="benachrichtigen-hinweis">Kommt mit den Push-Nachrichten.</p>
							</div>
						</jf-karte>

						@if (!austausch()) {
							<jf-karte class="block">
								<h2>Module</h2>
								<ol class="module">
									@for (e of arbeit().module; track e.schluessel; let i = $index, letzte = $last) {
										<li [class.gewaehlt]="e.schluessel === gewaehlt()">
											<div class="zeile">
												<button
													type="button"
													class="knopf leise waehlen"
													[attr.aria-current]="e.schluessel === gewaehlt() ? 'true' : null"
													(click)="waehleModul(i)"
												>
													<strong>{{ typText(e.modul.typ) }}</strong>
													<span class="gedaempft klein kurz">{{ kurz(e.modul) }}</span>
												</button>
												<button
													type="button"
													class="knopf leise nur-icon"
													[attr.aria-label]="'Nach oben: Modul ' + (i + 1)"
													[disabled]="i === 0"
													(click)="schieben(i, -1)"
												>
													<jf-icon name="hoch" />
												</button>
												<button
													type="button"
													class="knopf leise nur-icon"
													[attr.aria-label]="'Nach unten: Modul ' + (i + 1)"
													[disabled]="letzte"
													(click)="schieben(i, 1)"
												>
													<jf-icon name="runter" />
												</button>
												<button
													type="button"
													class="knopf leise nur-icon"
													[attr.aria-label]="'Entfernen: Modul ' + (i + 1)"
													[disabled]="entfernenGesperrt(e.modul)"
													(click)="entfernenFragen(i)"
												>
													<jf-icon name="schliessen" />
												</button>
											</div>
											@if (fehlerhaft().has(i) && e.schluessel !== gewaehlt()) {
												<span class="fehlermarke"><jf-icon name="warnung" /> Fehler in diesem Modul</span>
											}
											@if (entfernenGesperrt(e.modul)) {
												<span class="gedaempft klein">{{ gesperrtText(e.modul) }}</span>
											}
										</li>
									} @empty {
										<li class="gedaempft">Noch keine Module.</li>
									}
								</ol>
								@if (fehlerAn('module'); as text) {
									<p class="fehler" role="alert">{{ text }}</p>
								}
								<div class="hinzufuegen" role="group" aria-label="Modul hinzufügen">
									<span class="gedaempft klein" aria-hidden="true">Modul hinzufügen:</span>
									@for (t of typen; track t.typ) {
										<button
											type="button"
											class="knopf klein"
											[disabled]="arbeit().module.length >= grenzen.module"
											(click)="hinzufuegen(t.typ)"
										>
											<jf-icon name="plus" /> {{ t.text }}
										</button>
									}
								</div>
							</jf-karte>

							@for (a of ausgewaehlt(); track a.eintrag.schluessel) {
								<jf-karte class="block">
									<h2>{{ typText(a.eintrag.modul.typ) }} (Modul {{ a.index + 1 }})</h2>
									@let m = a.eintrag.modul;
									@switch (m.typ) {
										@case ('DATEIEN') {
											<jf-dateien-felder
												[modul]="m"
												[slug]="slug()"
												[zahl]="zahlFuer(m)"
												[fehler]="modulFehler(a.index)"
												(aendern)="modulGeaendert(a.eintrag.schluessel, $event)"
												(hochgeladen)="ladeMedien()"
											/>
										}
										@case ('FOTOS') {
											<jf-fotos-felder
												[modul]="m"
												[slug]="slug()"
												[zahl]="zahlFuer(m)"
												[fehler]="modulFehler(a.index)"
												(aendern)="modulGeaendert(a.eintrag.schluessel, $event)"
												(hochgeladen)="ladeMedien()"
											/>
										}
										@case ('HELFER') {
											<jf-helfer-felder
												[modul]="m"
												[index]="a.index"
												[rollenfilter]="kopf().rollenfilter"
												[sperre]="helferSperreFuer(m)"
												[fehler]="modulFehler(a.index)"
												(aendern)="modulGeaendert(a.eintrag.schluessel, $event)"
											/>
										}
										@default {
											<jf-modul-felder
												[modul]="m"
												[index]="a.index"
												[rollenfilter]="kopf().rollenfilter"
												[sperre]="sperreFuer(m)"
												[fehler]="modulFehler(a.index)"
												(geaendert)="modulGeaendert(a.eintrag.schluessel, $event)"
											/>
										}
									}
								</jf-karte>
							}
						}
					</fieldset>

					<div class="vorschau-spalte" [hidden]="schmal() && ansicht() === 'bearbeiten'">
						<jf-thread-vorschau
							[entwurf]="entwurf()"
							[zielgruppe]="zielgruppe()"
							[markiert]="gewaehlterIndex()"
							(waehle)="waehleModul($event)"
						/>
					</div>
				</div>

				<div class="aktionen">
					@if (veroeffentlicht()) {
						<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="speichere(false)">
							Speichern
						</button>
					} @else {
						<button type="button" class="knopf" [disabled]="laeuft()" (click)="speichere(false)">
							Entwurf speichern
						</button>
						<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="speichere(true)">
							Veröffentlichen
						</button>
					}
					@if (bearbeitung(); as b) {
						<button type="button" class="knopf" [disabled]="laeuft()" (click)="pinne()">
							{{ b.angepinnt ? 'Lösen' : 'Anpinnen' }}
						</button>
						@if (b.darfArchivieren) {
							<button type="button" class="knopf" [disabled]="laeuft()" (click)="archiviere()">
								{{ b.archiviert ? 'Wiederherstellen' : 'Archivieren' }}
							</button>
						}
						<a class="knopf leise" [routerLink]="['/', slug(), 't', b.segment]">Thread ansehen</a>
						@if (hatAntwortModul()) {
							<a class="knopf leise" [routerLink]="['/', slug(), 'verwaltung', 'threads', b.id, 'antworten']"
								>Antworten</a
							>
						}
						@if (b.darfLoeschen) {
							<button type="button" class="knopf gefahr" [disabled]="laeuft()" (click)="fragtLoeschen.set(true)">
								Löschen
							</button>
						}
					}
				</div>

				@if (veraltet(); as text) {
					<jf-karte class="veraltet" role="alert">
						<p>{{ text }}</p>
						<p class="gedaempft klein">Neu laden verwirft die Änderungen auf dieser Seite.</p>
						<button type="button" class="knopf primaer" (click)="neuLaden()">Neu laden</button>
					</jf-karte>
				}
				@if (meldung(); as text) {
					<p class="meldung fehler" role="alert">{{ text }}</p>
				}
				@if (status() && !ungespeichert()) {
					<p class="status" role="status">{{ status() }}</p>
				}

				@if (fragtEntfernen(); as f) {
					<jf-bestaetigung
						titel="Modul entfernen?"
						[text]="f.text"
						bestaetigung="Entfernen"
						(bestaetigt)="entferneBestaetigt()"
						(abgebrochen)="fragtEntfernen.set(null)"
					/>
				}
				@if (fragtLoeschen()) {
					<jf-bestaetigung
						titel="Thread löschen?"
						[text]="loeschText()"
						bestaetigung="Endgültig löschen"
						(bestaetigt)="loesche()"
						(abgebrochen)="fragtLoeschen.set(false)"
					/>
				}
			}
			@case ('nicht-gefunden') {
				<jf-karte>
					<!-- Ein Text fuer unbekannt und ohne Recht (Rahmen-Spec 8). -->
					<h1>Nicht gefunden oder keine Berechtigung</h1>
					<a class="knopf" [routerLink]="listeLink()">Zur Liste</a>
				</jf-karte>
			}
			@case ('fehler') {
				<jf-karte>
					<p class="fehler" role="alert">{{ ladefehler() }}</p>
					<button type="button" class="knopf primaer" (click)="neuLaden()">Nochmal versuchen</button>
				</jf-karte>
			}
			@default {
				<p class="gedaempft" role="status">Wird geladen …</p>
			}
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a4);
			max-width: 80rem;
		}
		h1 {
			margin: 0;
			font-size: var(--schrift-titel);
		}
		h2 {
			margin: 0;
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0;
		}
		.titelzeile {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a3);
		}
		.zur-liste {
			margin-left: auto;
		}
		.umschalter {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--a2);
		}
		.spalten {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: var(--a5);
			align-items: start;
		}
		/* Ein fieldset ist sonst mindestens so breit wie sein breitester Inhalt und spraenge die Spalte. */
		.formular {
			display: grid;
			gap: var(--a4);
			min-width: 0;
			min-inline-size: 0;
			margin: 0;
			padding: 0;
			border: 0;
		}
		.vorschau-spalte {
			position: sticky;
			top: var(--a4);
			max-height: calc(100dvh - 2 * var(--a4));
			overflow-y: auto;
			min-width: 0;
		}
		/* hidden setzt display none nur, solange keine eigene Regel display setzt. */
		.formular[hidden],
		.vorschau-spalte[hidden] {
			display: none;
		}
		.block {
			display: grid;
			gap: var(--a3);
			min-width: 0;
		}
		.gruppe {
			display: grid;
			gap: var(--a1);
			min-width: 0;
			margin: 0;
			padding: 0;
			border: 0;
		}
		legend {
			padding: 0;
			margin-bottom: var(--a1);
			font-size: var(--schrift-klein);
			font-weight: 600;
			color: var(--text-gedaempft);
		}
		.fehler {
			color: var(--fehler);
		}
		.hinweis {
			font-weight: 600;
		}
		.benachrichtigen {
			display: grid;
		}
		.module {
			display: grid;
			gap: var(--a2);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.module li {
			display: grid;
			gap: var(--a1);
			padding: var(--a1);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
		}
		.module li.gewaehlt {
			border-color: var(--akzent);
			box-shadow: 0 0 0 1px var(--akzent);
		}
		.zeile {
			display: flex;
			align-items: center;
			gap: var(--a1);
			min-width: 0;
		}
		.knopf.waehlen {
			display: grid;
			flex: 1;
			justify-content: stretch;
			justify-items: start;
			min-width: 0;
			padding: var(--a1) var(--a3);
			border-radius: var(--radius-klein);
			text-align: left;
			white-space: normal;
		}
		.kurz {
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-weight: 400;
		}
		.fehlermarke {
			display: inline-flex;
			align-items: center;
			gap: var(--a1);
			color: var(--fehler);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		.hinzufuegen,
		.aktionen {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		.knopf.gefahr {
			color: var(--fehler);
		}
		.veraltet {
			display: grid;
			gap: var(--a2);
			justify-items: start;
			border-color: var(--warnung);
		}
		.status {
			color: var(--erfolg);
			font-weight: 600;
		}
		@media (max-width: 1023px) {
			.spalten {
				grid-template-columns: minmax(0, 1fr);
			}
			.vorschau-spalte {
				position: static;
				max-height: none;
				overflow: visible;
				justify-self: center;
				width: 100%;
				display: grid;
				justify-items: center;
			}
		}
	`,
})
export class ThreadEditorComponent {
	/** Kommen aus dem Pfad (withComponentInputBinding); ohne id ist es threads/neu. */
	readonly slug = input.required<string>();
	readonly id = input<string>();

	private readonly api = inject(VerwaltungThreadsApi);
	private readonly router = inject(Router);

	protected readonly typen = TYPEN;
	protected readonly grenzen = GRENZEN;
	protected readonly wert = wertVon;
	protected readonly modi = (Object.keys(MODUS_TEXT) as ThreadModus[]).map((wert) => ({
		wert,
		text: MODUS_TEXT[wert],
	}));
	protected readonly rollenfilter = (Object.keys(ROLLENFILTER_TEXT) as Rollenfilter[]).map((wert) => ({
		wert,
		text: ROLLENFILTER_TEXT[wert],
	}));

	protected readonly zustand = signal<Zustand>('laedt');
	protected readonly ladefehler = signal<string | null>(null);
	/** Der Stand des Servers; null bei einem neuen Thread. */
	protected readonly bearbeitung = signal<ThreadBearbeitung | null>(null);
	protected readonly untergruppen = signal<{ id: string; name: string }[]>([]);
	/**
	 * Die Version fuer das naechste ersetze; nur Laden und Speichern setzen sie. Anpinnen und
	 * Archivieren liefern zwar auch eine Bearbeitung, aber ihr Entwurf ist nicht die Arbeitskopie:
	 * Uebernaehme die Seite deren Version, haette jemand anderes inzwischen gespeichert, ginge das
	 * naechste Speichern ohne 409 VERALTET ueber seine Aenderung hinweg.
	 */
	private version = 0;

	protected readonly arbeit = signal<Arbeit>(arbeitAus(leererEntwurf()));
	private readonly basis = signal(JSON.stringify(leererEntwurf()));
	protected readonly gewaehlt = signal<string | null>(null);

	/** Fehler aus entwurfFehler zeigt die Seite erst nach dem ersten Speichern, dann aber bei jeder Eingabe neu. */
	private readonly geprueft = signal(false);
	private readonly serverFehler = signal<ServerFehler | null>(null);
	protected readonly meldung = signal<string | null>(null);
	protected readonly veraltet = signal<string | null>(null);
	protected readonly status = signal<string | null>(null);
	protected readonly laeuft = signal(false);
	protected readonly fragtLoeschen = signal(false);
	/** Das Modul, dessen Entfernen gerade eine Rueckfrage zeigt, am Schluessel statt am Index (siehe Eintrag). */
	protected readonly fragtEntfernen = signal<{ schluessel: string; text: string } | null>(null);
	/** Nach dem Loeschen gibt es nichts mehr zu verlieren; der Waechter soll nicht fragen. */
	private readonly geloescht = signal(false);

	protected readonly schmal = signal(false);
	protected readonly ansicht = signal<'bearbeiten' | 'vorschau'>('bearbeiten');

	private uebergabe = uebergabeAus(inject(Router).currentNavigation());
	private lauf = 0;
	/** Zaehlt jeden Stand, der die Medienzahlen setzt; eine spaetere Antwort ueberholt eine fruehere (siehe ladeMedien). */
	private medienLauf = 0;
	private weg = false;

	protected readonly kopf = computed(() => this.arbeit().kopf);
	protected readonly entwurf = computed<ThreadEntwurf>(() => {
		const { kopf, module } = this.arbeit();
		return { ...kopf, module: module.map((e) => e.modul) };
	});
	protected readonly neu = computed(() => this.id() === undefined);
	protected readonly veroeffentlicht = computed(() => this.bearbeitung()?.veroeffentlicht ?? false);
	protected readonly austausch = computed(() => this.bearbeitung()?.art === 'JUGENDSPRECHER_AUSTAUSCH');
	/**
	 * Der Link "Antworten" fuehrt in die Uebersicht gespeicherter Umfragen und Helferlisten, nicht
	 * ungespeicherter; dieselbe Regel wie hatAntwortModul der Verwaltungsliste (Plan-Entscheidung 13).
	 */
	protected readonly hatAntwortModul = computed(
		() => this.bearbeitung()?.entwurf.module.some((m) => m.typ === 'UMFRAGE' || m.typ === 'HELFER') ?? false,
	);
	protected readonly listeLink = computed(() => ['/', this.slug(), 'verwaltung', 'threads']);

	private readonly untergruppenIds = computed(() => new Set(this.untergruppen().map((u) => u.id)));
	protected readonly zielgruppe = computed(() =>
		zielgruppeText(this.kopf(), new Map(this.untergruppen().map((u) => [u.id, u.name]))),
	);

	/** Der Feldfehler des Servers mit dem Index, den sein Modul jetzt hat; mit dem Modul entfernt, ist er weg. */
	private readonly serverFeldfehler = computed<Feldfehler | null>(() => {
		const s = this.serverFehler();
		if (s === null) return null;
		if (s.schluessel === null) return { feld: s.feld, text: s.text };
		const i = this.arbeit().module.findIndex((e) => e.schluessel === s.schluessel);
		return i < 0 ? null : { feld: `module.${i}.${s.feld}`, text: s.text };
	});

	protected readonly fehler = computed<Feldfehler[]>(() => {
		const client = this.geprueft() ? entwurfFehler(this.entwurf(), this.untergruppenIds()) : [];
		const server = this.serverFeldfehler();
		return server ? [...client, server] : client;
	});

	/** Die Fehler je Modul nach dem Praefix module.N.; jf-modul-felder ordnet sie seinen Feldern zu. */
	private readonly fehlerJeModul = computed(() => {
		const karte = new Map<number, Feldfehler[]>();
		for (const f of this.fehler()) {
			const treffer = MODULFEHLER.exec(f.feld);
			if (!treffer) continue;
			const i = Number(treffer[1]);
			karte.set(i, [...(karte.get(i) ?? []), f]);
		}
		return karte;
	});
	protected readonly fehlerhaft = computed(() => new Set(this.fehlerJeModul().keys()));

	protected readonly gewaehlterIndex = computed(() => {
		const i = this.arbeit().module.findIndex((e) => e.schluessel === this.gewaehlt());
		return i < 0 ? null : i;
	});

	/** Hoechstens ein Eintrag; als Liste, damit die Vorlage ihn nach dem Schluessel trackt (siehe Eintrag). */
	protected readonly ausgewaehlt = computed(() => {
		const i = this.gewaehlterIndex();
		const eintrag = i === null ? undefined : this.arbeit().module[i];
		return eintrag === undefined || i === null || this.austausch() ? [] : [{ eintrag, index: i }];
	});

	constructor() {
		effect(() => {
			const slug = this.slug();
			const id = this.id();
			untracked(() => void this.lade(slug, id));
		});

		const destroy = inject(DestroyRef);
		destroy.onDestroy(() => {
			this.weg = true;
			this.lauf++;
		});

		if (typeof matchMedia === 'function') {
			const mq = matchMedia(SCHMAL);
			this.schmal.set(mq.matches);
			const aenderung = (e: MediaQueryListEvent) => this.schmal.set(e.matches);
			mq.addEventListener?.('change', aenderung);
			destroy.onDestroy(() => mq.removeEventListener?.('change', aenderung));
		}
	}

	/** Fuer ungespeichertWaechter und beforeunload. */
	ungespeichert(): boolean {
		return this.zustand() === 'bereit' && !this.geloescht() && JSON.stringify(this.entwurf()) !== this.basis();
	}

	/** Neuladen und Schliessen des Tabs erreicht kein Router-Waechter; der Browser fragt dann selbst. */
	protected vorDemVerlassen(e: BeforeUnloadEvent): void {
		if (!this.ungespeichert()) return;
		e.preventDefault();
		// Aeltere Safari-Versionen fragen nur, wenn returnValue gesetzt ist.
		e.returnValue = '';
	}

	// ---- Laden -------------------------------------------------------------------------

	private async lade(slug: string, id: string | undefined): Promise<void> {
		const lauf = ++this.lauf;
		this.zustand.set('laedt');
		this.geprueft.set(false);
		this.serverFehler.set(null);
		this.meldung.set(null);
		this.veraltet.set(null);
		this.status.set(null);

		const uebergabe = this.uebergabe;
		this.uebergabe = null;
		if (id !== undefined && uebergabe?.bearbeitung.id === id) {
			this.uebernehme(uebergabe.bearbeitung);
			this.status.set(uebergabe.status);
			this.meldung.set(uebergabe.meldung);
			if (uebergabe.serverFehler) {
				// Nach uebernehme: Die Module tragen jetzt die Schluessel, an die der Fehler gehoert.
				this.setzeServerFehler(uebergabe.serverFehler);
				this.geprueft.set(true);
			}
			this.zustand.set('bereit');
			return;
		}

		try {
			if (id === undefined) {
				// Die Untergruppen fuer einen neuen Thread kommen aus der Liste; sie sagt auch, ob die
				// Person ueberhaupt anlegen darf. Ohne das Recht antwortete das Anlegen sonst erst beim Speichern.
				const liste = await firstValueFrom(this.api.liste(slug));
				if (lauf !== this.lauf) return;
				if (!liste.darfErstellen) {
					this.zustand.set('nicht-gefunden');
					return;
				}
				this.bearbeitung.set(null);
				this.untergruppen.set(liste.untergruppen);
				this.setzeArbeit(leererEntwurf());
				this.gewaehlt.set(null);
			} else {
				const b = await firstValueFrom(this.api.bearbeitung(slug, id));
				if (lauf !== this.lauf) return;
				this.uebernehme(b);
			}
			this.zustand.set('bereit');
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, slug, fehler)) return;
			if (fehler.status === 404) {
				this.zustand.set('nicht-gefunden');
				return;
			}
			this.ladefehler.set(fehlertextNichtGefunden(fehler));
			this.zustand.set('fehler');
		}
	}

	protected neuLaden(): void {
		void this.lade(this.slug(), this.id());
	}

	private setzeArbeit(e: ThreadEntwurf): void {
		this.arbeit.set(arbeitAus(e));
		this.basis.set(JSON.stringify(this.entwurf()));
	}

	/**
	 * Uebernimmt den Stand des Servers als Arbeitskopie und Vergleichsbasis. Die Auswahl bleibt an
	 * ihrer Position: Ein neues Modul bekommt beim Speichern seine ID und damit einen neuen Schluessel.
	 */
	private uebernehme(b: ThreadBearbeitung): void {
		this.medienLauf++;
		const vorher = this.gewaehlterIndex();
		this.bearbeitung.set(b);
		this.version = b.version;
		this.untergruppen.set(b.untergruppen);
		this.setzeArbeit(b.entwurf);
		const nachher = vorher === null ? undefined : this.arbeit().module[vorher];
		this.gewaehlt.set(nachher?.schluessel ?? null);
	}

	// ---- Eingaben ----------------------------------------------------------------------

	protected haken(e: Event): boolean {
		return (e.target as HTMLInputElement).checked;
	}

	protected wertAlsRollenfilter(e: Event): Rollenfilter {
		return wertVon(e) as Rollenfilter;
	}

	protected wertAlsModus(e: Event): ThreadModus {
		return wertVon(e) as ThreadModus;
	}

	protected setzeKopf(teil: Partial<Kopf>): void {
		this.arbeit.update((a) => ({ ...a, kopf: { ...a.kopf, ...teil } }));
	}

	// "Alle" und die Auswahl schliessen sich aus. Wer "Alle" abwaehlt, steht ohne Untergruppe da und
	// bekommt beim Speichern den Fehler; verworfen: dann still alle Untergruppen anzuhaken, denn das
	// waere eine Auswahl, die die Person nicht getroffen hat.
	protected alleSetzen(an: boolean): void {
		this.setzeKopf({ alleUntergruppen: an, untergruppenIds: [] });
	}

	// Aufsteigend nach ID, wie der Server sie liefert (laden.ts: orderBy untergruppeId asc). Ungespeichert
	// vergleicht den Entwurf als JSON; ab- und wieder angehakt stuende die ID sonst hinten und die Seite
	// fragte beim Verlassen nach einer Aenderung, die keine ist. Verglichen nach Code-Einheiten statt
	// localeCompare: postgres:17-alpine (lokal wie auf dem Server) sortiert mit Sortierfolge C, also nach
	// Bytes, und fuer die IDs (cuid, Kleinbuchstaben und Ziffern) ist das dieselbe Reihenfolge.
	// Verworfen: ungespeichert die IDs als Menge vergleichen zu lassen, denn dann muesste der Vergleich
	// die Form des Entwurfs kennen.
	protected untergruppeSetzen(id: string, an: boolean): void {
		const k = this.kopf();
		const bisher = k.alleUntergruppen ? [] : k.untergruppenIds.filter((x) => x !== id);
		const ids = (an ? [...bisher, id] : bisher).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		this.setzeKopf({ alleUntergruppen: false, untergruppenIds: ids });
	}

	/**
	 * Eine Einheit, die beim neuen Rollenfilter niemanden fragt, stellt die Seite auf die erste
	 * passende (Spec 3.2), damit der Wechsel nicht sofort einen Fehler erzeugt; das gilt fuer
	 * Umfragen und Helferlisten. Nicht, wenn Antworten oder Eintraege die Einheit festlegen: Dort
	 * zeigt entwurfFehler den Fehler an der Einheit, und die Person entscheidet, ob sie den
	 * Rollenfilter zuruecknimmt.
	 */
	protected rollenfilterSetzen(rollenfilter: Rollenfilter): void {
		this.arbeit.update((a) => ({
			kopf: { ...a.kopf, rollenfilter },
			module: a.module.map((e) => ({ ...e, modul: this.mitPassenderEinheit(e.modul, rollenfilter) })),
		}));
	}

	private mitPassenderEinheit(m: ModulEntwurf, rollenfilter: Rollenfilter): ModulEntwurf {
		if (m.typ !== 'UMFRAGE' && m.typ !== 'HELFER') return m;
		const erlaubt = einheitenFuer(rollenfilter);
		if (erlaubt.includes(m.einheit) || this.einheitFest(m)) return m;
		return { ...m, einheit: erlaubt[0] ?? m.einheit };
	}

	// Dieselben Grenzen wie die Felder: Bei der Umfrage legt eine Antwort mit Option die Einheit
	// fest, bei der Helferliste der erste Eintrag (pruefeHelferAenderung).
	private einheitFest(m: ModulEntwurf): boolean {
		if (m.typ === 'UMFRAGE') return (this.sperreFuer(m)?.schluessel.length ?? 0) > 0;
		if (m.typ === 'HELFER') return this.helferSperreFuer(m)?.eingetragen ?? false;
		return false;
	}

	// neuesModul waehlt die Einheit nur fuer die Helferliste nach dem Rollenfilter; die Vorlage der
	// Umfrage bleibt fest (Pro Jungfischer bei "Nur Familie" waere sofort ein Fehler), daher danach
	// mitPassenderEinheit.
	protected hinzufuegen(typ: ModulTyp): void {
		const roh = neuesModul(typ, this.entwurf().module, new Date(), this.kopf().rollenfilter);
		const eintrag: Eintrag = {
			schluessel: lokalerSchluessel(),
			modul: this.mitPassenderEinheit(roh, this.kopf().rollenfilter),
		};
		this.arbeit.update((a) => ({ ...a, module: [...a.module, eintrag] }));
		this.gewaehlt.set(eintrag.schluessel);
	}

	protected schieben(i: number, richtung: -1 | 1): void {
		const ziel = i + richtung;
		this.arbeit.update((a) => {
			const module = [...a.module];
			const hier = module[i];
			const dort = module[ziel];
			if (hier === undefined || dort === undefined) return a;
			module[i] = dort;
			module[ziel] = hier;
			return { ...a, module };
		});
	}

	// Ein Modul mit Fotos oder Dateien nimmt beim Speichern seine Medien mit (Plan-Entscheidung 11):
	// Die Rueckfrage nennt die Zahlen, solange noch nichts verloren ist. Ein Modul ohne Medien, auch
	// ein ungespeichertes, faellt ohne Rueckfrage weg; verworfen: jedes Entfernen bestaetigen zu
	// lassen, das machte aus dem Alltag (ein Info-Text zu viel) eine Huerde.
	//
	// Bekannte Luecke (gilt ebenso fuer loeschText): Die Zahl stammt vom Laden der Bearbeitung und vom
	// eigenen Upload (ladeMedien). Fotos, die andere danach hochladen, kennt die Rueckfrage nicht; das
	// Speichern loescht sie trotzdem mit. Bei "Alle Leser laden hoch" kann das waehrend eines Zeltlagers
	// geschehen, ist aber selten, denn ein Foto-Modul entfernt man kaum mitten im Hochladen. Verworfen:
	// ein Abgleich beim Speichern (die Route kennt die echte Zahl und antwortete bei Abweichung mit 409,
	// der Editor fragte neu) -- ein eigener Konflikt-Weg durch Route, Editor und Tests fuer einen Fall,
	// den die Person auch nach dem Speichern noch sieht (die Fotos fehlen im Thread).
	protected entfernenFragen(i: number): void {
		const e = this.arbeit().module[i];
		if (e === undefined) return;
		const zahl = this.zahlFuer(e.modul);
		const medien = zahl === null ? null : medienZahlText(zahl);
		if (medien === null) {
			this.entfernen(i);
			return;
		}
		const name = e.modul.titel?.trim() || this.typText(e.modul.typ);
		this.fragtEntfernen.set({
			schluessel: e.schluessel,
			text: `Modul ‚${name}‘ entfernen? Beim Speichern löscht das ${medien}.`,
		});
	}

	protected entferneBestaetigt(): void {
		const f = this.fragtEntfernen();
		this.fragtEntfernen.set(null);
		const i = this.arbeit().module.findIndex((e) => e.schluessel === f?.schluessel);
		if (i >= 0) this.entfernen(i);
	}

	protected entfernen(i: number): void {
		const weg = this.arbeit().module[i];
		if (weg === undefined) return;
		this.arbeit.update((a) => ({ ...a, module: a.module.filter((_, j) => j !== i) }));
		if (this.gewaehlt() === weg.schluessel) this.gewaehlt.set(null);
	}

	/** jf-modul-felder ist gesteuert: Jede Aenderung kommt hier an und ersetzt das Modul an seinem Schluessel. */
	protected modulGeaendert(schluessel: string, modul: ModulEntwurf): void {
		this.arbeit.update((a) => ({
			...a,
			module: a.module.map((e) => (e.schluessel === schluessel ? { schluessel, modul } : e)),
		}));
	}

	protected waehleModul(i: number): void {
		const e = this.arbeit().module[i];
		if (e === undefined) return;
		this.gewaehlt.set(e.schluessel);
		this.ansicht.set('bearbeiten');
	}

	// ---- Anzeige -----------------------------------------------------------------------

	protected typText(typ: ModulTyp): string {
		return TYPEN.find((t) => t.typ === typ)?.text ?? typ;
	}

	protected kurz(m: ModulEntwurf): string {
		if (m.titel) return m.titel;
		if (m.typ === 'INFO') return m.text.trim().split('\n')[0]?.slice(0, 60) || 'Noch ohne Text';
		if (m.typ === 'TERMIN') {
			return m.termin.startDatum ? terminZeit({ modulId: '', ...m.termin }) : 'Noch ohne Datum';
		}
		if (m.typ === 'DATEIEN') return 'Dateien';
		if (m.typ === 'FOTOS') return 'Fotos';
		if (m.typ === 'HELFER') return 'Helferliste';
		return m.frage.trim() || 'Noch ohne Frage';
	}

	protected fehlerAn(feld: string): string | undefined {
		return this.fehler().find((f) => f.feld === feld)?.text;
	}

	protected modulFehler(i: number): Feldfehler[] {
		return this.fehlerJeModul().get(i) ?? KEINE_FEHLER;
	}

	/** Null bei einem ungespeicherten Modul: Es hat keine Medien und keine Zahl. */
	protected zahlFuer(m: ModulEntwurf): MedienZahl | null {
		if (m.id === null) return null;
		return this.bearbeitung()?.medien.module[m.id] ?? KEINE_MEDIEN;
	}

	/**
	 * Was das Loeschen des Threads mitnimmt, wenn Fotos oder Dateien daran haengen. Dieselbe Luecke
	 * wie bei entfernenFragen: Was andere seit dem Laden hochgeladen haben, fehlt in der Zahl.
	 */
	protected readonly loeschText = computed(() => {
		const basis = 'Der Thread wird mit allen Modulen endgültig gelöscht.';
		const medien = medienZahlText(this.bearbeitung()?.medien.gesamt ?? KEINE_MEDIEN);
		return medien === null ? basis : `${basis} Das löscht auch ${medien}.`;
	});

	/** Nur gespeicherte Umfragen haben Antworten und damit eine Sperre. */
	protected sperreFuer(m: ModulEntwurf): UmfrageSperre | null {
		if (m.typ !== 'UMFRAGE' || m.id === null) return null;
		return this.bearbeitung()?.sperren[m.id] ?? null;
	}

	/** Nur gespeicherte Helferlisten haben Eintraege und damit eine Sperre. */
	protected helferSperreFuer(m: ModulEntwurf): HelferSperre | null {
		if (m.typ !== 'HELFER' || m.id === null) return null;
		return this.bearbeitung()?.helferSperren[m.id] ?? null;
	}

	// Jede Antwortzeile zaehlt, auch eine ohne Option: Die Datenbank verweigerte das Loeschen sonst
	// (UmfrageSperre). Bei der Helferliste jeder Eintrag, auch der einer nicht mehr gefragten Person
	// (Plan-Entscheidung 1); der Server antwortete sonst mit 409.
	protected entfernenGesperrt(m: ModulEntwurf): boolean {
		if (m.typ === 'HELFER') return this.helferSperreFuer(m)?.eingetragen ?? false;
		return this.sperreFuer(m)?.beantwortet ?? false;
	}

	// Eine Helferliste hat Eintraege, keine Antworten (wie HELFER_EINHEIT_GESPERRT in vergleich.ts).
	protected gesperrtText(m: ModulEntwurf): string {
		return m.typ === 'HELFER' ? 'Gesperrt, weil schon Einträge da sind' : 'Gesperrt, weil schon Antworten da sind';
	}

	// ---- Speichern ---------------------------------------------------------------------

	protected async speichere(veroeffentlichen: boolean): Promise<void> {
		if (this.laeuft()) return;
		this.geprueft.set(true);
		this.serverFehler.set(null);
		this.meldung.set(null);
		this.veraltet.set(null);
		this.status.set(null);

		const entwurf = this.entwurf();
		const fehler = entwurfFehler(entwurf, this.untergruppenIds());
		if (fehler.length > 0) {
			this.zeigeFehlerhaftes(fehler);
			return;
		}

		const slug = this.slug();
		const id = this.id();
		this.laeuft.set(true);
		try {
			let b: ThreadBearbeitung;
			try {
				b = await firstValueFrom(
					id === undefined ? this.api.lege(slug, entwurf) : this.api.ersetze(slug, id, this.version, entwurf),
				);
			} catch (ursache) {
				if (!this.weg) await this.zeigeFehler(ursache);
				return;
			}
			if (this.weg) return;
			this.uebernehme(b);

			let veroeffentlicht = false;
			if (veroeffentlichen) {
				try {
					b = await firstValueFrom(this.api.veroeffentliche(slug, b.id));
					if (this.weg) return;
					this.uebernehme(b);
					veroeffentlicht = true;
				} catch (ursache) {
					if (this.weg) return;
					await this.zeigeFehler(ursache);
					// Bei abgelaufener Sitzung hat zeigeFehler zur Anmeldung gefuehrt und die Seite ist
					// zerstoert; die Navigation nach threads/<id> unten ueberholte sonst die Anmeldeseite.
					if (this.weg) return;
				}
			}
			if (!veroeffentlichen || veroeffentlicht) {
				this.status.set(veroeffentlicht ? 'Veröffentlicht' : b.veroeffentlicht ? 'Gespeichert' : 'Entwurf gespeichert');
			}

			if (id === undefined) {
				const uebergabe: Uebergabe = {
					bearbeitung: b,
					status: this.status(),
					meldung: this.meldung(),
					serverFehler: this.serverFeldfehler(),
				};
				await this.router.navigate(['/', slug, 'verwaltung', 'threads', b.id], {
					replaceUrl: true,
					state: { [UEBERGABE]: uebergabe },
				});
			}
		} finally {
			this.laeuft.set(false);
		}
	}

	/**
	 * Ordnet einen Fehler der API zu: 409 VERALTET als Karte mit "Neu laden", ein Feld, das die Seite
	 * zeigt, an das Feld, alles andere als Satz unter den Knoepfen (404 als "Nicht gefunden oder keine
	 * Berechtigung", 429 mit Wartezeit).
	 */
	private async zeigeFehler(ursache: unknown): Promise<void> {
		const fehler = alsApiFehler(ursache);
		if (await beiAbgelaufenerSitzung(this.router, this.slug(), fehler)) return;
		if (fehler.status === 409 && fehler.code === 'VERALTET') {
			this.veraltet.set(fehler.fehler);
			return;
		}
		if (fehler.feld !== undefined && this.zeigtFeld(fehler.feld)) {
			const f: Feldfehler = { feld: fehler.feld, text: fehler.fehler };
			this.setzeServerFehler(f);
			this.zeigeFehlerhaftes([f]);
			return;
		}
		this.meldung.set(fehlertextNichtGefunden(fehler));
	}

	/**
	 * Ob die Seite ein Feld des Servers an einer Stelle zeigen kann; sonst ginge der Fehler unter.
	 * An einem Modul zaehlt, was jf-modul-felder fuer dessen Typ und Modus zeigt (zeigtModulFeld):
	 * Ein Fehler an einem Feld, das es dort nicht gibt, waehlte das Modul, und zu sehen waere nichts.
	 */
	private zeigtFeld(feld: string): boolean {
		if (feld === 'titel' || feld === 'modus') return true;
		if (this.austausch()) return false;
		if (feld === 'zielgruppe' || feld === 'module') return true;
		const treffer = MODULFEHLER.exec(feld);
		const e = treffer ? this.arbeit().module[Number(treffer[1])] : undefined;
		return treffer !== null && e !== undefined && zeigtModulFeld(e.modul, feld.slice(treffer[0].length));
	}

	/** Haengt einen Fehler an einem Modul an dessen Schluessel (siehe ServerFehler). */
	private setzeServerFehler(f: Feldfehler): void {
		const treffer = MODULFEHLER.exec(f.feld);
		const e = treffer ? this.arbeit().module[Number(treffer[1])] : undefined;
		this.serverFehler.set(
			treffer && e
				? { schluessel: e.schluessel, feld: f.feld.slice(treffer[0].length), text: f.text }
				: { schluessel: null, feld: f.feld, text: f.text },
		);
	}

	/** Waehlt das erste Modul mit Fehler, damit seine Felder samt Fehler zu sehen sind. */
	private zeigeFehlerhaftes(fehler: readonly Feldfehler[]): void {
		this.ansicht.set('bearbeiten');
		for (const f of fehler) {
			const treffer = MODULFEHLER.exec(f.feld);
			const e = treffer ? this.arbeit().module[Number(treffer[1])] : undefined;
			if (e) {
				this.gewaehlt.set(e.schluessel);
				return;
			}
		}
	}

	// ---- Medien ------------------------------------------------------------------------

	/**
	 * Holt nach einem Upload die Zahlen neu und uebernimmt nur sie, nicht den Entwurf und nicht die
	 * Version: Die Arbeitskopie hat ungespeicherte Eingaben, und ein Upload aendert den Thread nicht
	 * (kein neuer Stand, also kein 409 beim naechsten Speichern). Verworfen: ein eigener Endpunkt
	 * nur fuer die Zahlen, denn die Bearbeitung liefert sie schon und ein Weg weniger bleibt zu
	 * pflegen. Eine Antwort, die ein Speichern oder eine neuere Anfrage ueberholt hat, verfaellt
	 * (medienLauf), sonst stuende die Zahl von vor dem Speichern wieder da.
	 */
	protected async ladeMedien(): Promise<void> {
		const id = this.id();
		if (id === undefined || this.bearbeitung() === null) return;
		const lauf = this.lauf;
		const nummer = ++this.medienLauf;
		const veraltet = () => this.weg || lauf !== this.lauf || nummer !== this.medienLauf;
		try {
			const neu = await firstValueFrom(this.api.bearbeitung(this.slug(), id));
			if (veraltet()) return;
			this.bearbeitung.update((alt) => (alt === null ? alt : { ...alt, medien: neu.medien }));
		} catch (ursache) {
			if (!veraltet()) await this.zeigeFehler(ursache);
		}
	}

	// ---- Liste: Anpinnen, Archiv, Loeschen ---------------------------------------------

	protected pinne(): void {
		const b = this.bearbeitung();
		if (b) void this.aendereListe(this.api.pinne(this.slug(), b.id, !b.angepinnt));
	}

	protected archiviere(): void {
		const b = this.bearbeitung();
		if (b) void this.aendereListe(this.api.archiviere(this.slug(), b.id, !b.archiviert));
	}

	/** Uebernimmt nur Kopf und Rechte, nicht den Entwurf: Ungespeicherte Eingaben bleiben stehen. */
	private async aendereListe(anfrage: Observable<ThreadBearbeitung>): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.meldung.set(null);
		this.status.set(null);
		try {
			const b = await firstValueFrom(anfrage);
			if (!this.weg) this.bearbeitung.set(b);
		} catch (ursache) {
			if (!this.weg) await this.zeigeFehler(ursache);
		} finally {
			this.laeuft.set(false);
		}
	}

	protected async loesche(): Promise<void> {
		this.fragtLoeschen.set(false);
		const b = this.bearbeitung();
		if (!b || this.laeuft()) return;
		const slug = this.slug();
		this.laeuft.set(true);
		this.meldung.set(null);
		try {
			await firstValueFrom(this.api.loesche(slug, b.id));
			if (this.weg) return;
			this.geloescht.set(true);
			await this.router.navigate(['/', slug, 'verwaltung', 'threads']);
		} catch (ursache) {
			if (!this.weg) await this.zeigeFehler(ursache);
		} finally {
			this.laeuft.set(false);
		}
	}
}
