import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MeldungComponent } from '../gestaltung/meldung';
import { AdminApi, alsAdminFehler, fehlertext } from './admin-api';

/** Kopfzeile und Platz fuer die Seiten der Verwaltung; Desktop-Breite (1280 x 800). */
@Component({
	selector: 'jf-admin-rahmen',
	imports: [MeldungComponent, RouterLink, RouterLinkActive, RouterOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<header>
			<div class="leiste">
				<strong class="name">JuFi Admin</strong>
				<nav aria-label="Verwaltung">
					<a routerLink="/admin/vereine" routerLinkActive="aktiv">Vereine</a>
					<a routerLink="/admin/konto" routerLinkActive="aktiv">Konto</a>
				</nav>
				@if (fehler(); as text) {
					<span class="fehler" role="alert">{{ text }}</span>
				}
				<button type="button" class="knopf klein" [disabled]="laeuft()" (click)="abmelden()">Abmelden</button>
			</div>
		</header>
		<main>
			<router-outlet />
		</main>
		<!-- Fuer die Rueckmeldung Kopiert der Einladungstexte (MeldungService). -->
		<jf-meldung />
	`,
	styles: `
		:host {
			display: block;
			min-height: 100dvh;
		}
		header {
			background: var(--karte);
			border-bottom: 1px solid var(--linie);
		}
		/* Gleiche Breite wie main, damit die Kopfzeile mit dem Inhalt fluchtet. */
		.leiste {
			display: flex;
			align-items: center;
			gap: var(--a5);
			max-width: 64rem;
			margin: 0 auto;
			padding: var(--a2) var(--a5);
		}
		.name {
			font-size: var(--schrift-gross);
		}
		nav {
			display: flex;
			gap: var(--a4);
			flex: 1;
		}
		nav a {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			color: var(--text-gedaempft);
			font-weight: 600;
			text-decoration: none;
		}
		nav a.aktiv {
			color: var(--akzent);
		}
		.fehler {
			color: var(--fehler);
			font-size: var(--schrift-klein);
		}
		main {
			max-width: 64rem;
			margin: 0 auto;
			padding: var(--a5);
		}
	`,
})
export class AdminRahmenComponent {
	private readonly api = inject(AdminApi);
	private readonly router = inject(Router);
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<string | null>(null);

	protected async abmelden(): Promise<void> {
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			await firstValueFrom(this.api.abmelden());
		} catch (ursache) {
			// Nicht zur Anmeldeseite weiterleiten: ohne Antwort ist die Sitzung womoeglich
			// noch offen, und die Person hielte sich fuer abgemeldet.
			this.fehler.set(`Abmelden fehlgeschlagen – ${fehlertext(alsAdminFehler(ursache))}`);
			return;
		} finally {
			this.laeuft.set(false);
		}
		await this.router.navigateByUrl('/admin/anmelden');
	}
}
