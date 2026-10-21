import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { NichtGefundenComponent } from '../seiten/nicht-gefunden';
import { IconComponent, type IconName } from '../gestaltung/icon';
import { KarteComponent } from '../gestaltung/ui';
import { ThreadUebersicht } from './threads/thread-uebersicht';
import { VereinKontext } from './verein-kontext';
import { VereinsLogoComponent } from './vereins-logo';

interface Eintrag {
	/** Pfad unterhalb des Vereins, leer fuer die Startseite. */
	pfad: string;
	text: string;
	icon: IconName;
	/** Weitere Pfade unterhalb des Vereins, auf denen dieser Eintrag aktiv bleibt (Profil gehoert zu Mehr). */
	auch: string[];
}

/**
 * Vier Eintraege seit TP3 (Spec 6.2). Medien kommt mit TP4 dazu; bis dahin waere jeder
 * weitere Eintrag ein Link ins Leere. Einzelne Threads (t/...) gehoeren zu Threads.
 */
const EINTRAEGE: Eintrag[] = [
	{ pfad: '', text: 'Start', icon: 'start', auch: [] },
	{ pfad: 'threads', text: 'Threads', icon: 'threads', auch: ['t'] },
	{ pfad: 'termine', text: 'Termine', icon: 'termine', auch: [] },
	{ pfad: 'mehr', text: 'Mehr', icon: 'mehr', auch: ['profil', 'meine-jungfischer'] },
];

/**
 * Huelle der Mitglieder-Ansicht: Kopf mit Logo oder Initialen, Inhalt, untere Leiste.
 * Am Desktop bleibt es eine mittige Spalte von hoechstens 480 px; Mitglieder sind am
 * Handy, und eine breite Seite brauchte ein zweites Layout ohne Nutzen.
 *
 * Die Huelle faengt auch die zwei Zustaende ab, die jede Seite darunter sonst selbst
 * behandeln muesste: unbekannter Verein (Nicht gefunden, ohne Leiste, damit nichts
 * verraet, was es gibt) und fehlende Verbindung. Verworfen: je Seite behandeln, das
 * waere Doppelung ohne Gewinn.
 * Waehrend der Verein noch laedt, steht der Inhalt schon da: Die Seiten holen ihre
 * Daten ohnehin selbst, und ein leerer Bildschirm bis zur ersten Antwort waere laenger.
 */
