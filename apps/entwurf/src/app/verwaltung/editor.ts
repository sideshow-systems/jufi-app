import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import type { Id, Modul, Modus, Rollenfilter, Thread, UmfrageModul } from '../daten/typen';
import { alsIso } from '../daten/zeit';
import { betrag } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';
import { zielgruppeText } from '../gestaltung/texte';
import { KarteComponent } from '../gestaltung/ui';
import { NichtGefunden } from '../mitglieder/nicht-gefunden';
import { ModulWeiche } from '../module/modul';
import { terminFehler, terminZeit } from '../regeln/terminzeit';
import { VERWALTUNG_STIL } from './ansichten';
import { MODUS_TEXT } from './threads';

type Typ = Modul['typ'];

const TYPEN: { typ: Typ; text: string }[] = [
	{ typ: 'info', text: 'Info-Text' },
	{ typ: 'termin', text: 'Termin' },
	{ typ: 'umfrage', text: 'Umfrage' },
	{ typ: 'helfer', text: 'Helferliste' },
	{ typ: 'fahrt', text: 'Fahrgemeinschaft' },
	{ typ: 'kosten', text: 'Kosten' },
	{ typ: 'dateien', text: 'Dateien' },
	{ typ: 'fotos', text: 'Fotos' },
];

const OPTIONEN_VORLAGEN = {
	jn: [
		{ id: 'ja', text: 'Ja' },
		{ id: 'nein', text: 'Nein' },
	],
	jnv: [
		{ id: 'ja', text: 'Ja' },
		{ id: 'nein', text: 'Nein' },
		{ id: 'vielleicht', text: 'Vielleicht' },
	],
};

let zaehler = 0;
const id = (p: string) => `${p}-neu-${Date.now().toString(36)}${(++zaehler).toString(36)}`;

/** Ein neuer, noch nicht gespeicherter Thread; an alle Jungfischer und Eltern. */
const ohneZielgruppe = (t: Thread) => t.zielgruppe.untergruppen !== 'alle' && !t.zielgruppe.untergruppen.length;

export function leererThread(ich: Id): Thread {
	return {
		id: '',
		nr: 0,
		titel: '',
		zielgruppe: { untergruppen: 'alle', rollen: 'jungfischerUndEltern' },
		modus: 'kommentare',
		angepinnt: false,
		archiviert: false,
		veroeffentlicht: false,
		erstelltVon: ich,
		module: [],
		verlauf: [],
		letzteAktivitaet: '',
	};
}

/** Neues Modul mit sinnvollen Vorgaben, damit die Vorschau sofort etwas zeigt. */
function neuesModul(typ: Typ, ich: Id, jetzt: Date): Modul {
	const inEinerWoche = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 7);
	const tag = alsIso(inEinerWoche).slice(0, 10);
	switch (typ) {
		case 'info':
			return { id: id('m'), typ, text: '' };
		case 'termin':
			return { id: id('m'), typ, von: tag, beginnZeit: '18:00', endeZeit: '20:00', ort: 'Vereinsheim' };
		case 'umfrage':
			return {
				id: id('m'),
				typ,
				frage: 'Kommst du mit?',
				mehrfach: false,
				optionen: OPTIONEN_VORLAGEN.jn,
				einheit: 'jungfischer',
				ergebnisse: 'alle',
				teilnahme: true,
				antworten: [],
			};
		case 'helfer':
			return {
				id: id('m'),
				typ,
				titel: 'Wer hilft mit?',
				einheit: 'erwachsener',
				plaetze: [{ id: id('h'), text: 'Aufbau', anzahl: 2, eintraege: [] }],
			};
		case 'fahrt':
			return { id: id('m'), typ, autos: [] };
		case 'kosten':
			return { id: id('m'), typ, titel: 'Kosten', betragCent: 1000, hinweis: '', status: {} };
		case 'dateien':
			return { id: id('m'), typ, dateien: [{ id: id('d'), name: 'Beispiel.pdf', groesse: '100 KB' }] };
		case 'fotos':
			return { id: id('m'), typ, fotos: [{ id: id('f'), bild: 'fotos/f1.svg', von: ich }] };
	}
}

