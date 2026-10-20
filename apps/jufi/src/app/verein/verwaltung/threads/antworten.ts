import {
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	inject,
	input,
	signal,
	untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { fristText, type UebersichtZeile, type UmfrageUebersicht } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { alsApiFehler, fehlertextNichtGefunden, fehlerVon } from '../../../gemeinsam/api-fehler';
import { KarteComponent } from '../../../gestaltung/ui';
import { beiAbgelaufenerSitzung, istNichtAngemeldet } from '../../sitzung-abgelaufen';
import { ThreadApi } from '../../threads/thread-api';
import { teilnahmeText } from '../../threads/umfrage-modul';
import { VerwaltungThreadsApi } from './threads-api';

interface Knopf {
	id: string;
	text: string;
}

interface Person {
	/** Eindeutig je Zeile und Gruppe: Bei Mehrfachauswahl steht eine Person unter mehreren Optionen. */
	schluessel: string;
	fuerId: string;
	name: string;
	eingetragenVon: string | null;
}

interface Gruppe {
	/** Die Options-Id; "offen" fuer alle ohne Antwort. */
	id: string;
	titel: string;
	personen: Person[];
}

interface UmfrageSicht {
	modulId: string;
	frage: string;
	frist: string | null;
	mehrfach: boolean;
	knoepfe: Knopf[];
	gruppen: Gruppe[];
}

/**
 * Die Antworten-Uebersicht der Verwaltung (Spec 7.1): je Umfrage, wer wie geantwortet hat, und wer
 * noch offen ist. Wer den Thread bearbeiten darf, kann hier fuer eine Person nachtragen; ob die
 * Person das darf, entscheidet der Server (darfNachtragen), die Seite rechnet keine Rechte nach.
 *
 * Nachgetragen wird ueber dieselbe Route wie die Antwort der Familie (ThreadApi.antworte): Der Server
 * erlaubt Bearbeitern jede gefragte Person auch nach der Frist, eine zweite Route gaebe es nur
 * doppelt zu pflegen. Danach laedt die Uebersicht neu, statt die Zeile selbst umzubauen: Gruppen,
 * Anzahlen, "Noch offen" und der Vermerk "eingetragen von" haengen alle an der Antwort des Servers.
 *
 * Bei Mehrfachauswahl gilt je Klick genau die angetippte Option (optionIds mit einem Eintrag) und
 * ersetzt, was vorher stand. Verworfen: Haken zum Mehrfachwaehlen auch hier; fuer ein Nachtragen
 * nach einem Telefonat genuegt die eine Option, und der Haken braeuchte einen zweiten Schritt.
 */
@Component({
	selector: 'jf-antworten-uebersicht',
	imports: [KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<a class="zurueck" [routerLink]="['/', slug(), 'verwaltung', 'threads']">Zurück zu den Threads</a>

		@if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="uebersicht.reload()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (uebersicht.hasValue()) {
			<h1>{{ uebersicht.value().titel }}</h1>
			@if (fehler(); as text) {
				<p class="fehler" role="alert">{{ text }}</p>
			}
			@for (u of umfragen(); track u.modulId) {
				<jf-karte>
					<h2>{{ u.frage }}</h2>
					@if (u.frist) {
						<p class="gedaempft klein">{{ u.frist }}</p>
					}
					@if (u.mehrfach && darfNachtragen()) {
						<p class="gedaempft klein">Mehrfachauswahl: Beim Eintragen gilt nur die gewählte Option.</p>
					}
					@for (g of u.gruppen; track g.id) {
						<section [attr.data-gruppe]="g.id">
							<h3>{{ g.titel }} ({{ g.personen.length }})</h3>
							@if (g.personen.length > 0) {
								<ul>
									@for (p of g.personen; track p.schluessel) {
										<li class="person">
											<div class="zeile">
												<span class="name">{{ p.name }}</span>
												@if (p.eingetragenVon) {
													<span class="gedaempft klein">eingetragen von {{ p.eingetragenVon }}</span>
												}
												@if (darfNachtragen()) {
													<button
														type="button"
														class="knopf leise klein"
														[attr.aria-expanded]="offeneZeile() === p.schluessel"
														(click)="klappe(p.schluessel)"
													>
														Eintragen<span class="unsichtbar"> für {{ p.name }}</span>
													</button>
												}
											</div>
											@if (offeneZeile() === p.schluessel) {
												<div class="optionen" role="group" [attr.aria-label]="'Antwort für ' + p.name">
													@for (k of u.knoepfe; track k.id) {
														<button
															type="button"
															class="knopf klein"
															[disabled]="sendet()"
															(click)="trageNach(u.modulId, p.fuerId, k.id)"
														>
															{{ k.text }}
														</button>
													}
												</div>
											}
										</li>
									}
								</ul>
							}
						</section>
					}
				</jf-karte>
			} @empty {
				<jf-karte>
					<p class="gedaempft">Dieser Thread hat keine Umfrage, deshalb gibt es hier keine Antworten.</p>
				</jf-karte>
			}
		} @else {
			<p class="gedaempft" role="status">Wird geladen …</p>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
			max-width: 48rem;
		}
		h1,
		h2,
		h3,
		p,
		ul {
			margin: 0;
		}
		h1 {
			font-size: var(--schrift-titel);
			overflow-wrap: anywhere;
		}
		h2 {
			font-size: var(--schrift-gross);
			overflow-wrap: anywhere;
		}
		h3 {
			font-size: var(--schrift);
		}
		jf-karte {
			display: grid;
			gap: var(--a3);
		}
		section {
			display: grid;
			gap: var(--a1);
		}
		ul {
			display: grid;
			padding: 0;
			list-style: none;
		}
		.zurueck {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
		}
		.zeile {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a1) var(--a3);
			min-height: var(--tippflaeche);
		}
		.name {
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.zeile .knopf {
			margin-left: auto;
		}
		.optionen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
			padding: var(--a2) 0 var(--a3);
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class ThreadAntwortenComponent {
	/** Kommen aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();
	readonly id = input.required<string>();

	private readonly api = inject(VerwaltungThreadsApi);
	private readonly threadApi = inject(ThreadApi);
	private readonly router = inject(Router);
	private weg = false;

	protected readonly uebersicht = rxResource({
		params: () => ({ slug: this.slug(), id: this.id() }),
		stream: ({ params }) => this.api.antworten(params.slug, params.id),
	});
	private readonly fehlerRoh = fehlerVon(this.uebersicht);
	/** Nach einem 401 geht es zur Anmeldung; dort waere ein Fehlertext verwirrend. */
	protected readonly ladefehler = computed(() => {
		const f = this.fehlerRoh();
		return f === null || istNichtAngemeldet(f) ? null : fehlertextNichtGefunden(f);
	});

	/** Die Zeile, deren Optionen aufgeklappt sind; hoechstens eine, ein weiteres Eintragen schliesst die vorige. */
	protected readonly offeneZeile = signal<string | null>(null);
	protected readonly sendet = signal(false);
	protected readonly fehler = signal<string | null>(null);

	protected readonly darfNachtragen = computed(
		() => this.uebersicht.hasValue() && this.uebersicht.value().darfNachtragen,
	);
	protected readonly umfragen = computed<UmfrageSicht[]>(() =>
		this.uebersicht.hasValue() ? this.uebersicht.value().umfragen.map(sicht) : [],
	);

	constructor() {
		inject(DestroyRef).onDestroy(() => (this.weg = true));
		effect(() => {
			const fehler = this.fehlerRoh();
			if (fehler) untracked(() => void beiAbgelaufenerSitzung(this.router, this.slug(), fehler));
		});
	}

	protected klappe(schluessel: string): void {
		this.fehler.set(null);
		this.offeneZeile.set(this.offeneZeile() === schluessel ? null : schluessel);
	}

	/** Eine neue clientId je Klick: Wiederholt das Netz die Anfrage, erkennt der Server sie. */
	protected async trageNach(modulId: string, fuerId: string, optionId: string): Promise<void> {
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (this.sendet()) return;
		this.sendet.set(true);
		this.fehler.set(null);
		try {
			await firstValueFrom(
				this.threadApi.antworte(this.slug(), modulId, fuerId, {
					optionIds: [optionId],
					clientId: crypto.randomUUID(),
				}),
			);
			if (this.weg) return;
			this.offeneZeile.set(null);
			this.uebersicht.reload();
		} catch (ursache) {
			if (this.weg) return;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), fehler)) return;
			// Fuer Bearbeiter gibt es kein 410: Der Server nimmt Nachtraege auch nach der Frist an.
			this.fehler.set(fehlertextNichtGefunden(fehler));
		} finally {
			this.sendet.set(false);
		}
	}
}

