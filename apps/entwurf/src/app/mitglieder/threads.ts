import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import type { Thread } from '../daten/typen';
import { relativeZeit } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { AbschnittComponent } from '../gestaltung/ui';
import { siehtThread } from '../regeln/sichtbarkeit';
import { istArchiviert } from '../regeln/termine';
import { pfadZuThread } from './pfade';

/** Thread-Liste (Spec TP1 4.1): Angepinnt, Aktiv nach letzter Aktivitaet, Archiv eingeklappt. */
@Component({
	selector: 'jf-threads',
	imports: [RouterLink, IconComponent, AbschnittComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Threads</h1>
		@for (gruppe of gruppen(); track gruppe.titel) {
			@if (gruppe.liste.length) {
				<jf-abschnitt [titel]="gruppe.titel">
					@for (t of gruppe.liste; track t.id) {
						<a [routerLink]="pfad(t)" class="zeile">
							<span class="text">
								<strong>{{ t.titel }}</strong>
								<span>{{ zeit(t) }}{{ t.veroeffentlicht ? '' : ' · Entwurf' }}</span>
							</span>
							@if (istNeu(t)) {
								<span class="neu">neu</span>
							}
							<jf-icon name="vor" />
						</a>
					}
				</jf-abschnitt>
			}
		}
		@if (archiv().length) {
			<details>
				<summary>Archiv · {{ archiv().length }}</summary>
				@for (t of archiv(); track t.id) {
					<a [routerLink]="pfad(t)" class="zeile">
						<span class="text">
							<strong>{{ t.titel }}</strong>
							<span>{{ zeit(t) }}</span>
						</span>
						<jf-icon name="vor" />
					</a>
				}
			</details>
		}
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
		.zeile {
			display: flex;
			align-items: center;
			gap: var(--a3);
			min-height: 56px;
			padding: var(--a3) var(--a4);
			background: var(--karte);
			border: 1px solid var(--linie);
			border-radius: var(--radius);
			color: var(--text);
			text-decoration: none;
		}
		.text {
			display: grid;
			flex: 1;
			min-width: 0;
		}
		.text span {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		.neu {
			padding: 2px 8px;
			border-radius: var(--radius-pille);
			background: var(--akzent);
			color: var(--auf-akzent);
			font-size: 0.6875rem;
			font-weight: 700;
		}
		jf-icon {
			color: var(--text-gedaempft);
		}
		details {
			display: grid;
			gap: var(--a2);
		}
		summary {
			min-height: var(--tippflaeche);
			display: flex;
			align-items: center;
			font-size: var(--schrift-klein);
			font-weight: 700;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--text-gedaempft);
			cursor: pointer;
		}
		details .zeile {
			margin-bottom: var(--a2);
		}
	`,
})
export class Threads {
	private readonly store = inject(EntwurfStore);

	private readonly sichtbar = computed(() =>
		this.store
			.stand()
			.threads.filter((t) => siehtThread(this.store.stand(), this.store.ich(), t))
			.sort((a, b) => b.letzteAktivitaet.localeCompare(a.letzteAktivitaet)),
	);
	protected readonly archiv = computed(() => this.sichtbar().filter((t) => istArchiviert(t, this.store.jetzt())));
	private readonly offen = computed(() => this.sichtbar().filter((t) => !istArchiviert(t, this.store.jetzt())));
	protected readonly gruppen = computed(() => [
		{ titel: 'Angepinnt', liste: this.offen().filter((t) => t.angepinnt) },
		{ titel: 'Aktiv', liste: this.offen().filter((t) => !t.angepinnt) },
	]);

	protected pfad(t: Thread): string {
		return pfadZuThread(this.store.stand(), t.id);
	}

	protected zeit(t: Thread): string {
		return relativeZeit(t.letzteAktivitaet, this.store.jetzt());
	}

	protected istNeu(t: Thread): boolean {
		return t.letzteAktivitaet > (this.store.stand().letzterBesuch[this.store.ich()] ?? '');
	}
}
