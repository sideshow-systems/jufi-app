import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { type AuswertungsName, fristText, TEILNAHME_OPTIONEN, type UmfrageAnsicht } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { alsApiFehler, fehlertextNichtGefunden } from '../../gemeinsam/api-fehler';
import { PilleComponent } from '../../gestaltung/ui';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { ThreadApi } from './thread-api';

type PillenArt = 'ok' | 'offen' | 'neutral';

/**
 * Zeichen und Pillenfarbe der Teilnahme-Optionen (Spec 6.3: "✓ Dabei", "? Vielleicht", "✗ Abgesagt").
 * Exportiert fuer die Antworten-Uebersicht der Verwaltung: Dieselbe Option soll dort dasselbe
 * Zeichen tragen wie in der Sicht der Familie; eine Kopie liefe beim naechsten Zeichen auseinander.
 */
export const TEILNAHME_ZEICHEN: Record<string, { zeichen: string; art: PillenArt }> = {
	dabei: { zeichen: '✓', art: 'ok' },
	vielleicht: { zeichen: '?', art: 'neutral' },
	abgesagt: { zeichen: '✗', art: 'offen' },
};

interface Knopf {
	id: string;
	text: string;
}

interface Zeile {
	fuerId: string;
	name: string;
	optionIds: string[];
	antwort: { text: string; art: PillenArt } | null;
	eingetragenVon: string | null;
	bedienbar: boolean;
}

interface ErgebnisZeile {
	schluessel: string;
	text: string;
	anzahl: number;
	namen: string | null;
}

/**
 * Eine Umfrage, wie der Server sie fuer die Person ausgerechnet hat (Spec 6.3): Antwortrecht,
 * Zeilen und Ergebnis kommen fertig, die Karte entscheidet nichts davon selbst. Nach einer Antwort
 * meldet sie die neue Ansicht des Servers nach oben, statt sich selbst zu aendern; so sehen Seite
 * und Gelesen-Stand dieselbe Umfrage.
 *
 * Waehrend eine Antwort unterwegs ist, ist die ganze Karte gesperrt, nicht nur die Zeile.
 * Verworfen: je Zeile sperren. Jede Antwort bringt die ganze Umfrage zurueck; ueberholten sich
 * zwei Antworten, setzte die spaeter eintreffende eine aeltere Ansicht ueber die neuere.
 */
