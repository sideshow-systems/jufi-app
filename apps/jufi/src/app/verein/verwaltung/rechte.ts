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
import { ALLE_RECHTE, RECHTE_VORLAGEN, type RechtName } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { type ApiFehler, alsApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { KarteComponent, PilleComponent } from '../../gestaltung/ui';
import { MitgliedSitzung } from '../mitglied-waechter';
import { MitgliederApi, type PersonListe } from '../mitglieder-api';
import { VereinKopfComponent } from '../verein-kopf';
import { RECHT_TEXT } from './texte';

type Vorlage = keyof typeof RECHTE_VORLAGEN;

const VORLAGEN: { schluessel: Vorlage; name: string }[] = [
	{ schluessel: 'LEITUNG', name: 'Leitung' },
	{ schluessel: 'JUGENDLEITER', name: 'Jugendleiter' },
	{ schluessel: 'BETREUER', name: 'Betreuer' },
];

/** Wessen Rechte gerade bearbeitet werden; name steht in der Ueberschrift und in der Rueckfrage. */
interface Bearbeitung {
	id: string;
	name: string;
	/** Hatte die Person vorher keine Rechte? Dann ist ein leerer Entwurf kein Entzug, sondern nichts zu speichern. */
	neu: boolean;
}

/**
 * Die Rechte der Erwachsenen. Nur mit JUGENDLEITER_RECHTE: Der Server antwortet allen anderen
 * mit 404, damit niemand erfaehrt, wer Rechte hat; die Seite zeigt ihnen gleich den Hinweis.
 *
 * Die Vorlagen (Leitung, Jugendleiter, Betreuer) belegen nur die Haekchen vor, gespeichert werden
 * stets die einzelnen Rechte (Domain: RECHTE_VORLAGEN). Eine Rolle, die man waehlt und die
 * danach Haekchen sperrt, wurde verworfen: Jede Abweichung braeuchte einen neuen Rollentyp.
 */
@Component({
	selector: 'jf-rechte',
	imports: [KarteComponent, PilleComponent, RouterLink, VereinKopfComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<jf-verein-kopf [slug]="slug()" untertitel="Rechte" />
		@if (!sichtbar()) {
			<jf-karte>
				<h2>Nicht gefunden oder keine Berechtigung</h2>
			</jf-karte>
		} @else if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (personen()) {
			<div class="stapel">
				@if (frage() && bearbeitung(); as b) {
					<jf-karte>
						<div
							#dialog
							tabindex="-1"
							class="frage"
							role="alertdialog"
							aria-label="Rückfrage"
							aria-describedby="frage-text"
						>
							<p id="frage-text">{{ frageText() }}</p>
							<div class="reihe">
								<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="sende(b)">
									Ja, Rechte ändern
								</button>
								<button type="button" class="knopf" [disabled]="laeuft()" (click)="frage.set(false)">Abbrechen</button>
							</div>
						</div>
					</jf-karte>
				}

				@if (bearbeitung(); as b) {
					<jf-karte>
						<form
							#editor
							tabindex="-1"
							class="editor"
							[attr.aria-label]="'Rechte von ' + b.name"
							(submit)="speichere($event, b)"
						>
							<h2>Rechte von {{ b.name }}</h2>
							<div class="reihe" role="group" aria-label="Vorlage">
								@for (v of vorlagen; track v.schluessel) {
									<button type="button" class="knopf" [disabled]="laeuft()" (click)="nimmVorlage(v.schluessel)">
										{{ v.name }}
									</button>
								}
							</div>
							<p class="gedaempft klein">
								Die Vorlagen füllen nur die Häkchen vor. Gespeichert werden die einzelnen Rechte.
							</p>
							<fieldset [attr.aria-describedby]="fehler() ? 'rechte-fehler' : null">
								<legend class="unsichtbar">Einzelne Rechte</legend>
								@for (r of alleRechte; track r) {
									<label class="haken">
										<input
											type="checkbox"
											[name]="'recht-' + r"
											[checked]="entwurf().includes(r)"
											(change)="schalte(r)"
										/>
										<span>
											{{ rechtText[r].name }}
											<span class="gedaempft klein hinweis">{{ rechtText[r].beschreibung }}</span>
										</span>
									</label>
								}
							</fieldset>
							@if (b.neu && entwurf().length === 0) {
								<p class="gedaempft klein" role="status">Bitte mindestens ein Recht wählen.</p>
							}
							@if (fehler(); as text) {
								<p id="rechte-fehler" class="fehler" role="alert">{{ text }}</p>
							}
							<div class="reihe">
								<button type="submit" class="knopf primaer" [disabled]="laeuft() || (b.neu && entwurf().length === 0)">
									Rechte speichern
								</button>
								<button type="button" class="knopf" [disabled]="laeuft()" (click)="schliesse()">Abbrechen</button>
							</div>
						</form>
					</jf-karte>
				}

				<jf-karte>
					<h2>Personen mit Rechten</h2>
					@if (fehler() && !bearbeitung()) {
						<p class="fehler" role="alert">{{ fehler() }}</p>
					}
					<ul class="liste mit-rechten">
						@for (p of mitRechten(); track p.id) {
							<li [attr.data-person]="p.id">
								<span class="name">{{ p.vorname }} {{ p.nachname }}</span>
								<span class="pillen">
									@for (r of p.rechte ?? []; track r) {
										<jf-pille art="neutral">{{ rechtText[asRecht(r)].name }}</jf-pille>
									}
								</span>
								<span class="reihe">
									<button type="button" class="knopf bearbeiten" [disabled]="laeuft()" (click)="beginne(p)">
										Rechte ändern
									</button>
								</span>
							</li>
						}
					</ul>
				</jf-karte>

				<jf-karte>
					<h2>Weiteren Person Rechte geben</h2>
					@if (ohneRechte().length > 0) {
						<form class="weitere" (submit)="beginneNeu($event)">
							<label class="feld">
								Erwachsene ohne Rechte
								<select name="weitere" [value]="weitereId()" (change)="weitereId.set(wert($event))">
									<option value="">Person wählen</option>
									@for (p of ohneRechte(); track p.id) {
										<option [value]="p.id">{{ p.vorname }} {{ p.nachname }}</option>
									}
								</select>
							</label>
							<div class="reihe">
								<button type="submit" class="knopf primaer" [disabled]="laeuft() || !weitereId()">Rechte geben</button>
							</div>
						</form>
					} @else {
						<p class="gedaempft">Alle Erwachsenen haben schon Rechte.</p>
					}
				</jf-karte>
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
			gap: var(--a4);
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
		.pillen {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a1);
		}
		.pillen:empty {
			display: none;
		}
		form,
		.editor {
			display: grid;
			gap: var(--a3);
		}
		.editor:focus {
			outline: none;
		}
		fieldset {
			display: grid;
			gap: var(--a3);
			margin: 0;
			padding: 0;
			border: 0;
		}
		.haken .hinweis {
			display: block;
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
export class RechteComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly sitzung = inject(MitgliedSitzung);
	private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
	private readonly editor = viewChild<ElementRef<HTMLElement>>('editor');

	protected readonly personen = signal<PersonListe[] | null>(null);
	protected readonly ladefehler = signal<string | null>(null);
	/** Eine Handlung zur Zeit: Zwei schnelle Klicks schickten sonst zwei Anfragen, deren Antworten sich ueberholen koennten. */
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<string | null>(null);
	protected readonly bearbeitung = signal<Bearbeitung | null>(null);
	protected readonly entwurf = signal<readonly RechtName[]>([]);
	protected readonly frage = signal(false);
	protected readonly weitereId = signal('');

	protected readonly vorlagen = VORLAGEN;
	protected readonly alleRechte = ALLE_RECHTE;
	protected readonly rechtText = RECHT_TEXT;
	protected readonly wert = wertVon;

	protected readonly sichtbar = computed(
		() => this.sitzung.ich()?.person.rechte.includes('JUGENDLEITER_RECHTE') ?? false,
	);

	private readonly erwachsene = computed(() => (this.personen() ?? []).filter((p) => p.art === 'ERWACHSENER'));
	protected readonly mitRechten = computed(() => this.erwachsene().filter((p) => (p.rechte?.length ?? 0) > 0));
	protected readonly ohneRechte = computed(() => this.erwachsene().filter((p) => (p.rechte?.length ?? 0) === 0));

	protected readonly frageText = computed(() => {
		const b = this.bearbeitung();
		if (!b) return '';
		const selbst = b.id === this.sitzung.ich()?.person.id;
		if (this.entwurf().length === 0) {
			return selbst
				? 'Du entziehst dir damit alle Rechte und kommst danach nicht mehr in die Verwaltung. Wirklich?'
				: `${b.name} verliert damit alle Rechte und ist danach kein Jugendleiter mehr. Wirklich?`;
		}
		return 'Du nimmst dir damit das Recht, Rechte zu vergeben, und kannst diese Seite danach nicht mehr öffnen. Wirklich?';
	});

	/** Zaehlt die Ladevorgaenge: Die Antwort eines veralteten darf die neuere Liste nicht ueberschreiben. */
	private ladeNr = 0;

	constructor() {
		// Rueckfrage und Bearbeitung nehmen den Fokus mit, sonst weiss eine Tastatur- oder Vorlesenutzerin nicht,
		// dass etwas aufging. Die Rueckfrage kommt zuletzt und gewinnt, solange beide offen sind.
		effect(() => this.editor()?.nativeElement.focus());
		effect(() => this.dialog()?.nativeElement.focus());
	}

	ngOnInit(): void {
		if (this.sichtbar()) void this.lade();
	}

	protected async lade(): Promise<void> {
		const nr = ++this.ladeNr;
		this.ladefehler.set(null);
		try {
			const antwort = await firstValueFrom(this.api.personen(this.slug()));
			if (nr === this.ladeNr) this.personen.set(antwort.personen);
		} catch (ursache) {
			if (nr === this.ladeNr) this.ladefehler.set(fehlertext(alsApiFehler(ursache)));
		}
	}

	/** Die Liste der API ist ein string-Feld; die Namen kommen aus dem Server-Enum und decken sich mit RechtName. */
	protected asRecht(r: string): RechtName {
		return r as RechtName;
	}

	protected beginne(p: PersonListe): void {
		this.fehler.set(null);
		this.frage.set(false);
		this.entwurf.set((p.rechte ?? []) as RechtName[]);
		this.bearbeitung.set({ id: p.id, name: `${p.vorname} ${p.nachname}`, neu: (p.rechte?.length ?? 0) === 0 });
		this.weitereId.set('');
	}

	protected beginneNeu(ereignis: Event): void {
		ereignis.preventDefault();
		const p = this.ohneRechte().find((x) => x.id === this.weitereId());
		if (p) this.beginne(p);
	}

	protected schliesse(): void {
		this.bearbeitung.set(null);
		this.frage.set(false);
		this.fehler.set(null);
		this.weitereId.set('');
	}

	protected nimmVorlage(v: Vorlage): void {
		this.entwurf.set(RECHTE_VORLAGEN[v]);
	}

	protected schalte(r: RechtName): void {
		this.entwurf.update((alt) => (alt.includes(r) ? alt.filter((x) => x !== r) : [...alt, r]));
	}

	/**
	 * Wer Rechte ganz entzieht oder sich selbst die Rechteverwaltung nimmt, wird erst gefragt:
	 * Beides ist ohne Zutun anderer nicht rueckgaengig zu machen. Alle anderen Aenderungen gehen direkt.
	 */
	protected speichere(ereignis: Event, b: Bearbeitung): void {
		ereignis.preventDefault();
		const selbst = b.id === this.sitzung.ich()?.person.id;
		const verlustSelbst = selbst && !this.entwurf().includes('JUGENDLEITER_RECHTE');
		if (this.entwurf().length === 0 || verlustSelbst) {
			this.fehler.set(null);
			this.frage.set(true);
			return;
		}
		void this.sende(b);
	}

	protected async sende(b: Bearbeitung): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.fehler.set(null);
		const rechte = [...this.entwurf()];
		try {
			await firstValueFrom(this.api.setzeRechte(this.slug(), b.id, rechte));
			this.frage.set(false);
			this.bearbeitung.set(null);
			this.weitereId.set('');
			const ich = this.sitzung.ich();
			// Die Rechte der Sitzung nachziehen, sonst zeigte die Seite nach dem Selbstentzug weiter an, was der Server verweigert.
			if (ich && ich.person.id === b.id) this.sitzung.ich.set({ ...ich, person: { ...ich.person, rechte } });
			if (this.sichtbar()) await this.lade();
		} catch (ursache) {
			this.frage.set(false);
			const f = alsApiFehler(ursache);
			this.fehler.set(rechtefehler(f));
			if (f.status === 404) await this.lade();
		} finally {
			this.laeuft.set(false);
		}
	}
}

/** Der Satz zu einem Fehler der Rechte; der Code entscheidet, nicht der Text des Servers. */
function rechtefehler(f: ApiFehler): string {
	if (f.code === 'LETZTE_LEITUNG') return 'Mindestens eine Person muss Jugendleiter & Rechte verwalten dürfen.';
	if (f.status === 404) return 'Diese Person gibt es nicht, oder du darfst keine Rechte vergeben.';
	return fehlertext(f);
}
