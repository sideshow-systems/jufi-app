import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	effect,
	ElementRef,
	inject,
	input,
	type OnInit,
	signal,
	viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
	type DokumentAnsicht,
	type DokumenteAntwort,
	type KategorieAnsicht,
	type SpeicherAntwort,
	speicherText,
} from '@jufi/domain';
import { finalize, firstValueFrom } from 'rxjs';
import { BestaetigungComponent } from '../../admin/bestaetigung';
import { alsApiFehler, type ApiFehler, fehlertext } from '../../gemeinsam/api-fehler';
import { wertVon } from '../../gemeinsam/formular';
import { IconComponent } from '../../gestaltung/icon';
import { KarteComponent } from '../../gestaltung/ui';
import { DateienApi } from '../dateien-api';
import { beiAbgelaufenerSitzung } from '../sitzung-abgelaufen';
import { SpeicherstandComponent } from './speicherstand';

/** Wie das accept-Attribut des Servers erlaubt: nur Endungen, der Typ zaehlt dort am Inhalt. */
const ENDUNGEN = '.pdf,.docx,.xlsx,.pptx,.odt,.ods,.jpg,.jpeg,.png';

/** Eine Datei auf dem Weg zum Server, bis sie angenommen ist oder die Person sie verwirft. */
interface Hochladung {
	nr: number;
	kategorieId: string;
	/** Neues Dokument oder die Datei eines vorhandenen ersetzen. */
	ziel: { art: 'neu' } | { art: 'ersetzen'; dokumentId: string; titel: string };
	datei: File;
	zustand: 'wartet' | 'laeuft' | 'fehler';
	anteil: number;
	text: string | null;
}

/** Wo ein Fehler steht: kategorie-<id>, dokument-<id>, anlegen oder seite (oben, wenn das Ziel weg ist). */
type Ort = string;

type Bearbeitung = { art: 'kategorie' | 'dokument'; id: string; wert: string };

/**
 * Verwaltung › Dokumente (TP4 Spec 3.1): Kategorien pflegen, Dokumente hochladen, ersetzen,
 * umbenennen, verschieben und loeschen, dazu der Speicherstand des Vereins. Nur mit dem Recht
 * DOKUMENTE: Der Server antwortet allen anderen mit 404 auf die Pflege-Routen, und GET /dokumente
 * sagt ihnen ueber darfPflegen, dass sie hier nichts zu suchen haben; die Seite zeigt dann den
 * Hinweis wie jede Seite, die es fuer die Person nicht gibt.
 *
 * Nach jeder gelungenen Aktion kommen Liste und Speicherstand frisch vom Server, wie bei den
 * Untergruppen: Die Reihenfolge, die Titelsortierung und der Verbrauch sind Sache des Servers, und
 * ein lokal nachgefuehrter Stand stimmte nach der ersten fremden Aenderung nicht mehr.
 *
 * Uploads laufen einzeln nacheinander, ueber alle Kategorien hinweg. Verworfen: alle Dateien
 * gleichzeitig, denn der Server begrenzt die Uploads je Person (60 je zehn Minuten) und das
 * Kontingent entscheidet unter einer Sperre; zehn parallele Dateien an der Grenze meldeten dann
 * zehnmal "voll" statt einmal, und der Fortschritt jeder Datei lief langsamer.
 */
