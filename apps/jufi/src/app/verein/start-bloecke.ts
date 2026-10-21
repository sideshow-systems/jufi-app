import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	Injector,
	input,
	signal,
	untracked,
} from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { fristText, type StartAnsicht, terminZeit } from '@jufi/domain';
import { fehlertext, fehlerVon } from '../gemeinsam/api-fehler';
import { AbschnittComponent, KarteComponent } from '../gestaltung/ui';
import { Echtzeit } from './echtzeit';
import { nachlader } from './threads/nachladen';
import { ThreadApi } from './threads/thread-api';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from './sitzung-abgelaufen';

/** value() wirft im Fehlerzustand; hasValue() fragt gefahrlos. */
function wertVon<T>(ressource: { hasValue: () => boolean; value: () => T }): T | undefined {
	return ressource.hasValue() ? ressource.value() : undefined;
}

/**
 * Die drei Bloecke oben auf der Startseite (Spec 6.1): was auf eine Antwort wartet, was als
 * Naechstes stattfindet und was seit dem letzten Besuch neu ist. Sie kommen aus einer Antwort
 * (GET /start, Plan-Entscheidung 13) und teilen sich darum einen Fehlerzustand; verworfen:
 * drei Ressourcen, die dieselben Threads dreimal luden. Der Server hat Sichtbarkeit, Entwuerfe,
 * Archiv, Grenzen und Reihenfolge schon angewendet, das Bauteil zeigt nur an.
 *
 * Ein leerer Block erscheint nicht, und sind alle leer, bleibt der Platz leer (kein Rahmen mit
 * "Nichts zu tun"): Die Startseite soll an einem ruhigen Tag ruhig sein. Waehrend des Ladens
 * steht ebenfalls nichts da; verworfen: ein "Wird geladen", das bei jedem Besuch kurz aufblitzte
 * und dann meist gleich wieder wegfiele.
 *
 * Neu geladen wird auf jedes Ereignis der Echtzeit, entprellt und vorgemerkt (nachlader): Jede
 * Aenderung an einem sichtbaren Thread kann einen der drei Bloecke aendern, auch Nachrichten
 * (Neu) und Antworten (Braucht deine Antwort). Verworfen: nach Arten filtern wie die Termine,
 * hier faellt keine Art sicher heraus. Waehrend des Neuladens bleibt die alte Antwort stehen.
 */
