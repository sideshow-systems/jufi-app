import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import { OfflineAuswahl } from '../daten/offline';
import { EntwurfStore } from '../daten/store';
import type { Dokument } from '../daten/typen';
import { IconComponent } from '../gestaltung/icon';
import { MeldungService } from '../gestaltung/meldung';
import { AbschnittComponent } from '../gestaltung/ui';

const KATEGORIEN: Dokument['kategorie'][] = ['Ordnungen', 'Merkblätter', 'Formulare'];

/** Globale Dokumente des Vereins nach Kategorie (Rahmen 6.6). */
@Component({
	selector: 'jf-dokumente',
	imports: [IconComponent, AbschnittComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Dokumente</h1>
		@for (g of gruppen(); track g.kategorie) {
			<jf-abschnitt [titel]="g.kategorie">
				@for (d of g.dokumente; track d.id) {
					<div class="dokument">
						<button type="button" class="oeffnen" (click)="oeffnen(d)">
							<jf-icon name="dokument" />
							<span class="text">
								<strong>{{ d.name }}</strong>
								<span class="gedaempft klein">PDF · {{ d.groesse }}</span>
							</span>
						</button>
						<label class="schalter">
							<input type="checkbox" [checked]="offline().has(d.id)" (change)="auswahl.umschalten(d.id)" />
							<span>Offline</span>
						</label>
					</div>
				}
			</jf-abschnitt>
		}
		<p class="hinweis gedaempft klein">
			<jf-icon name="info" />
			„Offline verfügbar" ist im Entwurf nur angedeutet: die fertige App legt die Datei dann auf dem Gerät ab.
		</p>
	`,
	styles: `
		:host {
			display: grid;
			gap: var(--a4);
		}
		h1 {
			margin: var(--a2) 0 0;
			font-size: var(--schrift-titel);
		}
		.dokument {
			display: flex;
			align-items: center;
			gap: var(--a2);
			padding: var(--a2) var(--a3);
			border-radius: var(--radius);
			background: var(--karte);
			border: 1px solid var(--linie);
		}
		.oeffnen {
			display: flex;
			flex: 1;
			min-width: 0;
			align-items: center;
			gap: var(--a3);
			min-height: var(--tippflaeche);
			padding: 0;
			border: 0;
			background: none;
			color: var(--text);
			font: inherit;
			text-align: left;
			cursor: pointer;
		}
		.oeffnen jf-icon {
			font-size: 1.5rem;
			color: var(--akzent);
			flex: none;
		}
		.text {
			display: grid;
			min-width: 0;
			overflow-wrap: anywhere;
		}
		.schalter {
			display: flex;
			align-items: center;
			gap: var(--a1);
			min-height: var(--tippflaeche);
			font-size: var(--schrift-klein);
			color: var(--text-gedaempft);
		}
		.schalter input {
			width: 22px;
			height: 22px;
			accent-color: var(--akzent);
		}
		.hinweis {
			display: flex;
			gap: var(--a2);
			margin: 0;
		}
		.hinweis jf-icon {
			flex: none;
			margin-top: 2px;
		}
	`,
})
export class Dokumente {
	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	private readonly ereignisse = inject(TESTEREIGNISSE);
	protected readonly auswahl = inject(OfflineAuswahl);
	protected readonly offline = this.auswahl.ids;

	protected readonly gruppen = computed(() =>
		KATEGORIEN.map((kategorie) => ({
			kategorie,
			dokumente: this.store.stand().dokumente.filter((d) => d.kategorie === kategorie),
		})).filter((g) => g.dokumente.length),
	);

	protected oeffnen(d: Dokument): void {
		this.meldung.zeige('Im Entwurf nicht herunterladbar');
		this.ereignisse.next({ art: 'dokumentGeoeffnet', id: d.id });
	}
}
