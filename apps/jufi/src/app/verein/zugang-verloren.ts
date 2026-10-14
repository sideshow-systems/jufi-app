import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { wertVon } from '../gemeinsam/formular';
import { KarteComponent } from '../gestaltung/ui';
import { MitgliederApi } from './mitglieder-api';
import { VereinKopfComponent } from './verein-kopf';

/**
 * Die Antwort steht fest in der Seite und wird nicht aus der Server-Antwort gelesen:
 * Der Server antwortet bewusst immer gleich, die Seite darf daraus nichts ableiten,
 * was der Server nicht preisgibt (ob die Adresse bekannt ist).
 */
const ANTWORT = 'Falls die Adresse bekannt ist, kommt eine Mail.';

@Component({
	selector: 'jf-zugang-verloren',
	imports: [KarteComponent, RouterLink, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-verein-kopf [slug]="slug()" untertitel="Zugang verloren" />
			<jf-karte>
				<form (submit)="senden($event)">
					<label class="feld">
						E-Mail-Adresse
						<input
							type="email"
							name="email"
							autocomplete="email"
							autocapitalize="none"
							spellcheck="false"
							[value]="email()"
							(input)="email.set(wert($event))"
						/>
					</label>
					<button type="submit" class="knopf primaer" [disabled]="laeuft()">Link anfordern</button>
				</form>
				@if (gesendet()) {
					<p class="antwort" role="status">{{ antwort }}</p>
				}
				@if (fehler(); as text) {
					<p class="fehler" role="alert">{{ text }}</p>
				}
				<hr />
				<p class="jungfischer">
					Du bist Jungfischer? Frag deine Familie oder einen Jugendleiter nach einem neuen Link.
				</p>
				<a class="knopf leise" [routerLink]="['/', slug(), 'anmelden']">Zurueck zur Anmeldung</a>
			</jf-karte>
		</main>
	`,
	styles: `
		:host {
			display: block;
		}
		main {
			max-width: 24rem;
			margin: 0 auto;
			padding: var(--a5) var(--a4);
		}
		form {
			display: grid;
			gap: var(--a3);
		}
		hr {
			border: 0;
			border-top: 1px solid var(--linie);
			margin: var(--a4) 0;
		}
		jf-karte .knopf {
			width: 100%;
		}
		.antwort,
		.fehler {
			margin: var(--a3) 0 0;
		}
		.fehler {
			color: var(--fehler);
		}
		.jungfischer {
			margin: 0 0 var(--a3);
			color: var(--text-gedaempft);
		}
	`,
})
export class ZugangVerlorenComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);

	protected readonly antwort = ANTWORT;
	protected readonly email = signal('');
	protected readonly laeuft = signal(false);
	protected readonly gesendet = signal(false);
	protected readonly fehler = signal<string | null>(null);

	protected readonly wert = wertVon;

	protected async senden(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const adresse = this.email().trim();
		if (this.laeuft() || adresse === '') return;
		this.laeuft.set(true);
		this.fehler.set(null);
		this.gesendet.set(false);
		try {
			await firstValueFrom(this.api.zugangVerloren(this.slug(), adresse));
			this.gesendet.set(true);
		} catch (ursache) {
			this.fehler.set(fehlertext(alsApiFehler(ursache)));
		} finally {
			this.laeuft.set(false);
		}
	}
}
