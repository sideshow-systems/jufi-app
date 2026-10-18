import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	ElementRef,
	inject,
	input,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { type Beziehung, beziehungVorbelegung } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { EinladungAnzeigeComponent } from '../../admin/einladung-anzeige';
import { alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { datumDeutsch, zeitpunktBerlin } from '../../gestaltung/format';
import { KarteComponent, PilleComponent } from '../../gestaltung/ui';
import { MitgliedSitzung } from '../mitglied-waechter';
import {
	type EinladungsLink,
	type FamilienEintrag,
	MitgliederApi,
	type PersonDetail,
	type PersonListe,
	type Untergruppe,
} from '../mitglieder-api';
import { VereinKopfComponent } from '../verein-kopf';
import { BEZIEHUNG_TEXT, BEZIEHUNGEN, beziehungText, tagBerlin, verwaltungsfehler, warnhinweisText } from './texte';

type Bereich = 'stamm' | 'gruppen' | 'familie' | 'zugang' | 'entfernen' | 'volljaehrig';

/** Eine offene Rueckfrage; immer nur eine, der Dialog steht oben auf der Seite. */
type Frage =
	| { art: 'entfernen' }
	| { art: 'zugang-entziehen' }
	| { art: 'loesen'; eintrag: FamilienEintrag }
	| { art: 'familie-loesen' };

interface Entfernt {
	name: string;
	angebot: { id: string; vorname: string; nachname: string }[];
	fehler: string | null;
}

/**
 * Eine Person der Verwaltung: Stammdaten, Untergruppen, Familie, Zugang, Entfernen.
 *
 * Die Rechte aus GET /ich blenden nur ein und aus; der Server entscheidet jede Aktion neu
 * und antwortet bei Unbefugten mit 404. Betreuer (Einsicht LESEN) sehen die Person
 * schreibgeschuetzt und ohne Zugangs- und Einladungsstand: Den liefert ihnen der Server nicht.
 *
 * Nach jeder Aktion wird die Person neu geholt statt lokal nachgefuehrt: Ob etwa der Zugang
 * nach dem Loesen einer Zuordnung noch gilt, weiss nur der Server.
 */
@Component({
	selector: 'jf-personenseite',
	imports: [EinladungAnzeigeComponent, KarteComponent, PilleComponent, RouterLink, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-verein-kopf [slug]="slug()" untertitel="Person" />
			<a class="zurueck" [routerLink]="['/', slug(), 'verwaltung']">← Zur Mitgliederliste</a>
			@if (ladefehler(); as text) {
				<jf-karte>
					<p class="fehler" role="alert">{{ text }}</p>
					<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
				</jf-karte>
			} @else if (entfernt(); as e) {
				<jf-karte>
					<h2>{{ e.name }} wurde entfernt</h2>
					@for (a of e.angebot; track a.id) {
						<div class="angebot" [attr.data-angebot]="a.id">
							<p>{{ a.vorname }} {{ a.nachname }} hat keine Jungfischer mehr in der Gruppe – auch entfernen?</p>
							<div class="reihe">
								<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="entferneAngebot(a.id)">
									Auch entfernen
								</button>
								<button type="button" class="knopf" [disabled]="laeuft()" (click)="behalteAngebot(a.id)">
									Behalten
								</button>
							</div>
						</div>
					}
					@if (e.fehler; as text) {
						<p class="fehler" role="alert">{{ text }}</p>
					}
					<a class="knopf" [routerLink]="['/', slug(), 'verwaltung']">Zur Mitgliederliste</a>
				</jf-karte>
			} @else if (person(); as p) {
				<div class="stapel">
					@if (frage(); as f) {
						<jf-karte>
							<div
								#dialog
								tabindex="-1"
								class="frage"
								role="alertdialog"
								aria-label="Rückfrage"
								aria-describedby="frage-text"
							>
								<p id="frage-text">{{ frageText(f, p) }}</p>
								<div class="reihe">
									<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="bestaetige(f, p)">
										{{ frageKnopf(f) }}
									</button>
									<button type="button" class="knopf" [disabled]="laeuft()" (click)="frage.set(null)">Abbrechen</button>
								</div>
							</div>
						</jf-karte>
					}

					<jf-karte>
						<h2>{{ p.vorname }} {{ p.nachname }}</h2>
						<p class="gedaempft">{{ p.art === 'JUNGFISCHER' ? 'Jungfischer' : 'Erwachsene' }}</p>
						@if ((p.warnhinweise ?? []).length > 0) {
							<ul class="pillen" aria-label="Warnhinweise">
								@for (h of p.warnhinweise ?? []; track $index) {
									<li>
										<jf-pille art="offen">{{ hinweis(h) }}</jf-pille>
									</li>
								}
							</ul>
						}
						@if (!darfAendern()) {
							<dl>
								@if (p.geburtsdatum) {
									<dt>Geburtsdatum</dt>
									<dd>{{ datum(p.geburtsdatum) }}</dd>
								}
								@if (p.art === 'JUNGFISCHER' && p.jugendsprecher) {
									<dt>Rolle</dt>
									<dd>Jugendsprecher</dd>
								}
								@if (p.untergruppen) {
									<dt>Untergruppen</dt>
									<dd>{{ gruppenText(p) }}</dd>
								}
								@if (p.email) {
									<dt>E-Mail</dt>
									<dd>{{ p.email }}</dd>
								}
							</dl>
						}
					</jf-karte>

					@if (volljaehrigHinweis(); as seit) {
						@if (darfAendern()) {
							<jf-karte>
								<div role="group" aria-label="Volljährigkeit" data-volljaehrig>
									<h2>Volljährig</h2>
									<p>
										{{ p.vorname }} ist seit dem {{ datum(seit) }} volljährig. Die Familie entscheidet nicht mehr über
										den Zugang. Wie soll es weitergehen?
									</p>
									<div class="reihe">
										<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="belasse()">
											Belassen
										</button>
										@if ((p.familie ?? []).length > 0) {
											<button
												type="button"
												class="knopf"
												[disabled]="laeuft()"
												(click)="frage.set({ art: 'familie-loesen' })"
											>
												Familie lösen
											</button>
										}
										@if (darfEntfernen()) {
											<button
												type="button"
												class="knopf"
												[disabled]="laeuft()"
												(click)="frage.set({ art: 'entfernen' })"
											>
												Aus der Gruppe entfernen
											</button>
										}
									</div>
									@if (fehler().volljaehrig; as text) {
										<p class="fehler" role="alert">{{ text }}</p>
									}
								</div>
							</jf-karte>
						}
					}

					@if (darfAendern()) {
						<jf-karte>
							<form (submit)="speichereStamm($event)" novalidate>
								<h2>Stammdaten</h2>
								<div class="felder">
									<label class="feld">
										Vorname
										<input
											name="vorname"
											autocomplete="off"
											[value]="vorname()"
											[attr.aria-invalid]="markiert('vorname')"
											(input)="vorname.set(wert($event))"
										/>
									</label>
									<label class="feld">
										Nachname
										<input
											name="nachname"
											autocomplete="off"
											[value]="nachname()"
											[attr.aria-invalid]="markiert('nachname')"
											(input)="nachname.set(wert($event))"
										/>
									</label>
									@if (p.art === 'JUNGFISCHER') {
										<label class="feld">
											Geburtsdatum
											<input
												type="date"
												name="geburtsdatum"
												[value]="geburtsdatum()"
												[attr.aria-invalid]="markiert('geburtsdatum')"
												(input)="geburtsdatum.set(wert($event))"
											/>
										</label>
									}
									<label class="feld">
										E-Mail
										<input
											type="email"
											name="email"
											autocomplete="off"
											[value]="email()"
											[disabled]="mailFest()"
											[attr.aria-invalid]="markiert('email')"
											[attr.aria-describedby]="mailFest() ? 'mail-fest' : null"
											(input)="email.set(wert($event))"
										/>
										@if (mailFest()) {
											<span class="hinweis" id="mail-fest"
												>Die Adresse ist die Kennung der Anmeldung und lässt sich nicht mehr ändern.</span
											>
										}
									</label>
									@if (p.art === 'JUNGFISCHER') {
										<label class="haken">
											<input
												type="checkbox"
												name="jugendsprecher"
												[checked]="jugendsprecher()"
												(change)="jugendsprecher.set(angehakt($event))"
											/>
											Jugendsprecher
										</label>
									}
								</div>
								<div class="reihe">
									<button type="submit" class="knopf primaer" [disabled]="laeuft()">Speichern</button>
								</div>
								@if (fehler().stamm; as text) {
									<p class="fehler" role="alert">{{ text }}</p>
								}
								@if (gespeichert() === 'stamm') {
									<p class="erfolg" role="status">Gespeichert</p>
								}
							</form>
						</jf-karte>

						@if (p.art === 'JUNGFISCHER') {
							<jf-karte>
								<form (submit)="speichereGruppen($event)">
									<fieldset>
										<legend><h2>Untergruppen</h2></legend>
										@for (u of untergruppenAlle(); track u.id) {
											<label class="haken">
												<input
													type="checkbox"
													[name]="'untergruppe-' + u.id"
													[checked]="gewaehlteGruppen().includes(u.id)"
													(change)="schalteGruppe(u.id)"
												/>
												{{ u.name }}
											</label>
										} @empty {
											<p class="gedaempft">Es gibt noch keine Untergruppen.</p>
										}
									</fieldset>
									@if (untergruppenAlle().length > 0) {
										<div class="reihe">
											<button type="submit" class="knopf primaer" [disabled]="laeuft()">Untergruppen speichern</button>
										</div>
									}
									@if (fehler().gruppen; as text) {
										<p class="fehler" role="alert">{{ text }}</p>
									}
									@if (gespeichert() === 'gruppen') {
										<p class="erfolg" role="status">Gespeichert</p>
									}
								</form>
							</jf-karte>
						}
					}

					@if (p.familie) {
						<jf-karte>
							<h2>{{ p.art === 'JUNGFISCHER' ? 'Familie' : 'Kinder' }}</h2>
							<ul class="liste">
								@for (f of p.familie; track f.erwachsenerId + f.jungfischerId) {
									<li [attr.data-familie]="gegenueberId(p, f)">
										<span>
											<a [routerLink]="['/', slug(), 'verwaltung', 'personen', gegenueberId(p, f)]"
												>{{ f.vorname }} {{ f.nachname }}</a
											>
											· {{ beziehung(f) }} ·
											{{ f.erziehungsberechtigt ? 'erziehungsberechtigt' : 'nicht erziehungsberechtigt' }}
										</span>
										@if (darfAendern()) {
											<span class="reihe">
												@if (p.art === 'JUNGFISCHER') {
													<button
														type="button"
														class="knopf klein"
														[disabled]="laeuft()"
														(click)="schalteBerechtigung(f)"
													>
														{{
															f.erziehungsberechtigt
																? 'Nicht mehr erziehungsberechtigt'
																: 'Als erziehungsberechtigt eintragen'
														}}
													</button>
												}
												<button
													type="button"
													class="knopf klein"
													[disabled]="laeuft()"
													(click)="frage.set({ art: 'loesen', eintrag: f })"
												>
													Zuordnung lösen
												</button>
											</span>
										}
									</li>
								} @empty {
									<li class="gedaempft">
										{{ p.art === 'JUNGFISCHER' ? 'Noch niemand zugeordnet.' : 'Keine Jungfischer zugeordnet.' }}
									</li>
								}
							</ul>
							@if (fehler().familie; as text) {
								<p class="fehler" role="alert">{{ text }}</p>
							}
						</jf-karte>

						@if (darfAendern() && p.art === 'JUNGFISCHER') {
							<jf-karte>
								<form (submit)="fuegeFamilieHinzu($event)" novalidate>
									<h2>Familie hinzufügen</h2>
									<div class="felder">
										<fieldset>
											<legend>Wer?</legend>
											<label class="haken">
												<input
													type="radio"
													name="modus"
													value="vorhanden"
													[checked]="modus() === 'vorhanden'"
													(change)="modus.set('vorhanden')"
												/>
												Vorhandene Person
											</label>
											<label class="haken">
												<input
													type="radio"
													name="modus"
													value="neu"
													[checked]="modus() === 'neu'"
													(change)="modus.set('neu')"
												/>
												Neue Person anlegen
											</label>
										</fieldset>
										@if (modus() === 'vorhanden') {
											<label class="feld">
												Erwachsene
												<select name="erwachsener" [value]="erwachsenerId()" (change)="erwachsenerId.set(wert($event))">
													<option value="">Bitte wählen</option>
													@for (e of kandidaten(); track e.id) {
														<option [value]="e.id" [selected]="e.id === erwachsenerId()">
															{{ e.vorname }} {{ e.nachname }}
														</option>
													}
												</select>
											</label>
										} @else {
											<label class="feld">
												Vorname
												<input
													name="neuVorname"
													autocomplete="off"
													[value]="neuVorname()"
													(input)="neuVorname.set(wert($event))"
												/>
											</label>
											<label class="feld">
												Nachname
												<input
													name="neuNachname"
													autocomplete="off"
													[value]="neuNachname()"
													(input)="neuNachname.set(wert($event))"
												/>
											</label>
											<label class="feld">
												E-Mail (freiwillig)
												<input
													type="email"
													name="neuEmail"
													autocomplete="off"
													[value]="neuEmail()"
													(input)="neuEmail.set(wert($event))"
												/>
											</label>
										}
										<label class="feld">
											Beziehung
											<select name="beziehung" [value]="beziehungNeu()" (change)="waehleBeziehung(wert($event))">
												<option value="">Bitte wählen</option>
												@for (b of beziehungen; track b) {
													<option [value]="b">{{ beziehungsName[b] }}</option>
												}
											</select>
										</label>
										@if (beziehungNeu() === 'ANDERE') {
											<label class="feld">
												Welche Beziehung?
												<input
													name="freitext"
													autocomplete="off"
													maxlength="100"
													[value]="freitext()"
													(input)="freitext.set(wert($event))"
												/>
											</label>
										}
										<label class="haken">
											<input
												type="checkbox"
												name="erziehungsberechtigt"
												[checked]="erziehungsberechtigt()"
												(change)="erziehungsberechtigt.set(angehakt($event))"
											/>
											Erziehungsberechtigt
										</label>
									</div>
									<div class="reihe">
										<button type="submit" class="knopf primaer" [disabled]="laeuft()">Zur Familie hinzufügen</button>
									</div>
								</form>
							</jf-karte>
						}
					}

					@if (darfAendern() && p.einladung !== undefined) {
						<jf-karte>
							<h2>Zugang</h2>
							<dl>
								@if (p.art === 'JUNGFISCHER') {
									<dt>Zugang erlaubt</dt>
									<dd>{{ p.zugang?.erlaubt ? 'Ja' : 'Nein' }}</dd>
								}
								<dt>Anmeldung</dt>
								<dd>{{ zugangStand(p) }}</dd>
								<dt>Einladung</dt>
								<dd>{{ einladungStand(p) }}</dd>
							</dl>
							<div class="reihe">
								<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="erzeugeLink(false)">
									{{ p.zugang?.vorhanden ? 'Neuen Zugangslink erzeugen' : 'Einladung erzeugen' }}
								</button>
								@if (p.email) {
									<button type="button" class="knopf" [disabled]="laeuft()" (click)="erzeugeLink(true)">
										Per Mail senden
									</button>
								}
								@if (p.art === 'JUNGFISCHER') {
									@if (p.zugang?.erlaubt) {
										<button
											type="button"
											class="knopf"
											[disabled]="laeuft()"
											(click)="frage.set({ art: 'zugang-entziehen' })"
										>
											Zugang entziehen
										</button>
									} @else {
										<button type="button" class="knopf" [disabled]="laeuft()" (click)="setzeZugang(true)">
											Zugang erlauben
										</button>
									}
								}
							</div>
							@if (fehler().zugang; as text) {
								<p class="fehler" role="alert">{{ text }}</p>
							}
							@if (link(); as l) {
								<p class="gedaempft klein">
									Schick {{ p.vorname }} diesen Text, zum Beispiel per WhatsApp. Er ist nur jetzt zu sehen.
								</p>
								<jf-einladung-anzeige [einladung]="l" />
							}
						</jf-karte>
					}

					@if (rechteLink()) {
						<jf-karte>
							<h2>Rechte</h2>
							<p class="gedaempft">Welche Rechte {{ p.vorname }} im Verein hat, ändert sich auf der Seite Rechte.</p>
							<a class="knopf" [routerLink]="['/', slug(), 'verwaltung', 'rechte']">Zu den Rechten</a>
						</jf-karte>
					}

					@if (darfEntfernen()) {
						<jf-karte>
							<h2>Entfernen</h2>
							<p class="gedaempft">Die Person verschwindet aus allen Listen, ihr Zugang endet.</p>
							<button type="button" class="knopf" [disabled]="laeuft()" (click)="frage.set({ art: 'entfernen' })">
								Aus der Gruppe entfernen
							</button>
							@if (fehler().entfernen; as text) {
								<p class="fehler" role="alert">{{ text }}</p>
							}
						</jf-karte>
					}
				</div>
			}
		</main>
	`,
	styles: `
		:host {
			display: block;
		}
		main {
			max-width: 36rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		.zurueck {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			margin: 0 0 var(--a2);
		}
		.stapel {
			display: grid;
			gap: var(--a4);
		}
		h2 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-gross);
		}
		legend h2 {
			margin: 0 0 var(--a2);
		}
		p {
			margin: 0 0 var(--a3);
			overflow-wrap: anywhere;
		}
		dl {
			display: grid;
			margin: 0 0 var(--a3);
		}
		dt {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		dd {
			margin: 0 0 var(--a3);
			overflow-wrap: anywhere;
		}
		ul {
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.pillen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
			margin: 0 0 var(--a3);
		}
		.liste {
			display: grid;
			gap: var(--a3);
			margin: 0 0 var(--a3);
		}
		.liste li {
			display: grid;
			gap: var(--a2);
			overflow-wrap: anywhere;
		}
		form {
			display: grid;
			gap: var(--a3);
		}
		.felder {
			display: grid;
			gap: var(--a3);
		}
		fieldset {
			margin: 0;
			padding: 0;
			border: 0;
		}
		legend {
			padding: 0;
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		legend h2 {
			color: var(--text);
			font-size: var(--schrift-gross);
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		.hinweis {
			font-weight: 400;
		}
		.fehler {
			margin: var(--a3) 0 0;
			color: var(--fehler);
		}
		.erfolg {
			margin: 0;
			color: var(--erfolg);
			font-weight: 600;
		}
		.angebot {
			margin-bottom: var(--a4);
		}
		jf-einladung-anzeige {
			margin-top: var(--a3);
		}
	`,
})
export class PersonenseiteComponent {
	/** Kommen aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();
	readonly id = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly sitzung = inject(MitgliedSitzung);
	private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

	protected readonly person = signal<PersonDetail | null>(null);
	protected readonly ladefehler = signal<string | null>(null);
	protected readonly untergruppenAlle = signal<Untergruppe[]>([]);
	protected readonly erwachsene = signal<PersonListe[]>([]);
	/** Eine Handlung zur Zeit: Zwei schnelle Klicks schickten sonst zwei Anfragen, deren Antworten sich ueberholen koennten. */
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<Partial<Record<Bereich, string>>>({});
	protected readonly gespeichert = signal<Bereich | null>(null);
	/** Das Feld, auf das sich der letzte Serverfehler bezieht (feld in der Antwort). */
	protected readonly fehlerFeld = signal<string | null>(null);
	protected readonly frage = signal<Frage | null>(null);
	protected readonly link = signal<EinladungsLink | null>(null);
	protected readonly entfernt = signal<Entfernt | null>(null);

	protected readonly vorname = signal('');
	protected readonly nachname = signal('');
	protected readonly geburtsdatum = signal('');
	protected readonly email = signal('');
	protected readonly jugendsprecher = signal(false);
	protected readonly gewaehlteGruppen = signal<string[]>([]);

	protected readonly modus = signal<'vorhanden' | 'neu'>('vorhanden');
	protected readonly erwachsenerId = signal('');
	protected readonly neuVorname = signal('');
	protected readonly neuNachname = signal('');
	protected readonly neuEmail = signal('');
	protected readonly beziehungNeu = signal<Beziehung | ''>('');
	protected readonly freitext = signal('');
	protected readonly erziehungsberechtigt = signal(false);

	protected readonly wert = wertVon;
	protected readonly hinweis = warnhinweisText;
	protected readonly beziehungen = BEZIEHUNGEN;
	protected readonly beziehungsName = BEZIEHUNG_TEXT;

	private readonly rechte = computed(() => this.sitzung.ich()?.person.rechte ?? []);
	private readonly verwalter = computed(() => this.rechte().includes('MITGLIEDER'));

	/**
	 * Wer Rechte hat, aendert nur, wer JUGENDLEITER_RECHTE hat (der Server antwortet sonst 404, damit
	 * niemand erfaehrt, wer Jugendleiter ist); die Seite zeigt es gleich als Lesesicht.
	 */
	protected readonly darfAendern = computed(() => {
		const p = this.person();
		if (!p || !this.verwalter()) return false;
		return (p.rechte?.length ?? 0) === 0 || this.rechte().includes('JUGENDLEITER_RECHTE');
	});

	/** Erwachsene mit Rechten verweisen auf die Rechteseite, die nur JUGENDLEITER_RECHTE oeffnet. */
	protected readonly rechteLink = computed(() => {
		const p = this.person();
		return (
			!!p && p.art === 'ERWACHSENER' && (p.rechte?.length ?? 0) > 0 && this.rechte().includes('JUGENDLEITER_RECHTE')
		);
	});

	/** Sich selbst entfernen weist der Server ab (SELBST); die Seite bietet es gar nicht erst an. */
	protected readonly darfEntfernen = computed(
		() => this.darfAendern() && this.person()?.id !== this.sitzung.ich()?.person.id,
	);

	protected readonly volljaehrigHinweis = computed(() => {
		const h = this.person()?.warnhinweise?.find((x) => x.art === 'VOLLJAEHRIG');
		return h?.art === 'VOLLJAEHRIG' ? h.seit : null;
	});

	protected readonly mailFest = computed(() => {
		const p = this.person();
		return p?.art === 'ERWACHSENER' && !!p.zugang?.vorhanden;
	});

	protected readonly kandidaten = computed(() => {
		const schon = new Set((this.person()?.familie ?? []).map((f) => f.erwachsenerId));
		return this.erwachsene().filter((e) => e.art === 'ERWACHSENER' && !schon.has(e.id));
	});

	constructor() {
		// Ein Wechsel der Kennung (Link zu einer anderen Person) behaelt dieselbe Seite: neu laden statt altes zeigen.
		effect(() => {
			this.id();
			this.slug();
			untracked(() => {
				this.person.set(null);
				this.entfernt.set(null);
				this.link.set(null);
				this.frage.set(null);
				this.fehler.set({});
				this.gespeichert.set(null);
				void this.lade(true);
			});
		});
		// Die Rueckfrage nimmt den Fokus mit, sonst weiss eine Tastatur- oder Vorlesenutzerin nicht, dass sie aufging.
		effect(() => this.dialog()?.nativeElement.focus());
	}

	protected async lade(mitHilfen = false): Promise<void> {
		this.ladefehler.set(null);
		try {
			const p = await firstValueFrom(this.api.person(this.slug(), this.id()));
			// Eine Antwort fuer die vorige Person (Wechsel waehrend der Anfrage) darf die neue Seite nicht ueberschreiben.
			if (p.id !== this.id()) return;
			this.person.set(p);
			this.fuelle(p);
			if (mitHilfen) void this.ladeHilfen(p);
		} catch (ursache) {
			this.ladefehler.set(fehlertext(alsApiFehler(ursache)));
		}
	}

	/** Auswahlen fuer die Verwaltung; ohne sie bleibt die Seite benutzbar, nur die Auswahl ist leer. */
	private async ladeHilfen(p: PersonDetail): Promise<void> {
		if (p.art !== 'JUNGFISCHER' || !this.darfAendern()) return;
		await Promise.all([
			firstValueFrom(this.api.untergruppen(this.slug())).then(
				(a) => this.untergruppenAlle.set(a.untergruppen),
				() => this.untergruppenAlle.set([]),
			),
			this.ladeErwachsene(),
		]);
	}

	private ladeErwachsene(): Promise<void> {
		return firstValueFrom(this.api.personen(this.slug())).then(
			(a) => this.erwachsene.set(a.personen.filter((x) => x.art === 'ERWACHSENER')),
			() => this.erwachsene.set([]),
		);
	}

	private fuelle(p: PersonDetail): void {
		this.vorname.set(p.vorname);
		this.nachname.set(p.nachname);
		this.geburtsdatum.set(p.geburtsdatum ?? '');
		this.email.set(p.email ?? '');
		this.jugendsprecher.set(p.jugendsprecher ?? false);
		this.gewaehlteGruppen.set((p.untergruppen ?? []).map((u) => u.id));
	}

	protected datum(tag: string): string {
		return datumDeutsch(tag.slice(0, 10));
	}

	protected gruppenText(p: PersonDetail): string {
		return p.untergruppen && p.untergruppen.length > 0 ? p.untergruppen.map((u) => u.name).join(', ') : 'keine';
	}

	protected beziehung(f: FamilienEintrag): string {
		return beziehungText(f.beziehung, f.beziehungFreitext);
	}

	/** Die Gegenseite der Zuordnung: beim Kind der Erwachsene, beim Erwachsenen das Kind. */
	protected gegenueberId(p: PersonDetail, f: FamilienEintrag): string {
		return p.art === 'JUNGFISCHER' ? f.erwachsenerId : f.jungfischerId;
	}

	protected markiert(feld: string): 'true' | null {
		return this.fehlerFeld() === feld && !!this.fehler().stamm ? 'true' : null;
	}

	protected angehakt(ereignis: Event): boolean {
		return (ereignis.target as HTMLInputElement).checked;
	}

	protected zugangStand(p: PersonDetail): string {
		if (!p.zugang?.vorhanden) return 'Noch nicht eingerichtet';
		const zuletzt = p.zugang.letzteAnmeldungAm;
		return zuletzt
			? `Eingerichtet, zuletzt angemeldet am ${zeitpunktBerlin(zuletzt)} Uhr`
			: 'Eingerichtet, noch nie angemeldet';
	}

	protected einladungStand(p: PersonDetail): string {
		const e = p.einladung;
		if (!e?.ablauf) return 'Keine Einladung';
		const text = e.offen ? `Offen, läuft am ${tagBerlin(e.ablauf)} ab` : `Abgelaufen am ${tagBerlin(e.ablauf)}`;
		return e.mailNichtZugestellt ? `${text}. Die Einladungsmail war nicht zustellbar.` : text;
	}

	protected frageText(f: Frage, p: PersonDetail): string {
		switch (f.art) {
			case 'entfernen':
				return `Willst du ${p.vorname} ${p.nachname} wirklich aus der Gruppe entfernen? Der Zugang endet, und die Person erscheint in keiner Liste mehr.`;
			case 'zugang-entziehen':
				return `Willst du ${p.vorname} den Zugang entziehen? Anmeldung, Passkeys und offene Einladungen werden gelöscht. Erlaubst du ihn später wieder, braucht ${p.vorname} eine neue Einladung.`;
			case 'loesen':
				return `Willst du die Zuordnung von ${f.eintrag.vorname} ${f.eintrag.nachname} lösen? Gilt dadurch keine Einwilligung mehr, endet der Zugang des Kindes.`;
			case 'familie-loesen':
				return `Willst du alle Zuordnungen von ${p.vorname} zur Familie lösen? Gilt dadurch keine Einwilligung mehr, endet der Zugang.`;
		}
	}

	protected frageKnopf(f: Frage): string {
		switch (f.art) {
			case 'entfernen':
				return 'Ja, entfernen';
			case 'zugang-entziehen':
				return 'Ja, Zugang entziehen';
			case 'loesen':
				return 'Ja, lösen';
			case 'familie-loesen':
				return 'Ja, alle lösen';
		}
	}

	protected bestaetige(f: Frage, p: PersonDetail): Promise<void> {
		switch (f.art) {
			case 'entfernen':
				return this.entferne(p);
			case 'zugang-entziehen':
				return this.setzeZugang(false);
			case 'loesen':
				return this.loese(f.eintrag);
			case 'familie-loesen':
				return this.loeseAlle(p);
		}
	}

	/**
	 * Aktion, danach Person neu. Der Fehler steht im Bereich der Aktion, nicht oben: Auf der langen
	 * Seite muss klar sein, welche Aktion gescheitert ist. Die Rueckfrage schliesst in jedem Fall.
	 */
	private async fuehreAus(bereich: Bereich, aktion: () => Promise<unknown>, neuLaden = true): Promise<boolean> {
		if (this.laeuft()) return false;
		this.laeuft.set(true);
		this.fehler.update((alt) => ({ ...alt, [bereich]: '' }));
		this.gespeichert.set(null);
		this.fehlerFeld.set(null);
		try {
			await aktion();
			this.frage.set(null);
			if (neuLaden) await this.lade();
			return true;
		} catch (ursache) {
			this.frage.set(null);
			const f = alsApiFehler(ursache);
			this.fehlerFeld.set(f.feld ?? null);
			this.fehler.update((alt) => ({ ...alt, [bereich]: verwaltungsfehler(f) }));
			return false;
		} finally {
			this.laeuft.set(false);
		}
	}

	protected async speichereStamm(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const p = this.person();
		if (!p) return;
		const vorname = this.vorname().trim();
		const nachname = this.nachname().trim();
		if (!vorname || !nachname) {
			this.fehler.update((alt) => ({ ...alt, stamm: 'Bitte Vor- und Nachname ausfüllen' }));
			return;
		}
		// Nur Geaendertes: Die Adresse eines Erwachsenen mit Zugang ist fest, und ein unveraendertes Feld soll nie eine Ablehnung ausloesen.
		const aenderung: Parameters<MitgliederApi['aenderePerson']>[2] = {};
		if (vorname !== p.vorname) aenderung.vorname = vorname;
		if (nachname !== p.nachname) aenderung.nachname = nachname;
		if (p.art === 'JUNGFISCHER') {
			if (this.geburtsdatum() && this.geburtsdatum() !== p.geburtsdatum) aenderung.geburtsdatum = this.geburtsdatum();
			if (this.jugendsprecher() !== (p.jugendsprecher ?? false)) aenderung.jugendsprecher = this.jugendsprecher();
		}
		const mail = this.email().trim();
		if (!this.mailFest() && mail !== (p.email ?? '')) aenderung.email = mail || null;
		if (Object.keys(aenderung).length === 0) {
			this.fehler.update((alt) => ({ ...alt, stamm: 'Es gibt nichts zu speichern' }));
			return;
		}
		const ok = await this.fuehreAus('stamm', () =>
			firstValueFrom(this.api.aenderePerson(this.slug(), p.id, aenderung)),
		);
		if (ok) this.gespeichert.set('stamm');
	}

	protected schalteGruppe(id: string): void {
		this.gewaehlteGruppen.update((alt) => (alt.includes(id) ? alt.filter((x) => x !== id) : [...alt, id]));
	}

	protected async speichereGruppen(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const p = this.person();
		if (!p) return;
		const ok = await this.fuehreAus('gruppen', () =>
			firstValueFrom(this.api.setzeUntergruppen(this.slug(), p.id, this.gewaehlteGruppen())),
		);
		if (ok) this.gespeichert.set('gruppen');
	}

	protected waehleBeziehung(wert: string): void {
		const b = wert as Beziehung | '';
		this.beziehungNeu.set(b);
		// Nur eine Vorbelegung: Die Verwaltung darf sie ueberstimmen, die rechtliche Lage haengt nicht am Verwandtschaftsgrad.
		if (b) this.erziehungsberechtigt.set(beziehungVorbelegung(b));
	}

	protected async fuegeFamilieHinzu(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const p = this.person();
		const beziehung = this.beziehungNeu();
		if (!p) return;
		const melde = (text: string) => this.fehler.update((alt) => ({ ...alt, familie: text }));
		if (this.modus() === 'vorhanden' && !this.erwachsenerId()) return melde('Bitte eine Person wählen');
		if (this.modus() === 'neu' && (!this.neuVorname().trim() || !this.neuNachname().trim())) {
			return melde('Bitte Vor- und Nachname der neuen Person ausfüllen');
		}
		if (!beziehung) return melde('Bitte eine Beziehung wählen');
		if (beziehung === 'ANDERE' && !this.freitext().trim()) return melde('Bitte die Beziehung beschreiben');

		const ok = await this.fuehreAus(
			'familie',
			async () => {
				let erwachsenerId = this.erwachsenerId();
				if (this.modus() === 'neu') {
					const mail = this.neuEmail().trim();
					// Ohne trotzdem: Eine Dublette weist der Server ab, und die Verwaltung waehlt dann die vorhandene Person.
					erwachsenerId = (
						await firstValueFrom(
							this.api.legePersonAn(this.slug(), {
								art: 'ERWACHSENER',
								vorname: this.neuVorname().trim(),
								nachname: this.neuNachname().trim(),
								...(mail ? { email: mail } : {}),
							}),
						)
					).id;
				}
				try {
					await firstValueFrom(
						this.api.setzeFamilie(this.slug(), p.id, erwachsenerId, {
							beziehung,
							...(beziehung === 'ANDERE' ? { beziehungFreitext: this.freitext().trim() } : {}),
							erziehungsberechtigt: this.erziehungsberechtigt(),
						}),
					);
				} catch (ursache) {
					// Die Person gibt es jetzt: Ein Wiederholen im Modus neu liefe in DOPPELT. Darum steht sie danach zur Auswahl.
					if (this.modus() === 'neu') {
						await this.ladeErwachsene();
						this.modus.set('vorhanden');
						this.erwachsenerId.set(erwachsenerId);
					}
					throw ursache;
				}
			},
			false,
		);
		if (!ok) return;
		this.erwachsenerId.set('');
		this.neuVorname.set('');
		this.neuNachname.set('');
		this.neuEmail.set('');
		this.beziehungNeu.set('');
		this.freitext.set('');
		this.erziehungsberechtigt.set(false);
		await Promise.all([this.lade(), this.ladeErwachsene()]);
	}

	protected schalteBerechtigung(f: FamilienEintrag): Promise<boolean> {
		return this.fuehreAus('familie', async () => {
			await firstValueFrom(
				this.api.setzeFamilie(this.slug(), f.jungfischerId, f.erwachsenerId, {
					beziehung: f.beziehung,
					...(f.beziehung === 'ANDERE' && f.beziehungFreitext ? { beziehungFreitext: f.beziehungFreitext } : {}),
					erziehungsberechtigt: !f.erziehungsberechtigt,
				}),
			);
			this.verwirfLink();
		});
	}

	/**
	 * Aendert sich die Familie, kann der Server den Zugang des Kindes entziehen (entzieheZugangWennUngueltig)
	 * und loescht dabei die offenen Einladungen: Der angezeigte Link waere tot. Verworfen: nur nach dem
	 * Neuladen am Zugangsstand pruefen -- der Stand sagt nicht, ob genau diese Einladung noch gilt.
	 */
	private verwirfLink(): void {
		this.link.set(null);
	}

	protected async loese(f: FamilienEintrag): Promise<void> {
		await this.fuehreAus('familie', async () => {
			await firstValueFrom(this.api.loeseFamilie(this.slug(), f.jungfischerId, f.erwachsenerId));
			this.verwirfLink();
		});
	}

	protected async loeseAlle(p: PersonDetail): Promise<void> {
		const eintraege = p.familie ?? [];
		await this.fuehreAus('volljaehrig', async () => {
			for (const f of eintraege) {
				await firstValueFrom(this.api.loeseFamilie(this.slug(), f.jungfischerId, f.erwachsenerId));
				this.verwirfLink();
			}
		});
	}

	protected async belasse(): Promise<void> {
		const p = this.person();
		if (!p) return;
		await this.fuehreAus('volljaehrig', () => firstValueFrom(this.api.volljaehrigBelassen(this.slug(), p.id)));
	}

	/** Einladung (ohne Zugang) oder Zugangslink (mit Zugang); mit mail geht der Text auch an die Adresse der Person. */
	protected async erzeugeLink(mail: boolean): Promise<void> {
		const p = this.person();
		if (!p) return;
		await this.fuehreAus('zugang', async () => {
			this.link.set(await firstValueFrom(this.api.ladePersonEin(this.slug(), p.id, mail)));
		});
	}

	/**
	 * Zugang eines Kindes erlauben oder entziehen. Der Server loescht beim Entziehen die offenen
	 * Einladungen: der angezeigte Link waere tot und wird verworfen. Die Ablehnung beim Erlauben
	 * hat hier einen eigenen Text, denn der allgemeine spricht vom Einladen.
	 */
	protected async setzeZugang(erlaubt: boolean): Promise<void> {
		const p = this.person();
		if (!p) return;
		await this.fuehreAus('zugang', async () => {
			try {
				await firstValueFrom(this.api.setzePersonZugang(this.slug(), p.id, erlaubt));
			} catch (ursache) {
				if (alsApiFehler(ursache).code === 'EINWILLIGUNG_FEHLT') {
					throw new Error(
						'Der Zugang lässt sich noch nicht erlauben: Es fehlt die Einwilligung einer erziehungsberechtigten Person.',
					);
				}
				throw ursache;
			}
			if (!erlaubt) this.verwirfLink();
		});
	}

	protected async entferne(p: PersonDetail): Promise<void> {
		const name = `${p.vorname} ${p.nachname}`;
		await this.fuehreAus(
			'entfernen',
			async () => {
				const antwort = await firstValueFrom(this.api.entfernePerson(this.slug(), p.id));
				// Der angezeigte Link gehoerte zur entfernten Person: Der Server hat ihre Einladungen geloescht.
				this.link.set(null);
				this.entfernt.set({ name, angebot: antwort.folgeangebot, fehler: null });
			},
			false,
		);
	}

	protected async entferneAngebot(id: string): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		try {
			await firstValueFrom(this.api.entfernePerson(this.slug(), id));
			this.nimmAngebotWeg(id, null);
		} catch (ursache) {
			this.nimmAngebotWeg(undefined, verwaltungsfehler(alsApiFehler(ursache)));
		} finally {
			this.laeuft.set(false);
		}
	}

	protected behalteAngebot(id: string): void {
		this.nimmAngebotWeg(id, null);
	}

	private nimmAngebotWeg(id: string | undefined, fehler: string | null): void {
		this.entfernt.update((e) => (e ? { ...e, angebot: e.angebot.filter((a) => a.id !== id), fehler } : e));
	}
}
