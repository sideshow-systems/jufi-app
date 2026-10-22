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
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
	type FahrtModulAnsicht,
	fristText,
	type HelferUebersicht,
	type UebersichtZeile,
	type UmfrageUebersicht,
} from '@jufi/domain';
import { firstValueFrom, type Observable } from 'rxjs';
import { alsApiFehler, fehlertextNichtGefunden, fehlerVon } from '../../../gemeinsam/api-fehler';
import { KarteComponent } from '../../../gestaltung/ui';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from '../../sitzung-abgelaufen';
import { ThreadApi } from '../../threads/thread-api';
import { FahrtModul } from '../../threads/fahrt-modul';
import { teilnahmeText } from '../../threads/umfrage-modul';
import { VerwaltungThreadsApi } from './threads-api';

interface Knopf {
	id: string;
	text: string;
}

interface Person {
	/** Eindeutig je Zeile und Gruppe: Bei Mehrfachauswahl steht eine Person unter mehreren Optionen. */
	schluessel: string;
	fuerId: string;
	name: string;
	eingetragenVon: string | null;
	/** Die bisherige Auswahl der Person aus der Uebersicht; bei Mehrfachauswahl die Vorbelegung der Umschalter. */
	optionIds: string[];
}

interface Gruppe {
	/** Die Options-Id; "offen" fuer alle ohne Antwort. */
	id: string;
	titel: string;
	personen: Person[];
}

interface EintragSicht {
	fuerId: string;
	name: string;
	notiz: string | null;
	eingetragenVon: string | null;
}

interface HelferPositionSicht {
	id: string;
	text: string;
	anzahl: number;
	belegt: number;
	voll: boolean;
	eintraege: EintragSicht[];
	/** Die Gefragten ohne Eintrag in genau dieser Position; wer woanders eingetragen ist, bleibt waehlbar. */
	auswahl: { fuerId: string; name: string }[];
	/** Die gewaehlte Person oder leer; nur, was die Auswahl noch anbietet (siehe helferSicht). */
	gewaehlt: string;
	notiz: string;
}

interface HelferSicht {
	modulId: string;
	titel: string;
	frist: string | null;
	ohneEintrag: number;
	positionen: HelferPositionSicht[];
}

interface UmfrageSicht {
	modulId: string;
	frage: string;
	frist: string | null;
	mehrfach: boolean;
	knoepfe: Knopf[];
	gruppen: Gruppe[];
}

