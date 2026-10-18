import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { IconComponent } from '../gestaltung/icon';
import { ThemaWahlComponent } from '../gestaltung/thema-wahl';
import { AbschnittComponent, KarteComponent } from '../gestaltung/ui';
import { MitgliedSitzung } from './mitglied-waechter';

/**
 * Mehr: alles, was nicht auf die Startseite gehoert. Profil, Meine Jungfischer und die
 * Verwaltung erscheinen nur, wenn die Person sie braucht; Darstellung, Rechtstexte und
 * Abmelden sind fuer alle da. Die Seite laedt nichts selbst: Was sie wissen muss, hat der
 * Waechter mit GET /ich in MitgliedSitzung gelegt. Verworfen: eine eigene Anfrage, die
 * nur dasselbe noch einmal holte und die Seite bis zur Antwort leer liesse.
 */
@Component({
	selector: 'jf-mehr',
	imports: [AbschnittComponent, IconComponent, KarteComponent, RouterLink, ThemaWahlComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Mehr</h1>

		<nav class="liste" aria-label="Mehr">
			<a class="zeile" [routerLink]="['/', slug(), 'profil']">
				<jf-icon name="nutzer" /> <span class="text">Profil</span> <jf-icon name="vor" />
			</a>
			@if (sitzung.ich()?.hatKinder) {
				<a class="zeile" [routerLink]="['/', slug(), 'meine-jungfischer']">
					<jf-icon name="personen" /> <span class="text">Meine Jungfischer</span> <jf-icon name="vor" />
				</a>
			}
			@if (hatRecht()) {
				<a class="zeile" [routerLink]="['/', slug(), 'verwaltung']">
					<jf-icon name="einstellungen" /> <span class="text">Verwaltung</span> <jf-icon name="vor" />
				</a>
			}
		</nav>

		<jf-abschnitt titel="Darstellung">
			<jf-karte>
				<jf-thema-wahl />
				<p class="hinweis">Gilt nur auf diesem Gerät.</p>
			</jf-karte>
		</jf-abschnitt>

		<nav class="liste" aria-label="Rechtliches">
			<a class="zeile" routerLink="/impressum">
				<jf-icon name="dokument" /> <span class="text">Impressum</span> <jf-icon name="vor" />
			</a>
			<a class="zeile" routerLink="/datenschutz">
				<jf-icon name="schild" /> <span class="text">Datenschutz</span> <jf-icon name="vor" />
			</a>
		</nav>

		<div class="liste">
			<button type="button" class="zeile" [disabled]="laeuft()" (click)="abmelden()">
				<jf-icon name="abmelden" /> <span class="text">Abmelden</span>
			</button>
			@if (abmeldefehler(); as meldung) {
				<p class="fehler" role="alert">{{ meldung }}</p>
			}
		</div>
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a4);
		}
		h1,
		p {
			margin: 0;
		}
		h1 {
			font-size: var(--schrift-titel);
		}
		.liste {
			display: grid;
			gap: var(--a2);
		}
		.zeile {
			display: flex;
			align-items: center;
			gap: var(--a3);
			width: 100%;
			min-height: max(52px, var(--tippflaeche));
			padding: 0 var(--a4);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			background: var(--karte);
			color: var(--text);
			font: inherit;
			font-weight: 600;
			text-align: left;
			text-decoration: none;
			cursor: pointer;
		}
		.zeile:disabled {
			opacity: 0.6;
			cursor: default;
		}
		.zeile jf-icon:first-child {
			color: var(--akzent);
		}
		.zeile jf-icon:last-child:not(:first-child) {
			margin-left: auto;
			color: var(--text-gedaempft);
		}
		.text {
			min-width: 0;
			overflow-wrap: anywhere;
		}
		jf-thema-wahl + .hinweis {
			margin-top: var(--a3);
		}
		.hinweis {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class MehrComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	protected readonly sitzung = inject(MitgliedSitzung);

	/** Jugendleiter ist, wer mindestens ein Recht hat; die Verwaltung entscheidet danach selbst, was sie zeigt. */
	protected readonly hatRecht = computed(() => (this.sitzung.ich()?.person.rechte.length ?? 0) > 0);

	protected readonly laeuft = signal(false);
	protected readonly abmeldefehler = signal<string | null>(null);

	protected async abmelden(): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.abmeldefehler.set(null);
		try {
			await this.sitzung.abmelden(this.slug());
		} catch (ursache) {
			// Bleibt die Person auf der Seite, weiss sie, dass die Sitzung noch steht: kein stilles Scheitern.
			this.abmeldefehler.set(fehlertext(alsApiFehler(ursache)));
		} finally {
			this.laeuft.set(false);
		}
	}
}
