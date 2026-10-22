import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { fristText, type HelferModulAnsicht } from '@jufi/domain';
import { firstValueFrom, type Observable } from 'rxjs';
import { type ApiFehler, alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { ThreadApi } from './thread-api';

/** Eine eigene Zeile der Person, die in dieser Position etwas tun darf. */
interface Aktion {
	fuerId: string;
	/** Der Vorname bei Kindern; bei der eigenen Zeile null, dort heissen die Knoepfe schlicht Eintragen und Austragen. */
	name: string | null;
	/** Ihr Eintrag in dieser Position, sonst null. */
	notiz: { text: string | null } | null;
}

interface PositionZeile {
	id: string;
	text: string;
	anzahl: number;
	belegt: number;
	voll: boolean;
	prozent: number;
	eintraege: { fuerId: string; text: string; von: string | null }[];
	aktionen: Aktion[];
}

/** Wo der Satz eines Fehlers steht: an der Position oder, wenn die Liste selbst fehlt, oben am Modul. */
interface Fehler {
	ort: string;
	text: string;
}

/** Das offene Formular: Es gehoert zu einer Position und einer Zeile; aendern heisst, die Zeile ist schon eingetragen. */
interface Formular {
	positionId: string;
	fuerId: string;
	aendern: boolean;
}

const MODUL = 'modul';

/**
 * Eine Helferliste, wie der Server sie fuer die Person ausgerechnet hat (Spec 5.2): Fuellstand,
 * Eingetragene und das Recht je eigener Zeile kommen fertig, die Karte entscheidet nichts davon
 * selbst, auch nicht, ob eine Position voll ist, wenn der Server es anders sieht. Nach einer
 * Handlung meldet sie die neue Ansicht des Servers nach oben (geaendert), wie die Umfrage.
 *
 * Eine Handlung zur Zeit, die ganze Karte gesperrt. Verworfen: je Position sperren; jede Antwort
 * bringt die ganze Liste zurueck, und ueberholten sich zwei, setzte die spaeter eintreffende eine
 * aeltere Ansicht ueber die neuere.
 *
 * Scheitert eine Handlung, weil die Liste sich geaendert hat (voll, archiviert, Frist vorbei, nicht
 * mehr da), zeigt die Karte den Satz des Servers und meldet veraltet: Die Seite laedt dann still
 * neu. Verworfen: die Ansicht aus der Fehlerantwort zu bauen; der Server schickt sie nur bei Erfolg,
 * und eine zweite Antwortform liesse die Typen auseinanderlaufen.
 */
@Component({
	selector: 'jf-helfer-modul',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2>{{ modul().titel || 'Helferliste' }}</h2>
		@if (frist(); as f) {
			<p class="frist" [class.vorbei]="fristVorbei()">{{ f }}</p>
		}
		@if (fehler(); as f) {
			@if (f.ort === MODUL) {
				<p class="fehler" role="alert">{{ f.text }}</p>
			}
		}

		@for (p of positionen(); track p.id) {
			<section class="position" [attr.aria-label]="p.text">
				<div class="kopf">
					<h3>{{ p.text }}</h3>
					<span class="fuell">
						<span>{{ p.belegt }}/{{ p.anzahl }}</span>
						@if (p.voll) {
							<span class="voll">voll</span>
						}
					</span>
				</div>
				<div
					class="balken"
					role="progressbar"
					aria-valuemin="0"
					[attr.aria-valuenow]="p.belegt"
					[attr.aria-valuemax]="p.anzahl"
					[attr.aria-label]="'Plätze für ' + p.text"
				>
					<span [style.width.%]="p.prozent"></span>
				</div>

				@if (p.eintraege.length === 0) {
					<p class="leer gedaempft klein">Noch niemand eingetragen.</p>
				} @else {
					<ul class="eintraege">
						@for (e of p.eintraege; track e.fuerId) {
							<li>
								<span class="name">{{ e.text }}</span>
								@if (e.von; as von) {
									<span class="von gedaempft klein">{{ von }}</span>
								}
							</li>
						}
					</ul>
				}

				@if (p.aktionen.length > 0) {
					<div class="aktionen">
						@for (a of p.aktionen; track a.fuerId) {
							@if (a.notiz) {
								<button type="button" class="knopf klein" [disabled]="sendet()" (click)="trageAus(p, a)">
									{{ a.name ? a.name + ' austragen' : 'Austragen' }}
								</button>
								<button
									type="button"
									class="knopf leise klein"
									[attr.aria-label]="a.name ? 'Notiz ändern für ' + a.name : null"
									[disabled]="sendet()"
									(click)="oeffne(p, a)"
								>
									Notiz ändern
								</button>
							} @else {
								<button type="button" class="knopf klein" [disabled]="sendet()" (click)="oeffne(p, a)">
									{{ a.name ? a.name + ' eintragen' : 'Eintragen' }}
								</button>
							}
						}
					</div>
				}

				@if (formular(); as f) {
					@if (f.positionId === p.id) {
						<form class="formular" (submit)="senden($event)">
							@if (formularName(); as name) {
								<p class="klein gedaempft">Für {{ name }}</p>
							}
							<label class="feld">
								<span>Notiz (optional)</span>
								<input
									name="notiz"
									maxlength="80"
									autocomplete="off"
									placeholder="z. B. Marmorkuchen"
									[value]="notiz()"
									[disabled]="sendet()"
									(input)="notiz.set(wert($event))"
								/>
							</label>
							<div class="aktionen">
								<button type="submit" class="knopf primaer klein" [disabled]="sendet()">
									{{ f.aendern ? 'Speichern' : 'Eintragen' }}
								</button>
								<button type="button" class="knopf klein" [disabled]="sendet()" (click)="schliesse()">Abbrechen</button>
							</div>
						</form>
					}
				}

				@if (fehler(); as f) {
					@if (f.ort === p.id) {
						<p class="fehler" role="alert">{{ f.text }}</p>
					}
				}
			</section>
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
		h3 {
			margin: 0;
			min-width: 0;
			font-size: var(--schrift);
			overflow-wrap: anywhere;
		}
		p {
			margin: 0;
		}
		.frist {
			font-size: var(--schrift-klein);
			color: var(--text-gedaempft);
		}
		.frist.vorbei {
			color: var(--warnung);
			font-weight: 600;
		}
		.position {
			display: grid;
			gap: var(--a2);
			min-width: 0;
			padding-top: var(--a2);
			border-top: 1px solid var(--linie);
		}
		.kopf {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: var(--a2);
		}
		.fuell {
			flex: none;
			display: inline-flex;
			align-items: baseline;
			gap: var(--a2);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		.voll {
			color: var(--warnung);
		}
		.balken {
			height: 6px;
			border-radius: var(--radius-pille);
			background: var(--linie);
			overflow: hidden;
		}
		.balken span {
			display: block;
			height: 100%;
			background: var(--akzent);
		}
		.eintraege {
			display: grid;
			gap: var(--a1);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.eintraege li {
			display: grid;
			gap: 2px;
		}
		.name,
		.von {
			overflow-wrap: anywhere;
		}
		.aktionen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a2);
		}
		.formular {
			display: grid;
			gap: var(--a2);
		}
		.formular input {
			min-width: 0;
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class HelferModul {
	readonly modul = input.required<HelferModulAnsicht>();
	readonly slug = input.required<string>();
	/**
	 * Die Vorschau des Editors: Sie hat weder Zeilen noch Eintraege, die Knoepfe fehlten ohnehin.
	 * Der Schalter haelt sie auch dann fort, wenn eine Ansicht doch Zeilen mitbraechte. Verworfen:
	 * eine erfundene Zeile in der Vorschau, deren Knoepfe die API riefen.
	 */
	readonly vorschau = input(false);
	/** Die Ansicht des Servers nach einer Handlung; die Seite setzt sie in ihren Thread ein. */
	readonly geaendert = output<HelferModulAnsicht>();
	/** Die Liste hat sich seit dem Laden geaendert; die Seite soll still neu laden. */
	readonly veraltet = output<void>();

	private readonly api = inject(ThreadApi);
	private readonly router = inject(Router);

	protected readonly MODUL = MODUL;
	protected readonly sendet = signal(false);
	protected readonly fehler = signal<Fehler | null>(null);
	protected readonly formular = signal<Formular | null>(null);
	protected readonly notiz = signal('');
	/**
	 * Der Server hat mit 410 geantwortet. Er entscheidet die Frist (Server-Uhr), nicht die Uhr des
	 * Geraets; danach bietet die Karte keine Knoepfe mehr an, die ohnehin 410 bekaemen.
	 */
	private readonly abgewiesen = signal(false);
	/** Eine Antwort, die erst nach dem Verlassen der Seite eintrifft, soll nichts mehr ausloesen. */
	private weg = false;

	constructor() {
		inject(DestroyRef).onDestroy(() => (this.weg = true));
	}

	/**
	 * Wie bei der Umfrage bestimmt die Uhr des Geraets nur die Anzeige; die Knoepfe folgen allein dem
	 * Server (darfEintragen je Zeile, 410). Verworfen: die Knoepfe nach der Geraeteuhr auszublenden,
	 * denn eine falsch gehende Uhr sperrte sonst Eintragungen, die der Server annaehme, und
	 * Jugendleiter tragen nach der Frist weiter nach.
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

	protected readonly positionen = computed<PositionZeile[]>(() => {
		const m = this.modul();
		const bedienbar = !this.vorschau() && !this.abgewiesen();
		return m.positionen.map((p) => {
			const voll = p.belegt >= p.anzahl;
			const aktionen: Aktion[] = [];
			if (bedienbar) {
				for (const z of m.zeilen) {
					if (!z.darfEintragen) continue;
					const eintrag = p.eintraege.find((e) => e.fuerId === z.fuerId);
					// Wer schon eingetragen ist, aendert auch in einer vollen Position die Notiz oder traegt sich
					// aus; nur ein neuer Eintrag braucht einen freien Platz (Review-Fokus 2).
					if (eintrag === undefined && voll) continue;
					aktionen.push({
						fuerId: z.fuerId,
						name: z.selbst ? null : z.vorname,
						notiz: eintrag === undefined ? null : { text: eintrag.notiz },
					});
				}
			}
			return {
				id: p.id,
				text: p.text,
				anzahl: p.anzahl,
				belegt: p.belegt,
				voll,
				prozent: p.anzahl > 0 ? Math.min(100, (p.belegt / p.anzahl) * 100) : 0,
				eintraege: p.eintraege.map((e) => ({
					fuerId: e.fuerId,
					text: e.notiz ? `${e.name} – ${e.notiz}` : e.name,
					von: e.eingetragenVon,
				})),
				aktionen,
			};
		});
	});

	/** Wer im offenen Formular eingetragen wird, wenn es nicht die Person selbst ist. */
	protected readonly formularName = computed(() => {
		const f = this.formular();
		if (f === null) return null;
		const z = this.modul().zeilen.find((x) => x.fuerId === f.fuerId);
		return z === undefined || z.selbst ? null : z.vorname;
	});

	protected wert(e: Event): string {
		return (e.target as HTMLInputElement).value;
	}

	protected oeffne(p: PositionZeile, a: Aktion): void {
		if (this.sendet()) return;
		this.fehler.set(null);
		this.notiz.set(a.notiz?.text ?? '');
		this.formular.set({ positionId: p.id, fuerId: a.fuerId, aendern: a.notiz !== null });
	}

	protected schliesse(): void {
		this.formular.set(null);
	}

	/**
	 * Eine clientId je Absenden: Wiederholt das Netz die Anfrage, erkennt der Server sie. Eine leere
	 * Notiz geht als null, damit sie nicht als leerer Text neben dem Namen landet; der Server
	 * schneidet ebenfalls zu und bleibt die Instanz, die ueber die Grenzen entscheidet.
	 */
	protected async senden(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const f = this.formular();
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (f === null || this.sendet()) return;
		const notiz = this.notiz().trim();
		await this.fuehreAus(f.positionId, () =>
			this.api.trageEin(this.slug(), f.positionId, f.fuerId, {
				notiz: notiz === '' ? null : notiz,
				clientId: crypto.randomUUID(),
			}),
		);
	}

	protected async trageAus(p: PositionZeile, a: Aktion): Promise<void> {
		await this.fuehreAus(p.id, () => this.api.trageAus(this.slug(), p.id, a.fuerId));
	}

	private async fuehreAus(ort: string, aufruf: () => Observable<{ modul: HelferModulAnsicht }>): Promise<void> {
		if (this.sendet()) return;
		this.sendet.set(true);
		this.fehler.set(null);
		try {
			const { modul } = await firstValueFrom(aufruf());
			if (this.weg) return;
			this.formular.set(null);
			this.geaendert.emit(modul);
		} catch (ursache) {
			if (this.weg) return;
			const f = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), f)) return;
			this.zeigeFehler(ort, f);
		} finally {
			this.sendet.set(false);
		}
	}

	/**
	 * 404 heisst, dass Liste oder Recht in der Zwischenzeit weg sind: Der Satz steht am Modul, wie bei
	 * den Dateien, denn die Position gibt es vielleicht nicht mehr. 409 (voll, archiviert) und 410
	 * (Frist) heissen, dass die Ansicht veraltet ist: Der Satz steht an der Position, und die Seite
	 * laedt neu. Alles andere (Netz, 429) laesst das Formular offen fuer einen neuen Versuch.
	 */
	private zeigeFehler(ort: string, f: ApiFehler): void {
		if (f.status === 404) {
			this.formular.set(null);
			this.fehler.set({ ort: MODUL, text: 'Das gibt es nicht mehr, oder du darfst hier nichts ändern.' });
			this.veraltet.emit();
			return;
		}
		if (f.status === 409 || f.status === 410) {
			if (f.status === 410) this.abgewiesen.set(true);
			this.formular.set(null);
			this.fehler.set({ ort, text: f.code === 'VOLL' ? 'Hier sind schon alle Plätze vergeben.' : fehlertext(f) });
			this.veraltet.emit();
			return;
		}
		this.fehler.set({ ort, text: fehlertext(f) });
	}
}