/**
 * Thread-Editor (Spec TP1 4.3): links das Formular, rechts die Handy-Vorschau
 * mit denselben Bauteilen wie in der App, nur lesend. Reihenfolge per
 * Hoch/Runter statt Ziehen — fuer den Entwurf genuegt das und es geht auch
 * mit Tastatur.
 */
@Component({
	selector: 'jf-thread-editor',
	imports: [RouterLink, IconComponent, KarteComponent, ModulWeiche, NichtGefunden],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (entwurf(); as t) {
			<div class="titelzeile">
				<h1>{{ t.id ? 'Thread bearbeiten' : 'Neuer Thread' }}</h1>
				<a class="knopf leise" routerLink="/glonntal/verwaltung/threads">Abbrechen</a>
			</div>
			<div class="spalten">
				<div class="formular">
					<jf-karte class="block">
						<label class="feld">
							Titel
							<input
								name="titel"
								[value]="t.titel"
								placeholder="z. B. 🎄 Weihnachtsfeier"
								(input)="setze({ titel: wert($event) })"
							/>
						</label>
						<fieldset>
							<legend>Zielgruppe</legend>
							<label class="haken">
								<input type="checkbox" [checked]="t.zielgruppe.untergruppen === 'alle'" (change)="alleSetzen($event)" />
								Alle
							</label>
							@for (u of untergruppen(); track u.id) {
								<label class="haken">
									<input
										type="checkbox"
										[checked]="t.zielgruppe.untergruppen !== 'alle' && t.zielgruppe.untergruppen.includes(u.id)"
										(change)="untergruppeSetzen(u.id, $event)"
									/>
									{{ u.name }}
								</label>
							}
							@if (ohneZielgruppe(t)) {
								<p class="hinweis klein">Wer soll den Thread sehen? Bitte „Alle" oder eine Untergruppe wählen.</p>
							}
							<label class="feld">
								Wer
								<select [value]="t.zielgruppe.rollen" (change)="rollenSetzen($event)">
									<option value="jungfischerUndEltern">Jungfischer + Eltern</option>
									<option value="nurEltern">Nur Eltern</option>
									<option value="nurJugendleiter">Nur Jugendleiter</option>
								</select>
							</label>
							<p class="gedaempft klein">{{ zielgruppe() }}</p>
						</fieldset>
						<label class="feld">
							Modus
							<select [value]="t.modus" (change)="setze({ modus: $any(wert($event)) })">
								@for (m of modi; track m.wert) {
									<option [value]="m.wert" [selected]="m.wert === t.modus">{{ m.text }}</option>
								}
							</select>
						</label>
						<label class="haken">
							<input type="checkbox" checked />
							Mitglieder benachrichtigen <span class="gedaempft klein">(im Entwurf nur Anzeige)</span>
						</label>
					</jf-karte>

					<jf-karte class="block">
						<h2>Module</h2>
						<ol class="module">
							@for (m of t.module; track m.id; let i = $index; let letzte = $last) {
								<li [class.gewaehlt]="gewaehlt() === m.id">
									<button type="button" class="waehlen" (click)="gewaehlt.set(m.id)">
										<strong>{{ typText(m.typ) }}</strong>
										<span class="gedaempft klein">{{ kurz(m) }}</span>
									</button>
									<button
										type="button"
										class="knopf leise nur-icon"
										aria-label="Nach oben"
										[disabled]="i === 0"
										(click)="schieben(i, -1)"
									>
										<jf-icon name="hoch" />
									</button>
									<button
										type="button"
										class="knopf leise nur-icon"
										aria-label="Nach unten"
										[disabled]="letzte"
										(click)="schieben(i, 1)"
									>
										<jf-icon name="runter" />
									</button>
									<button type="button" class="knopf leise nur-icon" aria-label="Entfernen" (click)="entfernen(m.id)">
										<jf-icon name="schliessen" />
									</button>
								</li>
							} @empty {
								<li class="gedaempft">Noch keine Module.</li>
							}
						</ol>
						<div class="hinzufuegen" role="group" aria-label="Modul hinzufügen">
							<span class="gedaempft klein">Modul hinzufügen:</span>
							@for (x of typen; track x.typ) {
								<button type="button" class="knopf klein" (click)="hinzufuegen(x.typ)">{{ x.text }}</button>
							}
						</div>
					</jf-karte>

					@if (aktuell(); as m) {
						<jf-karte class="block">
							<h2>{{ typText(m.typ) }}</h2>
							@switch (m.typ) {
								@case ('info') {
									<label class="feld">
										Überschrift (optional)
										<input [value]="m.titel ?? ''" (input)="modulSetzen({ titel: wert($event) || undefined })" />
									</label>
									<label class="feld">
										Text
										<textarea rows="6" [value]="m.text" (input)="modulSetzen({ text: wert($event) })"></textarea>
									</label>
								}
								@case ('termin') {
									<label class="feld">
										Bezeichnung (optional)
										<input [value]="m.titel ?? ''" (input)="modulSetzen({ titel: wert($event) || undefined })" />
									</label>
									<div class="reihe">
										<label class="feld">
											Startdatum
											<input type="date" [value]="m.von" (change)="datumSetzen(wert($event))" />
										</label>
										<label class="feld">
											Enddatum (optional)
											<input
												type="date"
												[value]="m.bis ?? ''"
												(change)="modulSetzen({ bis: wert($event) || undefined })"
											/>
										</label>
									</div>
									<div class="reihe">
										<label class="feld">
											Beginn (optional)
											<input
												type="time"
												[value]="m.beginnZeit ?? ''"
												(change)="modulSetzen({ beginnZeit: wert($event) || undefined })"
											/>
										</label>
										<label class="feld">
											Ende (optional)
											<input
												type="time"
												[value]="m.endeZeit ?? ''"
												(change)="modulSetzen({ endeZeit: wert($event) || undefined })"
											/>
										</label>
									</div>
									@if (terminFehler(m); as fehler) {
										<p class="hinweis klein">{{ fehler }}</p>
									}
									<label class="feld">
										Ort
										<input [value]="m.ort" (input)="modulSetzen({ ort: wert($event) })" />
									</label>
									<label class="feld">
										Treffpunkt (optional)
										<input
											[value]="m.treffpunkt ?? ''"
											(input)="modulSetzen({ treffpunkt: wert($event) || undefined })"
										/>
									</label>
								}
								@case ('umfrage') {
									<label class="feld">
										Frage
										<input [value]="m.frage" (input)="modulSetzen({ frage: wert($event) })" />
									</label>
									<label class="feld">
										Antworten
										<select [value]="vorlage(m)" (change)="vorlageSetzen($event)">
											<option value="jn">Ja / Nein</option>
											<option value="jnv">Ja / Nein / Vielleicht</option>
											<option value="eigene">Eigene Antworten</option>
										</select>
									</label>
									@if (vorlage(m) === 'eigene') {
										<label class="feld">
											Eigene Antworten (eine pro Zeile)
											<textarea rows="4" [value]="eigeneText(m)" (change)="eigeneSetzen($event)"></textarea>
										</label>
									}
									<div class="reihe">
										<label class="feld">
											Wer antwortet
											<select [value]="m.einheit" (change)="modulSetzen({ einheit: $any(wert($event)) })">
												<option value="jungfischer">Pro Jungfischer</option>
												<option value="erwachsener">Pro Erwachsenem</option>
												<option value="person">Jede Person</option>
											</select>
										</label>
										<label class="feld">
											Ergebnisse sehen
											<select [value]="m.ergebnisse" (change)="modulSetzen({ ergebnisse: $any(wert($event)) })">
												<option value="alle">Alle, mit Namen</option>
												<option value="summe">Alle, nur Summen</option>
												<option value="jugendleiter">Nur Jugendleiter</option>
											</select>
										</label>
									</div>
									<label class="feld">
										Frist (optional)
										<input
											type="datetime-local"
											[value]="m.frist ?? ''"
											(change)="modulSetzen({ frist: wert($event) || undefined })"
										/>
									</label>
									<label class="haken">
										<input type="checkbox" [checked]="m.mehrfach" (change)="modulSetzen({ mehrfach: haken($event) })" />
										Mehrfachauswahl
									</label>
									<label class="haken">
										<input
											type="checkbox"
											[checked]="m.teilnahme"
											[disabled]="vorlage(m) === 'eigene'"
											(change)="modulSetzen({ teilnahme: haken($event) })"
										/>
										Ist Teilnahme-Umfrage (steuert Fahrgemeinschaft und Kosten)
									</label>
									@if (vorlage(m) === 'eigene') {
										<p class="gedaempft klein">
											Teilnahme geht nur mit Ja / Nein: daran erkennen Fahrgemeinschaft und Kosten, wer mitkommt.
										</p>
									}
								}
								@case ('helfer') {
									<label class="feld">
										Überschrift
										<input [value]="m.titel" (input)="modulSetzen({ titel: wert($event) })" />
									</label>
									<p class="gedaempft klein">Plätze und Anzahl lassen sich im Entwurf nicht ändern.</p>
								}
								@case ('kosten') {
									<label class="feld">
										Überschrift
										<input [value]="m.titel" (input)="modulSetzen({ titel: wert($event) })" />
									</label>
									<label class="feld">
										Betrag in Euro
										<input
											type="number"
											min="0"
											step="0.5"
											[value]="m.betragCent / 100"
											(change)="betragSetzen($event)"
										/>
									</label>
									<p class="gedaempft klein">Pro Kind: {{ preis(m.betragCent) }}</p>
								}
								@case ('fahrt') {
									<p class="gedaempft">Autos bieten die Eltern selbst im Thread an.</p>
								}
								@default {
									<p class="gedaempft">Hochladen ist im Entwurf nicht möglich; das Modul zeigt ein Beispiel.</p>
								}
							}
						</jf-karte>
					}

					<div class="aktionen">
						<button type="button" class="knopf" (click)="speichern(false)">
							{{ t.veroeffentlicht ? 'Speichern' : 'Entwurf speichern' }}
						</button>
						<button type="button" class="knopf primaer" (click)="speichern(true)">Veröffentlichen</button>
					</div>
				</div>

				<div class="vorschau-spalte">
					<span class="gedaempft klein">Vorschau am Handy</span>
					<div class="vorschau" aria-label="Vorschau">
						<div class="vorschau-kopf">
							<strong>{{ t.titel || 'Ohne Titel' }}</strong>
							<span class="gedaempft klein">{{ zielgruppe() }}</span>
						</div>
						@for (m of t.module; track m.id) {
							<jf-karte [class.gewaehlt]="gewaehlt() === m.id" (click)="gewaehlt.set(m.id)">
								<jf-modul [thread]="t" [modul]="m" [vorschau]="true" />
							</jf-karte>
						}
					</div>
				</div>
			</div>
		} @else {
			<jf-nicht-gefunden />
		}
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			.spalten {
				display: grid;
				grid-template-columns: minmax(0, 1fr) 320px;
				gap: var(--a5);
				align-items: start;
			}
			.formular {
				display: grid;
				gap: var(--a4);
				min-width: 0;
			}
			.block {
				display: grid;
				gap: var(--a3);
			}
			.feld input,
			.feld select,
			.feld textarea {
				font-family: inherit;
			}
			.hinweis {
				margin: 0;
				color: var(--warnung);
				font-weight: 600;
			}
			fieldset {
				display: grid;
				gap: var(--a2);
				margin: 0;
				padding: var(--a3);
				border: 1px solid var(--linie);
				border-radius: var(--radius-klein);
			}
			legend {
				font-weight: 600;
				font-size: var(--schrift-klein);
				color: var(--text-gedaempft);
			}
			.haken {
				display: flex;
				align-items: center;
				gap: var(--a2);
				min-height: var(--tippflaeche);
			}
			.haken input {
				width: 20px;
				height: 20px;
				accent-color: var(--akzent);
			}
			.reihe {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
				gap: var(--a3);
			}
			p {
				margin: 0;
			}
			.module {
				display: grid;
				gap: var(--a2);
				margin: 0;
				padding: 0;
				list-style: none;
			}
			.module li {
				display: flex;
				align-items: center;
				gap: var(--a1);
				padding: var(--a1);
				border: 1px solid var(--linie);
				border-radius: var(--radius-klein);
			}
			.module li.gewaehlt {
				border-color: var(--akzent);
				box-shadow: 0 0 0 1px var(--akzent);
			}
			.waehlen {
				display: grid;
				flex: 1;
				min-width: 0;
				min-height: var(--tippflaeche);
				padding: 0 var(--a2);
				border: 0;
				background: none;
				color: var(--text);
				font: inherit;
				text-align: left;
				cursor: pointer;
			}
			.waehlen span {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.hinzufuegen {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: var(--a2);
			}
			.vorschau-spalte {
				position: sticky;
				top: calc(var(--band-hoehe) + var(--a4));
				display: grid;
				gap: var(--a2);
			}
			.vorschau {
				display: grid;
				gap: var(--a3);
				align-content: start;
				width: 300px;
				height: min(640px, calc(100dvh - var(--band-hoehe) - 96px));
				overflow-y: auto;
				padding: var(--a4) var(--a3);
				border: 8px solid var(--text);
				border-radius: 32px;
				background: var(--seite);
			}
			.vorschau-kopf {
				display: grid;
			}
			.vorschau jf-karte {
				cursor: pointer;
				font-size: 0.9375rem;
			}
			.vorschau jf-karte.gewaehlt {
				box-shadow: 0 0 0 3px var(--akzent);
			}
			a.knopf {
				text-decoration: none;
			}
			@media (max-width: 1023px) {
				.spalten {
					grid-template-columns: minmax(0, 1fr);
				}
				.vorschau-spalte {
					position: static;
				}
				.vorschau {
					width: min(300px, 100%);
					height: auto;
					max-height: 640px;
				}
			}
		`,
	],
})
export class ThreadEditor {
	/** Aus der Route threads/:nr; fehlt sie, entsteht ein neuer Thread. */
	readonly nr = input<string | undefined>(undefined);

	private readonly store = inject(EntwurfStore);
	private readonly router = inject(Router);
	private readonly meldung = inject(MeldungService);

	protected readonly typen = TYPEN;
	protected readonly modi = (Object.keys(MODUS_TEXT) as Modus[]).map((wert) => ({ wert, text: MODUS_TEXT[wert] }));
	protected readonly untergruppen = computed(() => this.store.stand().untergruppen);

	/** Arbeitskopie; erst Speichern schreibt in den Store. */
	protected readonly entwurf = linkedSignal<Thread | undefined>(() => {
		const nr = this.nr();
		if (nr === undefined) return leererThread(this.store.ich());
		return this.store.stand().threads.find((t) => t.nr === Number(nr));
	});
	protected readonly gewaehlt = signal<Id | null>(null);
	protected readonly aktuell = computed(() => this.entwurf()?.module.find((m) => m.id === this.gewaehlt()));
	protected readonly zielgruppe = computed(() => {
		const t = this.entwurf();
		return t ? zielgruppeText(this.store.stand(), t.zielgruppe) : '';
	});

	protected wert(e: Event): string {
		return (e.target as HTMLInputElement).value;
	}

	protected haken(e: Event): boolean {
		return (e.target as HTMLInputElement).checked;
	}

	protected typText(typ: Typ): string {
		return TYPEN.find((x) => x.typ === typ)!.text;
	}

	protected preis(cent: number): string {
		return betrag(cent);
	}

	protected kurz(m: Modul): string {
		switch (m.typ) {
			case 'info':
				return m.titel ?? (m.text.slice(0, 40) || 'leer');
			case 'termin':
				return `${terminZeit(m)} · ${m.ort}`;
			case 'umfrage':
				return m.frage;
			case 'helfer':
			case 'kosten':
				return m.titel;
			default:
				return '';
		}
	}

	protected readonly ohneZielgruppe = ohneZielgruppe;
	protected readonly terminFehler = terminFehler;

	protected setze(teil: Partial<Thread>): void {
		this.entwurf.update((t) => (t ? { ...t, ...teil } : t));
	}

	protected alleSetzen(e: Event): void {
		const z = this.entwurf()!.zielgruppe;
		this.setze({ zielgruppe: { ...z, untergruppen: this.haken(e) ? 'alle' : [] } });
	}

	protected untergruppeSetzen(uid: Id, e: Event): void {
		const z = this.entwurf()!.zielgruppe;
		const bisher = z.untergruppen === 'alle' ? [] : z.untergruppen;
		// Leer bleibt leer: der Thread ginge sonst still an alle. speichern() verlangt eine Wahl.
		const neu = this.haken(e) ? [...bisher, uid] : bisher.filter((x) => x !== uid);
		this.setze({ zielgruppe: { ...z, untergruppen: neu } });
	}

	protected rollenSetzen(e: Event): void {
		const z = this.entwurf()!.zielgruppe;
		this.setze({ zielgruppe: { ...z, rollen: this.wert(e) as Rollenfilter } });
	}

	protected hinzufuegen(typ: Typ): void {
		const m = neuesModul(typ, this.store.ich(), this.store.jetzt());
		this.setze({ module: [...this.entwurf()!.module, m] });
		this.gewaehlt.set(m.id);
	}

	protected schieben(i: number, schritt: -1 | 1): void {
		const module = [...this.entwurf()!.module];
		[module[i], module[i + schritt]] = [module[i + schritt], module[i]];
		this.setze({ module });
	}

	protected entfernen(mid: Id): void {
		this.setze({ module: this.entwurf()!.module.filter((m) => m.id !== mid) });
		if (this.gewaehlt() === mid) this.gewaehlt.set(null);
	}

	protected modulSetzen(teil: Record<string, unknown>): void {
		const gid = this.gewaehlt();
		this.setze({
			module: this.entwurf()!.module.map((m) => (m.id === gid ? ({ ...m, ...teil } as Modul) : m)),
		});
	}

	protected datumSetzen(tag: string): void {
		const m = this.aktuell();
		if (m?.typ !== 'termin' || !tag) return;
		this.modulSetzen({ von: tag });
	}

	protected vorlage(m: UmfrageModul): 'jn' | 'jnv' | 'eigene' {
		const ids = m.optionen.map((o) => o.id).join(',');
		return ids === 'ja,nein' ? 'jn' : ids === 'ja,nein,vielleicht' ? 'jnv' : 'eigene';
	}

	protected vorlageSetzen(e: Event): void {
		const v = this.wert(e) as 'jn' | 'jnv' | 'eigene';
		const optionen =
			v === 'eigene'
				? [
						{ id: 'o1', text: 'Antwort 1' },
						{ id: 'o2', text: 'Antwort 2' },
					]
				: OPTIONEN_VORLAGEN[v];
		this.modulSetzen({ optionen, teilnahme: v === 'eigene' ? false : (this.aktuell() as UmfrageModul).teilnahme });
	}

	protected eigeneText(m: UmfrageModul): string {
		return m.optionen.map((o) => o.text).join('\n');
	}

	protected eigeneSetzen(e: Event): void {
		const texte = this.wert(e)
			.split('\n')
			.map((x) => x.trim())
			.filter(Boolean);
		// Unveraenderte Texte behalten ihre Kennung, sonst wanderten abgegebene
		// Antworten beim Umsortieren auf eine andere Option.
		const bisher = [...(this.aktuell() as UmfrageModul).optionen];
		let nr = Math.max(0, ...bisher.map((o) => Number(o.id.slice(1)) || 0));
		const optionen = texte.map((text) => {
			const i = bisher.findIndex((o) => o.text === text);
			return i >= 0 ? bisher.splice(i, 1)[0] : { id: `o${++nr}`, text };
		});
		this.modulSetzen({ optionen });
	}

	protected betragSetzen(e: Event): void {
		const euro = Number(this.wert(e));
		if (Number.isFinite(euro) && euro >= 0) this.modulSetzen({ betragCent: Math.round(euro * 100) });
	}

	protected speichern(veroeffentlichen: boolean): void {
		const t = this.entwurf()!;
		if (!t.titel.trim()) {
			this.meldung.zeige('Bitte einen Titel eingeben');
			return;
		}
		if (ohneZielgruppe(t)) {
			this.meldung.zeige('Bitte „Alle" oder eine Untergruppe wählen');
			return;
		}
		// Ein falscher Termin landete sonst so in Kalendern und "Als Naechstes".
		const fehler = t.module.map((m) => (m.typ === 'termin' ? terminFehler(m) : null)).find(Boolean);
		if (fehler) {
			this.meldung.zeige(fehler);
			return;
		}
		this.store.threadSpeichern({ ...t, titel: t.titel.trim(), veroeffentlicht: veroeffentlichen || t.veroeffentlicht });
		this.meldung.zeige(veroeffentlichen ? 'Veröffentlicht' : 'Entwurf gespeichert');
		void this.router.navigateByUrl(`/${this.store.stand().verein.slug}/verwaltung/threads`);
	}
}
