import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { VerwaltungThread } from '@jufi/domain';
import { fehlertextNichtGefunden, fehlerVon } from '../../../gemeinsam/api-fehler';
import { IconComponent } from '../../../gestaltung/icon';
import { KarteComponent } from '../../../gestaltung/ui';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from '../../sitzung-abgelaufen';
import { VerwaltungThreadsApi } from './threads-api';

/**
 * Die Thread-Liste der Verwaltung: alle Threads des Vereins samt Entwuerfen und Archiv, mit den
 * Wegen in Editor, Thread und Antworten. Sie ist die Verwaltungssicht und ersetzt nicht die Liste
 * der Mitglieder (Etappe 4): Entwuerfe und Archiv stehen hier, und die Zeile fuehrt in den Editor.
 *
 * Wer einen Thread nicht bearbeiten darf, sieht ihn trotzdem und gelangt mit dem Titel in die
 * normale Thread-Seite; ob die Person den Editor oeffnen darf, entscheidet der Server schon in
 * der Antwort (darfBearbeiten), die Seite rechnet keine Rechte nach. Das Archiv ist eingeklappt:
 * Es waechst mit den Jahren und wird selten gebraucht, aber es soll nicht erst gesucht werden.
 * "Angepinnt" ist kein eigener Abschnitt wie in der Mitgliederliste, sondern steht oben in "Aktiv":
 * Die Jugendleiter sollen sehen, was bei den Mitgliedern oben steht, ohne dass die Liste Abschnitte
 * bekommt, die es dort nicht gibt.
 */
@Component({
	selector: 'jf-verwaltung-threads',
	imports: [IconComponent, KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="kopf">
			<h1>Threads</h1>
			@if (liste.hasValue() && liste.value().darfErstellen) {
				<a class="knopf primaer" [routerLink]="['/', slug(), 'verwaltung', 'threads', 'neu']">Neuer Thread</a>
			}
		</div>

		@if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="liste.reload()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (liste.hasValue()) {
			@if (liste.value().threads.length === 0) {
				<p class="gedaempft">Noch keine Threads.</p>
			}
			@for (a of abschnitte(); track a.schluessel) {
				<section [attr.aria-labelledby]="'abschnitt-' + a.schluessel">
					<h2 [id]="'abschnitt-' + a.schluessel">{{ a.titel }}</h2>
					<ul>
						@for (t of a.threads; track t.id) {
							<li class="zeile" [attr.data-thread]="t.id">
								<div class="haupt">
									@if (t.angepinnt) {
										<jf-icon name="pin" class="pin" role="img" aria-label="Angepinnt" />
									}
									@if (t.darfBearbeiten) {
										<a class="titel" [routerLink]="['/', slug(), 'verwaltung', 'threads', t.id]">{{ t.titel }}</a>
									} @else {
										<a class="titel" [routerLink]="['/', slug(), 't', t.segment]">{{ t.titel }}</a>
									}
									@if (t.hatUmfrage) {
										<a class="antworten" [routerLink]="['/', slug(), 'verwaltung', 'threads', t.id, 'antworten']"
											>Antworten</a
										>
									}
								</div>
								<p class="info gedaempft klein">
									@if (t.keineZielgruppe) {
										<span class="warnung"><jf-icon name="warnung" /> Keine Zielgruppe mehr</span>
									} @else {
										<span>{{ t.zielgruppe }}</span>
									}
									@if (t.naechsterTermin) {
										<span>{{ t.naechsterTermin }}</span>
									}
								</p>
							</li>
						}
					</ul>
				</section>
			}
			@if (archiv().length > 0) {
				<button
					type="button"
					class="knopf leise archiv-knopf"
					[attr.aria-expanded]="archivOffen()"
					(click)="archivOffen.set(!archivOffen())"
				>
					{{ archivOffen() ? 'Archiv verbergen' : 'Archiv zeigen' }} ({{ archiv().length }})
				</button>
			}
		}
	`,
	styles: `
		:host {
			display: block;
			max-width: 64rem;
		}
		.kopf {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: var(--a3);
			margin: 0 0 var(--a3);
		}
		h1 {
			margin: 0;
			font-size: var(--schrift-titel);
		}
		section {
			display: grid;
			gap: var(--a2);
			margin: 0 0 var(--a4);
		}
		h2 {
			margin: var(--a2) 0 0;
			font-size: var(--schrift-klein);
			font-weight: 700;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--text-gedaempft);
		}
		ul {
			display: grid;
			gap: var(--a2);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.zeile {
			display: grid;
			gap: var(--a1);
			padding: var(--a3) var(--a4);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			background: var(--karte);
			overflow-wrap: anywhere;
		}
		.haupt {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2) var(--a3);
		}
		.pin {
			color: var(--akzent);
		}
		.titel,
		.antworten {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
		}
		.titel {
			font-weight: 600;
		}
		.antworten {
			margin-left: auto;
		}
		.info {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a1) var(--a3);
			margin: 0;
		}
		.warnung {
			display: inline-flex;
			align-items: center;
			gap: var(--a1);
			color: var(--warnung);
			font-weight: 600;
		}
		.fehler {
			margin: 0 0 var(--a3);
			color: var(--fehler);
		}
		.archiv-knopf {
			margin: 0 0 var(--a4);
		}
	`,
})
export class ThreadListeComponent {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(VerwaltungThreadsApi);
	private readonly router = inject(Router);

	protected readonly archivOffen = signal(false);

	protected readonly liste = rxResource({
		params: () => this.slug(),
		stream: ({ params }) => this.api.liste(params),
	});
	private readonly fehlerRoh = fehlerVon(this.liste);
	/** Nach einem 401 geht es zur Anmeldung; dort waere ein Fehlertext verwirrend. */
	protected readonly ladefehler = computed(() => {
		const f = this.fehlerRoh();
		return f === null || istNichtAngemeldet(f) ? null : fehlertextNichtGefunden(f);
	});

	private readonly threads = computed<VerwaltungThread[]>(() =>
		this.liste.hasValue() ? this.liste.value().threads : [],
	);
	protected readonly entwuerfe = computed(() => this.threads().filter((t) => t.entwurf));
	// Angepinnte zuerst, sonst in der Reihenfolge des Servers: Sortiert er nach letzter Aktivitaet, bleibt das erhalten.
	protected readonly aktive = computed(() => {
		const aktiv = this.threads().filter((t) => !t.entwurf && !t.archiviert);
		return [...aktiv.filter((t) => t.angepinnt), ...aktiv.filter((t) => !t.angepinnt)];
	});
	protected readonly archiv = computed(() => this.threads().filter((t) => !t.entwurf && t.archiviert));

	/** Die gezeigten Abschnitte in Reihenfolge; leere fehlen, das Archiv nur aufgeklappt. */
	protected readonly abschnitte = computed(() =>
		[
			{ schluessel: 'entwuerfe', titel: 'Entwürfe', threads: this.entwuerfe() },
			{ schluessel: 'aktiv', titel: 'Aktiv', threads: this.aktive() },
			{ schluessel: 'archiv', titel: 'Archiv', threads: this.archivOffen() ? this.archiv() : [] },
		].filter((a) => a.threads.length > 0),
	);

	constructor() {
		effect(() => {
			const fehler = this.fehlerRoh();
			if (fehler) untracked(() => void beiAbgelaufenerSitzung(this.router, this.slug(), fehler));
		});
	}
}
