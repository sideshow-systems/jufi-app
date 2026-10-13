import { ChangeDetectionStrategy, Component } from '@angular/core';
import { KarteComponent } from '../gestaltung/ui';

/** Platzhalter bis Etappe 5; die Plattform hat bis dahin keine eigene Startseite. */
@Component({
	selector: 'jf-plattform-start',
	imports: [KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-karte>
				<h1>JuFi App</h1>
				<p>Die Jugendarbeit deines Vereins an einem Ort. Diese Seite ist noch im Aufbau.</p>
				<!-- Ein normaler Link statt routerLink: /entwurf/ gehoert dem Server, nicht dem Router. -->
				<a href="/entwurf/">Zum klickbaren Entwurf</a>
			</jf-karte>
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
	`,
})
export class PlattformStartComponent {}
