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
	viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
	type FahrtModulAnsicht,
	type HelferModulAnsicht,
	idAusSegment,
	teilenText,
	type ThreadAnsicht,
	threadSegment,
	type UmfrageAnsicht,
} from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { type ApiFehler, alsApiFehler, fehlertext, fehlertextNichtGefunden } from '../../gemeinsam/api-fehler';
import { IconComponent } from '../../gestaltung/icon';
import { MeldungService } from '../../gestaltung/meldung';
import { KarteComponent, PilleComponent } from '../../gestaltung/ui';
import { betrifft, Echtzeit, type EchtzeitEreignis } from '../echtzeit';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { VerwaltungThreadsApi } from '../verwaltung/threads/threads-api';
import { DateienModulComponent } from './dateien-modul';
import { FotosModulComponent } from './fotos-modul';
import { FahrtModul } from './fahrt-modul';
import { HelferModul } from './helfer-modul';
import { InfoModul } from './info-modul';
import { teile } from './teilen';
import { TerminModul } from './termin-modul';
import { ThreadApi } from './thread-api';
import { ThreadUebersicht } from './thread-uebersicht';
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
 *
 * Live: Ereignisse der Echtzeit, die diesen Thread betreffen, aktualisieren die Seite still
 * (aktualisiereStill), ohne "Wird geladen" und ohne die Karten neu aufzubauen. Eine Nachricht
 * mit mitgeliefertem Eintrag geht bei offenem Verlauf direkt hinein, ohne Anfrage (nur nach einer
 * gescheiterten Aktualisierung stoesst sie eine neue an, siehe ausstehend). Geloescht
 * oder unsichtbar zeigt die Seite ohne Anfrage "Nicht gefunden" (Rahmen-Spec 8). Gelesen
 * meldet sie nur bei sichtbarem Dokument und nie ueber das hinaus, was sie geladen hat
 * (bekannterStand, Entscheidung 8).
 */
