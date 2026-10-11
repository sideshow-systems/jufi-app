import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EntwurfStore } from '../daten/store';
import type { UmfrageModul } from '../daten/typen';
import { monatKurz, tagImMonat, uhrzeit, wochentagKurz } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { AbschnittComponent } from '../gestaltung/ui';
import { brauchtAntwort, type OffenerPunkt } from '../regeln/antworten';
import { naechsteTermine, neuigkeiten } from '../regeln/termine';
import { pfadZuThread } from './pfade';

/** Start als Dashboard (Rahmen 5.2): Braucht deine Antwort · Als Naechstes · Neu. */
@Component({
	selector: 'jf-start',
	imports: [RouterLink, IconComponent, AbschnittComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h1>Hallo {{ ich().vorname }}</h1>

		<jf-abschnitt [titel]="'Braucht deine Antwort · ' + offen().length">
			@for (p of offen(); track p.threadId + p.modulId + p.fuer) {
				<a class="punkt" [routerLink]="link(p)">
					<span class="text">
						<strong>{{ p.titel }}</strong>
						<span>{{ beschreibung(p) }}</span>
						@if (p.frist) {
							<span class="frist">bis {{ wtag(p.frist) }} {{ zeit(p.frist) }}</span>
						}
					</span>
					<span class="knopf primaer klein">{{ knopfText(p) }}</span>
				</a>
			} @empty {
				<p class="leer">Alles erledigt 🎉</p>
			}
		</jf-abschnitt>

		<jf-abschnitt titel="Als Nächstes">
			@for (e of termine(); track e.modul.id) {
				<a class="termin" [routerLink]="pfad(e.threadId)">
					<span class="datum">
						<strong>{{ tag(e.modul.beginn) }}</strong>
						<span>{{ monat(e.modul.beginn) }}</span>
					</span>
					<span class="text">
						<strong>{{ e.modul.titel ?? e.threadTitel }}</strong>
						<span>{{ wtag(e.modul.beginn) }} {{ zeit(e.modul.beginn) }} · {{ e.modul.ort }}</span>
					</span>
					<jf-icon name="vor" />
				</a>
			} @empty {
				<p class="leer">Keine Termine</p>
			}
		</jf-abschnitt>

		@if (neu().length) {
			<jf-abschnitt titel="Neu seit deinem letzten Besuch">
				@for (n of neu(); track n.threadId) {
					<a class="neu" [routerLink]="pfad(n.threadId)">
						<span class="text">
							<strong>{{ n.titel }}</strong>
							<span>{{ n.text }}</span>
						</span>
						<jf-icon name="vor" />
					</a>
				}
			</jf-abschnitt>
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
		a {
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
			gap: 2px;
		}
		.text span {
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		.text .frist {
			color: var(--warnung);
			font-weight: 600;
		}
		.punkt {
			border-left: 4px solid var(--akzent);
		}
		.datum {
			display: grid;
			place-items: center;
			width: 48px;
			height: 48px;
			flex: none;
			border-radius: var(--radius-klein);
			background: var(--akzent-flaeche);
			color: var(--akzent);
			line-height: 1.1;
		}
		.datum strong {
			font-size: 1.125rem;
		}
		.datum span {
			font-size: 0.6875rem;
			font-weight: 700;
			text-transform: uppercase;
		}
		jf-icon {
			color: var(--text-gedaempft);
		}
		.leer {
			margin: 0;
			color: var(--text-gedaempft);
		}
	`,
})
export class Start implements OnDestroy {
	private readonly store = inject(EntwurfStore);
	protected readonly ich = this.store.person;
	// Beim Oeffnen festgehalten: was "neu" ist, soll waehrend des Besuchs nicht verschwinden.
	private readonly seit = this.store.stand().letzterBesuch[this.store.ich()] ?? '';

	protected readonly offen = computed(() => brauchtAntwort(this.store.stand(), this.store.ich(), this.store.jetzt()));
	protected readonly termine = computed(() =>
		naechsteTermine(this.store.stand(), this.store.ich(), this.store.jetzt(), 3),
	);
	protected readonly neu = computed(() => neuigkeiten(this.store.stand(), this.store.ich(), this.seit));

	protected readonly tag = tagImMonat;
	protected readonly monat = monatKurz;
	protected readonly wtag = wochentagKurz;
	protected readonly zeit = uhrzeit;

	protected pfad(threadId: string): string {
		return pfadZuThread(this.store.stand(), threadId);
	}

	protected link(p: OffenerPunkt): string {
		return pfadZuThread(this.store.stand(), p.threadId, p.modulId);
	}

	protected beschreibung(p: OffenerPunkt): string {
		if (p.art === 'kosten') return `Kosten für ${p.label}`;
		if (p.art === 'helfer') return 'Helferliste: Trag dich ein';
		const m = this.store
			.stand()
			.threads.find((t) => t.id === p.threadId)
			?.module.find((x) => x.id === p.modulId) as UmfrageModul | undefined;
		return `${p.label}: ${m?.frage ?? 'Umfrage'}`;
	}

	protected knopfText(p: OffenerPunkt): string {
		return p.art === 'kosten' ? 'Bezahlen' : p.art === 'helfer' ? 'Eintragen' : 'Antworten';
	}

	ngOnDestroy(): void {
		this.store.besuchMerken(this.store.ich());
	}
}
