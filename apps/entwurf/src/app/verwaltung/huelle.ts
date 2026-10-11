import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { EntwurfStore } from '../daten/store';
import { IconComponent, type IconName } from '../gestaltung/icon';

interface Punkt {
	pfad: string;
	text: string;
	icon: IconName;
}

/**
 * Verwaltung am Desktop (Spec TP1 4.3): Seitenleiste links, Inhalt rechts.
 * Unter 768 px klappt die Leiste in ein Menue; benutzbar, aber mit Hinweis.
 */
@Component({
	selector: 'jf-verwaltung-huelle',
	imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<aside [class.offen]="menueOffen()">
			<div class="marke">
				<img [src]="stand().verein.logo" alt="" width="32" height="32" />
				<span>
					<strong>{{ stand().verein.name }}</strong>
					<span class="gedaempft klein">Verwaltung</span>
				</span>
				<button
					type="button"
					class="knopf leise nur-icon menue-knopf"
					[attr.aria-expanded]="menueOffen()"
					aria-controls="verwaltung-navigation"
					[attr.aria-label]="menueOffen() ? 'Menü schließen' : 'Menü öffnen'"
					(click)="menueOffen.set(!menueOffen())"
				>
					<jf-icon [name]="menueOffen() ? 'schliessen' : 'liste'" />
				</button>
			</div>
			<nav id="verwaltung-navigation" aria-label="Verwaltung">
				@for (p of punkte(); track p.pfad) {
					<a
						[routerLink]="p.pfad"
						routerLinkActive="aktiv"
						[routerLinkActiveOptions]="{ exact: p.pfad === basis() }"
						ariaCurrentWhenActive="page"
					>
						<jf-icon [name]="p.icon" /> {{ p.text }}
					</a>
				}
				<a class="zurueck" [routerLink]="'/' + stand().verein.slug"><jf-icon name="handy" /> Zur App</a>
			</nav>
		</aside>
		<main>
			<p class="hinweis"><jf-icon name="info" /> Am Desktop bequemer</p>
			<router-outlet />
		</main>
	`,
	styles: `
		:host {
			display: grid;
			grid-template-columns: 248px minmax(0, 1fr);
			min-height: 100dvh;
			padding-top: var(--band-hoehe);
		}
		aside {
			position: sticky;
			top: var(--band-hoehe);
			align-self: start;
			height: calc(100dvh - var(--band-hoehe));
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
		.marke img {
			border-radius: 8px;
		}
		.marke > span {
			display: grid;
			flex: 1;
			min-width: 0;
		}
		.menue-knopf {
			display: none;
		}
		nav {
			display: grid;
			gap: 2px;
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
		.hinweis {
			display: none;
		}
		@media (max-width: 767px) {
			:host {
				grid-template-columns: minmax(0, 1fr);
				padding-top: max(var(--band-hoehe), var(--sicher-oben));
			}
			aside {
				position: sticky;
				top: max(var(--band-hoehe), var(--sicher-oben));
				z-index: 10;
				height: auto;
				padding: var(--a2) var(--a3);
				border-right: 0;
				border-bottom: 1px solid var(--linie);
			}
			.marke {
				padding: 0;
			}
			.menue-knopf {
				display: inline-flex;
			}
			nav {
				display: none;
				padding-top: var(--a2);
			}
			aside.offen nav {
				display: grid;
			}
			main {
				padding: var(--a3) var(--a4) calc(var(--a6) + var(--sicher-unten));
			}
			.hinweis {
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
		}
	`,
})
export class VerwaltungHuelle {
	protected readonly stand = inject(EntwurfStore).stand;
	protected readonly menueOffen = signal(false);
	protected readonly basis = computed(() => `/${this.stand().verein.slug}/verwaltung`);
	protected readonly punkte = computed<Punkt[]>(() => {
		const b = this.basis();
		return [
			{ pfad: b, text: 'Übersicht', icon: 'uebersicht' },
			{ pfad: `${b}/threads`, text: 'Threads', icon: 'threads' },
			{ pfad: `${b}/termine`, text: 'Termine', icon: 'termine' },
			{ pfad: `${b}/personen`, text: 'Personen', icon: 'personen' },
			{ pfad: `${b}/untergruppen`, text: 'Untergruppen', icon: 'liste' },
			{ pfad: `${b}/rechte`, text: 'Jugendleiter & Rechte', icon: 'schild' },
			{ pfad: `${b}/dokumente`, text: 'Globale Dokumente', icon: 'ordner' },
			{ pfad: `${b}/einstellungen`, text: 'Einstellungen', icon: 'einstellungen' },
		];
	});

	constructor() {
		// Nach jedem Seitenwechsel klappt das Handy-Menue wieder zu.
		inject(Router)
			.events.pipe(
				filter((e) => e instanceof NavigationEnd),
				takeUntilDestroyed(),
			)
			.subscribe(() => this.menueOffen.set(false));
	}
}
