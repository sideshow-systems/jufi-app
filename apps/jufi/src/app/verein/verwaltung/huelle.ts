import {
	ChangeDetectionStrategy,
	ElementRef,
	Component,
	computed,
	DestroyRef,
	effect,
	inject,
	input,
	signal,
	viewChild,
	untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { fehlerVon, fehlertext } from '../../gemeinsam/api-fehler';
import { datumBerlin } from '../../gestaltung/format';
import { IconComponent, type IconName } from '../../gestaltung/icon';
import { KarteComponent } from '../../gestaltung/ui';
import { NichtGefundenComponent } from '../../seiten/nicht-gefunden';
import { MitgliedSitzung } from '../mitglied-waechter';
import { MitgliederApi, type NotfallLinkHinweis } from '../mitglieder-api';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from '../sitzung-abgelaufen';
import { VereinKontext } from '../verein-kontext';
import { VereinsLogoComponent } from '../vereins-logo';

interface Punkt {
	/** Schluessel des aktiven Punkts; Personenseite und Anlegen gehoeren zu Mitglieder. */
	schluessel: 'mitglieder' | 'threads' | 'dokumente' | 'untergruppen' | 'rechte' | 'einstellungen';
	/** Pfad unterhalb von verwaltung, leer fuer die Mitgliederliste. */
	pfad: string[];
	text: string;
	icon: IconName;
	/** Das Recht, das den Punkt zeigt; ohne Angabe genuegt irgendein Recht. */
	recht?: string;
}

const PUNKTE: Punkt[] = [
	{ schluessel: 'mitglieder', pfad: [], text: 'Mitglieder', icon: 'personen' },
	// Ohne recht wie Mitglieder: Die Liste ist fuer alle Jugendleiter da, ohne Schreibrechte nur lesbar (TP3-Spec 6.6);
	// wer gar nichts darf, hat ohnehin keine Leiste (zugang); das 404 der Liste ist nur das Sicherheitsnetz.
	{ schluessel: 'threads', pfad: ['threads'], text: 'Threads', icon: 'threads' },
	{ schluessel: 'dokumente', pfad: ['dokumente'], text: 'Dokumente', icon: 'ordner', recht: 'DOKUMENTE' },
	{ schluessel: 'untergruppen', pfad: ['untergruppen'], text: 'Untergruppen', icon: 'liste', recht: 'MITGLIEDER' },
	{
		schluessel: 'rechte',
		pfad: ['rechte'],
		text: 'Jugendleiter & Rechte',
		icon: 'schild',
		recht: 'JUGENDLEITER_RECHTE',
	},
	{
		schluessel: 'einstellungen',
		pfad: ['einstellungen'],
		text: 'Vereinseinstellungen',
		icon: 'einstellungen',
		recht: 'EINSTELLUNGEN',
	},
];

/** Gleiche Grenze wie die Media Query in den Stilen: darunter klappt die Leiste in ein Menue. */
const SCHMAL = '(max-width: 767px)';

/**
 * Huelle der Verwaltung am Desktop: Seitenleiste links, Inhalt rechts. Unter 768 px klappt
 * die Leiste in ein Menue; die Verwaltung ist dort benutzbar, aber mit Hinweis (Vorlage ist
 * die Huelle im Entwurf). Sie liegt neben der Mitglieder-Huelle und nicht darin, denn sie hat
 * ein eigenes Layout, und die Mitglieder-Huelle ist eine schmale Spalte mit unterer Leiste.
 *
 * Die Punkte folgen den Rechten, damit niemand einen Punkt sieht, der mit 404 antwortete;
 * entschieden wird weiter auf dem Server. Wer gar kein Recht hat, bekommt Nicht gefunden
 * ohne Leiste, und die Seiten darunter werden nicht einmal gebaut (kein Router-Outlet, also
 * keine Anfrage). Der Hinweis auf neue Notfall-Links steht hier und nicht in einer Seite:
 * Er soll auf jeder Seite der Verwaltung stehen, bis er nach 30 Tagen von selbst verschwindet
 * (Plan-Entscheidung 2), und braucht deshalb keine Quittung.
 *
 * Ob das Menue offen ist, entscheidet matchMedia im Code, nicht nur das CSS: So steht die
 * zugeklappte Navigation mit hidden im DOM, und der Menueknopf gibt es nur dort, wo er wirkt.
 * Verworfen: display none per Media Query allein, dann waere der Knopf am Desktop fuer
 * Screenreader da und aria-expanded stuende ohne Bedeutung.
 */
@Component({
	selector: 'jf-verwaltung-huelle',
	imports: [IconComponent, KarteComponent, NichtGefundenComponent, RouterLink, RouterOutlet, VereinsLogoComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(document:keydown.escape)': 'schliesseMitEscape()' },
	template: `
		@if (kontext.ladefehler()) {
			<main>
				<jf-karte>
					<p>Keine Verbindung – nochmal versuchen</p>
					<button type="button" class="knopf primaer" (click)="kontext.neuLaden()">Nochmal versuchen</button>
				</jf-karte>
			</main>
		} @else if (kontext.verein() === 'nicht-gefunden' || !zugang()) {
			<jf-nicht-gefunden />
		} @else {
			<div class="huelle">
				<aside>
					<div class="marke">
						<jf-vereins-logo />
						<span class="titel">
							<strong>{{ anzeigename() }}</strong>
							<span class="gedaempft klein">Verwaltung</span>
						</span>
						@if (schmal()) {
							<button
								#menueKnopf
								type="button"
								class="knopf leise nur-icon menue-knopf"
								[attr.aria-expanded]="menueOffen()"
								aria-controls="verwaltung-navigation"
								[attr.aria-label]="menueOffen() ? 'Menü schließen' : 'Menü öffnen'"
								(click)="menueOffen.set(!menueOffen())"
							>
								<jf-icon [name]="menueOffen() ? 'schliessen' : 'liste'" />
							</button>
						}
					</div>
					<nav id="verwaltung-navigation" aria-label="Verwaltung" [hidden]="schmal() && !menueOffen()">
						@for (p of punkte(); track p.schluessel) {
							<a
								[routerLink]="['/', slug(), 'verwaltung', ...p.pfad]"
								[class.aktiv]="aktiv() === p.schluessel"
								[attr.aria-current]="aktiv() === p.schluessel ? 'page' : null"
							>
								<jf-icon [name]="p.icon" /> {{ p.text }}
							</a>
						}
						<a class="zurueck" [routerLink]="['/', slug()]"><jf-icon name="handy" /> Zur App</a>
					</nav>
				</aside>
				<main #haupt tabindex="-1">
					@if (schmal()) {
						<p class="desktop-hinweis"><jf-icon name="info" /> Am Desktop bequemer</p>
					}
					@for (h of hinweise(); track $index) {
						<p class="notfall" role="status">
							<jf-icon name="info" />
							<span>{{ hinweisText(h) }}</span>
						</p>
					}
					@if (hinweisFehler(); as text) {
						<p class="notfall" role="status">
							<jf-icon name="warnung" />
							<span>Hinweise konnten nicht geladen werden: {{ text }}</span>
							<button type="button" class="knopf" (click)="hinweiseRessource.reload()">Nochmal versuchen</button>
						</p>
					}
					<router-outlet />
				</main>
			</div>
		}
	`,
	styles: `
		:host {
			display: block;
			min-height: 100dvh;
			padding-top: var(--sicher-oben);
		}
		.huelle {
			display: grid;
			grid-template-columns: 248px minmax(0, 1fr);
			min-height: calc(100dvh - var(--sicher-oben));
		}
		aside {
			position: sticky;
			top: var(--sicher-oben);
			align-self: start;
			height: calc(100dvh - var(--sicher-oben));
			overflow-y: auto;
			padding: var(--a4) var(--a3);
			background: var(--karte);
			border-right: 1px solid var(--linie);
		}
		.marke {
			display: flex;
			align-items: center;
			gap: var(--a3);
			padding: 0 var(--a2) var(--a4);
		}
		.titel {
			display: grid;
			flex: 1;
			min-width: 0;
		}
		nav {
			display: grid;
			gap: 2px;
		}
		nav[hidden] {
			display: none;
		}
		nav a {
			display: flex;
			align-items: center;
			gap: var(--a3);
			min-height: var(--tippflaeche);
			padding: 0 var(--a3);
			border-radius: var(--radius-klein);
			color: var(--text);
			font-weight: 600;
			text-decoration: none;
		}
		nav a jf-icon {
			color: var(--text-gedaempft);
			font-size: 1.125rem;
		}
		nav a.aktiv {
			background: var(--akzent-flaeche);
			color: var(--akzent);
		}
		nav a.aktiv jf-icon {
			color: var(--akzent);
		}
		nav a.zurueck {
			margin-top: var(--a4);
			border-top: 1px solid var(--linie);
			border-radius: 0;
			padding-top: var(--a3);
		}
		main {
			min-width: 0;
			padding: var(--a5) var(--a6);
		}
		/* Programmatischer Fokus nach dem Menue (tabindex minus eins): Der Rahmen ginge um den ganzen Inhalt und sagt nichts. */
		main:focus {
			outline: none;
		}
		/* Nur im Fehlerfall steht main allein im Host, ohne Leiste daneben. */
		:host > main {
			max-width: 32rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		.notfall {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: var(--a2);
			margin: 0 0 var(--a3);
			padding: var(--a2) var(--a3);
			border-radius: var(--radius-klein);
			background: var(--warnung-flaeche);
			color: var(--warnung);
			font-weight: 600;
		}
		.desktop-hinweis {
			display: flex;
			align-items: center;
			gap: var(--a2);
			margin: 0 0 var(--a3);
			padding: var(--a2) var(--a3);
			border-radius: var(--radius-klein);
			background: var(--warnung-flaeche);
			color: var(--warnung);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		@media (max-width: 767px) {
			/* Eine Spalte, zwei Zeilen. Ohne explizite Zeilen verteilt das Grid den Freiraum der min-height
			   zu gleichen Teilen auf beide auto-Zeilen: Bei kurzem Inhalt endete die Leiste weit oben und der
			   Inhalt finge erst weit darunter an, mit einer Luecke dazwischen. Die erste Zeile ist so hoch wie die
			   Leiste, die zweite nimmt den Rest. */
			.huelle {
				grid-template-columns: minmax(0, 1fr);
				grid-template-rows: auto 1fr;
			}
			aside {
				z-index: 10;
				height: auto;
				padding: var(--a2) var(--a3);
				border-right: 0;
				border-bottom: 1px solid var(--linie);
			}
			.marke {
				padding: 0;
			}
			nav {
				padding-top: var(--a2);
			}
			main {
				padding: var(--a3) var(--a4) calc(var(--a6) + var(--sicher-unten));
			}
		}
	`,
})
export class VerwaltungHuelle {
	protected readonly kontext = inject(VereinKontext);
	private readonly sitzung = inject(MitgliedSitzung);
	private readonly api = inject(MitgliederApi);
	private readonly router = inject(Router);

	/** Kommt aus dem Pfad (withComponentInputBinding), wie bei der Mitglieder-Huelle. */
	readonly slug = input.required<string>();

	private readonly haupt = viewChild<ElementRef<HTMLElement>>('haupt');
	private readonly menueKnopf = viewChild<ElementRef<HTMLElement>>('menueKnopf');
	protected readonly menueOffen = signal(false);
	protected readonly schmal = signal(false);

	private readonly rechte = computed(() => this.sitzung.ich()?.person.rechte ?? []);
	protected readonly zugang = computed(() => this.rechte().length > 0);
	protected readonly punkte = computed(() =>
		PUNKTE.filter((p) => p.recht === undefined || this.rechte().includes(p.recht)),
	);
	protected readonly anzeigename = computed(() => {
		const v = this.kontext.verein();
		return v && v !== 'nicht-gefunden' ? v.anzeigename : '';
	});

	private readonly url = toSignal(
		this.router.events.pipe(
			filter((e): e is NavigationEnd => e instanceof NavigationEnd),
			map((e) => e.urlAfterRedirects),
		),
		{ initialValue: this.router.url },
	);

	/** Schluessel des aktiven Punkts: der Pfadteil nach verwaltung; Anlegen und Personenseite gehoeren zu Mitglieder. */
	protected readonly aktiv = computed(() => {
		const teile = this.url().split(/[?#]/)[0].split('/').filter(Boolean);
		const unter = teile[2] ?? '';
		if (unter === '' || unter === 'neu' || unter === 'personen') return 'mitglieder';
		return PUNKTE.find((p) => p.pfad[0] === unter)?.schluessel ?? null;
	});

	// Ohne Recht ruht die Ressource und schickt nichts: Der Server antwortete mit 404.
	protected readonly hinweiseRessource = rxResource({
		params: () => (this.rechte().includes('JUGENDLEITER_RECHTE') ? this.slug() : undefined),
		stream: ({ params }) => this.api.verwaltungsHinweise(params).pipe(map((a) => a.notfallLinks)),
	});
	private readonly hinweisFehlerRoh = fehlerVon(this.hinweiseRessource);
	protected readonly hinweise = computed<NotfallLinkHinweis[]>(() =>
		// value() wirft im Fehlerzustand; hasValue() fragt gefahrlos.
		this.hinweiseRessource.hasValue() ? this.hinweiseRessource.value() : [],
	);
	/** Nach einem 401 geht es zur Anmeldung; dort waere ein Fehlertext verwirrend. */
	protected readonly hinweisFehler = computed(() => {
		const f = this.hinweisFehlerRoh();
		return f === null || istNichtAngemeldet(f) ? null : fehlertext(f);
	});

	constructor() {
		// Nach jedem Seitenwechsel klappt das Menue wieder zu. Der Fokus ging mit dem Link unter, den die Person
		// angeklickt hat; ohne Ziel fiele er auf body. Er geht auf den Inhalt, nicht auf den Menueknopf: Die Person
		// hat gewaehlt, wohin sie wollte, und das Menue ist erledigt.
		this.router.events
			.pipe(
				filter((e) => e instanceof NavigationEnd),
				takeUntilDestroyed(),
			)
			.subscribe(() => {
				const warOffen = this.menueOffen();
				this.menueOffen.set(false);
				if (warOffen) this.haupt()?.nativeElement.focus();
			});

		// Wie die Seiten: Der Waechter prueft die Sitzung nur beim Betreten der Verwaltung.
		effect(() => {
			const fehler = this.hinweisFehlerRoh();
			if (fehler) untracked(() => void beiAbgelaufenerSitzung(this.router, this.slug(), fehler));
		});

		if (typeof matchMedia === 'function') {
			const mq = matchMedia(SCHMAL);
			this.schmal.set(mq.matches);
			const aenderung = (e: MediaQueryListEvent) => this.schmal.set(e.matches);
			mq.addEventListener?.('change', aenderung);
			inject(DestroyRef).onDestroy(() => mq.removeEventListener?.('change', aenderung));
		}
	}

	/** Escape schliesst das offene Menue und gibt den Fokus dem Knopf, der es geoeffnet hat. */
	protected schliesseMitEscape(): void {
		if (!this.menueOffen()) return;
		this.menueOffen.set(false);
		this.menueKnopf()?.nativeElement.focus();
	}

	protected hinweisText(h: NotfallLinkHinweis): string {
		const fuer = h.vorname ?? 'ein ehemaliges Mitglied';
		return `Der Plattform-Admin hat am ${datumBerlin(h.am)} einen neuen Link für ${fuer} erzeugt.`;
	}
}
