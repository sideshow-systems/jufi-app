import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { VereinApi } from '../daten/verein-api';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { ThemaService } from '../gestaltung/thema';
import { KarteComponent } from '../gestaltung/ui';
import { MitgliederApi } from '../verein/mitglieder-api';
import { MitgliedSitzung } from '../verein/mitglied-waechter';
import { NichtGefundenComponent } from './nicht-gefunden';

/** Gleich dem title in index.html; dorthin faellt der Titel zurueck, sobald kein Verein mehr gezeigt wird. */
const STANDARDTITEL = 'JuFi App';

/** Platzhalter der Vereinsseite: zeigt, dass Slug, API und Vereinsfarbe zusammenspielen. */
@Component({
	selector: 'jf-verein-start',
	imports: [KarteComponent, NichtGefundenComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (verein.error()) {
			<main>
				<jf-karte>
					<p>Keine Verbindung – nochmal versuchen</p>
					<button type="button" class="knopf primaer" (click)="verein.reload()">Nochmal versuchen</button>
				</jf-karte>
			</main>
		} @else if (verein.value(); as v) {
			@if (v === 'nicht-gefunden') {
				<jf-nicht-gefunden />
			} @else {
				<main>
					<jf-karte>
						<!-- Name allein statt im Satz: "bei den" passt zu Jungfischer Demo, nicht zu Glonntal Fischereiverein. -->
						<p class="gruss">Willkommen</p>
						<h1>{{ v.anzeigename }}</h1>
						<!-- Schlicht, bis die Huelle mit Navigation kommt (Etappe 5): Profil und Abmelden muessen schon jetzt erreichbar sein. -->
						<div class="reihe">
							@if (sitzung.ich()?.hatKinder) {
								<a class="knopf" [routerLink]="['/', slug(), 'jungfischer']">Meine Jungfischer</a>
							}
							<a class="knopf" [routerLink]="['/', slug(), 'profil']">Profil</a>
							<button type="button" class="knopf" [disabled]="laeuft()" (click)="abmelden()">Abmelden</button>
						</div>
						@if (abmeldefehler(); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
					</jf-karte>
				</main>
			}
		}
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
		h1,
		p {
			margin: 0 0 var(--a3);
		}
		h1 {
			font-size: var(--schrift-gross);
		}
		.gruss {
			margin-bottom: var(--a1);
			color: var(--text-gedaempft);
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		.fehler {
			margin: var(--a3) 0 0;
			color: var(--fehler);
		}
	`,
})
export class VereinStartComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(VereinApi);
	private readonly mitglieder = inject(MitgliederApi);
	private readonly router = inject(Router);
	protected readonly sitzung = inject(MitgliedSitzung);
	private readonly thema = inject(ThemaService);

	protected readonly laeuft = signal(false);
	protected readonly abmeldefehler = signal<string | null>(null);

	// Neuer Slug, neue Anfrage; eine noch laufende wird dabei verworfen.
	protected readonly verein = rxResource({
		params: () => this.slug(),
		stream: ({ params }) => this.api.lade(params),
	});

	constructor() {
		effect((onCleanup) => {
			// value() wirft im Fehlerzustand; hasValue() fragt gefahrlos.
			if (!this.verein.hasValue()) return;
			const v = this.verein.value();
			if (v && v !== 'nicht-gefunden') {
				this.thema.setzeVereinsfarbe(v.farbe);
				document.title = v.anzeigename;
				// Laeuft vor dem naechsten Durchlauf (neuer Slug, 404, Fehler) und beim
				// Zerstoeren der Seite. Ohne das trueg die Plattformseite oder ein
				// unbekannter Verein Titel und Farbe des vorigen Vereins.
				onCleanup(() => {
					this.thema.entferneVereinsfarbe();
					document.title = STANDARDTITEL;
				});
			}
		});
	}

	protected async abmelden(): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.abmeldefehler.set(null);
		try {
			await firstValueFrom(this.mitglieder.abmelden(this.slug()));
			this.sitzung.ich.set(null);
			await this.router.navigateByUrl(`/${encodeURIComponent(this.slug())}/anmelden`);
		} catch (ursache) {
			// Bleibt die Person auf der Seite, weiss sie, dass die Sitzung noch steht: kein stilles Scheitern.
			this.abmeldefehler.set(fehlertext(alsApiFehler(ursache)));
		} finally {
			this.laeuft.set(false);
		}
	}
}