@Component({
	selector: 'jf-umfrage-modul',
	imports: [PilleComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (modul().titel; as titel) {
			<h2>{{ titel }}</h2>
			<p class="frage">{{ modul().frage }}</p>
		} @else {
			<h2>{{ modul().frage }}</h2>
		}
		@if (frist(); as f) {
			<p class="frist" [class.vorbei]="fristVorbei()">{{ f }}</p>
		}
		@if (vorschau()) {
			<span class="optionen" role="group" aria-label="Antworten">
				@for (k of knoepfe(); track k.id) {
					<button type="button" class="knopf klein" disabled>{{ k.text }}</button>
				}
			</span>
		}

		@for (z of zeilen(); track z.fuerId) {
			<div class="zeile">
				<div class="oben">
					<span class="name">{{ z.name }}</span>
					@if (z.antwort && aendert() !== z.fuerId) {
						<span class="antwort">
							<jf-pille [art]="z.antwort.art">{{ z.antwort.text }}</jf-pille>
							@if (z.bedienbar) {
								<button
									type="button"
									class="knopf leise klein"
									[attr.aria-label]="'Antwort für ' + z.name + ' ändern'"
									[disabled]="sendet()"
									(click)="aendern(z)"
								>
									ändern
								</button>
							}
						</span>
					} @else if (z.bedienbar) {
						@if (modul().mehrfach) {
							<fieldset class="wahl">
								<legend class="unsichtbar">Antwort für {{ z.name }}</legend>
								@for (k of knoepfe(); track k.id) {
									<label class="haken">
										<input
											type="checkbox"
											[checked]="gewaehlt(z.fuerId, k.id)"
											[disabled]="sendet()"
											(change)="umschalten(z.fuerId, k.id)"
										/>
										{{ k.text }}
									</label>
								}
								<button
									type="button"
									class="knopf primaer klein"
									[disabled]="sendet() || auswahlVon(z.fuerId).length === 0"
									(click)="antworte(z.fuerId, auswahlVon(z.fuerId))"
								>
									Antworten
								</button>
							</fieldset>
						} @else {
							<span class="optionen" role="group" [attr.aria-label]="'Antwort für ' + z.name">
								@for (k of knoepfe(); track k.id) {
									<button
										type="button"
										class="knopf klein"
										[class.primaer]="z.optionIds.includes(k.id)"
										[attr.aria-pressed]="z.antwort ? z.optionIds.includes(k.id) : null"
										[disabled]="sendet()"
										(click)="antworte(z.fuerId, [k.id])"
									>
										{{ k.text }}
									</button>
								}
							</span>
						}
					} @else {
						<span class="gedaempft klein">keine Antwort</span>
					}
				</div>
				@if (z.eingetragenVon; as von) {
					<p class="von gedaempft klein">{{ von }}</p>
				}
			</div>
		}

		@if (fehler(); as f) {
			<p class="fehler" role="alert">{{ f }}</p>
		}

		@if (ergebnis(); as e) {
			<ul class="ergebnis" aria-label="Ergebnis">
				@for (o of e; track o.schluessel) {
					<li>
						<strong>{{ o.text }} ({{ o.anzahl }})</strong>
						@if (o.namen) {
							<span class="gedaempft">{{ o.namen }}</span>
						}
					</li>
				}
			</ul>
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a2);
		}
		h2 {
			margin: 0;
			font-size: var(--schrift);
			overflow-wrap: anywhere;
		}
		p {
			margin: 0;
		}
		.frage {
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.frist {
			font-size: var(--schrift-klein);
			color: var(--text-gedaempft);
		}
		.frist.vorbei {
			color: var(--warnung);
			font-weight: 600;
		}
		.zeile {
			display: grid;
			gap: 2px;
			padding-top: var(--a2);
			border-top: 1px solid var(--linie);
		}
		.oben {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: var(--a2);
		}
		.name {
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		.antwort,
		.optionen {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		.wahl {
			display: grid;
			justify-items: start;
			gap: 0;
			width: 100%;
			margin: 0;
			padding: 0;
			border: 0;
			min-width: 0;
		}
		.wahl .knopf {
			margin-top: var(--a1);
		}
		.fehler {
			color: var(--fehler);
		}
		.ergebnis {
			display: grid;
			gap: var(--a1);
			margin: 0;
			padding: var(--a2) 0 0;
			border-top: 1px solid var(--linie);
			list-style: none;
			font-size: var(--schrift-klein);
		}
		.ergebnis li {
			display: flex;
			flex-wrap: wrap;
			gap: 0 var(--a2);
		}
	`,
})
export class UmfrageModul {
	readonly modul = input.required<UmfrageAnsicht>();
	readonly slug = input.required<string>();
	/**
	 * Die Vorschau des Editors: Sie hat keine Zeilen, also auch keine Knoepfe zum Antworten, und
	 * zeigte ohne diesen Schalter nur die Frage. Die Antworten erscheinen deshalb einmal als gesperrte
	 * Knoepfe, so wie die Mitglieder sie sehen werden. Verworfen: eine erfundene Zeile "Du" in der
	 * Vorschau, deren Knoepfe die API riefen.
	 */
	readonly vorschau = input(false);
	/** Die Ansicht des Servers nach einer Antwort; die Seite setzt sie in ihren Thread ein. */
	readonly geaendert = output<UmfrageAnsicht>();

	private readonly api = inject(ThreadApi);
	private readonly router = inject(Router);

	protected readonly sendet = signal(false);
	protected readonly fehler = signal<string | null>(null);
	/** Die Zeile, deren Antwort gerade geaendert wird. */
	protected readonly aendert = signal<string | null>(null);
	/** Die vorlaeufigen Haken bei Mehrfachauswahl, je Zeile. */
	private readonly auswahl = signal<Readonly<Record<string, readonly string[]>>>({});
	/**
	 * Der Server hat mit 410 geantwortet. Er entscheidet die Frist (Spec 2.2, Server-Uhr), nicht
	 * die Uhr des Geraets; danach bietet die Karte keine Knoepfe mehr an, die ohnehin 410 bekaemen.
	 */
	private readonly abgewiesen = signal(false);
	/** Eine Antwort, die erst nach dem Verlassen der Seite eintrifft, soll nichts mehr ausloesen. */
	private weg = false;

	constructor() {
		inject(DestroyRef).onDestroy(() => (this.weg = true));
	}

	/**
	 * Die Uhr des Geraets bestimmt nur die Anzeige ("bis Do 18:00" oder "Frist abgelaufen"); die
	 * Knoepfe folgen allein dem Server (darfAntworten, 410). Verworfen: die Knoepfe nach der
	 * Geraeteuhr ausblenden, denn eine falsch gehende Uhr sperrte sonst Antworten, die der Server
	 * annaehme, und Jugendleiter tragen nach der Frist weiter nach. Gerechnet wird mit jeder neuen
	 * Ansicht, nicht laufend; laeuft die Frist bei offener Seite ab, sagt es die naechste Antwort (410).
	 */
	protected readonly fristVorbei = computed(() => {
		const m = this.modul();
		return this.abgewiesen() || m.fristAbgelaufen || (m.frist !== null && Date.now() >= Date.parse(m.frist));
	});

	protected readonly frist = computed(() => {
		const m = this.modul();
		if (this.fristVorbei()) return 'Frist abgelaufen';
		return m.frist === null ? null : fristText(new Date(m.frist), new Date());
	});

	protected readonly knoepfe = computed<Knopf[]>(() => {
		const m = this.modul();
		return m.optionen.map((o) => ({ id: o.id, text: m.teilnahme ? teilnahmeText(o.schluessel, o.text) : o.text }));
	});

	protected readonly zeilen = computed<Zeile[]>(() => {
		const m = this.modul();
		const abgewiesen = this.abgewiesen();
		return m.zeilen.map((z) => ({
			fuerId: z.fuerId,
			name: z.selbst ? 'Du' : z.vorname,
			optionIds: z.optionIds,
			antwort: antwortPille(m, z.optionIds),
			eingetragenVon: z.eingetragenVon,
			// Nach der Frist bleiben die Knoepfe, wo der Server Nachtragen erlaubt (Jugendleiter, Spec 3.3).
			bedienbar: z.darfAntworten && !abgewiesen,
		}));
	});

	protected readonly ergebnis = computed<ErgebnisZeile[] | null>(() => {
		const m = this.modul();
		const e = m.ergebnis;
		if (e === null) return null;
		const texte = new Map(m.optionen.map((o) => [o.id, o.text]));
		return [
			...e.optionen.map((o) => ({
				schluessel: o.optionId,
				text: texte.get(o.optionId) ?? '',
				anzahl: o.anzahl,
				namen: namenListe(o.namen),
			})),
			{ schluessel: '', text: 'Offen', anzahl: e.offen.anzahl, namen: namenListe(e.offen.namen) },
		];
	});

	protected auswahlVon(fuerId: string): readonly string[] {
		return this.auswahl()[fuerId] ?? [];
	}

	protected gewaehlt(fuerId: string, optionId: string): boolean {
		return this.auswahlVon(fuerId).includes(optionId);
	}

	protected umschalten(fuerId: string, optionId: string): void {
		this.auswahl.update((alle) => {
			const bisher = alle[fuerId] ?? [];
			const neu = bisher.includes(optionId) ? bisher.filter((o) => o !== optionId) : [...bisher, optionId];
			return { ...alle, [fuerId]: neu };
		});
	}

	protected aendern(z: Zeile): void {
		this.auswahl.update((alle) => ({ ...alle, [z.fuerId]: [...z.optionIds] }));
		this.aendert.set(z.fuerId);
	}

	/**
	 * Eine clientId je Tipp: Wiederholt das Netz die Anfrage, erkennt der Server sie (Entscheidung 2).
	 * Die Optionen gehen in der Reihenfolge der Umfrage, nicht der Klicks, damit dieselbe Auswahl
	 * dieselbe Anfrage ist.
	 */
	protected async antworte(fuerId: string, optionIds: readonly string[]): Promise<void> {
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (this.sendet() || optionIds.length === 0) return;
		const m = this.modul();
		const reihenfolge = m.optionen.map((o) => o.id).filter((id) => optionIds.includes(id));
		this.sendet.set(true);
		this.fehler.set(null);
		try {
			const { modul } = await firstValueFrom(
				this.api.antworte(this.slug(), m.id, fuerId, { optionIds: reihenfolge, clientId: crypto.randomUUID() }),
			);
			if (this.weg) return;
			this.aendert.set(null);
			this.auswahl.update((alle) => {
				const rest = { ...alle };
				delete rest[fuerId];
				return rest;
			});
			this.geaendert.emit(modul);
		} catch (ursache) {
			if (this.weg) return;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), fehler)) return;
			if (fehler.status === 410) {
				this.abgewiesen.set(true);
				this.aendert.set(null);
				return;
			}
			this.fehler.set(fehlertextNichtGefunden(fehler));
		} finally {
			this.sendet.set(false);
		}
	}
}

/** Siehe TEILNAHME_ZEICHEN: ebenfalls fuer die Antworten-Uebersicht, damit der Text der Knoepfe derselbe ist. */
export function teilnahmeText(schluessel: string, text: string): string {
	const zeichen = TEILNAHME_ZEICHEN[schluessel]?.zeichen;
	const fest = TEILNAHME_OPTIONEN.find((o) => o.schluessel === schluessel)?.text ?? text;
	return zeichen ? `${zeichen} ${fest}` : text;
}

/** Die Pille einer gegebenen Antwort; ohne gewaehlte Option gilt die Zeile als unbeantwortet (wie in der Auswertung). */
function antwortPille(m: UmfrageAnsicht, optionIds: readonly string[]): Zeile['antwort'] {
	const gewaehlt = m.optionen.filter((o) => optionIds.includes(o.id));
	if (gewaehlt.length === 0) return null;
	if (m.teilnahme) {
		const o = gewaehlt[0]!;
		return { text: teilnahmeText(o.schluessel, o.text), art: TEILNAHME_ZEICHEN[o.schluessel]?.art ?? 'neutral' };
	}
	return { text: gewaehlt.map((o) => o.text).join(', '), art: 'ok' };
}

/** Den Vermerk "eingetragen von" schickt der Server nur Jugendleitern (Spec 3.4). */
function namenListe(namen: readonly AuswertungsName[] | null): string | null {
	if (namen === null || namen.length === 0) return null;
	return namen.map((n) => (n.eingetragenVon ? `${n.name} (eingetragen von ${n.eingetragenVon})` : n.name)).join(', ');
}
