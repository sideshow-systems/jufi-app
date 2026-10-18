import { ChangeDetectionStrategy, Component, inject, input, type OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { EinladungAnzeigeComponent } from '../admin/einladung-anzeige';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { KarteComponent } from '../gestaltung/ui';
import { type EinladungsLink, type KindAnsicht, MitgliederApi } from './mitglieder-api';
import { beiAbgelaufenerSitzung } from './sitzung-abgelaufen';
import { beziehungText } from './verwaltung/texte';

/**
 * Die Kinder der angemeldeten Person: wer sie sind, wer zur Familie gehoert, wie es um
 * Zugang und Einwilligung steht. Aktionen gibt es nur fuer Erziehungsberechtigte
 * minderjaehriger Kinder; der Server prueft das ebenfalls, die Seite versteckt nur.
 *
 * Nach jeder Aktion wird die Liste neu geholt statt lokal nachgefuehrt: Ob der Zugang
 * nach einem Widerruf noch gilt, haengt an anderen Einwilligungen, die nur der Server kennt.
 */
@Component({
	selector: 'jf-jungfischer',
	imports: [EinladungAnzeigeComponent, KarteComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Meine Jungfischer</h1>
		<a class="zurueck" [routerLink]="['/', slug(), 'mehr']">← Mehr</a>
		@if (ladefehler(); as text) {
			<jf-karte>
				<p class="fehler" role="alert">{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (kinder(); as liste) {
			<div class="stapel">
				@for (k of liste; track k.id) {
					<jf-karte>
						<article [attr.data-kind]="k.id">
							<h2>{{ k.vorname }} {{ k.nachname }}</h2>
							@if (k.jugendsprecher) {
								<!-- Ohne Geschlecht formuliert: Die Daten kennen keines, und Jugendsprecherin oder Jugendsprecher zu raten waere falsch. -->
								<p>Jugendsprecher-Rolle: {{ k.vorname }} nimmt am Austausch mit den Jugendleitern teil.</p>
							}
							<dl>
								<dt>Untergruppen</dt>
								<dd>{{ untergruppen(k) }}</dd>
								<dt>Familie</dt>
								<dd>
									<ul>
										@for (f of k.familie; track $index) {
											<li>{{ f.vorname }} {{ f.nachname }} · {{ beziehung(f) }}</li>
										}
									</ul>
								</dd>
								<dt>Zugang</dt>
								<dd>{{ zugangstext(k) }}</dd>
							</dl>

							@if (k.volljaehrig) {
								<p class="gedaempft klein">
									{{ k.vorname }} ist volljährig und entscheidet über den eigenen Zugang selbst. Du kannst hier nichts
									ändern.
								</p>
							} @else if (k.ichBinErziehungsberechtigt) {
								@if (widerrufId() === k.id) {
									<div class="frage" role="alertdialog" aria-label="Einwilligung widerrufen">
										<p>
											Willst du die Einwilligung wirklich widerrufen? Der Zugang von {{ k.vorname }} endet dann, wenn
											keine andere Einwilligung besteht.
										</p>
										<div class="reihe">
											<button type="button" class="knopf primaer" [disabled]="laeuft()" (click)="widerrufe(k)">
												Ja, widerrufen
											</button>
											<button type="button" class="knopf" [disabled]="laeuft()" (click)="widerrufId.set(null)">
												Abbrechen
											</button>
										</div>
									</div>
								} @else {
									<div class="reihe">
										<button
											type="button"
											class="knopf"
											[disabled]="laeuft()"
											(click)="setzeZugang(k, !k.zugang.erlaubt)"
										>
											{{ k.zugang.erlaubt ? 'Zugang entziehen' : 'Zugang erlauben' }}
										</button>
										<button type="button" class="knopf" [disabled]="laeuft()" (click)="erzeugeLink(k)">
											Neuen Link erzeugen
										</button>
										@if (k.zugang.einwilligungGueltig) {
											<button type="button" class="knopf" [disabled]="laeuft()" (click)="widerrufId.set(k.id)">
												Einwilligung widerrufen
											</button>
										} @else {
											<button type="button" class="knopf" [disabled]="laeuft()" (click)="gibEinwilligung(k)">
												Einwilligung geben
											</button>
										}
									</div>
								}
								@if (fehler()[k.id]; as text) {
									<p class="fehler" role="alert">{{ text }}</p>
								}
								@if (links()[k.id]; as l) {
									<jf-einladung-anzeige [einladung]="l" />
								}
							}
						</article>
					</jf-karte>
				} @empty {
					<jf-karte><p class="gedaempft">Es sind keine Jungfischer mit dir verbunden.</p></jf-karte>
				}
			</div>
		}
	`,
	styles: `
		:host {
			display: block;
		}
		.zurueck {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			margin: 0 0 var(--a2);
		}
		.stapel {
			display: grid;
			gap: var(--a4);
		}
		h1 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-titel);
		}
		h2 {
			margin: 0 0 var(--a3);
			font-size: var(--schrift-gross);
		}
		p {
			margin: 0 0 var(--a3);
			overflow-wrap: anywhere;
		}
		dl {
			display: grid;
			margin: 0 0 var(--a3);
		}
		dt {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		dd {
			margin: 0 0 var(--a3);
			overflow-wrap: anywhere;
		}
		ul {
			display: grid;
			gap: var(--a1);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		.frage p {
			margin-bottom: var(--a3);
		}
		.fehler {
			margin: var(--a3) 0 0;
			color: var(--fehler);
		}
		jf-einladung-anzeige {
			margin-top: var(--a3);
		}
	`,
})
export class JungfischerComponent implements OnInit {
	/** Kommt aus dem Pfad (withComponentInputBinding). */
	readonly slug = input.required<string>();

	private readonly api = inject(MitgliederApi);
	private readonly router = inject(Router);

	protected readonly kinder = signal<KindAnsicht[] | null>(null);
	protected readonly ladefehler = signal<string | null>(null);
	/** Eine Handlung zur Zeit: Zwei schnelle Klicks schickten sonst zwei Anfragen, deren Antworten sich ueberholen koennten. */
	protected readonly laeuft = signal(false);
	protected readonly fehler = signal<Record<string, string>>({});
	protected readonly links = signal<Record<string, EinladungsLink>>({});
	/** Das Kind, bei dem gerade die Rueckfrage zum Widerruf offen ist. */
	protected readonly widerrufId = signal<string | null>(null);

	ngOnInit(): void {
		void this.lade();
	}

	protected async lade(): Promise<void> {
		this.ladefehler.set(null);
		try {
			this.kinder.set((await firstValueFrom(this.api.meineJungfischer(this.slug()))).kinder);
		} catch (ursache) {
			const f = alsApiFehler(ursache);
			if (await beiAbgelaufenerSitzung(this.router, this.slug(), f)) return;
			this.ladefehler.set(fehlertext(f));
		}
	}

	protected untergruppen(k: KindAnsicht): string {
		return k.untergruppen.length > 0 ? k.untergruppen.map((u) => u.name).join(', ') : 'keine';
	}

	protected beziehung(f: KindAnsicht['familie'][number]): string {
		return beziehungText(f.beziehung, f.beziehungFreitext);
	}

	protected zugangstext(k: KindAnsicht): string {
		if (!k.zugang.erlaubt) return 'Nicht erlaubt';
		if (!k.zugang.einwilligungGueltig) return 'Erlaubt, aber es fehlt eine Einwilligung';
		return k.zugang.vorhanden ? 'Erlaubt und eingerichtet' : 'Erlaubt, noch nicht eingerichtet';
	}

	protected setzeZugang(k: KindAnsicht, erlaubt: boolean): Promise<void> {
		return this.fuehreAus(
			k,
			() => firstValueFrom(this.api.setzeKindZugang(this.slug(), k.id, erlaubt)),
			// Der Server loescht beim Entziehen die offenen Einladungen; der Link waere tot.
			!erlaubt,
		);
	}

	protected gibEinwilligung(k: KindAnsicht): Promise<void> {
		return this.fuehreAus(k, () => firstValueFrom(this.api.kindEinwilligung(this.slug(), k.id, true)));
	}

	protected widerrufe(k: KindAnsicht): Promise<void> {
		return this.fuehreAus(k, () => firstValueFrom(this.api.kindEinwilligung(this.slug(), k.id, false)), true);
	}

	protected async erzeugeLink(k: KindAnsicht): Promise<void> {
		await this.fuehreAus(k, async () => {
			const l = await firstValueFrom(this.api.kindEinladung(this.slug(), k.id));
			this.links.update((alt) => ({ ...alt, [k.id]: l }));
		});
	}

	/**
	 * Aktion, danach Liste neu. Ein Fehler steht beim Kind, nicht oben: Bei mehreren
	 * Kindern muss klar sein, welche Aktion gescheitert ist.
	 */
	private async fuehreAus(k: KindAnsicht, aktion: () => Promise<unknown>, loeschtLink = false): Promise<void> {
		if (this.laeuft()) return;
		this.laeuft.set(true);
		this.fehler.update((alt) => ({ ...alt, [k.id]: '' }));
		try {
			await aktion();
			if (loeschtLink) {
				this.links.update((alt) => {
					const neu = { ...alt };
					delete neu[k.id];
					return neu;
				});
			}
			this.widerrufId.set(null);
			await this.lade();
		} catch (ursache) {
			this.widerrufId.set(null);
			this.fehler.update((alt) => ({ ...alt, [k.id]: fehlertext(alsApiFehler(ursache)) }));
		} finally {
			this.laeuft.set(false);
		}
	}
}
