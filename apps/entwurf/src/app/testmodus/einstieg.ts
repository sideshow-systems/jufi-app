import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import { TM_STIL } from './stil';
import { TestmodusService } from './testmodus';
import type { PersonKey } from './typen';

interface Karte {
	key: PersonKey;
	name: string;
	satz: string;
}

/**
 * Einstieg (Spec TP1 5.1): erklaeren, dass nichts echt ist, eine Person
 * waehlen, mit oder ohne Aufgaben starten. Die Testperson bekommt nur den
 * Link, also muss diese Seite ohne weitere Erklaerung tragen.
 */
@Component({
	selector: 'jf-einstieg',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<img [src]="logo()" alt="" width="56" height="56" />
			<h1>Willkommen zum Entwurf der JuFi App</h1>
			<p>
				Das ist ein klickbarer Entwurf. Nichts hier ist echt: alle Namen sind erfunden, und du kannst nichts kaputt
				machen. Was du einträgst, bleibt nur in deinem Browser.
			</p>

			<fieldset>
				<legend>Wer bist du heute?</legend>
				@for (k of karten; track k.key) {
					<label class="karte" [class.gewaehlt]="wahl() === k.key">
						<input type="radio" name="person" [value]="k.key" [checked]="wahl() === k.key" (change)="wahl.set(k.key)" />
						<span>
							<strong>{{ k.name }}</strong>
							<span class="satz">{{ k.satz }}</span>
						</span>
					</label>
				}
			</fieldset>

			<fieldset class="art">
				<legend>Wie möchtest du starten?</legend>
				<label [class.gewaehlt]="mitAufgaben()">
					<input type="radio" name="art" [checked]="mitAufgaben()" (change)="mitAufgaben.set(true)" />
					Mit Aufgaben
				</label>
				<label [class.gewaehlt]="!mitAufgaben()">
					<input type="radio" name="art" [checked]="!mitAufgaben()" (change)="mitAufgaben.set(false)" />
					Frei umsehen
				</label>
			</fieldset>

			<button type="button" class="tm-knopf los" [disabled]="!wahl()" (click)="los()">Los geht's</button>
			<p class="klein gedaempft">Über den violetten Knopf unten links kannst du jederzeit die Person wechseln.</p>
		</main>
	`,
	styles: [
		TM_STIL,
		`
			main {
				display: grid;
				gap: var(--a4);
				max-width: 480px;
				margin: 0 auto;
				padding: calc(var(--sicher-oben) + var(--a6)) calc(var(--a4) + var(--sicher-rechts))
					calc(var(--sicher-unten) + var(--a6)) calc(var(--a4) + var(--sicher-links));
			}
			img {
				border-radius: 14px;
			}
			h1 {
				margin: 0;
				font-size: var(--schrift-titel);
			}
			p {
				margin: 0;
			}
			fieldset {
				display: grid;
				gap: var(--a2);
				margin: 0;
				padding: 0;
				border: 0;
			}
			legend {
				margin-bottom: var(--a2);
				font-weight: 700;
			}
			.karte,
			.art label {
				display: flex;
				align-items: center;
				gap: var(--a3);
				min-height: var(--tippflaeche);
				padding: var(--a3) var(--a4);
				border: 2px solid var(--linie);
				border-radius: var(--radius);
				background: var(--karte);
				cursor: pointer;
			}
			.karte > span {
				display: grid;
			}
			.satz {
				color: var(--text-gedaempft);
				font-size: var(--schrift-klein);
			}
			.gewaehlt {
				border-color: var(--tm) !important;
			}
			input {
				width: 20px;
				height: 20px;
				flex: none;
				accent-color: var(--tm);
			}
			.art {
				grid-template-columns: 1fr 1fr;
			}
			.art legend {
				grid-column: 1 / -1;
			}
			.los {
				width: 100%;
			}
			.los:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}
		`,
	],
})
export class Einstieg {
	private readonly store = inject(EntwurfStore);
	private readonly testmodus = inject(TestmodusService);
	private readonly router = inject(Router);

	protected readonly karten: Karte[] = [
		{
			key: 'sandra',
			name: 'Sandra',
			satz: 'Mutter von Lena (13) und Max (10). Kümmert sich um Anmeldungen und Fahrten.',
		},
		{ key: 'lena', name: 'Lena', satz: 'Jungfischerin, 13 Jahre, mit eigenem Zugang zur App.' },
		{ key: 'thomas', name: 'Thomas', satz: 'Jugendleiter. Legt Termine und Umfragen an und behält den Überblick.' },
	];
	protected readonly logo = computed(() => this.store.stand().verein.logo);
	protected readonly wahl = signal<PersonKey | null>(this.testmodus.zustand().person);
	protected readonly mitAufgaben = signal(this.testmodus.zustand().mitAufgaben);

	protected los(): void {
		const k = this.wahl();
		if (!k) return;
		this.testmodus.waehlePerson(k, this.mitAufgaben());
		const slug = this.store.stand().verein.slug;
		void this.router.navigateByUrl(k === 'thomas' ? `/${slug}/verwaltung` : `/${slug}`);
	}
}
