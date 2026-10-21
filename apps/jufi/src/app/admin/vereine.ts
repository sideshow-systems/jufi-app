import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MB, speicherText } from '@jufi/domain';
import { firstValueFrom } from 'rxjs';
import { datumDeutsch } from '../gestaltung/format';
import { KarteComponent, PilleComponent } from '../gestaltung/ui';
import { AdminApi, type VereinZeile } from './admin-api';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';

/** Alle Vereine der Plattform mit ihren Kennzahlen (Spec 7.3). */
@Component({
	selector: 'jf-admin-vereine',
	imports: [KarteComponent, PilleComponent, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="kopf">
			<h1>Vereine</h1>
			<a class="knopf primaer" routerLink="/admin/vereine/neu">Verein anlegen</a>
		</div>
		@if (ladefehler(); as text) {
			<jf-karte>
				<p>{{ text }}</p>
				<button type="button" class="knopf primaer" (click)="lade()">Nochmal versuchen</button>
			</jf-karte>
		} @else if (vereine(); as liste) {
			@if (liste.length === 0) {
				<p class="gedaempft">Noch kein Verein angelegt.</p>
			} @else {
				<jf-karte>
					<div class="rolle">
						<table>
							<thead>
								<tr>
									<th scope="col">Anzeigename</th>
									<th scope="col">Slug</th>
									<th scope="col">Status</th>
									<th scope="col" class="zahl">Jungfischer</th>
									<th scope="col" class="zahl">Erwachsene</th>
									<th scope="col" class="zahl">Zugänge</th>
									<th scope="col" class="zahl">Offene Einladungen</th>
									<th scope="col" class="zahl">Speicher</th>
									<th scope="col">Letzte Anmeldung</th>
								</tr>
							</thead>
							<tbody>
								@for (v of liste; track v.id) {
									<tr>
										<td>
											<a [routerLink]="['/admin/vereine', v.id]">{{ v.anzeigename }}</a>
										</td>
										<td>
											<code>{{ v.slug }}</code>
										</td>
										<td>
											@if (v.status === 'AKTIV') {
												<jf-pille art="ok">Aktiv</jf-pille>
											} @else {
												<jf-pille art="offen">Gesperrt</jf-pille>
											}
										</td>
										<td class="zahl">{{ v.kennzahlen.jungfischer }}</td>
										<td class="zahl">{{ v.kennzahlen.erwachsene }}</td>
										<td class="zahl">{{ v.kennzahlen.zugaenge }}</td>
										<td class="zahl">{{ v.kennzahlen.offeneEinladungen }}</td>
										<td class="zahl">{{ speicher(v) }}</td>
										<td>{{ anmeldung(v) }}</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</jf-karte>
			}
		} @else {
			<p class="gedaempft">Wird geladen …</p>
		}
	`,
	styles: `
		:host {
			display: block;
		}
		.kopf {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--a4);
			margin: 0 0 var(--a4);
		}
		h1 {
			margin: 0;
			font-size: var(--schrift-titel);
		}
		jf-karte {
			padding: 0;
		}
		/* Reicht die Breite einmal nicht, scrollt die Tabelle statt der Seite. */
		.rolle {
			overflow-x: auto;
		}
		table {
			width: 100%;
			border-collapse: collapse;
		}
		th,
		td {
			padding: var(--a3) var(--a4);
			border-bottom: 1px solid var(--linie);
			text-align: start;
			vertical-align: middle;
		}
		th {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
			font-weight: 600;
		}
		tbody tr:last-child td {
			border-bottom: 0;
		}
		.zahl {
			text-align: end;
			font-variant-numeric: tabular-nums;
		}
	`,
})
export class AdminVereineComponent implements OnInit {
	private readonly api = inject(AdminApi);
	private readonly router = inject(Router);

	protected readonly vereine = signal<VereinZeile[] | null>(null);
	protected readonly ladefehler = signal<string | null>(null);

	ngOnInit(): void {
		void this.lade();
	}

	protected anmeldung(v: VereinZeile): string {
		return v.kennzahlen.letzteAnmeldung ? datumDeutsch(v.kennzahlen.letzteAnmeldung) : '—';
	}

	protected speicher(v: VereinZeile): string {
		return `${speicherText(v.kennzahlen.speicherBytes)} von ${speicherText(v.kennzahlen.speicherGrenzeMb * MB)}`;
	}

	protected async lade(): Promise<void> {
		this.ladefehler.set(null);
		try {
			this.vereine.set((await firstValueFrom(this.api.vereine())).vereine);
		} catch (ursache) {
			const fehler = alsApiFehler(ursache);
			// Die Sitzung laeuft nach 12 Stunden ab, auch bei offener Seite (siehe Konto).
			if (fehler.status === 401) await this.router.navigateByUrl('/admin/anmelden');
			else
				this.ladefehler.set(
					fehler.status === 0 ? fehlertext(fehler) : `Die Vereine konnten nicht geladen werden: ${fehlertext(fehler)}`,
				);
		}
	}
}
