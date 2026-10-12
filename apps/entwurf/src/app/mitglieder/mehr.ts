import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import { OfflineAuswahl } from '../daten/offline';
import { EntwurfStore } from '../daten/store';
import type { Id, Person } from '../daten/typen';
import { IconComponent, type IconName } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';
import { teileText } from '../gestaltung/teilen-aktion';
import { rolleText } from '../gestaltung/texte';
import { type ThemaWahl, ThemaService } from '../gestaltung/thema';
import { AbschnittComponent, KarteComponent } from '../gestaltung/ui';
import { istJugendleiter, kinderVon } from '../regeln/personen';
import { siehtThread } from '../regeln/sichtbarkeit';
import { einladungsLink } from '../regeln/teilen';
import { istArchiviert } from '../regeln/termine';

type Glocke = 'alles' | 'wichtig' | 'stumm';

interface Einladung {
	kindId: Id;
	text: string;
}

/** Profil, Kinder, Benachrichtigungen, Darstellung und Hinweise (Spec TP1 4.5). */
@Component({
	selector: 'jf-mehr',
	imports: [RouterLink, IconComponent, AbschnittComponent, KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<jf-karte class="profil">
			<span class="bild" aria-hidden="true">{{ ich().vorname.charAt(0) }}{{ ich().nachname.charAt(0) }}</span>
			<span>
				<strong>{{ ich().vorname }} {{ ich().nachname }}</strong>
				<span class="gedaempft klein">{{ rolle() }}</span>
			</span>
		</jf-karte>

		<nav class="links">
			<a [routerLink]="'/' + slug() + '/dokumente'"><jf-icon name="ordner" /> Dokumente <jf-icon name="vor" /></a>
			@if (jugendleiter()) {
				<a [routerLink]="'/' + slug() + '/verwaltung'"
					><jf-icon name="einstellungen" /> Verwaltung <jf-icon name="vor"
				/></a>
			}
		</nav>

		@if (kinder().length) {
			<jf-abschnitt titel="Meine Kinder">
				@for (k of kinder(); track k.id) {
					<jf-karte class="kind">
						<strong>{{ k.vorname }} {{ k.nachname }}{{ k.alter ? ', ' + k.alter : '' }}</strong>
						<span class="gedaempft klein">{{ k.hatZugang ? 'Hat eigenen Zugang' : 'Noch kein eigener Zugang' }}</span>
						<label class="schalter">
							<input
								type="checkbox"
								[attr.data-einwilligung]="k.id"
								[checked]="!!k.fotoEinwilligung"
								(change)="einwilligung(k, $event)"
							/>
							Fotos von {{ k.vorname }} dürfen gezeigt werden
						</label>
						<button type="button" class="knopf leise klein" (click)="einladen(k)">
							<jf-icon name="einladen" />
							{{ k.hatZugang ? 'Neuen Zugang erzeugen' : 'Zugang für ' + k.vorname + ' erzeugen' }}
						</button>
						@if (einladung()?.kindId === k.id) {
							<div class="einladung">
								<p>{{ einladung()!.text }}</p>
								<button type="button" class="knopf primaer klein" (click)="teilen()">
									<jf-icon name="teilen" /> Per WhatsApp senden
								</button>
							</div>
						}
					</jf-karte>
				}
			</jf-abschnitt>
		}

		<jf-abschnitt titel="Benachrichtigungen">
			@for (t of threads(); track t.id) {
				<label class="glocke">
					<jf-icon [name]="glockenIcon(t.id)" />
					<span class="titel">{{ t.titel }}</span>
					<select
						[value]="glocke(t.id)"
						(change)="glockeSetzen(t.id, $event)"
						[attr.aria-label]="'Benachrichtigung für ' + t.titel"
					>
						<option value="alles">Alles</option>
						<option value="wichtig">Nur Wichtiges</option>
						<option value="stumm">Stumm</option>
					</select>
				</label>
			}
		</jf-abschnitt>

		<jf-abschnitt titel="Darstellung">
			<div class="thema" role="group" aria-label="Darstellung">
				@for (w of themen; track w.wert) {
					<button
						type="button"
						class="knopf"
						[class.primaer]="thema.wahl() === w.wert"
						[attr.aria-pressed]="thema.wahl() === w.wert"
						(click)="thema.setzeWahl(w.wert)"
					>
						<jf-icon [name]="w.icon" /> {{ w.text }}
					</button>
				}
			</div>
		</jf-abschnitt>

		<jf-abschnitt titel="Offline gespeichert">
			@for (d of offlineDokumente(); track d.id) {
				<p class="offline"><jf-icon name="offline" /> {{ d.name }}</p>
			} @empty {
				<p class="gedaempft klein">Noch nichts. In „Dokumente" lässt sich jedes Dokument offline schalten.</p>
			}
		</jf-abschnitt>

		<jf-abschnitt titel="Als App installieren">
			<jf-karte class="install">
				<p><strong>iPhone:</strong> In Safari auf <em>Teilen</em> tippen, dann „Zum Home-Bildschirm".</p>
				<p><strong>Android:</strong> In Chrome das Menü ⋮ öffnen, dann „App installieren".</p>
			</jf-karte>
		</jf-abschnitt>
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a4);
		}
		.profil {
			display: flex;
			align-items: center;
			gap: var(--a3);
		}
		.profil > span:last-child {
			display: grid;
		}
		.bild {
			display: grid;
			place-items: center;
			width: 48px;
			height: 48px;
			border-radius: 50%;
			background: var(--akzent-flaeche);
			color: var(--akzent);
			font-weight: 700;
			flex: none;
		}
		.links {
			display: grid;
			gap: var(--a2);
		}
		.links a {
			display: flex;
			align-items: center;
			gap: var(--a3);
			min-height: 52px;
			padding: 0 var(--a4);
			border-radius: var(--radius);
			background: var(--karte);
			border: 1px solid var(--linie);
			color: var(--text);
			font-weight: 600;
			text-decoration: none;
		}
		.links a jf-icon:first-child {
			color: var(--akzent);
		}
		.links a jf-icon:last-child {
			margin-left: auto;
			color: var(--text-gedaempft);
		}
		.kind {
			display: grid;
			gap: var(--a2);
		}
		.schalter {
			display: flex;
			align-items: center;
			gap: var(--a2);
			min-height: var(--tippflaeche);
		}
		.schalter input {
			width: 22px;
			height: 22px;
			flex: none;
			accent-color: var(--akzent);
		}
		.kind .knopf {
			justify-self: start;
			min-height: var(--tippflaeche);
		}
		.einladung {
			display: grid;
			gap: var(--a2);
			padding: var(--a3);
			border-radius: var(--radius-klein);
			background: var(--akzent-flaeche);
		}
		.einladung p {
			margin: 0;
			white-space: pre-line;
			overflow-wrap: anywhere;
			font-size: var(--schrift-klein);
		}
		.glocke {
			display: flex;
			align-items: center;
			gap: var(--a2);
			min-height: var(--tippflaeche);
		}
		.glocke jf-icon {
			color: var(--akzent);
			flex: none;
		}
		.glocke .titel {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.glocke select {
			min-height: var(--tippflaeche);
			padding: 0 var(--a2);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--karte);
			color: var(--text);
			font: inherit;
		}
		.thema {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: var(--a2);
		}
		.thema .knopf {
			padding: 0 var(--a2);
		}
		.offline {
			display: flex;
			align-items: center;
			gap: var(--a2);
			margin: 0;
		}
		.install p {
			margin: 0 0 var(--a2);
		}
		.install p:last-child {
			margin: 0;
		}
	`,
})
export class Mehr {
	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	private readonly ereignisse = inject(TESTEREIGNISSE);
	private readonly dokument = inject(DOCUMENT);
	private readonly offline = inject(OfflineAuswahl);
	protected readonly thema = inject(ThemaService);

	protected readonly themen: { wert: ThemaWahl; text: string; icon: IconName }[] = [
		{ wert: 'hell', text: 'Hell', icon: 'hell' },
		{ wert: 'dunkel', text: 'Dunkel', icon: 'dunkel' },
		{ wert: 'system', text: 'System', icon: 'system' },
	];

	protected readonly ich = this.store.person;
	protected readonly slug = computed(() => this.store.stand().verein.slug);
	protected readonly jugendleiter = computed(() => istJugendleiter(this.store.person()));
	protected readonly rolle = computed(() => rolleText(this.store.stand(), this.store.ich()));
	protected readonly kinder = computed(() => kinderVon(this.store.stand(), this.store.ich()));
	protected readonly threads = computed(() => {
		const stand = this.store.stand();
		const jetzt = this.store.jetzt();
		return stand.threads.filter((t) => siehtThread(stand, this.store.ich(), t) && !istArchiviert(t, jetzt));
	});
	protected readonly offlineDokumente = computed(() =>
		this.store.stand().dokumente.filter((d) => this.offline.ids().has(d.id)),
	);

	/** Glocken nur im Bauteil: der Entwurf verschickt keine Benachrichtigungen. */
	private readonly glocken = signal<Record<Id, Glocke>>({});
	protected readonly einladung = signal<Einladung | null>(null);

	protected glocke(id: Id): Glocke {
		return this.glocken()[id] ?? 'alles';
	}

	protected glockenIcon(id: Id): IconName {
		return this.glocke(id) === 'stumm' ? 'glockeAus' : 'glocke';
	}

	protected glockeSetzen(id: Id, e: Event): void {
		const wert = (e.target as HTMLSelectElement).value as Glocke;
		this.glocken.update((g) => ({ ...g, [id]: wert }));
	}

	protected einwilligung(k: Person, e: Event): void {
		this.store.fotoEinwilligungSetzen(k.id, (e.target as HTMLInputElement).checked);
	}

	/** Beispiel-Link: der Entwurf kennt keine echten Zugaenge, zeigt aber den Weg dorthin. */
	protected einladen(k: Person): void {
		const verein = this.store.stand().verein;
		const link = einladungsLink(
			`${this.dokument.location.origin}/entwurf`,
			verein.slug,
			`${k.vorname.toLowerCase()}-beispiel`,
		);
		this.einladung.set({
			kindId: k.id,
			text: `Hallo ${k.vorname}! Hier ist dein eigener Zugang zur JuFi App der ${verein.name}:\n${link}`,
		});
		this.ereignisse.next({ art: 'einladungErzeugt', personId: k.id });
	}

	protected async teilen(): Promise<void> {
		const e = this.einladung();
		if (!e) return;
		const ergebnis = await teileText(e.text);
		if (ergebnis === 'kopiert') this.meldung.zeige('Text kopiert');
		if (ergebnis === 'fehler') this.meldung.zeige('Teilen nicht möglich');
	}
}