/**
 * Die Antworten-Uebersicht der Verwaltung (Spec 7.1): je Umfrage, wer wie geantwortet hat, und wer
 * noch offen ist. Wer den Thread bearbeiten darf, kann hier fuer eine Person nachtragen; ob die
 * Person das darf, entscheidet der Server (darfNachtragen), die Seite rechnet keine Rechte nach.
 *
 * Nachgetragen wird ueber dieselbe Route wie die Antwort der Familie (ThreadApi.antworte): Der Server
 * erlaubt Bearbeitern jede gefragte Person auch nach der Frist, eine zweite Route gaebe es nur
 * doppelt zu pflegen. Danach laedt die Uebersicht neu, statt die Zeile selbst umzubauen: Gruppen,
 * Anzahlen, "Noch offen" und der Vermerk "eingetragen von" haengen alle an der Antwort des Servers.
 *
 * Ohne Mehrfachauswahl ersetzt die angetippte Option die bisherige. Mit Mehrfachauswahl sind die
 * Optionen Umschalter, vorbelegt mit der bisherigen Auswahl (aus den Gruppen der Uebersicht
 * abgeleitet: unter welchen Optionen die Person steht); ein Tipp schaltet eine Option um und
 * speichert sofort die ganze neue Menge, denn der Server ersetzt immer die gesamte Auswahl.
 * Verworfen: je Klick nur die angetippte Option schicken; wer A und B gewaehlt hatte, behielte
 * nach dem Nachtragen von C nur C, und zurueck ginge es nicht. Verworfen: Umschalten und danach
 * ein Speichern-Knopf; der zweite Schritt braeuchte Zustand, den die Uebersicht sonst nicht hat.
 * Die letzte gewaehlte Option ist gesperrt (disabled): Eine leere Auswahl lehnt der Server mit 400
 * ab, und ein Knopf, der nur einen Fehlertext erzeugt, ist schlechter als einer, der es gar nicht
 * erst anbietet. aria-pressed bleibt true, damit der Zustand auch gesperrt lesbar ist.
 *
 * Unter den Umfragen steht je Helferliste ein Block (Task 8, TP4 Etappe 3): Positionen mit
 * Fuellstand und Eingetragenen, und fuer Bearbeiter Austragen je Eintrag sowie je nicht voller
 * Position ein kleines Formular. Es steht immer da, statt hinter einem Knopf aufzuklappen wie bei
 * der Umfrage: Dort waehlt man unter wenigen Optionen, hier braucht jeder Eintrag eine Person und
 * eine Notiz, und die Leitung traegt meist mehrere hintereinander nach. Die Person ist eine Auswahl
 * mit leerem Anfang, kein vorgewaehlter Erster; sonst traegt ein hastiges Eintragen jemanden ein,
 * den niemand gemeint hat. Ausgetragen und eingetragen wird ueber dieselben Routen wie in der Sicht
 * der Familie (ThreadApi.trageEin und trageAus); der Server erlaubt der Leitung beides auch nach
 * der Frist und im Archiv. Fehler stehen am Block, nicht oben: Der Satz gehoert zu der Liste, in
 * der die Handlung scheiterte. Ein 409 (voll) laedt die Uebersicht zusaetzlich neu, denn dann
 * stimmen Fuellstand und Auswahl nicht mehr.
 *
 * Unter den Helferlisten steht die Fahrgemeinschaft als jf-fahrt-modul mit der Ansicht der Leitung
 * (TP4 Etappe 4, Plan-Entscheidung 17): Umsetzen und alle anderen Bedienelemente sind dieselben wie
 * auf der Thread-Seite, die Karte bringt ihre Ueberschrift selbst mit. Verworfen: eine eigene Tabelle,
 * die jede Regel ein zweites Mal rechnete. Gemeldete Ansichten ersetzen die der Uebersicht; veraltet
 * laedt neu, und der Satz zum Grund bleibt an der Karte stehen, weil sie dieselbe bleibt.
 */