@Component({
	selector: 'jf-thread-seite',
	imports: [
		DateienModulComponent,
		FotosModulComponent,
		FahrtModul,
		HelferModul,
		IconComponent,
		InfoModul,
		KarteComponent,
		PilleComponent,
		RouterLink,
		TerminModul,
		UmfrageModul,
		Verlauf,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@switch (zustand()) {
			@case ('bereit') {
				@if (thread(); as t) {
					<header>
						<a
							class="knopf leise nur-icon"
							[routerLink]="['/', slug(), 'threads']"
							aria-label="Zurück zur Thread-Liste"
						>
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
						<!-- Bei einem Entwurf gaebe es keinen Empfaenger: Den Link oeffnen nur die Bearbeiter (Entscheidung 4). -->
						@if (!t.entwurf) {
							<button type="button" class="knopf leise nur-icon" aria-label="Stand teilen" (click)="teileStand(t)">
								<jf-icon name="teilen" />
							</button>
						}
						@if (t.darfBearbeiten) {
							<a class="knopf bearbeiten" [routerLink]="['/', slug(), 'verwaltung', 'threads', t.id]">
								<jf-icon name="stift" />
								<span>Bearbeiten</span>
							</a>
						}
					</header>

					@if (teilenFallback(); as text) {
						<!-- Ohne Zwischenablage bleibt der Text zum Markieren, wie bei der Einladung im Admin. -->
						<textarea readonly rows="8" aria-label="Text zum Teilen" (focus)="markiere($event)">{{ text }}</textarea>
					}

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
							[stand]="bekannterStand()"
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
									@case ('HELFER') {
										<jf-helfer-modul
											[modul]="m"
											[slug]="slug()"
											(geaendert)="ersetzeModul($event)"
											(veraltet)="modulVeraltet()"
										/>
									}
									@case ('FAHRT') {
										<jf-fahrt-modul
											[modul]="m"
											[slug]="slug()"
											(geaendert)="ersetzeModul($event)"
											(veraltet)="modulVeraltet()"
										/>
									}
									@case ('DATEIEN') {
										<jf-dateien-modul [modul]="m" [slug]="slug()" (geaendert)="dateienGeaendert()" />
									}
									@case ('FOTOS') {
										<jf-fotos-modul [modul]="m" [slug]="slug()" (geaendert)="dateienGeaendert()" />
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
		/* Unter 480 px bleibt vom Link nur der Stift: Mit Text und Teilen-Knopf schrumpfte der Titel eines langen Namens auf etwa 114 px und liefe ueber sieben Zeilen. Der Text bleibt fuer Screenreader da (gleiche Technik wie die globale Klasse unsichtbar, die sich nicht per Media Query zuschalten laesst). Verworfen: die Knoepfe in eine zweite Zeile umbrechen; der Kopf waere dann doppelt so hoch, und der Zurueck-Pfeil stuende ueber den Aktionen statt neben dem Titel. */
		@media (max-width: 479px) {
			.bearbeiten {
				padding: 0;
			}
			.bearbeiten span {
				position: absolute;
				width: 1px;
				height: 1px;
				overflow: hidden;
				clip: rect(0 0 0 0);
				white-space: nowrap;
			}
		}
		textarea {
			width: 100%;
			box-sizing: border-box;
			padding: var(--a3);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--karte);
			resize: vertical;
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
	/** Die Liste der Huelle (Punkt an "Threads"); optional, weil die Seite auch ohne Huelle steht (Tests). */
	private readonly uebersicht = inject(ThreadUebersicht, { optional: true });
	private readonly echtzeit = inject(Echtzeit);
	private readonly meldung = inject(MeldungService);
	/** Nur gesetzt, solange der Reiter Verlauf offen ist. */
	private readonly verlauf = viewChild(Verlauf);

	protected readonly zustand = signal<Zustand>('laedt');
	protected readonly thread = signal<ThreadAnsicht | null>(null);
	private readonly fehler = signal<ApiFehler | null>(null);
	protected readonly hervor = signal<string | null>(null);
	protected readonly stelltWieder = signal(false);
	protected readonly wiederherstellFehler = signal<string | null>(null);
	/** Der Text zum Markieren, wenn weder Teilen noch Kopieren ging. */
	protected readonly teilenFallback = signal<string | null>(null);
	/**
	 * Wahr, solange das Teilen-Blatt offen ist. Ein zweiter Tipp riefe share noch einmal, das mit
	 * InvalidStateError scheitert; teile fiele auf Kopieren zurueck und meldete zu Unrecht Kopiert.
	 * Verworfen: den Knopf sperren; ein gesperrter Knopf wirkt am Handy wie ein Defekt, und der
	 * Tipp ist ohnehin wirkungslos.
	 */
	private teilt = false;
	/**
	 * Bis hierhin hat die Seite den Thread (Entscheidung 8): der Stand der zuletzt geladenen Ansicht,
	 * gehoben um den Stand einer Live-Nachricht, solange keine Ladung offen ist (standOffen). Ist eine
	 * offen, kann unter dem Stand der Nachricht eine andere Aenderung liegen, die noch nicht da ist;
	 * dann hebt erst die gelungene Antwort den Stand. Der Verlauf meldet bis hierhin.
	 */
	protected readonly bekannterStand = signal(0);

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
	/**
	 * Wahr ab dem Beginn einer Ladung oder stillen Aktualisierung, bis eine gelingt. Ein Fehler (ausser
	 * 404, dann ist der Thread weg) laesst es wahr: Die Aenderung, die die Aktualisierung ausgeloest
	 * hat, ist dann nicht geladen, und eine spaetere Live-Nachricht darf den Stand nicht ueber sie
	 * heben, sonst gaelte sie als gelesen (Entscheidung 8). Erst die naechste gelungene Aktualisierung
	 * holt es nach; eine Live-Nachricht im offenen Verlauf stoesst sie an (ausstehend).
	 * Verworfen: der Wortlaut des Plans ("anderer Fehler: alter Stand bleibt" und danach keine
	 * ausstehende Aktualisierung mehr); dann hoebe die naechste Nachricht den Stand ueber die
	 * gescheiterte Aenderung hinweg (Review Task 10).
	 */
	private standOffen = false;
	/**
	 * Der hoechste Stand der Live-Nachrichten, die waehrend standOffen in den Verlauf kamen. Nach der
	 * gelungenen Antwort gilt max(ihr Stand, liveBis): Jede andere Aenderung vor einer dieser
	 * Nachrichten kam als Signal davor (der Hub liefert in Stand-Reihenfolge) und hat eine Aktualisierung
	 * gestartet, deren Antwort sie deckt; die Nachrichten selbst stehen schon im Verlauf. Verworfen:
	 * nur den Stand der Antwort nehmen; war die Nachricht juenger als die Antwort, bliebe sie trotz
	 * Anzeige ungelesen, bis sich am Thread wieder etwas aendert.
	 */
	private liveBis = 0;
	/**
	 * Wahr, solange eine Ladung oder stille Aktualisierung unterwegs ist, deren Ergebnis noch gelten
	 * kann (gleicher lauf). Eine Live-Nachricht bei standOffen stoesst nur dann eine Aktualisierung
	 * an: Sonst verwuerfe jede Nachricht eines Schwalls die laufende Anfrage ueber lauf, und keine
	 * kaeme je durch. Verworfen: auf Live-Nachrichten gar nicht nachladen -- nach einer gescheiterten
	 * Aktualisierung blieb der Stand dann offen, bis ein Ereignis ohne Eintrag kam, und in einem
	 * reinen Chat meldete der Verlauf nichts mehr als gelesen (Review Task 10).
	 */
	private ausstehend = false;
	/**
	 * Zaehlt die Seiten (Adresse, Thread, Abbau). Wiederherstellen prueft diesen Zaehler statt lauf:
	 * Ein Live-Ereignis waehrend des Aufrufs erhoeht lauf, und ein Fehler des Aufrufs ginge sonst
	 * verloren, der Knopf taete scheinbar nichts (Review Task 10).
	 */
	private seitenNr = 0;
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
			this.seitenNr++;
			this.ausstehend = false;
			clearTimeout(this.hervorUhr);
		});

		effect(() => {
			const slug = this.slug();
			const id = this.id();
			untracked(() => {
				this.seitenNr++;
				void this.lade(slug, id);
			});
		});

		this.echtzeit.ereignisse.pipe(takeUntilDestroyed()).subscribe((e) => this.beiEreignis(e));

		// Der Gelesen-Stand der Uebersicht geht erst raus, wenn die Person sie sieht: Wer direkt
		// im Verlauf landet, hat die Module nicht gesehen, und ein Hintergrund-Tab zeigt sie
		// niemandem (Entscheidung 8). Der Stand ist der des geladenen Threads, nicht ein spaeterer,
		// damit nichts als gelesen gilt, das nicht angekommen ist (Rahmen 1).
		effect(() => {
			const t = this.thread();
			if (t === null || this.zeigtVerlauf() || t === this.gemeldet || !this.echtzeit.vordergrund()) return;
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

	/**
	 * Baut den Text aus der Ansicht, die die Person gerade sieht, und teilt oder kopiert ihn. teile
	 * wird ohne ein await davor gerufen: Safari verlangt share innerhalb der Nutzergeste. Der Link
	 * nimmt origin des Fensters statt einer BASIS_URL vom Server (Entscheidung 2); die App ist nur
	 * unter ihrer Basisadresse erreichbar, beides ist dasselbe.
	 */
	protected async teileStand(t: ThreadAnsicht): Promise<void> {
		const fenster = this.dokument.defaultView;
		if (!fenster || this.teilt) return;
		const text = teilenText({ ansicht: t, basisUrl: fenster.location.origin, slug: this.slug(), jetzt: new Date() });
		this.teilt = true;
		let ergebnis;
		try {
			ergebnis = await teile(text, fenster);
		} finally {
			this.teilt = false;
		}
		// Nur ein gescheitertes Kopieren zeigt das Feld; ein neuer Versuch, der gelingt, raeumt es weg.
		this.teilenFallback.set(ergebnis === 'FEHLER' ? text : null);
		if (ergebnis === 'KOPIERT') this.meldung.zeige('Kopiert');
	}

	protected markiere(ereignis: Event): void {
		(ereignis.target as HTMLTextAreaElement).select();
	}

	protected neu(): void {
		void this.lade(this.slug(), this.id());
	}

	private async lade(slug: string, id: string | null): Promise<void> {
		const lauf = ++this.lauf;
		this.standOffen = id !== null;
		this.ausstehend = id !== null;
		this.liveBis = 0;
		this.thread.set(null);
		this.fehler.set(null);
		this.hervor.set(null);
		// Der Text gehoert zum Thread davor; ein anderer Thread zeigte sonst fremden Text unter seinem Kopf.
		this.teilenFallback.set(null);
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
			this.ausstehend = false;
			this.thread.set(ansicht);
			this.setzeStand(ansicht.stand);
			this.zustand.set('bereit');
			this.korrigiereAdresse(slug, ansicht);
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			this.ausstehend = false;
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
	 * Was ein Ereignis fuer diesen Thread bedeutet (Plan Task 10). Ein Signal ohne Thread (Umfeld)
	 * betrifft jeden und fuehrt zur stillen Aktualisierung, die dann 404 bekommt oder nicht.
	 */
	private beiEreignis(e: EchtzeitEreignis): void {
		const id = this.id();
		if (id === null || !betrifft(e, id)) return;
		if ((e.typ === 'signal' && e.signal.art === 'GELOESCHT') || (e.typ === 'sync' && e.unsichtbar.includes(id))) {
			this.verschwunden();
			return;
		}
		const verlauf = this.zeigtVerlauf() ? this.verlauf() : undefined;
		if (e.typ === 'signal' && e.signal.art === 'VERLAUF' && e.signal.eintrag) {
			// In der Uebersicht genuegt der Eintrag nicht: Der Zaehler am Reiter kommt vom Server.
			if (!verlauf) {
				void this.aktualisiereStill();
				return;
			}
			verlauf.uebernimm(e.signal.eintrag);
			const stand = e.signal.stand;
			if (this.standOffen) {
				this.liveBis = Math.max(this.liveBis, stand);
				// Ist nichts unterwegs, ist die letzte Aktualisierung gescheitert: jetzt neu versuchen.
				// Still, denn die Seite ist bereit; ein Verlauf ist nur mit geladenem Thread offen.
				if (!this.ausstehend) void this.aktualisiereStill();
			} else this.bekannterStand.update((s) => Math.max(s, stand));
			return;
		}
		void this.aktualisiereStill();
		// Ohne mitgelieferte Eintraege (Systemeintrag, Abgleich, alles neu) muss der Verlauf selbst fragen.
		if (e.typ !== 'signal' || e.signal.art === 'VERLAUF') void verlauf?.frischeAuf();
	}

	/**
	 * Der Thread ist geloescht oder nicht mehr sichtbar: kein Nachfragen, die Antwort waere 404.
	 * lauf zaehlt weiter, damit eine noch laufende Anfrage die Seite nicht zurueckholt.
	 */
	private verschwunden(): void {
		this.lauf++;
		this.ausstehend = false;
		this.thread.set(null);
		this.fehler.set(null);
		this.zustand.set('nicht-gefunden');
	}

	/**
	 * Laedt den Thread neu, ohne die Seite auf "Wird geladen" zu setzen: Die Karten bleiben stehen
	 * (Umfrage-Auswahl, Scrollstelle), nur der Inhalt wechselt. Derselbe lauf wie lade, damit eine
	 * aeltere Antwort keine neuere ueberschreibt. Ein Fehler ausser 401 und 404 laesst den alten
	 * Inhalt stehen, ohne Fehlerblock: Die Person hat nichts ausgeloest, und das naechste Ereignis
	 * oder Oeffnen holt es nach; der Stand bleibt dabei offen (standOffen).
	 *
	 * Laedt die Seite noch oder zeigt einen Fehler, laedt sie richtig: Es gibt keinen Inhalt, der
	 * stehen bleiben koennte, und eine laufende erste Anfrage koennte vor der Aenderung beantwortet
	 * sein. Bei "Nicht gefunden" fragt sie still und schaltet nur bei Erfolg um (der Thread ist wieder
	 * sichtbar); verworfen: auch dort lade, das liesse bei jedem Wiederverbinden und jeder
	 * Umfeld-Aenderung "Wird geladen" aufblitzen, meist nur, um wieder 404 zu bekommen.
	 */
	private async aktualisiereStill(): Promise<void> {
		const slug = this.slug();
		const id = this.id();
		if (id === null) return;
		const zustand = this.zustand();
		if (zustand === 'laedt' || zustand === 'fehler') return this.lade(slug, id);
		const lauf = ++this.lauf;
		this.standOffen = true;
		this.ausstehend = true;
		try {
			const ansicht = await firstValueFrom(this.api.thread(slug, id));
			if (lauf !== this.lauf) return;
			this.ausstehend = false;
			// Gleicher Stand, gleiche Meldung: Ein zweites PUT mit demselben Stand aenderte nichts.
			const alt = this.thread();
			if (alt !== null && alt === this.gemeldet && alt.stand === ansicht.stand) this.gemeldet = ansicht;
			this.thread.set(ansicht);
			this.setzeStand(ansicht.stand);
			this.zustand.set('bereit');
			this.korrigiereAdresse(slug, ansicht);
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			this.ausstehend = false;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, slug, fehler)) return;
			if (fehler.status === 404 && lauf === this.lauf) this.verschwunden();
		}
	}

	/** Nach einer gelungenen Ladung: Der Stand gilt, samt der Live-Nachrichten waehrend der Anfrage. */
	private setzeStand(stand: number): void {
		this.bekannterStand.set(Math.max(stand, this.liveBis));
		this.standOffen = false;
		this.liveBis = 0;
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
		const seite = this.seitenNr;
		this.stelltWieder.set(true);
		this.wiederherstellFehler.set(null);
		try {
			await firstValueFrom(this.verwaltung.archiviere(slug, t.id, false));
			if (seite !== this.seitenNr) return;
			await this.lade(slug, t.id);
		} catch (ursache) {
			if (seite !== this.seitenNr) return;
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
	 * Setzt die Umfrage, Helferliste oder Fahrgemeinschaft nach einer Antwort als neues Modul ein, als neuer Thread-Wert, damit die
	 * Seite neu zeichnet. Der Stand bleibt der geladene: Die Antwort meldet zwar den neuen
	 * Vereinsstand, aber bis dorthin koennen andere am Thread geaendert haben, was die Seite nicht
	 * geladen hat (Rahmen 1). Die eigene Antwort macht den Thread fuer die Person ohnehin nicht
	 * "neu", eigene Aenderungen zaehlen dort nicht (Spec 3.9). Weil der Stand bleibt, gilt die
	 * neue Ansicht als schon gemeldet; ein zweites PUT mit demselben Stand aenderte nichts.
	 * Verworfen: den Thread neu laden; das kostete eine Anfrage je Tipp und setzte die Seite
	 * waehrend des Ladens auf "Wird geladen".
	 */
	protected ersetzeModul(neu: UmfrageAnsicht | HelferModulAnsicht | FahrtModulAnsicht): void {
		const alt = this.thread();
		if (alt === null) return;
		const ersetzt: ThreadAnsicht = { ...alt, module: alt.module.map((m) => (m.id === neu.id ? neu : m)) };
		if (this.gemeldet === alt) this.gemeldet = ersetzt;
		this.thread.set(ersetzt);
	}

	/**
	 * Nach Upload, Umbenennen oder Loeschen im Datei- und im Foto-Modul: Die Seite laedt still neu, wie nach einer
	 * Live-Nachricht. Verworfen: die Dateiliste aus der Antwort einsetzen wie bei der Umfrage; der
	 * Server haengt die Endung an und ordnet die Liste, und die Antwort des Hochladens kennt nur
	 * die eine Zeile.
	 */
	protected dateienGeaendert(): void {
		void this.aktualisiereStill();
	}

	/**
	 * Helferliste oder Fahrgemeinschaft hat eine Handlung abgewiesen, weil sie sich seit dem Laden geaendert hat (voll,
	 * archiviert, Frist vorbei, nicht mehr da): Die Seite laedt still neu, damit die Karte zeigt, was
	 * der Server jetzt sieht. Der Satz zum Grund bleibt an der Karte stehen. Verworfen: den Thread
	 * mit "Wird geladen" neu zu laden; das risse die Karte mitsamt dem Satz weg.
	 */
	protected modulVeraltet(): void {
		void this.aktualisiereStill();
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
	 *
	 * Nach dem Melden fragt die Liste der Huelle neu. Ihre eigene Anfrage zum Pfadwechsel genuegt
	 * nicht: Tippt die Person gleich nach dem Oeffnen auf Zurueck, kann die Listenanfrage vor dem
	 * Gelesen-Stand beantwortet sein, und der Punkt bliebe bis zur naechsten Seite stehen. Ebenso
	 * erlischt er jetzt, wenn gelesen wird, ohne dass sich der Pfad aendert (Wechsel vom Verlauf
	 * zur Uebersicht). Verworfen: in der Huelle auf jeden Gelesen-Stand zu lauschen -- die Seite
	 * weiss als einzige, wann er angekommen ist.
	 */
	private async meldeGelesen(t: ThreadAnsicht): Promise<void> {
		try {
			await firstValueFrom(this.api.gelesen(this.slug(), t.id, { bereich: 'uebersicht', bis: t.stand }));
		} catch {
			// siehe oben
			return;
		}
		this.uebersicht?.neuLaden();
	}
}