function sicht(u: UmfrageUebersicht): UmfrageSicht {
	const person = (gruppe: string, z: UebersichtZeile): Person => ({
		schluessel: `${u.modulId}|${gruppe}|${z.fuerId}`,
		fuerId: z.fuerId,
		name: z.name,
		eingetragenVon: z.eingetragenVon,
	});
	const gruppen: Gruppe[] = u.optionen.map((o) => ({
		id: o.id,
		titel: u.teilnahme ? teilnahmeText(o.schluessel, o.text) : o.text,
		personen: u.zeilen.filter((z) => z.optionIds.includes(o.id)).map((z) => person(o.id, z)),
	}));
	const offen = u.zeilen.filter((z) => z.optionIds.length === 0).map((z) => person('offen', z));
	if (offen.length > 0) gruppen.push({ id: 'offen', titel: 'Noch offen', personen: offen });
	return {
		modulId: u.modulId,
		frage: u.frage,
		frist: u.fristAbgelaufen ? 'Frist abgelaufen' : u.frist === null ? null : fristText(new Date(u.frist), new Date()),
		mehrfach: u.mehrfach,
		knoepfe: u.optionen.map((o) => ({ id: o.id, text: u.teilnahme ? teilnahmeText(o.schluessel, o.text) : o.text })),
		gruppen,
	};
}