@Component({
	selector: 'jf-antworten-uebersicht',
	imports: [FahrtModul, KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<a class="zurueck" [routerLink]="['/', slug(), 'verwaltung', 'threads']">Zurück zu den Threads</a>

		@if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="uebersicht.reload()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (uebersicht.hasValue()) {
			<h1>{{ uebersicht.value().titel }}</h1>
			@if (fehler(); as text) {
				<p class="fehler" role="alert">{{ text }}</p>
			}
			@for (u of umfragen(); track u.modulId) {
				<jf-karte>
					<h2>{{ u.frage }}</h2>
					@if (u.frist) {
						<p class="gedaempft klein">{{ u.frist }}</p>
					}
					@if (u.mehrfach && darfNachtragen()) {
						<p class="gedaempft klein">Mehrfachauswahl: Optionen ein- oder ausschalten, eine bleibt immer gewählt.</p>
					}
					@for (g of u.gruppen; track g.id) {
						<section [attr.data-gruppe]="g.id">
							<h3>{{ g.titel }} ({{ g.personen.length }})</h3>
							@if (g.personen.length > 0) {
								<ul>
									@for (p of g.personen; track p.schluessel) {
										<li class="person">
											<div class="zeile">
												<span class="name">{{ p.name }}</span>
												@if (p.eingetragenVon) {
													<span class="gedaempft klein">eingetragen von {{ p.eingetragenVon }}</span>
												}
												@if (darfNachtragen()) {
													<button
														type="button"
														class="knopf leise klein"
														[attr.aria-expanded]="offeneZeile() === p.schluessel"
														(click)="klappe(p.schluessel)"
													>
														Eintragen<span class="unsichtbar"> für {{ p.name }}</span>
													</button>
												}
											</div>
											@if (offeneZeile() === p.schluessel) {
												<div class="optionen" role="group" [attr.aria-label]="'Antwort für ' + p.name">
													@for (k of u.knoepfe; track k.id) {
														<button
															type="button"
															class="knopf klein"
															[attr.aria-pressed]="u.mehrfach ? p.optionIds.includes(k.id) : null"
															[disabled]="sendet() || istLetzte(u, p, k.id)"
															(click)="waehle(u, p, k.id)"
														>
															{{ k.text }}
														</button>
													}
												</div>
											}
										</li>
									}
								</ul>
							}
						</section>
					}
				</jf-karte>
			}
			@for (h of helfer(); track h.modulId) {
				<jf-karte [attr.data-helfer]="h.modulId">
					<div class="kopf">
						<h2>{{ h.titel }}</h2>
						<span class="ohne gedaempft klein">{{ h.ohneEintrag }} ohne Eintrag</span>
					</div>
					@if (h.frist) {
						<p class="gedaempft klein">{{ h.frist }}</p>
					}
					@if (helferFehler(); as f) {
						@if (f.modulId === h.modulId) {
							<p class="fehler" role="alert">{{ f.text }}</p>
						}
					}
					@for (p of h.positionen; track p.id) {
						<section class="position" [attr.data-position]="p.id" [attr.aria-label]="p.text">
							<div class="kopf">
								<h3>{{ p.text }}</h3>
								<span class="fuell">
									<span class="zahl">{{ p.belegt }}/{{ p.anzahl }}</span>
									@if (p.voll) {
										<span class="voll">voll</span>
									}
								</span>
							</div>
							@if (p.eintraege.length === 0) {
								<p class="gedaempft klein">Noch niemand eingetragen.</p>
							} @else {
								<ul>
									@for (e of p.eintraege; track e.fuerId) {
										<li class="eintrag">
											<div class="zeile">
												<span class="name">{{ e.name }}</span>
												@if (e.notiz) {
													<span class="notiz">{{ e.notiz }}</span>
												}
												@if (darfNachtragen()) {
													<button
														type="button"
														class="knopf leise klein"
														[disabled]="sendet()"
														(click)="trageAus(h, p, e)"
													>
														Austragen<span class="unsichtbar"> {{ e.name }} aus {{ p.text }}</span>
													</button>
												}
											</div>
											@if (e.eingetragenVon) {
												<span class="gedaempft klein">eingetragen von {{ e.eingetragenVon }}</span>
											}
										</li>
									}
								</ul>
							}
							@if (darfNachtragen() && !p.voll) {
								@if (p.auswahl.length === 0) {
									<p class="gedaempft klein">Alle Gefragten stehen schon in dieser Position.</p>
								} @else {
									<form
										class="formular"
										[attr.aria-label]="'Eintragen in ' + p.text"
										(submit)="eintragen($event, h, p)"
									>
										<label class="feld">
											<span>Person</span>
											<select name="person" [disabled]="sendet()" (change)="waehlePerson(p.id, wert($event))">
												<option value="" [selected]="p.gewaehlt === ''">Person wählen</option>
												@for (g of p.auswahl; track g.fuerId) {
													<option [value]="g.fuerId" [selected]="g.fuerId === p.gewaehlt">{{ g.name }}</option>
												}
											</select>
										</label>
										<label class="feld">
											<span>Notiz (optional)</span>
											<input
												name="notiz"
												maxlength="80"
												autocomplete="off"
												placeholder="z. B. Marmorkuchen"
												[value]="p.notiz"
												[disabled]="sendet()"
												(input)="schreibeNotiz(p.id, wert($event))"
											/>
										</label>
										<button type="submit" class="knopf primaer klein" [disabled]="sendet() || p.gewaehlt === ''">
											Eintragen<span class="unsichtbar"> in {{ p.text }}</span>
										</button>
									</form>
								}
							}
						</section>
					}
				</jf-karte>
			}
			@if (fahrt(); as f) {
				<jf-karte [attr.data-fahrt]="f.id">
					<jf-fahrt-modul
						[modul]="f"
						[slug]="slug()"
						(geaendert)="setzeFahrt($event)"
						(veraltet)="uebersicht.reload()"
					/>
				</jf-karte>
			}
			@if (umfragen().length === 0 && helfer().length === 0 && fahrt() === null) {
				<jf-karte>
					<p class="gedaempft">
						Dieser Thread hat keine Umfrage oder Helferliste, deshalb gibt es hier keine Antworten.
					</p>
				</jf-karte>
			}
		} @else {
			<p class="gedaempft" role="status">Wird geladen …</p>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
			max-width: 48rem;
		}
		h1,
		h2,
		h3,
		p,
		ul {
			margin: 0;
		}
		h1 {
			font-size: var(--schrift-titel);
			overflow-wrap: anywhere;
		}
		h2 {
			font-size: var(--schrift-gross);
			overflow-wrap: anywhere;
		}
		h3 {
			font-size: var(--schrift);
		}
		jf-karte {
			display: grid;
			gap: var(--a3);
		}
		section {
			display: grid;
			gap: var(--a1);
		}
		ul {
			display: grid;
			padding: 0;
			list-style: none;
		}
		.zurueck {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
		}
		.zeile {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a1) var(--a3);
			min-height: var(--tippflaeche);
		}
		.name {
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.zeile .knopf {
			margin-left: auto;
		}
		.optionen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
			padding: var(--a2) 0 var(--a3);
		}
		.optionen .knopf[aria-pressed='true'] {
			background: var(--akzent);
			border-color: var(--akzent);
			color: var(--auf-akzent);
		}
		.kopf {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			justify-content: space-between;
			gap: var(--a1) var(--a3);
		}
		.position {
			padding-top: var(--a2);
			border-top: 1px solid var(--linie);
		}
		.fuell {
			display: inline-flex;
			align-items: baseline;
			gap: var(--a2);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		.voll {
			color: var(--warnung);
		}
		.eintrag {
			display: grid;
			gap: 2px;
		}
		.notiz {
			color: var(--text-gedaempft);
			overflow-wrap: anywhere;
		}
		.formular {
			display: grid;
			gap: var(--a2);
			justify-items: start;
		}
		.formular .feld {
			justify-self: stretch;
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class ThreadAntwortenComponent {
	/** Kommen aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();
	readonly id = input.required<string>();

	private readonly api = inject(VerwaltungThreadsApi);
	private readonly threadApi = inject(ThreadApi);
	private readonly router = inject(Router);
	private weg = false;

	protected readonly uebersicht = rxResource({
		params: () => ({ slug: this.slug(), id: this.id() }),
		stream: ({ params }) => this.api.antworten(params.slug, params.id),
	});
	private readonly fehlerRoh = fehlerVon(this.uebersicht);
	/** Nach einem 401 geht es zur Anmeldung; dort waere ein Fehlertext verwirrend. */
	protected readonly ladefehler = computed(() => {
		const f = this.fehlerRoh();
		return f === null || istNichtAngemeldet(f) ? null : fehlertextNichtGefunden(f);
	});

	/** Die Zeile, deren Optionen aufgeklappt sind; hoechstens eine, ein weiteres Eintragen schliesst die vorige. */
	protected readonly offeneZeile = signal<string | null>(null);
	protected readonly sendet = signal(false);
	protected readonly fehler = signal<string | null>(null);
	/** Der Satz zu einer gescheiterten Handlung, am Block der Liste, in der sie scheiterte. */
	protected readonly helferFehler = signal<{ modulId: string; text: string } | null>(null);
	/** Die gewaehlte Person und die Notiz je Position; geleert wird nur nach einem gelungenen Eintragen dort. */
	private readonly auswahlen = signal<Record<string, string>>({});
	private readonly notizen = signal<Record<string, string>>({});

	protected readonly darfNachtragen = computed(
		() => this.uebersicht.hasValue() && this.uebersicht.value().darfNachtragen,
	);
	protected readonly umfragen = computed<UmfrageSicht[]>(() =>
		this.uebersicht.hasValue() ? this.uebersicht.value().umfragen.map(sicht) : [],
	);
	protected readonly helfer = computed<HelferSicht[]>(() =>
		this.uebersicht.hasValue()
			? this.uebersicht.value().helfer.map((h) => helferSicht(h, this.auswahlen(), this.notizen()))
			: [],
	);

	protected readonly fahrt = computed<FahrtModulAnsicht | null>(() =>
		this.uebersicht.hasValue() ? this.uebersicht.value().fahrt : null,
	);

	constructor() {
		inject(DestroyRef).onDestroy(() => (this.weg = true));
		effect(() => {
			const fehler = this.fehlerRoh();
			if (fehler) untracked(() => void beiAbgelaufenerSitzung(this.router, this.slug(), fehler));
		});
	}

	/**
	 * Die Karte meldet die Ansicht nach einer Handlung; sie ersetzt die der Uebersicht, ohne neu zu
	 * laden, wie die Thread-Seite es mit ersetzeModul tut. Verworfen: jedes Mal neu laden, denn die
	 * Antwort des Servers enthaelt die Ansicht schon, und das Neuladen risse die Karte kurz weg.
	 */
	protected setzeFahrt(neu: FahrtModulAnsicht): void {
		if (!this.uebersicht.hasValue()) return;
		this.uebersicht.value.update((u) => ({ ...u, fahrt: neu }));
	}

	protected klappe(schluessel: string): void {
		this.fehler.set(null);
		this.offeneZeile.set(this.offeneZeile() === schluessel ? null : schluessel);
	}

	/** Bei Mehrfachauswahl die einzige gewaehlte Option der Person; sie laesst sich nicht abwaehlen (siehe Klassenkommentar). */
	protected istLetzte(u: UmfrageSicht, p: Person, optionId: string): boolean {
		return u.mehrfach && p.optionIds.length === 1 && p.optionIds[0] === optionId;
	}

	protected waehle(u: UmfrageSicht, p: Person, optionId: string): void {
		if (!u.mehrfach) {
			void this.trageNach(u.modulId, p.fuerId, [optionId]);
			return;
		}
		if (this.istLetzte(u, p, optionId)) return;
		const neu = p.optionIds.includes(optionId) ? p.optionIds.filter((o) => o !== optionId) : [...p.optionIds, optionId];
		// In der Reihenfolge der Umfrage, nicht der Klicks (wie in der Sicht der Familie).
		void this.trageNach(
			u.modulId,
			p.fuerId,
			u.knoepfe.map((k) => k.id).filter((id) => neu.includes(id)),
		);
	}

	protected wert(e: Event): string {
		return (e.target as HTMLInputElement | HTMLSelectElement).value;
	}

	protected waehlePerson(positionId: string, fuerId: string): void {
		this.auswahlen.update((a) => ({ ...a, [positionId]: fuerId }));
	}

	protected schreibeNotiz(positionId: string, text: string): void {
		this.notizen.update((n) => ({ ...n, [positionId]: text }));
	}

	/**
	 * Eine neue clientId je Absenden: Wiederholt das Netz die Anfrage, erkennt der Server sie. Eine
	 * leere Notiz geht als null, damit sie nicht als leerer Text neben dem Namen landet; der Server
	 * schneidet ebenfalls zu und entscheidet ueber die Grenzen.
	 */
	protected async eintragen(ereignis: Event, h: HelferSicht, p: HelferPositionSicht): Promise<void> {
		ereignis.preventDefault();
		if (p.gewaehlt === '') return;
		const notiz = p.notiz.trim();
		const gelungen = await this.fuehreHelferAus(h.modulId, () =>
			this.threadApi.trageEin(this.slug(), p.id, p.gewaehlt, {
				notiz: notiz === '' ? null : notiz,
				clientId: crypto.randomUUID(),
			}),
		);
		if (!gelungen) return;
		this.auswahlen.update((a) => ohne(a, p.id));
		this.notizen.update((n) => ohne(n, p.id));
	}

	protected async trageAus(h: HelferSicht, p: HelferPositionSicht, e: EintragSicht): Promise<void> {
		await this.fuehreHelferAus(h.modulId, () => this.threadApi.trageAus(this.slug(), p.id, e.fuerId));
	}

	/** Liefert, ob die Handlung gelang; nur dann bereinigt der Aufrufer sein Formular. */
	private async fuehreHelferAus(modulId: string, aufruf: () => Observable<unknown>): Promise<boolean> {
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (this.sendet()) return false;
		this.sendet.set(true);
		this.fehler.set(null);
		this.helferFehler.set(null);
		try {
			await firstValueFrom(aufruf());
			if (this.weg) return false;
			this.uebersicht.reload();
			return true;
		} catch (ursache) {
			if (this.weg) return false;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), fehler)) return false;
			// Bei 409 stimmen Fuellstand und Auswahl nicht mehr; die Eingabe bleibt stehen. Verworfen: auch
			// bei 404 neu laden, denn schlaegt das Laden dann ebenfalls fehl, ersetzte der Ladefehler die ganze Seite.
			if (fehler.status === 409) this.uebersicht.reload();
			this.helferFehler.set({
				modulId,
				text: fehler.code === 'VOLL' ? 'Hier sind schon alle Plätze vergeben.' : fehlertextNichtGefunden(fehler),
			});
			return false;
		} finally {
			this.sendet.set(false);
		}
	}

	/** Eine neue clientId je Klick: Wiederholt das Netz die Anfrage, erkennt der Server sie. */
	private async trageNach(modulId: string, fuerId: string, optionIds: string[]): Promise<void> {
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (this.sendet()) return;
		this.sendet.set(true);
		// Beide Saetze weg, wie in fuehreHelferAus: Ein Fehler am Helfer-Block bezoege sich sonst nach
		// der naechsten Handlung noch auf einen Stand, den das Neuladen schon ersetzt hat.
		this.fehler.set(null);
		this.helferFehler.set(null);
		try {
			await firstValueFrom(
				this.threadApi.antworte(this.slug(), modulId, fuerId, {
					optionIds,
					clientId: crypto.randomUUID(),
				}),
			);
			if (this.weg) return;
			this.offeneZeile.set(null);
			this.uebersicht.reload();
		} catch (ursache) {
			if (this.weg) return;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), fehler)) return;
			// Fuer Bearbeiter gibt es kein 410: Der Server nimmt Nachtraege auch nach der Frist an.
			this.fehler.set(fehlertextNichtGefunden(fehler));
		} finally {
			this.sendet.set(false);
		}
	}
}

