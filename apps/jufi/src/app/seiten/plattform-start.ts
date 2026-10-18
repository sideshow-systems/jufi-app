import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { KarteComponent } from '../gestaltung/ui';

/**
 * Die Plattform zeigt keine Liste ihrer Vereine: Wer in einen Verein will, bekommt dessen
 * Einladungslink von dort. Eine Liste verriete, welche Vereine die Plattform nutzt, und
 * brauchte eine Abfrage ohne Anmeldung.
 */
@Component({
	selector: 'jf-plattform-start',
	imports: [KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-karte>
				<h1>JuFi App</h1>
				<p>
					Die JuFi App ist für die Jugendarbeit von Vereinen gedacht. Vereine bekommen ihren Zugang über diese
					Plattform; du meldest dich über den Einladungslink deines Vereins an.
				</p>
				<!-- Ein normaler Link statt routerLink: /entwurf/ gehoert dem Server, nicht dem Router. -->
				<a class="knopf leise" href="/entwurf/">Zum klickbaren Entwurf</a>
			</jf-karte>
			<nav class="rechtliches" aria-label="Rechtliches">
				<a routerLink="/impressum">Impressum</a>
				<a routerLink="/datenschutz">Datenschutz</a>
			</nav>
		</main>
	`,
	styles: `
		:host {
			display: block;
		}
		main {
			max-width: 32rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		h1 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-titel);
		}
		p {
			margin: 0 0 var(--a4);
		}
		.rechtliches {
			display: flex;
			gap: var(--a4);
			margin-top: var(--a4);
		}
		.rechtliches a {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			color: var(--text-gedaempft);
		}
	`,
})
export class PlattformStartComponent {}
