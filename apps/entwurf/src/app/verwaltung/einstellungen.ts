import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EntwurfStore } from '../daten/store';
import { vereinsfarben } from '../gestaltung/farben';
import { MeldungService } from '../gestaltung/meldung';
import { ThemaService } from '../gestaltung/thema';
import { ThemaWahlComponent } from '../gestaltung/thema-wahl';
import { KarteComponent } from '../gestaltung/ui';
import { VERWALTUNG_STIL } from './ansichten';

/** Vereinseinstellungen; die Farbe wirkt sofort in der ganzen App (Spec TP1 4.3). */
@Component({
	selector: 'jf-verwaltung-einstellungen',
	imports: [KarteComponent, ThemaWahlComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile"><h1>Einstellungen</h1></div>
		<jf-karte class="block">
			<label class="feld">
				Vereinsname
				<input [value]="verein().name" readonly />
			</label>
			<div class="logo">
				<img [src]="verein().logo" alt="Vereinslogo" width="64" height="64" />
				<button type="button" class="knopf leise" (click)="nichtMoeglich()">Logo ändern</button>
			</div>
		</jf-karte>
		<jf-karte class="block">
			<h2>Vereinsfarbe</h2>
			<div class="farbe">
				<input type="color" aria-label="Vereinsfarbe" [value]="verein().farbe" (input)="farbeSetzen($event)" />
				<code>{{ verein().farbe }}</code>
				<span class="muster hell" [style.background]="satz().hell.akzent" [style.color]="satz().hell.aufAkzent"
					>Hell</span
				>
				<span class="muster dunkel" [style.background]="satz().dunkel.akzent" [style.color]="satz().dunkel.aufAkzent"
					>Dunkel</span
				>
			</div>
			<p class="gedaempft klein">
				Die App passt den Ton bei Bedarf etwas an, damit Text auf der Farbe und die Farbe auf weißem bzw. dunklem Grund
				gut lesbar bleibt.
			</p>
		</jf-karte>
		<jf-karte class="block">
			<h2>Darstellung</h2>
			<jf-thema-wahl />
			<p class="gedaempft klein">Gilt nur auf diesem Gerät.</p>
		</jf-karte>
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			.block {
				display: grid;
				gap: var(--a3);
				max-width: 560px;
			}
			h2 {
				margin: 0;
			}
			.logo,
			.farbe {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: var(--a3);
			}
			.logo img {
				border-radius: 12px;
			}
			input[type='color'] {
				width: 56px;
				height: 44px;
				padding: 2px;
				border: 1px solid var(--linie);
				border-radius: var(--radius-klein);
				background: var(--karte);
				cursor: pointer;
			}
			.muster {
				padding: var(--a1) var(--a3);
				border-radius: var(--radius-pille);
				font-weight: 600;
				font-size: var(--schrift-klein);
			}
			p {
				margin: 0;
			}
		`,
	],
})
export class VerwaltungEinstellungen {
	private readonly store = inject(EntwurfStore);
	private readonly thema = inject(ThemaService);
	private readonly meldung = inject(MeldungService);
	protected readonly verein = computed(() => this.store.stand().verein);
	protected readonly satz = computed(() => vereinsfarben(this.verein().farbe));

	protected farbeSetzen(e: Event): void {
		const hex = (e.target as HTMLInputElement).value;
		this.store.vereinsfarbeSetzen(hex);
		// Sofort, ohne auf den effect in App zu warten — der gilt fuer Neuladen.
		this.thema.setzeVereinsfarbe(hex);
	}

	protected nichtMoeglich(): void {
		this.meldung.zeige('Im Entwurf nicht möglich');
	}
}
