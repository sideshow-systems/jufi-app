import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import type { DateienModul, FotosModul, Thread } from '../daten/typen';
import { AbschnittComponent } from '../gestaltung/ui';
import { DateienBauteil } from '../module/dateien';
import { FotosBauteil } from '../module/fotos';
import { siehtThread } from '../regeln/sichtbarkeit';
import { pfadZuThread } from './pfade';

interface Abschnitt {
	thread: Thread;
	fotos: FotosModul[];
	dateien: DateienModul[];
}

/**
 * Alle Fotos und Dateien aus sichtbaren Threads, neueste Aktivitaet zuerst
 * (Rahmen 5.2). Dieselben Bauteile wie im Thread, nur ohne "Foto hinzufügen".
 */
@Component({
	selector: 'jf-medien',
	imports: [RouterLink, AbschnittComponent, FotosBauteil, DateienBauteil],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Medien</h1>
		@for (a of abschnitte(); track a.thread.id) {
			<jf-abschnitt [titel]="a.thread.titel">
				@for (m of a.fotos; track m.id) {
					<jf-fotos [modul]="m" [threadId]="a.thread.id" [vorschau]="true" />
				}
				@for (m of a.dateien; track m.id) {
					<jf-dateien [modul]="m" />
				}
				<a class="zum-thread" [routerLink]="pfad(a.thread)">Zum Thread</a>
			</jf-abschnitt>
		} @empty {
			<p class="gedaempft">Noch keine Fotos oder Dateien.</p>
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
		.zum-thread {
			display: inline-flex;
			align-items: center;
			min-height: var(--tippflaeche);
			color: var(--akzent);
			font-weight: 600;
			font-size: var(--schrift-klein);
		}
	`,
})
export class Medien {
	private readonly store = inject(EntwurfStore);

	protected readonly abschnitte = computed<Abschnitt[]>(() => {
		const stand = this.store.stand();
		return stand.threads
			.filter((t) => siehtThread(stand, this.store.ich(), t))
			.map((thread) => ({
				thread,
				fotos: thread.module.filter((m): m is FotosModul => m.typ === 'fotos'),
				dateien: thread.module.filter((m): m is DateienModul => m.typ === 'dateien'),
			}))
			.filter((a) => a.fotos.length || a.dateien.length)
			.sort((a, b) => b.thread.letzteAktivitaet.localeCompare(a.thread.letzteAktivitaet));
	});

	protected pfad(t: Thread): string {
		return pfadZuThread(this.store.stand(), t.id);
	}
}
