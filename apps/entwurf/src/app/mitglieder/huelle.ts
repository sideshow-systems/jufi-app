import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { EntwurfStore } from '../daten/store';
import { IconComponent, type IconName } from '../gestaltung/icon';

interface Eintrag {
	pfad: string;
	text: string;
	icon: IconName;
	/** Weitere Pfadanfaenge, die diesen Eintrag aktiv machen (z. B. ein Thread unter "Threads"). */
	auch: string[];
}

/**
 * Huelle der Mitglieder-Ansicht (Spec TP1 4.1): Kopf, Inhalt in Handybreite,
 * untere Leiste. Am Desktop bleibt es eine mittige Spalte — Mitglieder sind
 * am Handy, der Entwurf soll dort beurteilt werden.
 */
@Component({
	selector: 'jf-mitglieder-huelle',
	imports: [RouterOutlet, RouterLink, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<header class="kopf">
			<img [src]="stand().verein.logo" alt="" width="32" height="32" />
			<span class="name">{{ stand().verein.name }}</span>
		</header>
		<main>
			<router-outlet />
		</main>
		<nav class="leiste" aria-label="Hauptnavigation">
			@for (e of eintraege(); track e.pfad) {
				<a
					[routerLink]="e.pfad"
					[class.aktiv]="aktiv() === e.pfad"
					[attr.aria-current]="aktiv() === e.pfad ? 'page' : null"
				>
					<jf-icon [name]="e.icon" />
					<span>{{ e.text }}</span>
				</a>
			}
		</nav>
	`,
	styles: `
		:host {
			display: block;
			min-height: 100dvh;
			/* Das Band des Testmodus deckt den sicheren Bereich oben selbst ab;
			   ohne Band ruecken wir um die Kerbe des iPhones. */
			padding-top: max(var(--band-hoehe), var(--sicher-oben));
		}
		.kopf {
			position: sticky;
			top: max(var(--band-hoehe), var(--sicher-oben));
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
		.kopf img {
			border-radius: 8px;
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
			grid-template-columns: repeat(5, 1fr);
			max-width: 480px;
			margin: 0 auto;
			padding-bottom: var(--sicher-unten);
			background: var(--karte);
			border-top: 1px solid var(--linie);
		}
		.leiste a {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 2px;
			min-height: 56px;
			color: var(--text-gedaempft);
			text-decoration: none;
			font-size: 0.6875rem;
			font-weight: 600;
		}
		.leiste jf-icon {
			font-size: 1.375rem;
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
	private readonly store = inject(EntwurfStore);
	private readonly router = inject(Router);
	protected readonly stand = this.store.stand;

	protected readonly eintraege = computed<Eintrag[]>(() => {
		const s = `/${this.stand().verein.slug}`;
		return [
			{ pfad: s, text: 'Start', icon: 'start', auch: [] },
			{ pfad: `${s}/threads`, text: 'Threads', icon: 'threads', auch: [`${s}/t/`] },
			{ pfad: `${s}/termine`, text: 'Termine', icon: 'termine', auch: [] },
			{ pfad: `${s}/medien`, text: 'Medien', icon: 'medien', auch: [] },
			{ pfad: `${s}/mehr`, text: 'Mehr', icon: 'mehr', auch: [`${s}/dokumente`] },
		];
	});

	private readonly url = toSignal(
		this.router.events.pipe(
			filter((e) => e instanceof NavigationEnd),
			map(() => this.router.url),
		),
		{ initialValue: this.router.url },
	);

	protected readonly aktiv = computed(() => {
		const url = this.url().split(/[?#]/)[0];
		const treffer = this.eintraege().find(
			(e) => e.pfad !== this.eintraege()[0].pfad && (url.startsWith(e.pfad) || e.auch.some((a) => url.startsWith(a))),
		);
		return treffer?.pfad ?? (url === this.eintraege()[0].pfad ? url : null);
	});
}
