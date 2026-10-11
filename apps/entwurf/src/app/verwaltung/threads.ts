import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import type { Modus, Thread } from '../daten/typen';
import { relativeZeit } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { zielgruppeText } from '../gestaltung/texte';
import { PilleComponent } from '../gestaltung/ui';
import { istArchiviert } from '../regeln/termine';
import { VERWALTUNG_STIL } from './ansichten';

export const MODUS_TEXT: Record<Modus, string> = {
	aushang: 'Nur Aushang',
	kommentare: 'Mit Kommentaren',
	chat: 'Chat',
};

/** Thread-Liste der Verwaltung mit Filter aktiv/Archiv. */
@Component({
	selector: 'jf-verwaltung-threads',
	imports: [RouterLink, IconComponent, PilleComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="titelzeile">
			<h1>Threads</h1>
			<a class="knopf primaer" routerLink="neu"><jf-icon name="plus" /> Neuer Thread</a>
		</div>
		<div class="filter" role="group" aria-label="Filter">
			<button
				type="button"
				class="knopf klein"
				[class.primaer]="!archiv()"
				[attr.aria-pressed]="!archiv()"
				(click)="archiv.set(false)"
			>
				Aktiv
			</button>
			<button
				type="button"
				class="knopf klein"
				[class.primaer]="archiv()"
				[attr.aria-pressed]="archiv()"
				(click)="archiv.set(true)"
			>
				Archiv
			</button>
		</div>
		<div class="tabelle">
			<table>
				<thead>
					<tr>
						<th>Titel</th>
						<th>Zielgruppe</th>
						<th>Modus</th>
						<th>Letzte Aktivität</th>
						<th>Status</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					@for (t of liste(); track t.id) {
						<tr>
							<td>
								<strong>{{ t.titel }}</strong>
							</td>
							<td>{{ zielgruppe(t) }}</td>
							<td>{{ modus[t.modus] }}</td>
							<td>{{ zeit(t.letzteAktivitaet) }}</td>
							<td>
								<jf-pille [art]="!t.veroeffentlicht ? 'offen' : archiv() ? 'neutral' : 'ok'">
									{{ !t.veroeffentlicht ? 'Entwurf' : archiv() ? 'Archiv' : 'aktiv' }}
								</jf-pille>
							</td>
							<td class="aktionen">
								<a class="knopf leise klein" [routerLink]="[t.nr]">Bearbeiten</a>
								<a class="knopf leise klein" [routerLink]="[t.nr, 'antworten']">Antworten</a>
								<button type="button" class="knopf leise klein" (click)="archivieren(t)">
									{{ t.archiviert ? 'Wiederherstellen' : 'Archivieren' }}
								</button>
							</td>
						</tr>
					} @empty {
						<tr>
							<td colspan="6" class="gedaempft">Keine Threads.</td>
						</tr>
					}
				</tbody>
			</table>
		</div>
	`,
	styles: [
		VERWALTUNG_STIL,
		`
			.filter {
				display: flex;
				gap: var(--a2);
			}
			a.knopf {
				text-decoration: none;
			}
		`,
	],
})
export class VerwaltungThreads {
	private readonly store = inject(EntwurfStore);
	protected readonly modus = MODUS_TEXT;
	protected readonly archiv = signal(false);
	protected readonly liste = computed(() =>
		this.store
			.stand()
			.threads.filter((t) => istArchiviert(t, this.store.jetzt()) === this.archiv())
			.sort((a, b) => b.letzteAktivitaet.localeCompare(a.letzteAktivitaet)),
	);

	protected zielgruppe(t: Thread): string {
		return zielgruppeText(this.store.stand(), t.zielgruppe);
	}
	protected zeit(iso: string): string {
		return iso ? relativeZeit(iso, this.store.jetzt()) : '–';
	}
	protected archivieren(t: Thread): void {
		this.store.threadArchivieren(t.id, !t.archiviert);
	}
}
