import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { KarteComponent } from '../gestaltung/ui';
import { MitgliederApi } from './mitglieder-api';
import { MitgliedSitzung } from './mitglied-waechter';
import { VereinKontext } from './verein-kontext';

/** Platzhalter der Vereinsseite: zeigt, dass Slug, API und Vereinsfarbe zusammenspielen. */
@Component({
	selector: 'jf-start',
	imports: [KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (name(); as n) {
			<jf-karte>
				<!-- Name allein statt im Satz: "bei den" passt zu Jungfischer Demo, nicht zu Glonntal Fischereiverein. -->
				<p class="gruss">Willkommen</p>
				<h1>{{ n }}</h1>
				<!-- Schlicht, bis Start und Mehr ihre endgueltige Form haben: Profil und Abmelden muessen schon jetzt erreichbar sein. -->
				<div class="reihe">
					@if (zeigeVerwaltung()) {
						<a class="knopf" [routerLink]="['/', slug(), 'verwaltung']">Verwaltung</a>
					}
					@if (sitzung.ich()?.hatKinder) {
						<a class="knopf" [routerLink]="['/', slug(), 'meine-jungfischer']">Meine Jungfischer</a>
					}
					<a class="knopf" [routerLink]="['/', slug(), 'profil']">Profil</a>
					<button type="button" class="knopf" [disabled]="laeuft()" (click)="abmelden()">Abmelden</button>
				</div>
				@if (abmeldefehler(); as text) {
					<p class="fehler" role="alert">{{ text }}</p>
				}
			</jf-karte>
		}
	`,
	styles: `
		:host {
			display: block;
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
export class StartComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly kontext = inject(VereinKontext);
	/** Leer, solange der Verein laedt; Ladefehler und unbekannten Verein faengt die Huelle ab. */
	protected readonly name = computed(() => {
		const v = this.kontext.verein();
		return v && v !== 'nicht-gefunden' ? v.anzeigename : null;
	});
	private readonly mitglieder = inject(MitgliederApi);
	private readonly router = inject(Router);
	protected readonly sitzung = inject(MitgliedSitzung);

	/**
	 * Jedes Recht macht die Liste lesbar (Jugendleiter sind, wer irgendein Recht hat); wer keines hat,
	 * bekaeme vom Server nur die eigene Familie und die Ansprechpartner. Der Server entscheidet trotzdem.
	 */
	protected readonly zeigeVerwaltung = computed(() => (this.sitzung.ich()?.person.rechte?.length ?? 0) > 0);

	protected readonly laeuft = signal(false);
	protected readonly abmeldefehler = signal<string | null>(null);

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
