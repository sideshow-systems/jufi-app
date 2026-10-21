import { DOCUMENT } from '@angular/common';
import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	inject,
	Injector,
	input,
	signal,
	untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { idAusSegment, type ThreadAnsicht, threadSegment, type UmfrageAnsicht } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { type ApiFehler, alsApiFehler, fehlertext, fehlertextNichtGefunden } from '../../gemeinsam/api-fehler';
import { IconComponent } from '../../gestaltung/icon';
import { KarteComponent, PilleComponent } from '../../gestaltung/ui';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { VerwaltungThreadsApi } from '../verwaltung/threads/threads-api';
import { InfoModul } from './info-modul';
import { TerminModul } from './termin-modul';
import { ThreadApi } from './thread-api';
import { UmfrageModul } from './umfrage-modul';
import { Verlauf } from './verlauf';

/** So lange bleibt die Karte eines Deep Links hervorgehoben. */
const HERVOR_MS = 2000;

type Zustand = 'laedt' | 'bereit' | 'nicht-gefunden' | 'fehler';

/**
 * Ein Thread mit den Reitern Uebersicht und Verlauf (Spec 6.2). Die Seite holt den Thread
 * als Ganzes und zeigt, was der Server fuer die Person ausgerechnet hat; Rechte, Fristen und
 * Zaehler entscheidet sie nicht selbst.
 *
 * Geladen wird mit firstValueFrom in einer Methode statt mit rxResource: Die Seite muss nach
 * dem Laden den Gelesen-Stand melden, die Adresse umschreiben und bei 401 wegnavigieren, und
 * Task 9 ersetzt den Thread nach einer Antwort durch die neue Ansicht. Eine Ressource haelt
 * ihren Wert schreibgeschuetzt. Wechselt die Thread-ID waehrend einer Anfrage, gewinnt die
 * letzte (lauf); die Antwort der alten wird verworfen.
 */
