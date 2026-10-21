import { DOCUMENT } from '@angular/common';
import {
	afterNextRender,
	ChangeDetectionStrategy,
	Component,
	computed,
	DestroyRef,
	effect,
	inject,
	Injector,
	input,
	output,
	signal,
	untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { linkTeile, type SchreibSperre, type TextTeil, type VerlaufAnsicht } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { BestaetigungComponent } from '../../admin/bestaetigung';
import { type ApiFehler, alsApiFehler, fehlertextNichtGefunden } from '../../gemeinsam/api-fehler';
import { zeitpunktBerlin } from '../../gestaltung/format';
import { IconComponent } from '../../gestaltung/icon';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { ThreadApi } from './thread-api';

type Zustand = 'laedt' | 'bereit' | 'fehler';

interface Zeile {
	eintrag: VerlaufAnsicht;
	zeit: string;
	teile: TextTeil[];
	/** Statt des Textes bei einer geloeschten Nachricht. */
	geloeschtText: string | null;
}

/** Spiegelt die Grenze des Servers (verlauf.ts, MAX_ZEICHEN); der Server entscheidet, die Zahl steht nur im Hinweis. */
const MAX_ZEICHEN = 2000;

/**
 * Der Verlauf eines Threads (Spec 6.2): Nachrichten und Systemzeilen, aelteste oben, darunter
 * das Eingabefeld. Die Seite entscheidet nichts hier: Ob die Person schreiben (schreibSperre)
 * oder eine Nachricht loeschen darf (darfLoeschen), sagt der Server.
 *
 * Geladen wird die neueste Seite; "Fruehere laden" haengt die naechste oben an, mit der Id des
 * aeltesten gezeigten Eintrags als Cursor (der Server zaehlt nicht nach Nummern, damit nichts
 * doppelt erscheint, wenn unten etwas dazukommt). Nach dem ersten Laden meldet der Verlauf seinen
 * Stand als gelesen und sagt es der Seite erst, wenn der Server es angenommen hat; sie setzt den
 * Zaehler am Reiter dann zurueck. Ein spaeteres Nachladen aelterer Seiten meldet nichts mehr:
 * Sie sind ohnehin aelter als der Stand.
 */
@Component({
	selector: 'jf-verlauf',
	imports: [BestaetigungComponent, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@switch (zustand()) {
			@case ('bereit') {
				@if (weitere()) {
					<button type="button" class="knopf frueher" [disabled]="laedtFrueher()" (click)="ladeFrueher()">
						Frühere laden
					</button>
				}
				<ol aria-label="Verlauf">
					@for (z of zeilen(); track z.eintrag.id) {
						@if (z.eintrag.art === 'SYSTEM') {
							<li class="system">{{ z.eintrag.text }} · {{ z.zeit }}</li>
						} @else {
							<li class="nachricht" [class.eigen]="z.eintrag.eigen">
								<div class="kopf">
									<strong>{{ z.eintrag.eigen ? 'Du' : (z.eintrag.absender ?? 'Unbekannt') }}</strong>
									<span class="gedaempft">{{ z.zeit }}</span>
									@if (z.eintrag.darfLoeschen && z.eintrag.geloescht === null) {
										<button
											type="button"
											class="knopf leise klein"
											[attr.aria-label]="'Nachricht von ' + (z.eintrag.absender ?? 'Unbekannt') + ' löschen'"
											(click)="frage.set(z.eintrag)"
										>
											Löschen
										</button>
									}
								</div>
								@if (z.geloeschtText; as g) {
									<p class="geloescht gedaempft">{{ g }}</p>
								} @else {
									<p>
										@for (t of z.teile; track $index) {
											@if (t.art === 'link') {
												<a [href]="t.href" target="_blank" rel="noopener noreferrer">{{ t.text }}</a>
											} @else {
												<span>{{ t.text }}</span>
											}
										}
									</p>
								}
							</li>
						}
					} @empty {
						<li class="leer gedaempft">Noch keine Nachrichten.</li>
					}
				</ol>
				@if (listenfehler(); as f) {
					<p class="fehler" role="alert">{{ f }}</p>
				}
				@if (frage(); as e) {
					<jf-bestaetigung
						titel="Nachricht löschen"
						text="Willst du diese Nachricht wirklich löschen? Sie bleibt als gelöschte Nachricht im Verlauf stehen."
						bestaetigung="Löschen"
						(bestaetigt)="loesche(e)"
						(abgebrochen)="frage.set(null)"
					/>
				}
				@if (schreibSperre() === null) {
					<form class="eingabe" (submit)="senden($event)">
						@if (sendefehler(); as f) {
							<p class="fehler" role="alert">{{ f }}</p>
						}
						<label class="feld">
							<span class="unsichtbar">Nachricht schreiben</span>
							<input
								name="text"
								autocomplete="off"
								enterkeyhint="send"
								placeholder="Nachricht schreiben"
								[value]="text()"
								(input)="text.set(wert($event))"
								(keydown.enter)="senden($event)"
							/>
						</label>
						<button
							type="submit"
							class="knopf primaer nur-icon"
							aria-label="Senden"
							[disabled]="sendet() || text().trim() === ''"
						>
							<jf-icon name="senden" />
						</button>
					</form>
					<div class="abstand" aria-hidden="true"></div>
				}
			}
			@case ('fehler') {
				<p class="fehler" role="alert">{{ ladefehler() }}</p>
				<button type="button" class="knopf primaer" (click)="ladeErste()">Nochmal versuchen</button>
			}
			@default {
				<p class="gedaempft" role="status">Wird geladen …</p>
			}
		}
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a3);
		}
		ol {
			display: grid;
			gap: var(--a3);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		p {
			margin: 0;
		}
		.frueher {
			justify-self: center;
		}
		.nachricht {
			max-width: 88%;
			padding: var(--a2) var(--a3);
			border-radius: var(--radius);
			border-top-left-radius: 4px;
			background: var(--karte);
			border: 1px solid var(--linie);
		}
		.nachricht.eigen {
			justify-self: end;
			border-top-left-radius: var(--radius);
			border-top-right-radius: 4px;
			background: var(--akzent-flaeche);
		}
		.kopf {
			display: flex;
			flex-wrap: wrap;
			gap: 0 var(--a2);
			align-items: center;
			font-size: var(--schrift-klein);
		}
		.nachricht p {
			margin-top: 2px;
			white-space: pre-line;
			overflow-wrap: anywhere;
		}
		.geloescht {
			font-style: italic;
		}
		.system {
			justify-self: center;
			text-align: center;
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
			overflow-wrap: anywhere;
		}
		.leer {
			text-align: center;
		}
		.fehler {
			color: var(--fehler);
		}
		/* So hoch wie das Eingabefeld (Polster 2 x 8 px, Feld 44 px, Rand): Die feste Leiste verdeckt sonst die letzte Nachricht. */
		.abstand {
			height: 72px;
		}
		/*
		 * Ueber der unteren Leiste der Huelle, unter ihr aber ueber dem Inhalt. Die Hoehe der Leiste steht im
		 * Token --leiste-hoehe (Tippflaeche plus Rand oben), dazu die Aussparung. Nur die Tippflaeche allein
		 * schob das Feld um den Rand unter die Leiste (im Layouttest gemessen).
		 */
		.eingabe {
			position: fixed;
			z-index: 15;
			left: 0;
			right: 0;
			bottom: calc(var(--leiste-hoehe) + var(--sicher-unten));
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
			max-width: 480px;
			margin: 0 auto;
			padding: var(--a2) var(--a4);
			background: var(--seite);
			border-top: 1px solid var(--linie);
		}
		.eingabe .fehler {
			flex: 1 0 100%;
			font-size: var(--schrift-klein);
		}
		.eingabe .feld {
			flex: 1;
			min-width: 0;
		}
		@media (min-width: 520px) {
			.eingabe {
				border-left: 1px solid var(--linie);
				border-right: 1px solid var(--linie);
			}
		}
	`,
})
export class Verlauf {
	readonly slug = input.required<string>();
	readonly threadId = input.required<string>();
	/** Der Stand des geladenen Threads; bis dahin meldet der Verlauf alles als gelesen. */
	readonly stand = input.required<number>();
	/** null heisst: Die Person darf schreiben. Alles andere blendet das Eingabefeld aus, die Liste bleibt. */
	readonly schreibSperre = input.required<SchreibSperre | null>();
	/** Der Server hat den Verlauf als gelesen angenommen; die Seite setzt den Zaehler zurueck. */
	readonly gelesen = output<void>();

	private readonly api = inject(ThreadApi);
	private readonly router = inject(Router);
	private readonly dokument = inject(DOCUMENT);
	private readonly injector = inject(Injector);

	protected readonly zustand = signal<Zustand>('laedt');
	protected readonly ladefehler = signal<string>('');
	/** In zeitlicher Folge, aelteste zuerst; der Server liefert die neueste Seite zuerst, sie wird gedreht. */
	private readonly eintraege = signal<readonly VerlaufAnsicht[]>([]);
	protected readonly weitere = signal(false);
	protected readonly laedtFrueher = signal(false);
	/** Fehler beim Nachladen oder Loeschen, unter der Liste. */
	protected readonly listenfehler = signal<string | null>(null);
	/** Fehler beim Senden, im Eingabefeld, damit er neben dem stehenbleibenden Text zu sehen ist. */
	protected readonly sendefehler = signal<string | null>(null);
	protected readonly text = signal('');
	protected readonly sendet = signal(false);
	/** Die Nachricht, die die Person gerade loeschen will; offen ist die Rueckfrage. */
	protected readonly frage = signal<VerlaufAnsicht | null>(null);
	private readonly loeschtId = signal<string | null>(null);

	protected readonly zeilen = computed<Zeile[]>(() =>
		this.eintraege().map((e) => ({
			eintrag: e,
			zeit: zeitpunktBerlin(e.angelegtAm),
			teile: e.art === 'NACHRICHT' && e.text !== null ? linkTeile(e.text) : [],
			geloeschtText: geloeschtText(e),
		})),
	);

	/**
	 * Zaehlt die Ladevorgaenge; ein Ergebnis gilt nur, wenn seit seinem Start kein neuer begann.
	 * Auch das Abbauen zaehlt weiter: Eine Antwort, die erst nach dem Wechsel auf eine andere
	 * Seite eintrifft, soll weder die Anmeldung ausloesen noch den Zaehler der Seite beruehren.
	 */
	private lauf = 0;
	/**
	 * Der letzte Sendeversuch. Misslingt er am Netz, kann der Server die Nachricht trotzdem
	 * gespeichert haben; schickt die Person denselben Text noch einmal, geht dieselbe clientId mit,
	 * und der Server liefert die vorhandene Nachricht statt einer zweiten (Entscheidung 2).
	 * Verworfen: je Druck auf Senden eine neue clientId; ein Netzfehler nach dem Commit liesse die
	 * Nachricht doppelt im Verlauf stehen. Aendert die Person den Text, ist es eine andere Nachricht.
	 */
	private versuch: { text: string; clientId: string } | null = null;

	constructor() {
		inject(DestroyRef).onDestroy(() => this.lauf++);

		effect(() => {
			// Nur Adresse und Thread; der Stand wechselt, ohne dass neu geladen werden soll.
			this.slug();
			this.threadId();
			untracked(() => void this.ladeErste());
		});
	}

	protected wert(ereignis: Event): string {
		return (ereignis.target as HTMLInputElement).value;
	}

	protected async ladeErste(): Promise<void> {
		const lauf = ++this.lauf;
		const slug = this.slug();
		const threadId = this.threadId();
		this.zustand.set('laedt');
		this.eintraege.set([]);
		this.weitere.set(false);
		this.listenfehler.set(null);
		try {
			const seite = await firstValueFrom(this.api.verlauf(slug, threadId));
			if (lauf !== this.lauf) return;
			this.eintraege.set([...seite.eintraege].reverse());
			this.weitere.set(seite.weitere);
			this.zustand.set('bereit');
			this.zumEnde();
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			const fehler = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, slug, fehler)) return;
			this.ladefehler.set(fehlertextNichtGefunden(fehler));
			this.zustand.set('fehler');
			return;
		}
		await this.meldeGelesen(lauf, slug, threadId);
	}

	/**
	 * Schlaegt das Melden fehl, bleibt es unbemerkt: Der Stand holt sich beim naechsten Oeffnen
	 * nach, und ein Fehlerblock fuer etwas, das die Person nicht ausgeloest hat, waere falscher Alarm.
	 * Der Zaehler bleibt dann stehen, wie der Server ihn kennt.
	 */
	private async meldeGelesen(lauf: number, slug: string, threadId: string): Promise<void> {
		try {
			await firstValueFrom(this.api.gelesen(slug, threadId, { bereich: 'verlauf', bis: this.stand() }));
		} catch {
			return;
		}
		if (lauf === this.lauf) this.gelesen.emit();
	}

	protected async ladeFrueher(): Promise<void> {
		const aeltester = this.eintraege()[0];
		if (this.laedtFrueher() || aeltester === undefined) return;
		const lauf = this.lauf;
		this.laedtFrueher.set(true);
		this.listenfehler.set(null);
		try {
			const seite = await firstValueFrom(this.api.verlauf(this.slug(), this.threadId(), aeltester.id));
			if (lauf !== this.lauf) return;
			const bekannt = new Set(this.eintraege().map((e) => e.id));
			this.eintraege.update((alle) => [...[...seite.eintraege].reverse().filter((e) => !bekannt.has(e.id)), ...alle]);
			this.weitere.set(seite.weitere);
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			await this.zeigeFehler(ursache, this.listenfehler);
		} finally {
			this.laedtFrueher.set(false);
		}
	}

	protected async senden(ereignis: Event): Promise<void> {
		// Enter waehrend einer Eingabemethode (Japanisch, Emoji-Auswahl) bestaetigt nur die Umwandlung.
		// Vor preventDefault geprueft: Verwuerfe die Seite das Enter, bliebe die Umwandlung haengen.
		if (ereignis instanceof KeyboardEvent && ereignis.isComposing) return;
		ereignis.preventDefault();
		const text = this.text().trim();
		// Der zweite Tipp eines Doppeltipps kommt an, bevor der Knopf als gesperrt gezeichnet ist.
		if (this.sendet() || text === '' || this.schreibSperre() !== null) return;
		const versuch = this.versuch?.text === text ? this.versuch : { text, clientId: crypto.randomUUID() };
		this.versuch = versuch;
		const lauf = this.lauf;
		this.sendet.set(true);
		this.sendefehler.set(null);
		try {
			const { eintrag } = await firstValueFrom(
				this.api.schreibe(this.slug(), this.threadId(), { text, clientId: versuch.clientId }),
			);
			if (lauf !== this.lauf) return;
			this.versuch = null;
			this.eintraege.update((alle) => (alle.some((e) => e.id === eintrag.id) ? alle : [...alle, eintrag]));
			// Hat die Person waehrend des Sendens weitergetippt, gehoert der neue Text ihr.
			if (this.text().trim() === text) this.text.set('');
			this.zumEnde();
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			await this.zeigeFehler(ursache, this.sendefehler, textFehler);
		} finally {
			this.sendet.set(false);
		}
	}

	protected async loesche(eintrag: VerlaufAnsicht): Promise<void> {
		this.frage.set(null);
		if (this.loeschtId() !== null) return;
		const lauf = this.lauf;
		this.loeschtId.set(eintrag.id);
		this.listenfehler.set(null);
		try {
			await firstValueFrom(this.api.loescheNachricht(this.slug(), eintrag.id));
			if (lauf !== this.lauf) return;
			// Der Server liefert nichts zurueck; die Zeile wird so, wie er sie jetzt auch liefern wuerde.
			const geloescht: VerlaufAnsicht = {
				...eintrag,
				text: null,
				geloescht: eintrag.eigen ? 'SELBST' : 'MODERATION',
				darfLoeschen: false,
			};
			this.eintraege.update((alle) => alle.map((e) => (e.id === eintrag.id ? geloescht : e)));
		} catch (ursache) {
			if (lauf !== this.lauf) return;
			await this.zeigeFehler(ursache, this.listenfehler);
		} finally {
			this.loeschtId.set(null);
		}
	}

	private async zeigeFehler(
		ursache: unknown,
		ziel: { set(wert: string): void },
		uebersetze: (fehler: ApiFehler) => string = fehlertextNichtGefunden,
	): Promise<void> {
		const fehler = alsApiFehler(ursache);
		if (await beiAbgelaufenerSitzung(this.router, this.slug(), fehler)) return;
		ziel.set(uebersetze(fehler));
	}

	/**
	 * Das Ende der Seite, damit die neueste Nachricht zu sehen ist. Ueber die Seite statt ueber
	 * scrollIntoView an einem Element: Die untere Leiste und das Eingabefeld sind fest, ein Element
	 * "am Rand" laege dahinter; am Seitenende sorgen Abstandhalter und Polster der Huelle fuer Platz.
	 */
	private zumEnde(): void {
		afterNextRender(
			() => {
				const seite = this.dokument.scrollingElement;
				if (seite) seite.scrollTop = seite.scrollHeight;
			},
			{ injector: this.injector },
		);
	}
}

function geloeschtText(e: VerlaufAnsicht): string | null {
	if (e.art !== 'NACHRICHT' || e.geloescht === null) return null;
	return e.geloescht === 'SELBST' ? 'Nachricht gelöscht' : 'Von einem Jugendleiter entfernt';
}

/** Am Feld text lehnt der Server leeren oder zu langen Text ab; sein Satz nennt die Grenze nicht. */
function textFehler(fehler: ApiFehler): string {
	if (fehler.status === 400 && fehler.feld === 'text') {
		return `Die Nachricht ist leer oder zu lang (höchstens ${MAX_ZEICHEN} Zeichen).`;
	}
	return fehlertextNichtGefunden(fehler);
}
