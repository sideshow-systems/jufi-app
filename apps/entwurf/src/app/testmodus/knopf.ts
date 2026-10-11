import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import { aktuellerPfad } from './ort';
import { TM_STIL } from './stil';
import { type Dialog, TestmodusService } from './testmodus';

/**
 * Schwebender Testmodus-Knopf (Spec TP1 5.2), unten links ueber der Leiste.
 * Ueber dem Eingabefeld des Verlaufs rueckt er per --eingabe-hoehe hoch.
 */
@Component({
	selector: 'jf-testmodus-knopf',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: {
		'[class.verwaltung]': 'inVerwaltung()',
		'[hidden]': '!sichtbar()',
		'(document:keydown.escape)': 'offen.set(false)',
	},
	template: `
		@if (offen()) {
			<div class="hinter" (click)="offen.set(false)"></div>
			<div class="menue" role="menu" aria-label="Testmodus">
				<button type="button" role="menuitem" (click)="personWechseln()">Person wechseln</button>
				<button type="button" role="menuitem" (click)="oeffne({ art: 'liste' })">Aufgabenliste</button>
				<button type="button" role="menuitem" (click)="oeffne({ art: 'rueckmeldung' })">Rückmeldung senden</button>
				<button type="button" role="menuitem" (click)="oeffne({ art: 'seite' })">Rückmeldung zu dieser Seite</button>
				<button type="button" role="menuitem" class="gefahr" (click)="oeffne({ art: 'zuruecksetzen' })">
					Entwurf zurücksetzen
				</button>
			</div>
		}
		<button
			type="button"
			class="tm-knopf haupt"
			[attr.aria-expanded]="offen()"
			aria-haspopup="menu"
			(click)="offen.set(!offen())"
		>
			<span aria-hidden="true">🧪</span>
			Test{{ name() ? ' · ' + name() : '' }}
		</button>
	`,
	styles: [
		TM_STIL,
		`
			:host {
				position: fixed;
				z-index: 90;
				left: calc(var(--a3) + var(--sicher-links));
				bottom: calc(56px + var(--sicher-unten) + var(--eingabe-hoehe, 0px) + var(--a3));
				display: grid;
				justify-items: start;
				gap: var(--a2);
			}
			:host(.verwaltung) {
				bottom: calc(var(--a4) + var(--sicher-unten));
			}
			:host([hidden]) {
				display: none;
			}
			.haupt {
				box-shadow: 0 4px 14px rgb(76 29 149 / 0.35);
				font-size: var(--schrift-klein);
			}
			.hinter {
				position: fixed;
				inset: 0;
			}
			.menue {
				position: relative;
				display: grid;
				min-width: 240px;
				padding: var(--a1);
				border: 2px solid var(--tm);
				border-radius: var(--radius);
				background: var(--karte);
				box-shadow: var(--schatten);
			}
			.menue button {
				min-height: var(--tippflaeche);
				padding: 0 var(--a3);
				border: 0;
				border-radius: var(--radius-klein);
				background: transparent;
				text-align: left;
				font-weight: 600;
			}
			.menue button:hover,
			.menue button:focus-visible {
				background: var(--tm-flaeche);
			}
			.menue .gefahr {
				color: var(--fehler);
			}
		`,
	],
})
export class TestmodusKnopf {
	private readonly testmodus = inject(TestmodusService);
	private readonly store = inject(EntwurfStore);
	private readonly router = inject(Router);
	private readonly pfad = aktuellerPfad();

	protected readonly offen = signal(false);
	protected readonly sichtbar = computed(() => !this.pfad().includes('/willkommen'));
	protected readonly inVerwaltung = computed(() => this.pfad().includes('/verwaltung'));
	protected readonly name = computed(() => (this.testmodus.zustand().person ? this.store.person().vorname : ''));

	protected oeffne(d: Dialog): void {
		this.offen.set(false);
		this.testmodus.dialog.set(d);
	}

	protected personWechseln(): void {
		this.offen.set(false);
		void this.router.navigateByUrl(`/${this.store.stand().verein.slug}/willkommen`);
	}
}