@Component({
	selector: 'jf-verwaltung-dokumente',
	imports: [BestaetigungComponent, IconComponent, KarteComponent, SpeicherstandComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Dokumente</h1>
		@if (nichtGefunden()) {
			<jf-karte>
				<h2>Nicht gefunden oder keine Berechtigung</h2>
			</jf-karte>
		} @else if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="ladeAlles()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (liste(); as l) {
			<div class="stapel">
				@if (fehlerBei('seite'); as text) {
					<p class="fehler" role="alert">{{ text }}</p>
				}
				@if (speicher(); as s) {
					<jf-speicherstand [stand]="s" />
				} @else if (speicherFehler()) {
					<p class="gedaempft klein">Der Speicherstand konnte nicht geladen werden.</p>
				}

				@for (k of l.kategorien; track k.id) {
					<jf-karte>
						<section [attr.aria-labelledby]="'kat-' + k.id" [attr.data-kategorie]="k.id">
							@if (bearbeitung(); as b) {
								@if (b.art === 'kategorie' && b.id === k.id) {
									<form aria-label="Kategorie umbenennen" (submit)="speichereBearbeitung($event)">
										<label class="feld">
											Neuer Name
											<input
												#bearbeiteFeld
												type="text"
												name="kategorieName"
												maxlength="40"
												autocomplete="off"
												[value]="b.wert"
												(input)="setzeWert($event)"
											/>
										</label>
										<div class="reihe">
											<button type="submit" class="knopf primaer" [disabled]="laeuft()">Speichern</button>
											<button type="button" class="knopf" [disabled]="laeuft()" (click)="bearbeitung.set(null)">
												Abbrechen
											</button>
										</div>
									</form>
								}
							}
							@if (!istInBearbeitung('kategorie', k.id)) {
								<header>
									<h2 [id]="'kat-' + k.id">{{ k.name }}</h2>
									<span class="werkzeuge">
										<button
											type="button"
											class="knopf nur-icon"
											[attr.aria-label]="'„' + k.name + '“ nach oben'"
											[disabled]="laeuft() || $first"
											(click)="verschiebe(l, $index, -1)"
										>
											<jf-icon name="hoch" />
										</button>
										<button
											type="button"
											class="knopf nur-icon"
											[attr.aria-label]="'„' + k.name + '“ nach unten'"
											[disabled]="laeuft() || $last"
											(click)="verschiebe(l, $index, 1)"
										>
											<jf-icon name="runter" />
										</button>
										<button
											type="button"
											class="knopf klein"
											[attr.aria-label]="'Kategorie „' + k.name + '“ umbenennen'"
											[disabled]="laeuft()"
											(click)="beginne('kategorie', k.id, k.name)"
										>
											Umbenennen
										</button>
										@if (k.dokumente.length === 0) {
											<button
												type="button"
												class="knopf klein"
												[attr.aria-label]="'Kategorie „' + k.name + '“ löschen'"
												[disabled]="laeuft()"
												(click)="loescheKategorie(k)"
											>
												Kategorie löschen
											</button>
										}
									</span>
								</header>
							}
							@if (fehlerBei('kategorie-' + k.id); as text) {
								<p class="fehler" role="alert">{{ text }}</p>
							}

							<ul>
								@for (d of k.dokumente; track d.id) {
									<li [attr.data-dokument]="d.id">
										@if (istInBearbeitung('dokument', d.id)) {
											<form aria-label="Dokument umbenennen" (submit)="speichereBearbeitung($event)">
												<label class="feld">
													Neuer Titel
													<input
														#bearbeiteFeld
														type="text"
														name="titel"
														maxlength="120"
														autocomplete="off"
														[value]="bearbeitung()?.wert"
														(input)="setzeWert($event)"
													/>
												</label>
												@if (fehlerBei('dokument-' + d.id); as text) {
													<p class="fehler" role="alert">{{ text }}</p>
												}
												<div class="reihe">
													<button type="submit" class="knopf primaer" [disabled]="laeuft()">Speichern</button>
													<button type="button" class="knopf" [disabled]="laeuft()" (click)="bearbeitung.set(null)">
														Abbrechen
													</button>
												</div>
											</form>
										} @else {
											<div class="kopf">
												<jf-icon name="dokument" />
												<span class="titel">{{ d.titel }}</span>
												<span class="zusatz">{{ d.name }} · {{ groesse(d.groesse) }}</span>
											</div>
											<div class="reihe">
												<label class="feld wahl">
													Kategorie
													<select
														[attr.aria-label]="'Kategorie für ' + d.titel"
														[disabled]="laeuft()"
														(change)="verschiebeDokument(d, $event)"
													>
														@for (ziel of l.kategorien; track ziel.id) {
															<option [value]="ziel.id" [selected]="ziel.id === k.id">{{ ziel.name }}</option>
														}
													</select>
												</label>
												<button
													type="button"
													class="knopf klein"
													[attr.aria-label]="'„' + d.titel + '“ umbenennen'"
													[disabled]="laeuft()"
													(click)="beginne('dokument', d.id, d.titel)"
												>
													Umbenennen
												</button>
												<label class="knopf klein datei" [attr.aria-label]="'Datei von „' + d.titel + '“ ersetzen'">
													Ersetzen
													<input
														type="file"
														class="unsichtbar"
														[accept]="endungen"
														(change)="waehleErsatz($event, k, d)"
													/>
												</label>
												<button
													type="button"
													class="knopf klein"
													[attr.aria-label]="'„' + d.titel + '“ löschen'"
													[disabled]="laeuft()"
													(click)="frage.set(d)"
												>
													Löschen
												</button>
											</div>
											@if (fehlerBei('dokument-' + d.id); as text) {
												<p class="fehler" role="alert">{{ text }}</p>
											}
										}
									</li>
								} @empty {
									<li class="gedaempft">Noch keine Dokumente in dieser Kategorie.</li>
								}
								@for (h of hochladungenIn(k.id); track h.nr) {
									<li class="hochladung" [attr.data-hochladung]="h.nr">
										<span class="titel">{{ hochladungText(h) }}</span>
										@if (h.zustand === 'fehler') {
											<p class="fehler" role="alert">{{ h.text }}</p>
											<div class="reihe">
												<button type="button" class="knopf klein" (click)="nochmal(h)">Nochmal</button>
												<button type="button" class="knopf klein" (click)="verwirf(h)">Verwerfen</button>
											</div>
										} @else {
											<progress
												max="1"
												[attr.value]="h.zustand === 'laeuft' && h.anteil > 0 ? h.anteil : null"
												[attr.aria-label]="'Fortschritt von ' + h.datei.name"
											></progress>
											<span class="gedaempft klein">{{
												h.zustand === 'wartet' ? 'Wartet …' : 'Wird hochgeladen …'
											}}</span>
										}
									</li>
								}
							</ul>

							<label class="knopf leise datei hochladen">
								<jf-icon name="plus" /> Dokument hochladen
								<input
									type="file"
									class="unsichtbar"
									data-hochladen
									multiple
									[accept]="endungen"
									(change)="waehleDateien($event, k)"
								/>
							</label>
						</section>
					</jf-karte>
				} @empty {
					<p class="gedaempft">Noch keine Kategorien.</p>
				}

				<jf-karte>
					<form aria-label="Kategorie anlegen" (submit)="legeKategorieAn($event)">
						<h2>Kategorie anlegen</h2>
						<label class="feld">
							Name
							<input
								type="text"
								name="neueKategorie"
								maxlength="40"
								autocomplete="off"
								[value]="neueKategorie()"
								[attr.aria-invalid]="fehlerBei('anlegen') ? 'true' : null"
								(input)="neueKategorie.set(wert($event))"
							/>
						</label>
						@if (fehlerBei('anlegen'); as text) {
							<p class="fehler" role="alert">{{ text }}</p>
						}
						<div class="reihe">
							<button type="submit" class="knopf primaer" [disabled]="laeuft()">Kategorie anlegen</button>
						</div>
					</form>
				</jf-karte>

				@if (frage(); as d) {
					<jf-bestaetigung
						titel="Dokument löschen"
						[text]="'‚' + d.titel + '‘ löschen?'"
						bestaetigung="Löschen"
						(bestaetigt)="loescheDokument(d)"
						(abgebrochen)="frage.set(null)"
					/>
				}
			</div>
		} @else {
			<p class="gedaempft" role="status">Wird geladen …</p>
		}
	`,
	styles: `
		:host {
			display: block;
			max-width: 40rem;
		}
		h1 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-titel);
		}
		h2 {
			margin: 0;
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0;
		}
		.stapel {
			display: grid;
			gap: var(--a4);
		}
		section {
			display: grid;
			gap: var(--a3);
		}
		header {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: var(--a2);
		}
		header h2 {
			overflow-wrap: anywhere;
		}
		.werkzeuge,
		.reihe {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--a2);
		}
		ul {
			display: grid;
			gap: var(--a3);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		li {
			display: grid;
			gap: var(--a2);
			padding-top: var(--a3);
			border-top: 1px solid var(--linie);
			overflow-wrap: anywhere;
		}
		/* Icon links ueber beide Textzeilen, damit Titel und Zusatz bei langen Titeln beieinander bleiben. */
		.kopf {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: var(--a3);
			align-items: center;
		}
		.kopf jf-icon {
			grid-row: 1 / span 2;
			font-size: 1.375rem;
			color: var(--text-gedaempft);
		}
		.titel {
			font-weight: 600;
		}
		.zusatz {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		form {
			display: grid;
			gap: var(--a3);
		}
		/* Die Auswahl darf schrumpfen: Ein langer Kategoriename ragte sonst bei 375 px ueber den Rand. */
		.wahl {
			flex: 1 1 10rem;
			min-width: 0;
		}
		.wahl select {
			min-width: 0;
			max-width: 100%;
		}
		/* Das Dateifeld sitzt im Knopf und ist unsichtbar, aber per Tab erreichbar; den Rahmen bekommt der Knopf. */
		.datei {
			position: relative;
			cursor: pointer;
		}
		.datei:focus-within {
			outline: 2px solid var(--akzent);
			outline-offset: 2px;
		}
		.hochladen {
			justify-self: start;
		}
		progress {
			width: 100%;
			accent-color: var(--akzent);
		}
		.fehler {
			color: var(--fehler);
		}
		.gedaempft {
			color: var(--text-gedaempft);
		}
		.klein {
			font-size: var(--schrift-klein);
		}
	`,
})
export class DokumenteVerwaltungComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(DateienApi);
	private readonly router = inject(Router);
	private readonly zerstoert = inject(DestroyRef);
	private readonly bearbeiteFeld = viewChild<ElementRef<HTMLInputElement>>('bearbeiteFeld');

	protected readonly endungen = ENDUNGEN;
	protected readonly wert = wertVon;
	protected readonly liste = signal<DokumenteAntwort | null>(null);
	protected readonly speicher = signal<SpeicherAntwort | null>(null);
	protected readonly speicherFehler = signal(false);
	protected readonly nichtGefunden = signal(false);
	protected readonly ladefehler = signal<string | null>(null);
	/** Eine Handlung zur Zeit: Zwei schnelle Klicks schickten sonst zwei Anfragen, deren Antworten sich ueberholen koennten. */
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<{ ort: Ort; text: string } | null>(null);
	protected readonly frage = signal<DokumentAnsicht | null>(null);
	protected readonly bearbeitung = signal<Bearbeitung | null>(null);
	protected readonly neueKategorie = signal('');
	protected readonly hochladungen = signal<Hochladung[]>([]);

	/** Zaehlt die Ladevorgaenge: Die Antwort eines veralteten darf die neuere Liste nicht ueberschreiben. */
	private ladeNr = 0;
	private hochladungNr = 0;
	private uploadLaeuft = false;
	/** Nach dem Abbau startet kein weiterer Upload: Das Abmelden des laufenden loest finalize aus, und das riefe starteNaechste. */
	private abgebaut = false;
	/** Mehrere Anfragen koennen zugleich "nicht angemeldet" melden; zur Anmeldung geht es nur einmal. */
	private abgelaufen = false;

	constructor() {
		// Das Feld einer Umbenennung bekommt den Fokus: Wer "Umbenennen" drueckt, will gleich tippen.
		effect(() => this.bearbeiteFeld()?.nativeElement.focus());
		this.zerstoert.onDestroy(() => (this.abgebaut = true));
	}

	ngOnInit(): void {
		void this.ladeAlles();
	}

	protected async ladeAlles(): Promise<void> {
		const nr = ++this.ladeNr;
		this.ladefehler.set(null);
		this.nichtGefunden.set(false);
		const speicher = this.ladeSpeicher();
		try {
			const antwort = await firstValueFrom(this.api.dokumente(this.slug()));
			if (nr !== this.ladeNr) return;
			if (!antwort.darfPflegen) this.nichtGefunden.set(true);
			this.liste.set(antwort);
		} catch (ursache) {
			if (nr !== this.ladeNr) return;
			const f = alsApiFehler(ursache);
			if (await this.sitzungAbgelaufen(f)) return;
			if (f.status === 404) this.nichtGefunden.set(true);
			else this.ladefehler.set(fehlertext(f));
		}
		await speicher;
	}

	/** Der Speicherstand ist Beiwerk: Scheitert er, bleibt die Liste benutzbar und die Zeile sagt es. */
	private async ladeSpeicher(): Promise<void> {
		try {
			this.speicher.set(await firstValueFrom(this.api.speicher(this.slug())));
			this.speicherFehler.set(false);
		} catch (ursache) {
			if (await this.sitzungAbgelaufen(alsApiFehler(ursache))) return;
			this.speicherFehler.set(true);
		}
	}

	private async sitzungAbgelaufen(f: ApiFehler): Promise<boolean> {
		if (this.abgelaufen) return true;
		if (!(await beiAbgelaufenerSitzung(this.router, this.slug(), f))) return false;
		this.abgelaufen = true;
		return true;
	}

	protected groesse(bytes: number): string {
		return speicherText(bytes);
	}

	protected fehlerBei(ort: Ort): string | null {
		const f = this.fehler();
		return f?.ort === ort ? f.text : null;
	}

	protected istInBearbeitung(art: Bearbeitung['art'], id: string): boolean {
		const b = this.bearbeitung();
		return b?.art === art && b.id === id;
	}

	protected beginne(art: Bearbeitung['art'], id: string, wert: string): void {
		this.fehler.set(null);
		this.bearbeitung.set({ art, id, wert });
	}

	protected setzeWert(ereignis: Event): void {
		const wert = wertVon(ereignis);
		this.bearbeitung.update((b) => b && { ...b, wert });
	}

	// --- Kategorien -----------------------------------------------------------

	protected async legeKategorieAn(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const name = this.neueKategorie().trim();
		if (!name) {
			this.fehler.set({ ort: 'anlegen', text: 'Bitte einen Namen eingeben' });
			return;
		}
		if (await this.fuehreAus('anlegen', () => firstValueFrom(this.api.legeKategorieAn(this.slug(), name)))) {
			this.neueKategorie.set('');
		}
	}

	protected async loescheKategorie(k: KategorieAnsicht): Promise<void> {
		await this.fuehreAus(`kategorie-${k.id}`, () => firstValueFrom(this.api.loescheKategorie(this.slug(), k.id)));
	}

	protected async verschiebe(l: DokumenteAntwort, index: number, richtung: -1 | 1): Promise<void> {
		const ids = l.kategorien.map((k) => k.id);
		const ziel = index + richtung;
		if (ziel < 0 || ziel >= ids.length) return;
		[ids[index], ids[ziel]] = [ids[ziel] as string, ids[index] as string];
		const k = l.kategorien[index] as KategorieAnsicht;
		await this.fuehreAus(`kategorie-${k.id}`, () => firstValueFrom(this.api.sortiereKategorien(this.slug(), ids)));
	}

	// --- Dokumente ------------------------------------------------------------

	protected async speichereBearbeitung(ereignis: Event): Promise<void> {
		ereignis.preventDefault();
		const b = this.bearbeitung();
		if (!b) return;
		const wert = b.wert.trim();
		const ort: Ort = b.art === 'kategorie' ? `kategorie-${b.id}` : `dokument-${b.id}`;
		if (!wert) {
			this.fehler.set({
				ort,
				text: b.art === 'kategorie' ? 'Bitte einen Namen eingeben' : 'Bitte einen Titel eingeben',
			});
			return;
		}
		const aufruf =
			b.art === 'kategorie'
				? () => firstValueFrom(this.api.benenneKategorie(this.slug(), b.id, wert))
				: () => firstValueFrom(this.api.aendereDokument(this.slug(), b.id, { titel: wert }));
		if (await this.fuehreAus(ort, aufruf)) this.bearbeitung.set(null);
	}

	protected async verschiebeDokument(d: DokumentAnsicht, ereignis: Event): Promise<void> {
		const kategorieId = (ereignis.target as HTMLSelectElement).value;
		await this.fuehreAus(`dokument-${d.id}`, () =>
			firstValueFrom(this.api.aendereDokument(this.slug(), d.id, { kategorieId })),
		);
	}

	protected async loescheDokument(d: DokumentAnsicht): Promise<void> {
		await this.fuehreAus(`dokument-${d.id}`, () => firstValueFrom(this.api.loescheDokument(this.slug(), d.id)));
	}

	/**
	 * Aktion, danach Liste und Speicherstand neu. Die Rueckfrage schliesst in jedem Fall. Ein 404 laedt
	 * ebenfalls neu: Das Ziel ist dann schon weg, und die Zeile, die es zeigt, taeuscht nur noch.
	 */
	private async fuehreAus(ort: Ort, aktion: () => Promise<unknown>): Promise<boolean> {
		if (this.laeuft()) return false;
		this.laeuft.set(true);
		this.fehler.set(null);
		try {
			await aktion();
			this.frage.set(null);
			await this.ladeAlles();
			return true;
		} catch (ursache) {
			this.frage.set(null);
			const f = alsApiFehler(ursache);
			if (await this.sitzungAbgelaufen(f)) return false;
			// Bei 404 steht die Meldung oben auf der Seite: Das Ziel ist nach dem Neuladen weg, und mit ihm der Ort am Ziel.
			this.fehler.set({ ort: f.status === 404 ? 'seite' : ort, text: aktionsfehler(f) });
			if (f.status === 404) {
				this.bearbeitung.set(null);
				await this.ladeAlles();
			}
			return false;
		} finally {
			this.laeuft.set(false);
		}
	}

	// --- Hochladen ------------------------------------------------------------

	protected hochladungenIn(kategorieId: string): Hochladung[] {
		return this.hochladungen().filter((h) => h.kategorieId === kategorieId);
	}

	protected hochladungText(h: Hochladung): string {
		return h.ziel.art === 'ersetzen' ? `${h.ziel.titel} ersetzen: ${h.datei.name}` : h.datei.name;
	}

	protected waehleDateien(ereignis: Event, k: KategorieAnsicht): void {
		for (const datei of this.dateienAus(ereignis)) this.reihe({ art: 'neu' }, k.id, datei);
		this.starteNaechste();
	}

	protected waehleErsatz(ereignis: Event, k: KategorieAnsicht, d: DokumentAnsicht): void {
		const datei = this.dateienAus(ereignis)[0];
		if (!datei) return;
		this.reihe({ art: 'ersetzen', dokumentId: d.id, titel: d.titel }, k.id, datei);
		this.starteNaechste();
	}

	/** Leert das Feld, damit dieselbe Datei nach einer Korrektur noch einmal gewaehlt werden kann (sonst feuert change nicht). */
	private dateienAus(ereignis: Event): File[] {
		const eingabe = ereignis.target as HTMLInputElement;
		const dateien = [...(eingabe.files ?? [])];
		eingabe.value = '';
		return dateien;
	}

	private reihe(ziel: Hochladung['ziel'], kategorieId: string, datei: File): void {
		const h: Hochladung = {
			nr: ++this.hochladungNr,
			kategorieId,
			ziel,
			datei,
			zustand: 'wartet',
			anteil: 0,
			text: null,
		};
		this.hochladungen.update((alle) => [...alle, h]);
	}

	protected nochmal(h: Hochladung): void {
		this.aendere(h.nr, { zustand: 'wartet', anteil: 0, text: null });
		this.starteNaechste();
	}

	protected verwirf(h: Hochladung): void {
		this.hochladungen.update((alle) => alle.filter((x) => x.nr !== h.nr));
	}

	private aendere(nr: number, teil: Partial<Hochladung>): void {
		this.hochladungen.update((alle) => alle.map((h) => (h.nr === nr ? { ...h, ...teil } : h)));
	}

	private starteNaechste(): void {
		if (this.uploadLaeuft) return;
		const h = this.hochladungen().find((x) => x.zustand === 'wartet');
		if (!h) return;
		this.uploadLaeuft = true;
		this.aendere(h.nr, { zustand: 'laeuft', anteil: 0 });
		const [url, methode] =
			h.ziel.art === 'ersetzen'
				? ([this.api.dokumentDateiAdresse(this.slug(), h.ziel.dokumentId), 'PUT'] as const)
				: ([this.api.dokumentAdresse(this.slug(), h.kategorieId), 'POST'] as const);
		this.api
			.ladeHoch(url, h.datei, methode)
			.pipe(
				takeUntilDestroyed(this.zerstoert),
				finalize(() => {
					this.uploadLaeuft = false;
					if (!this.abgebaut) this.starteNaechste();
				}),
			)
			.subscribe((stand) => {
				if (stand.art === 'fortschritt') this.aendere(h.nr, { anteil: stand.anteil });
				else if (stand.art === 'fehler') this.aendere(h.nr, { zustand: 'fehler', text: stand.text });
				else {
					this.verwirf(h);
					void this.ladeAlles();
				}
			});
	}
}

/** Der Satz zu einem Fehler einer Aktion; 404 heisst, dass das Ziel in der Zwischenzeit weg ist. */
function aktionsfehler(f: ApiFehler): string {
	if (f.status === 404) return 'Das gibt es nicht mehr, oder du darfst hier nichts ändern. Die Liste ist neu geladen.';
	return fehlertext(f);
}