@Component({
	selector: 'jf-start-bloecke',
	imports: [AbschnittComponent, KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (fehler(); as f) {
			<jf-karte>
				<p class="fehler" role="alert">{{ fehlertext(f) }}</p>
				<button type="button" class="knopf" (click)="neuVersuchen()">Nochmal versuchen</button>
			</jf-karte>
		} @else {
			@if (punkte().length > 0) {
				<jf-abschnitt titel="Braucht deine Antwort">
					<ul>
						@for (p of punkte(); track p.schluessel) {
							<li>
								<a class="reihe" [routerLink]="['/', slug(), 't', p.segment, 'm', p.modulId]">{{ p.text }}</a>
							</li>
						}
					</ul>
				</jf-abschnitt>
			}
			@if (termine().length > 0) {
				<jf-abschnitt titel="Als Nächstes">
					<ul>
						@for (t of termine(); track t.schluessel) {
							<li>
								<a class="reihe" [routerLink]="['/', slug(), 't', t.segment, 'm', t.modulId]">
									<span class="titel">{{ t.titel }}</span>
									<span class="zusatz">{{ t.zusatz }}</span>
								</a>
							</li>
						}
					</ul>
				</jf-abschnitt>
			}
			@if (neu().length > 0) {
				<jf-abschnitt titel="Neu seit deinem letzten Besuch">
					<ul>
						@for (n of neu(); track n.threadId) {
							<li>
								<a class="reihe" [routerLink]="['/', slug(), 't', n.segment]">
									<span class="titel">{{ n.titel }}</span>
									<span class="zusatz">{{ n.angabe }}</span>
								</a>
							</li>
						}
					</ul>
				</jf-abschnitt>
			}
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a4);
		}
		/* Ohne Inhalt nimmt der Wirt sonst trotzdem eine Zeile samt Abstand im Raster der Startseite. */
		:host(:empty) {
			display: none;
		}
		p,
		ul {
			margin: 0;
		}
		jf-karte p + button {
			margin-top: var(--a3);
		}
		ul {
			display: grid;
			gap: var(--a2);
			padding: 0;
			list-style: none;
		}
		.reihe {
			display: grid;
			gap: var(--a1);
			min-height: var(--tippflaeche);
			padding: var(--a3) var(--a4);
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			color: var(--text);
			text-decoration: none;
			overflow-wrap: anywhere;
		}
		.titel {
			font-weight: 600;
		}
		.zusatz {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class StartBloeckeComponent {
	/** Kommt von der Startseite. */
	readonly slug = input.required<string>();

	private readonly api = inject(ThreadApi);
	private readonly router = inject(Router);
	protected readonly fehlertext = fehlertext;

	private readonly ressource = rxResource({
		params: () => this.slug(),
		stream: ({ params }) => this.api.start(params),
	});
	private readonly fehlerRoh = fehlerVon(this.ressource);
	private readonly nachladen = nachlader(this.ressource, inject(Injector));

	/** Gesetzt, sobald der Fehler zur Anmeldung schickt; dann zeigt das Bauteil keinen Fehlerblock mehr. */
	private readonly abgelaufen = signal(false);
	protected readonly fehler = computed(() => (this.abgelaufen() ? null : this.fehlerRoh()));

	private readonly antwort = computed<StartAnsicht | undefined>(() => wertVon(this.ressource));

	/**
	 * Die Uhrzeit liest das Bauteil einmal je Antwort, nicht bei jedem Zeichnen: "bis Do 18:00" haengt vom
	 * Tag ab, und eine Uhr im Signalgraphen liefe der Seite nur hinterher (verworfen: ein Intervall).
	 * Wer die Seite ueber Mitternacht offen laesst, sieht bis zum naechsten Laden den alten Tag.
	 */
	protected readonly punkte = computed(() => {
		const a = this.antwort();
		if (!a) return [];
		const jetzt = new Date();
		return a.brauchtAntwort.map((p) => {
			const frist = p.frist ? ` · ${fristText(new Date(p.frist), jetzt)}` : '';
			const wer = p.vorname ? `${p.vorname}: ` : '';
			return {
				// Dieselbe Umfrage kann fuer mehrere Personen offen sein; die Zeile ist je Antwortzeile eindeutig.
				schluessel: `${p.modulId}/${p.fuerId}`,
				segment: p.segment,
				modulId: p.modulId,
				text: `${wer}${p.titel} noch offen${frist}`,
			};
		});
	});

	/**
	 * Der Ort steht als Text, nicht als Karten-Link: Die ganze Zeile ist schon ein Link, und ein Link
	 * im Link ist ungueltiges Markup. Die Karte steht einen Tipp weiter im Thread (Termin-Modul).
	 */
	protected readonly termine = computed(() =>
		(this.antwort()?.alsNaechstes ?? []).map((t) => ({
			schluessel: `${t.threadId}/${t.termin.modulId}`,
			segment: t.segment,
			modulId: t.termin.modulId,
			titel: t.titel,
			zusatz: [terminZeit(t.termin), t.termin.ort].filter(Boolean).join(' · '),
		})),
	);

	protected readonly neu = computed(() => this.antwort()?.neu ?? []);

	constructor() {
		inject(Echtzeit)
			.ereignisse.pipe(takeUntilDestroyed())
			.subscribe(() => this.nachladen());

		// Der Waechter prueft die Sitzung nur beim Betreten; ein 401 danach schickt zur Anmeldung (wie die Startseite).
		effect(() => {
			const f = this.fehlerRoh();
			if (f === null || !istNichtAngemeldet(f)) return;
			untracked(() => {
				if (this.abgelaufen()) return;
				this.abgelaufen.set(true);
				void beiAbgelaufenerSitzung(this.router, this.slug(), f);
			});
		});
	}

	protected neuVersuchen(): void {
		this.ressource.reload();
	}
}