@Component({
	selector: 'jf-mitglieder-huelle',
	imports: [IconComponent, KarteComponent, NichtGefundenComponent, RouterLink, RouterOutlet, VereinsLogoComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	providers: [ThreadUebersicht],
	template: `
		@if (kontext.ladefehler()) {
			<main>
				<jf-karte>
					<p>Keine Verbindung – nochmal versuchen</p>
					<button type="button" class="knopf primaer" (click)="kontext.neuLaden()">Nochmal versuchen</button>
				</jf-karte>
			</main>
		} @else if (kontext.verein() === 'nicht-gefunden') {
			<jf-nicht-gefunden />
		} @else {
			<header class="kopf">
				@if (kontext.verein(); as v) {
					@if (v !== 'nicht-gefunden') {
						<jf-vereins-logo />
						<span class="name">{{ v.anzeigename }}</span>
					}
				}
			</header>
			<main>
				<router-outlet />
			</main>
			<nav class="leiste" aria-label="Hauptnavigation">
				@for (e of eintraege; track e.pfad) {
					<a
						[routerLink]="['/', slug(), ...(e.pfad ? [e.pfad] : [])]"
						[class.aktiv]="aktiv() === e.pfad"
						[attr.aria-current]="aktiv() === e.pfad ? 'page' : null"
					>
						<jf-icon [name]="e.icon" />
						<span>{{ e.text }}</span>
						@if (e.pfad === 'threads' && uebersicht.punkt()) {
							<span class="punkt" role="img" aria-label="neu"></span>
						}
					</a>
				}
			</nav>
		}
	`,
	styles: `
		:host {
			display: block;
			min-height: 100dvh;
			padding-top: var(--sicher-oben);
		}
		.kopf {
			position: sticky;
			top: var(--sicher-oben);
			z-index: 10;
			display: flex;
			align-items: center;
			gap: var(--a3);
			max-width: 480px;
			margin: 0 auto;
			padding: var(--a2) var(--a4);
			background: var(--seite);
			min-height: 56px;
		}
		.name {
			font-weight: 700;
		}
		main {
			max-width: 480px;
			margin: 0 auto;
			padding: var(--a2) var(--a4) calc(88px + var(--sicher-unten));
		}
		.leiste {
			position: fixed;
			z-index: 20;
			left: 0;
			right: 0;
			bottom: 0;
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			max-width: 480px;
			margin: 0 auto;
			padding-bottom: var(--sicher-unten);
			background: var(--karte);
			border-top: 1px solid var(--linie);
		}
		.leiste a {
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 2px;
			min-height: calc(var(--leiste-hoehe) - 1px);
			color: var(--text-gedaempft);
			text-decoration: none;
			font-size: 0.6875rem;
			font-weight: 600;
		}
		.leiste jf-icon {
			font-size: 1.375rem;
		}
		/* Der Ring in der Farbe der Leiste hebt den Punkt vom Icon ab, auch wenn beide die Akzentfarbe haben. */
		.punkt {
			position: absolute;
			top: 8px;
			left: calc(50% + 6px);
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background: var(--akzent);
			border: 2px solid var(--karte);
			box-sizing: content-box;
		}
		.leiste a.aktiv {
			color: var(--akzent);
		}
		@media (min-width: 520px) {
			.leiste {
				border-left: 1px solid var(--linie);
				border-right: 1px solid var(--linie);
			}
		}
	`,
})
export class MitgliederHuelle {
	protected readonly kontext = inject(VereinKontext);
	private readonly router = inject(Router);
	protected readonly eintraege = EINTRAEGE;
	protected readonly uebersicht = inject(ThreadUebersicht);

	/**
	 * Kommt aus dem Pfad (withComponentInputBinding). Verworfen: kontext.slug(), das
	 * erst mit dem Ende der Navigation gesetzt wird; die Leiste haette beim ersten Bau
	 * Links auf die Plattform statt auf den Verein.
	 */
	readonly slug = input.required<string>();

	constructor() {
		// Die Ressource haengt am Slug; ohne ihn (vor dem ersten Bau) fragt sie nichts.
		effect(() => this.uebersicht.slug.set(this.slug()));
		// Lesen und Antworten aendern "neu"; nach jeder Navigation neu zu fragen ist einfacher als
		// jede Seite zu bitten, den Punkt nachzuziehen (verworfen: Rueckmeldung der Seiten an die Huelle).
		// Eine Navigation, die nur die Parameter der Adresse aendert (die Suche der Thread-Liste, der Reiter
		// eines Threads), liest und antwortet nichts und fragt deshalb nicht: Sonst kostete jede Suche
		// eine Anfrage, deren Antwort die Seite gar nicht zeigt.
		let letzterPfad: string | undefined;
		this.router.events
			.pipe(
				filter((e): e is NavigationEnd => e instanceof NavigationEnd),
				map((e) => e.urlAfterRedirects.split(/[?#]/)[0]),
				filter((pfad) => {
					const anderer = pfad !== letzterPfad;
					letzterPfad = pfad;
					return anderer;
				}),
				takeUntilDestroyed(),
			)
			.subscribe(() => this.uebersicht.neuLaden());
	}

	private readonly url = toSignal(
		this.router.events.pipe(
			filter((e): e is NavigationEnd => e instanceof NavigationEnd),
			map((e) => e.urlAfterRedirects),
		),
		{ initialValue: this.router.url },
	);

	/** Pfad des aktiven Eintrags unterhalb des Vereins; '' ist Start. */
	protected readonly aktiv = computed(() => {
		const teile = this.url().split(/[?#]/)[0].split('/').filter(Boolean);
		const erster = teile[1] ?? '';
		return EINTRAEGE.find((e) => e.pfad === erster || e.auch.includes(erster))?.pfad ?? null;
	});
}
