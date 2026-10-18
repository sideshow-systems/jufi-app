import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	ElementRef,
	inject,
	input,
	type OnInit,
	signal,
	viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { type ApiFehler, alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { KarteComponent } from '../../gestaltung/ui';
import { MitgliedSitzung } from '../mitglied-waechter';
import { MitgliederApi, type Untergruppe } from '../mitglieder-api';
import { VereinKopfComponent } from '../verein-kopf';

/** Wo ein Fehler steht: beim Anlegen, beim Umbenennen oder oben bei der Liste (Laden, Loeschen). */
type Bereich = 'anlegen' | 'umbenennen' | 'liste';

/**
 * Die Untergruppen des Vereins. Lesen duerfen alle mit Rechten (Server: GET /untergruppen),
 * Anlegen, Umbenennen und Loeschen nur MITGLIEDER; die Seite blendet die Knoepfe danach aus.
 * Wer gar keine Rechte hat, sieht nur den Hinweis wie bei jeder Seite, die es fuer ihn nicht gibt.
 *
 * Nach jeder Aktion kommt die Liste frisch vom Server: Die Anzahl der Mitglieder kann sich
 * durch andere Personen geaendert haben, eine lokal nachgefuehrte Liste stimmte nicht.
 */
@Component({
	selector: 'jf-untergruppen',
	imports: [KarteComponent, RouterLink, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<jf-verein-kopf [slug]="slug()" untertitel="Untergruppen" />
		@if (!sichtbar()) {
			<jf-karte>
				<h2>Nicht gefunden oder keine Berechtigung</h2>
			</jf-karte>
		} @else if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (gruppen(); as alle) {
			<div class="stapel">
				@if (frage(); as u) {
					<jf-karte>
						<div
							#dialog
							tabindex="-1"
							class="frage"
							role="alertdialog"
							aria-label="Rückfrage"
							aria-describedby="frage-text"
						>
							<p id="frage-text">
								Untergruppe „{{ u.name }}“ wirklich löschen? Das Löschen entfernt keine Personen, sie verlieren nur
								diese Zuordnung.
							</p>
							<div class="reihe">
								<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="loesche(u)">
									Ja, löschen
								</button>
								<button type="button" class="knopf" [disabled]="laeuft()" (click)="frage.set(null)">Abbrechen</button>
							</div>
						</div>
					</jf-karte>
				}
				<jf-karte>
					<h2>Untergruppen</h2>
					@if (fehler()?.bereich === 'liste') {
						<p class="fehler" role="alert">{{ fehler()?.text }}</p>
					}
					<ul class="liste">
						@for (u of alle; track u.id) {
							<li [attr.data-gruppe]="u.id">
								@if (bearbeiteId() === u.id) {
									<form (submit)="benenneUm($event, u)">
										<label class="feld">
											Neuer Name
											<input
												type="text"
												name="umbenennen"
												maxlength="40"
												autocomplete="off"
												[value]="bearbeiteName()"
												[attr.aria-invalid]="fehler()?.bereich === 'umbenennen' ? 'true' : null"
												(input)="bearbeiteName.set(wert($event))"
											/>
										</label>
										@if (fehler()?.bereich === 'umbenennen') {
											<p class="fehler" role="alert">{{ fehler()?.text }}</p>
										}
										<div class="reihe">
											<button type="submit" class="knopf primaer" [disabled]="laeuft()">Speichern</button>
											<button type="button" class="knopf" [disabled]="laeuft()" (click)="bearbeiteId.set(null)">
												Abbrechen
											</button>
										</div>
									</form>
								} @else {
									<span class="name">{{ u.name }}</span>
									<span class="gedaempft">{{ anzahl(u) }}</span>
									@if (darfAendern()) {
										<span class="reihe">
											<button
												type="button"
												class="knopf umbenennen"
												[disabled]="laeuft()"
												(click)="beginneUmbenennen(u)"
											>
												Umbenennen
											</button>
											<button type="button" class="knopf loeschen" [disabled]="laeuft()" (click)="fragLoeschen(u)">
												Löschen
											</button>
										</span>
									}
								}
							</li>
						} @empty {
							<li class="gedaempft">Es gibt noch keine Untergruppen.</li>
						}
					</ul>
				</jf-karte>
				@if (darfAendern()) {
					<jf-karte>
						<form (submit)="lege($event)">
							<label class="feld">
								Neue Untergruppe
								<input
									type="text"
									name="neuerName"
									maxlength="40"
									autocomplete="off"
									[value]="neuerName()"
									[attr.aria-invalid]="fehler()?.bereich === 'anlegen' ? 'true' : null"
									(input)="neuerName.set(wert($event))"
								/>
							</label>
							@if (fehler()?.bereich === 'anlegen') {
								<p class="fehler" role="alert">{{ fehler()?.text }}</p>
							}
							<div class="reihe">
								<button type="submit" class="knopf primaer" [disabled]="laeuft()">Anlegen</button>
							</div>
						</form>
					</jf-karte>
				}
			</div>
		}
	`,
	styles: `
		:host {
			display: block;
			max-width: 40rem;
		}
		.stapel {
			display: grid;
			gap: var(--a4);
		}
		h2 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-gross);
		}
		.liste {
			display: grid;
			gap: var(--a3);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.liste li {
			display: grid;
			gap: var(--a2);
			overflow-wrap: anywhere;
		}
		.name {
			font-weight: 600;
		}
		form {
			display: grid;
			gap: var(--a3);
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
		.frage:focus {
			outline: none;
		}
	`,
})
export class UntergruppenComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly sitzung = inject(MitgliedSitzung);
	private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

	protected readonly gruppen = signal<Untergruppe[] | null>(null);
	protected readonly ladefehler = signal<string | null>(null);
	/** Eine Handlung zur Zeit: Zwei schnelle Klicks schickten sonst zwei Anfragen, deren Antworten sich ueberholen koennten. */
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<{ bereich: Bereich; text: string } | null>(null);
	protected readonly frage = signal<Untergruppe | null>(null);
	protected readonly neuerName = signal('');
	protected readonly bearbeiteId = signal<string | null>(null);
	protected readonly bearbeiteName = signal('');

	protected readonly sichtbar = computed(() => (this.sitzung.ich()?.person.rechte.length ?? 0) > 0);
	protected readonly darfAendern = computed(() => this.sitzung.ich()?.person.rechte.includes('MITGLIEDER') ?? false);
	protected readonly wert = wertVon;

	/** Zaehlt die Ladevorgaenge: Die Antwort eines veralteten darf die neuere Liste nicht ueberschreiben. */
	private ladeNr = 0;

	constructor() {
		// Die Rueckfrage nimmt den Fokus mit, sonst weiss eine Tastatur- oder Vorlesenutzerin nicht, dass sie aufging.
		effect(() => this.dialog()?.nativeElement.focus());
	}

	ngOnInit(): void {
		if (this.sichtbar()) void this.lade();
	}

	protected async lade(): Promise<void> {
		const nr = ++this.ladeNr;
		this.ladefehler.set(null);
		try {
			const antwort = await firstValueFrom(this.api.untergruppen(this.slug()));
			if (nr === this.ladeNr) this.gruppen.set(antwort.untergruppen);
		} catch (ursache) {
			if (nr === this.ladeNr) this.ladefehler.set(fehlertext(alsApiFehler(ursache)));
		}
	}

	protected anzahl(u: Untergruppe): string {
		return u.mitglieder === 1 ? '1 Mitglied' : `${u.mitglieder} Mitglieder`;
	}

	protected fragLoeschen(u: Untergruppe): void {
		this.fehler.set(null);
		this.frage.set(u);
	}

	protected beginneUmbenennen(u: Untergruppe): void {
		this.fehler.set(null);
		this.bearbeiteName.set(u.name);
		this.bearbeiteId.set(u.id);
	}

	protected async lege(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const name = this.neuerName().trim();
		if (!name) {
			this.fehler.set({ bereich: 'anlegen', text: 'Bitte einen Namen eingeben' });
			return;
		}
		if (await this.fuehreAus('anlegen', () => firstValueFrom(this.api.legeUntergruppeAn(this.slug(), name)))) {
			this.neuerName.set('');
		}
	}

	protected async benenneUm(ereignis: Event, u: Untergruppe): Promise<void> {
		ereignis.preventDefault();
		const name = this.bearbeiteName().trim();
		if (!name) {
			this.fehler.set({ bereich: 'umbenennen', text: 'Bitte einen Namen eingeben' });
			return;
		}
		if (
			await this.fuehreAus('umbenennen', () => firstValueFrom(this.api.benenneUntergruppeUm(this.slug(), u.id, name)))
		) {
			this.bearbeiteId.set(null);
		}
	}

	protected async loesche(u: Untergruppe): Promise<void> {
		await this.fuehreAus('liste', () => firstValueFrom(this.api.loescheUntergruppe(this.slug(), u.id)));
	}

	/**
	 * Aktion, danach Liste neu. Die Rueckfrage schliesst in jedem Fall; ein 404 laedt die Liste
	 * ebenfalls neu, weil die Gruppe dann schon weg ist und die Zeile nur noch taeuscht.
	 */
	private async fuehreAus(bereich: Bereich, aktion: () => Promise<unknown>): Promise<boolean> {
		if (this.laeuft()) return false;
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			await aktion();
			this.frage.set(null);
			await this.lade();
			return true;
		} catch (ursache) {
			this.frage.set(null);
			const f = alsApiFehler(ursache);
			// Bei 404 ist die Zeile weg, in der das Feld stand: Die Meldung gehoert dann zur Liste, sonst waere sie unsichtbar.
			this.fehler.set({ bereich: f.status === 404 ? 'liste' : bereich, text: untergruppenfehler(f) });
			if (f.status === 404) {
				this.bearbeiteId.set(null);
				await this.lade();
			}
			return false;
		} finally {
			this.laeuft.set(false);
		}
	}
}

/** Der Satz zu einem Fehler der Untergruppen; der Server meldet einen vergebenen Namen mit dem Code NAME_VERGEBEN. */
function untergruppenfehler(f: ApiFehler): string {
	if (f.code === 'NAME_VERGEBEN') return 'Eine Untergruppe mit diesem Namen gibt es schon.';
	if (f.status === 404) return 'Diese Untergruppe gibt es nicht mehr, oder du darfst hier nichts ändern.';
	return fehlertext(f);
}