function sicht(u: UmfrageUebersicht): UmfrageSicht {
	const person = (gruppe: string, z: UebersichtZeile): Person => ({
		schluessel: `${u.modulId}|${gruppe}|${z.fuerId}`,
		fuerId: z.fuerId,
		name: z.name,
		eingetragenVon: z.eingetragenVon,
		optionIds: z.optionIds,
	});
	const gruppen: Gruppe[] = u.optionen.map((o) => ({
		id: o.id,
		titel: u.teilnahme ? teilnahmeText(o.schluessel, o.text) : o.text,
		personen: u.zeilen.filter((z) => z.optionIds.includes(o.id)).map((z) => person(o.id, z)),
	}));
	const offen = u.zeilen.filter((z) => z.optionIds.length === 0).map((z) => person('offen', z));
	if (offen.length > 0) gruppen.push({ id: 'offen', titel: 'Noch offen', personen: offen });
	return {
		modulId: u.modulId,
		frage: u.frage,
		frist: u.fristAbgelaufen ? 'Frist abgelaufen' : u.frist === null ? null : fristText(new Date(u.frist), new Date()),
		mehrfach: u.mehrfach,
		knoepfe: u.optionen.map((o) => ({ id: o.id, text: u.teilnahme ? teilnahmeText(o.schluessel, o.text) : o.text })),
		gruppen,
	};
}

