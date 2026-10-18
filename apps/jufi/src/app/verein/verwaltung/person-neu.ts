import { ChangeDetectionStrategy, Component, inject, input, type OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { alsApiFehler, type ApiFehler } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { KarteComponent } from '../../gestaltung/ui';
import { MitgliederApi, type NeuePerson, type Untergruppe } from '../mitglieder-api';
import { VereinKopfComponent } from '../verein-kopf';
import { verwaltungsfehler } from './texte';

type Art = 'JUNGFISCHER' | 'ERWACHSENER';

/**
 * Eine Person anlegen. Ein Jungfischer braucht ein Geburtsdatum (daran haengt die
 * Volljaehrigkeit), ein Erwachsener hat keines. Gleicher Name und gleiches Datum sind nur
 * ein Hinweis (Spec 5.3): Es gibt gleichnamige Kinder, darum bietet die Warnung "Trotzdem
 * anlegen" an, statt zu sperren.
 */
@Component({
	selector: 'jf-person-neu',
	imports: [KarteComponent, RouterLink, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main>
			<jf-verein-kopf [slug]="slug()" untertitel="Person anlegen" />
			<a class="zurueck" [routerLink]="['/', slug(), 'verwaltung']">← Zur Mitgliederliste</a>
			<form (submit)="sende($event)" novalidate>
				<jf-karte>
					<div class="felder">
						<fieldset class="art">
							<legend>Art</legend>
							<label class="haken">
								<input
									type="radio"
									name="art"
									value="JUNGFISCHER"
									[checked]="art() === 'JUNGFISCHER'"
									(change)="setzeArt('JUNGFISCHER')"
								/>
								Jungfischer
							</label>
							<label class="haken">
								<input
									type="radio"
									name="art"
									value="ERWACHSENER"
									[checked]="art() === 'ERWACHSENER'"
									(change)="setzeArt('ERWACHSENER')"
								/>
								Erwachsene
							</label>
						</fieldset>
						<label class="feld">
							Vorname
							<input
								name="vorname"
								autocomplete="off"
								[value]="vorname()"
								[attr.aria-invalid]="markiert('vorname')"
								(input)="vorname.set(wert($event)); aenderung()"
							/>
						</label>
						<label class="feld">
							Nachname
							<input
								name="nachname"
								autocomplete="off"
								[value]="nachname()"
								[attr.aria-invalid]="markiert('nachname')"
								(input)="nachname.set(wert($event)); aenderung()"
							/>
						</label>
						@if (art() === 'JUNGFISCHER') {
							<label class="feld">
								Geburtsdatum
								<input
									type="date"
									name="geburtsdatum"
									[value]="geburtsdatum()"
									[attr.aria-invalid]="markiert('geburtsdatum')"
									(input)="geburtsdatum.set(wert($event)); aenderung()"
								/>
							</label>
						}
						<label class="feld">
							E-Mail (freiwillig)
							<input
								type="email"
								name="email"
								autocomplete="off"
								[value]="email()"
								[attr.aria-invalid]="markiert('email')"
								(input)="email.set(wert($event)); aenderung()"
							/>
						</label>
						@if (art() === 'JUNGFISCHER' && untergruppen().length > 0) {
							<fieldset class="art">
								<legend>Untergruppen</legend>
								@for (u of untergruppen(); track u.id) {
									<label class="haken">
										<input
											type="checkbox"
											[name]="'untergruppe-' + u.id"
											[checked]="gewaehlt().includes(u.id)"
											(change)="schalte(u.id)"
										/>
										{{ u.name }}
									</label>
								}
							</fieldset>
						}
					</div>
				</jf-karte>

				@if (doppelt(); as d) {
					<jf-karte>
						<div data-doppelt role="alert">
							<p>
								Diese Person gibt es vielleicht schon: {{ d.vorname }} {{ d.nachname }}. Gleiche Namen sind möglich,
								darum sperrt das nicht.
							</p>
							<div class="reihe">
								<a class="knopf" [routerLink]="['/', slug(), 'verwaltung', 'personen', d.id]"
									>Vorhandene Person ansehen</a
								>
								<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="lege(true)">
									Trotzdem anlegen
								</button>
							</div>
						</div>
					</jf-karte>
				}
				@if (fehler(); as f) {
					<p class="fehler" role="alert">{{ f.text }}</p>
				}
				<div class="reihe">
					<button type="submit" class="knopf primaer" [disabled]="laeuft()">Anlegen</button>
				</div>
			</form>
		</main>
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
		.zurueck {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			margin: 0 0 var(--a2);
		}
		form {
			display: grid;
			gap: var(--a4);
		}
		.felder {
			display: grid;
			gap: var(--a3);
		}
		fieldset {
			margin: 0;
			padding: 0;
			border: 0;
		}
		legend {
			padding: 0;
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		p {
			margin: 0 0 var(--a3);
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		.fehler {
			margin: 0;
			color: var(--fehler);
		}
		[aria-invalid='true'] {
			border-color: var(--fehler);
		}
	`,
})
export class PersonNeuComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly router = inject(Router);

	protected readonly art = signal<Art>('JUNGFISCHER');
	protected readonly vorname = signal('');
	protected readonly nachname = signal('');
	protected readonly geburtsdatum = signal('');
	protected readonly email = signal('');
	protected readonly gewaehlt = signal<string[]>([]);
	protected readonly untergruppen = signal<Untergruppe[]>([]);
	protected readonly doppelt = signal<ApiFehler['person'] | null>(null);
	protected readonly fehler = signal<{ text: string; feld?: string } | null>(null);
	/** Eine Handlung zur Zeit: Ein Doppelklick legte sonst die Person zweimal an. */
	protected readonly laeuft = signal(false);
	protected readonly wert = wertVon;

	ngOnInit(): void {
		// Nur Auswahl: ohne Untergruppen (oder ohne Recht) lassen sich Personen trotzdem anlegen.
		firstValueFrom(this.api.untergruppen(this.slug())).then(
			(a) => this.untergruppen.set(a.untergruppen),
			() => undefined,
		);
	}

	protected setzeArt(art: Art): void {
		this.art.set(art);
		this.aenderung();
	}

	protected schalte(id: string): void {
		this.gewaehlt.update((alt) => (alt.includes(id) ? alt.filter((x) => x !== id) : [...alt, id]));
	}

	/** Nach jeder Eingabe gilt die Warnung nicht mehr: Sie galt den alten Angaben. */
	protected aenderung(): void {
		this.doppelt.set(null);
		this.fehler.set(null);
	}

	protected markiert(feld: string): 'true' | null {
		return this.fehler()?.feld === feld ? 'true' : null;
	}

	protected sende(ereignis: Event): void {
		ereignis.preventDefault();
		void this.lege(false);
	}

	protected async lege(trotzdem: boolean): Promise<void> {
		if (this.laeuft()) return;
		const vorname = this.vorname().trim();
		const nachname = this.nachname().trim();
		const jungfischer = this.art() === 'JUNGFISCHER';
		if (!vorname) return this.fehler.set({ text: 'Bitte ausfüllen: Vorname', feld: 'vorname' });
		if (!nachname) return this.fehler.set({ text: 'Bitte ausfüllen: Nachname', feld: 'nachname' });
		if (jungfischer && !this.geburtsdatum()) {
			return this.fehler.set({ text: 'Bitte ausfüllen: Geburtsdatum', feld: 'geburtsdatum' });
		}
		const daten: NeuePerson = {
			art: this.art(),
			vorname,
			nachname,
			...(jungfischer ? { geburtsdatum: this.geburtsdatum() } : {}),
			...(this.email().trim() ? { email: this.email().trim() } : {}),
			...(jungfischer && this.gewaehlt().length > 0 ? { untergruppenIds: this.gewaehlt() } : {}),
			...(trotzdem ? { trotzdem: true } : {}),
		};
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			const { id } = await firstValueFrom(this.api.legePersonAn(this.slug(), daten));
			await this.router.navigate(['/', this.slug(), 'verwaltung', 'personen', id]);
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			if (f.code === 'DOPPELT' && f.person) {
				this.doppelt.set(f.person);
			} else {
				this.fehler.set({ text: verwaltungsfehler(f), feld: f.feld });
			}
		} finally {
			this.laeuft.set(false);
		}
	}
}