@Component({
	selector: 'jf-thread-seite',
	imports: [IconComponent, InfoModul, KarteComponent, PilleComponent, RouterLink, TerminModul, UmfrageModul, Verlauf],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@switch (zustand()) {
			@case ('bereit') {
				@if (thread(); as t) {
					<header>
						<a class="knopf leise nur-icon" [routerLink]="['/', slug()]" aria-label="Zurück zur Startseite">
							<jf-icon name="zurueck" />
						</a>
						<div class="titel">
							<h1>{{ t.titel }}</h1>
							@if (t.entwurf || t.archiviert) {
								<span class="marken">
									@if (t.entwurf) {
										<jf-pille art="offen">Entwurf</jf-pille>
									}
									@if (t.archiviert) {
										<jf-pille art="neutral">Archiviert</jf-pille>
										@if (t.darfArchivieren) {
											<button
												type="button"
												class="knopf leise klein"
												[disabled]="stelltWieder()"
												(click)="stelleWieder(t)"
											>
												Wiederherstellen
											</button>
										}
									}
								</span>
							}
						</div>
						@if (t.darfBearbeiten) {
							<a class="knopf" [routerLink]="['/', slug(), 'verwaltung', 'threads', t.id]">Bearbeiten</a>
						}
					</header>

					@if (wiederherstellFehler(); as text) {
						<p class="fehler" role="alert">{{ text }}</p>
					}

					@if (mitVerlauf()) {
						<nav class="reiter" aria-label="Ansicht">
							<a
								[routerLink]="[]"
								[queryParams]="{ reiter: null }"
								[class.aktiv]="!zeigtVerlauf()"
								[attr.aria-current]="!zeigtVerlauf() ? 'page' : null"
								>Übersicht</a
							>
							<a
								[routerLink]="[]"
								[queryParams]="{ reiter: 'verlauf' }"
								[class.aktiv]="zeigtVerlauf()"
								[attr.aria-current]="zeigtVerlauf() ? 'page' : null"
							>
								Verlauf
								@if (t.verlauf.ungelesen > 0) {
									<span class="zahl">{{ t.verlauf.ungelesen }}</span>
									<span class="unsichtbar"> ungelesen</span>
								}
							</a>
						</nav>
					}

					@if (zeigtVerlauf()) {
						<jf-verlauf
							id="verlauf"
							[slug]="slug()"
							[threadId]="t.id"
							[stand]="t.stand"
							[schreibSperre]="t.schreibSperre"
							(gelesen)="verlaufGelesen()"
						/>
					} @else {
						@for (m of t.module; track m.id) {
							<jf-karte [attr.id]="'modul-' + m.id" [class.hervor]="hervor() === m.id">
								@switch (m.typ) {
									@case ('INFO') {
										<jf-info-modul [modul]="m" />
									}
									@case ('TERMIN') {
										<jf-termin-modul [modul]="m" [thread]="t" [slug]="slug()" />
									}
									@case ('UMFRAGE') {
										<jf-umfrage-modul [modul]="m" [slug]="slug()" (geaendert)="ersetzeModul($event)" />
									}
									@default {
										<!-- Ein Modultyp, den erst ein neuerer Server kennt: lieber ein Hinweis als eine leere Karte. -->
										<p class="gedaempft">
											Dieser Inhalt lässt sich in dieser Version der App nicht anzeigen. Neu laden hilft meist.
										</p>
									}
								}
							</jf-karte>
						}
					}
				}
			}
			@case ('nicht-gefunden') {
				<jf-karte>
					<!-- Ein Text fuer unbekannt und unsichtbar (Rahmen-Spec 8): getrennte Meldungen verraeten, dass es den Thread gibt. -->
					<h1>Nicht gefunden oder keine Berechtigung</h1>
					<a class="knopf" [routerLink]="['/', slug()]">Zur Startseite</a>
				</jf-karte>
			}
			@case ('fehler') {
				<jf-karte>
					<p class="fehler" role="alert">{{ fehlertext() }}</p>
					<button type="button" class="knopf primaer" (click)="neu()">Nochmal versuchen</button>
				</jf-karte>
			}
			@default {
				<jf-karte><p class="gedaempft" role="status">Wird geladen …</p></jf-karte>
			}
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		h1,
		p {
			margin: 0;
		}
		h1 {
			font-size: var(--schrift-gross);
			overflow-wrap: anywhere;
		}
		header {
			display: flex;
			align-items: center;
			gap: var(--a2);
		}
		.titel {
			flex: 1;
			min-width: 0;
			display: grid;
			gap: var(--a1);
		}
		.marken {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
		.reiter {
			display: grid;
			grid-template-columns: 1fr 1fr;
			padding: var(--a1);
			border-radius: var(--radius-pille);
			background: var(--karte);
			border: 1px solid var(--linie);
		}
		.reiter a {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: var(--a2);
			min-height: var(--tippflaeche);
			border-radius: var(--radius-pille);
			color: var(--text-gedaempft);
			font-weight: 600;
			text-decoration: none;
		}
		.reiter a.aktiv {
			background: var(--akzent);
			color: var(--auf-akzent);
		}
		.zahl {
			min-width: 20px;
			padding: 0 6px;
			border-radius: var(--radius-pille);
			background: var(--akzent-flaeche);
			color: var(--akzent);
			font-size: var(--schrift-klein);
			text-align: center;
		}
		/* Der Kopf der Huelle klebt oben (56 px plus Aussparung); ohne den Rand verschwaende die Karte eines Deep Links darunter. */
		jf-karte {
			scroll-margin-top: calc(56px + var(--sicher-oben) + var(--a3));
			transition: box-shadow 0.3s;
		}
		jf-karte.hervor {
			box-shadow: 0 0 0 3px var(--akzent);
		}
		jf-karte p + .knopf,
		jf-karte h1 + .knopf,
		jf-karte p + button {
			margin-top: var(--a3);
		}
		.fehler {
			color: var(--fehler);
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
	`,
})
export class ThreadSeite {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();
	/** Der Pfadteil t/:segment, "<id>-<titel>"; nur die Id zaehlt (Spec 6.2). */
	readonly segment = input.required<string>();
	/** Nur auf der Route t/:segment/m/:modulId; der Deep Link auf ein Modul. */
	readonly modulId = input<string | undefined>(undefined);
	/** Query-Parameter; verlauf oeffnet den Verlauf direkt, alles andere die Uebersicht. */
	readonly reiter = input<string | undefined>(undefined);

	private readonly api = inject(ThreadApi);
	private readonly verwaltung = inject(VerwaltungThreadsApi);
	private readonly router = inject(Router);
	private readonly dokument = inject(DOCUMENT);
	private readonly injector = inject(Injector);

	protected readonly zustand = signal<Zustand>('laedt');
	protected readonly thread = signal<ThreadAnsicht | null>(null);
	private readonly fehler = signal<ApiFehler | null>(null);
	protected readonly hervor = signal<string | null>(null);
	protected readonly stelltWieder = signal(false);
	protected readonly wiederherstellFehler = signal<string | null>(null);

	protected readonly fehlertext = computed(() => {
		const f = this.fehler();
		return f ? fehlertext(f) : '';
	});

	/**
	 * Eigene Berechnung statt segment() im Effekt: Schreibt die Seite die Adresse um, aendert
	 * sich nur der Titelteil des Segments, die Id bleibt, und der Thread soll nicht neu laden.
	 */
	private readonly id = computed(() => idAusSegment(this.segment()));

	/**
	 * Reiter gibt es, wo es einen Verlauf gibt oder gab: Bei Nur Aushang ohne Nachrichten waere der
	 * Verlauf eine leere Seite. Mit alten Nachrichten bleibt er lesbar, auch wenn der Modus danach
	 * auf Nur Aushang gestellt wurde. Der Server zaehlt nur Nachrichten; Systemeintraege wie
	 * "veroeffentlicht" haetten sonst bei jedem Aushang einen Reiter erzwungen.
	 */
	protected readonly mitVerlauf = computed(() => {
		const t = this.thread();
		return t !== null && (t.modus !== 'AUSHANG' || t.verlauf.eintraege > 0);
	});
	protected readonly zeigtVerlauf = computed(() => this.mitVerlauf() && this.reiter() === 'verlauf');

	/**
	 * Ob die Karten der Module gezeichnet sind. Eigene Berechnung fuer den Deep Link: Ein neuer
	 * Thread-Wert nach einer Antwort aendert sie nicht, der Effekt laeuft dann gar nicht erst.
	 */
	private readonly moduleSichtbar = computed(() => this.thread() !== null && !this.zeigtVerlauf());

	/**
	 * Zaehlt die Ladevorgaenge; ein Ergebnis gilt nur, wenn seit seinem Start kein neuer begann.
	 * Auch das Abbauen der Seite zaehlt weiter (Konstruktor): Eine Antwort, die erst nach dem Wechsel
	 * auf eine andere Seite eintrifft, soll weder die Adresse zurueckschreiben noch mit der falschen
	 * Seite als weiter zur Anmeldung schicken. Verworfen: die Anfrage abbrechen (takeUntilDestroyed),
	 * denn der Zaehler schuetzt auch die Nachlaeufer nach dem await.
	 */
	private lauf = 0;
	/** Die Ansicht, deren Stand schon als gelesen gemeldet ist; eine neu geladene meldet sich erneut. */
	private gemeldet: ThreadAnsicht | null = null;
	/**
	 * Das Modul, zu dem der Deep Link schon gescrollt hat. Verworfen: sich allein auf
	 * moduleSichtbar verlassen; nach einem Wechsel in den Verlauf und zurueck sprang die Seite
	 * sonst erneut zur Karte, obwohl die Person laengst woanders liest.
	 */
	private gescrollt: string | null = null;
	/**
	 * Haengt an der Seite, nicht am Effekt: Liefe der Effekt waehrend der Hervorhebung erneut
	 * (Reiterwechsel), raeumte er die Uhr ab, und die Karte bliebe hervorgehoben.
	 */
	private hervorUhr: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		inject(DestroyRef).onDestroy(() => {
			this.lauf++;
			clearTimeout(this.hervorUhr);
		});

		effect(() => {
			const slug = this.slug();
			const id = this.id();
			untracked(() => void this.lade(slug, id));
		});

		// Der Gelesen-Stand der Uebersicht geht erst raus, wenn die Person sie sieht: Wer direkt
		// im Verlauf landet, hat die Module nicht gesehen. Der Stand ist der des geladenen Threads,
		// nicht ein spaeterer, damit nichts als gelesen gilt, das nicht angekommen ist (Rahmen 1).
		effect(() => {
			const t = this.thread();
			if (t === null || this.zeigtVerlauf() || t === this.gemeldet) return;
			this.gemeldet = t;
			untracked(() => void this.meldeGelesen(t));
		});

		// Deep Link auf ein Modul: einmal hinscrollen und kurz hervorheben, sobald die Karte gezeichnet ist.
		effect((aufraeumen) => {
			const modulId = this.modulId();
			if (!modulId || !this.moduleSichtbar() || modulId === this.gescrollt) return;
			const ref = afterNextRender(
				() => {
					const karte = this.dokument.getElementById(`modul-${modulId}`);
					if (!karte) return;
					this.gescrollt = modulId;
					const ruhig = this.dokument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
					karte.scrollIntoView({ behavior: ruhig ? 'auto' : 'smooth', block: 'start' });
					this.hervor.set(modulId);
					clearTimeout(this.hervorUhr);
					this.hervorUhr = setTimeout(() => this.hervor.set(null), HERVOR_MS);
				},
				{ injector: this.injector },
			);
			aufraeumen(() => ref.destroy());
		});
	}

	protected neu(): void {
		void this.lade(this.slug(), this.id());
	}

	private async lade(slug: string, id: string | null): Promise<void> {
		const lauf = ++this.lauf;
		this.thread.set(null);
		this.fehler.set(null);
		this.hervor.set(null);
		clearTimeout(this.hervorUhr);
		this.gescrollt = null;
		// Ohne lesbare Id gibt es nichts zu fragen; dieselbe Antwort wie bei 404, ohne Anfrage.
		if (id === null) {
			this.zustand.set('nicht-gefunden');
			return;
		}
		this.zustand.set('laedt');
		try {
			const ansicht = await firstValueFrom(this.api.thread(slug, id));
			if (lauf !== this.lauf) return;
			this.thread.set(ansicht);
			this.zustand.set('bereit');
			this.korrigiereAdresse(slug, ansicht);
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			const fehler = alsApiFehler(ursache);
			// Der Waechter prueft die Sitzung nur beim Betreten; sie kann bei offener Seite ablaufen.
			if (await beiAbgelaufenerSitzung(this.router, slug, fehler)) return;
			if (fehler.status === 404) {
				this.zustand.set('nicht-gefunden');
				return;
			}
			this.fehler.set(fehler);
			this.zustand.set('fehler');
		}
	}

	/**
	 * Holt einen archivierten Thread zurueck und laedt die Ansicht neu, statt die Marke lokal zu
	 * entfernen: Ob und wo der Thread danach in den Listen steht, rechnet der Server. Die Rechte
	 * (darfArchivieren) kommen aus der Ansicht; scheitert es trotzdem (404), steht der Satz der
	 * Seite und der Knopf bleibt fuer einen neuen Versuch.
	 */
	protected async stelleWieder(t: ThreadAnsicht): Promise<void> {
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (this.stelltWieder()) return;
		const slug = this.slug();
		const lauf = this.lauf;
		this.stelltWieder.set(true);
		this.wiederherstellFehler.set(null);
		try {
			await firstValueFrom(this.verwaltung.archiviere(slug, t.id, false));
			if (lauf !== this.lauf) return;
			await this.lade(slug, t.id);
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, slug, fehler)) return;
			this.wiederherstellFehler.set(fehlertextNichtGefunden(fehler));
		} finally {
			this.stelltWieder.set(false);
		}
	}

	/**
	 * Schreibt ein veraltetes Segment auf den aktuellen Titel um, ohne einen Verlaufseintrag
	 * anzulegen. Modul und Reiter bleiben. Verworfen: den Titel nie umschreiben; ein geaenderter
	 * Titel stuende sonst in jeder Adresse, die jemand aus der Leiste kopiert, falsch da.
	 */
	private korrigiereAdresse(slug: string, ansicht: ThreadAnsicht): void {
		const soll = threadSegment(ansicht.id, ansicht.titel);
		if (this.segment() === soll) return;
		const modulId = this.modulId();
		void this.router.navigate(['/', slug, 't', soll, ...(modulId ? ['m', modulId] : [])], {
			replaceUrl: true,
			queryParamsHandling: 'preserve',
		});
	}

	/**
	 * Setzt die Umfrage nach einer Antwort als neues Modul ein, als neuer Thread-Wert, damit die
	 * Seite neu zeichnet. Der Stand bleibt der geladene: Die Antwort meldet zwar den neuen
	 * Vereinsstand, aber bis dorthin koennen andere am Thread geaendert haben, was die Seite nicht
	 * geladen hat (Rahmen 1). Die eigene Antwort macht den Thread fuer die Person ohnehin nicht
	 * "neu", eigene Aenderungen zaehlen dort nicht (Spec 3.9). Weil der Stand bleibt, gilt die
	 * neue Ansicht als schon gemeldet; ein zweites PUT mit demselben Stand aenderte nichts.
	 * Verworfen: den Thread neu laden; das kostete eine Anfrage je Tipp und setzte die Seite
	 * waehrend des Ladens auf "Wird geladen".
	 */
	protected ersetzeModul(neu: UmfrageAnsicht): void {
		const alt = this.thread();
		if (alt === null) return;
		const ersetzt: ThreadAnsicht = { ...alt, module: alt.module.map((m) => (m.id === neu.id ? neu : m)) };
		if (this.gemeldet === alt) this.gemeldet = ersetzt;
		this.thread.set(ersetzt);
	}

	/**
	 * Der Server hat den Verlauf als gelesen angenommen: Der Zaehler am Reiter faellt auf 0. Wie bei
	 * ersetzeModul bleibt der Stand der geladene, und eine schon gemeldete Ansicht gilt auch in der
	 * neuen Fassung als gemeldet, sonst ginge beim Wechsel zur Uebersicht ein zweites PUT mit
	 * demselben Stand raus.
	 */
	protected verlaufGelesen(): void {
		const alt = this.thread();
		if (alt === null || alt.verlauf.ungelesen === 0) return;
		const neu: ThreadAnsicht = { ...alt, verlauf: { ...alt.verlauf, ungelesen: 0 } };
		if (this.gemeldet === alt) this.gemeldet = neu;
		this.thread.set(neu);
	}

	/**
	 * Schlaegt das Melden fehl, bleibt es unbemerkt: Der Stand holt sich beim naechsten Oeffnen
	 * nach, und ein Fehlerblock fuer etwas, das die Person nicht ausgeloest hat, waere falscher Alarm.
	 */
	private async meldeGelesen(t: ThreadAnsicht): Promise<void> {
		try {
			await firstValueFrom(this.api.gelesen(this.slug(), t.id, { bereich: 'uebersicht', bis: t.stand }));
		} catch {
			// siehe oben
		}
	}
}