function helferSicht(
	h: HelferUebersicht,
	auswahlen: Record<string, string>,
	notizen: Record<string, string>,
): HelferSicht {
	return {
		modulId: h.modulId,
		titel: h.titel || 'Helferliste',
		frist: h.fristAbgelaufen ? 'Frist abgelaufen' : h.frist === null ? null : fristText(new Date(h.frist), new Date()),
		ohneEintrag: h.ohneEintrag,
		positionen: h.positionen.map((p) => {
			const eingetragen = new Set(p.eintraege.map((e) => e.fuerId));
			const auswahl = h.gefragte.filter((g) => !eingetragen.has(g.fuerId));
			const gewaehlt = auswahlen[p.id] ?? '';
			return {
				id: p.id,
				text: p.text,
				anzahl: p.anzahl,
				belegt: p.belegt,
				voll: p.belegt >= p.anzahl,
				eintraege: p.eintraege,
				auswahl,
				// Eine Person, die inzwischen eingetragen ist (oder nicht mehr gefragt), gilt als nicht gewaehlt.
				gewaehlt: auswahl.some((g) => g.fuerId === gewaehlt) ? gewaehlt : '',
				notiz: notizen[p.id] ?? '',
			};
		}),
	};
}

function ohne(zuordnung: Record<string, string>, schluessel: string): Record<string, string> {
	return Object.fromEntries(Object.entries(zuordnung).filter(([k]) => k !== schluessel));
}
