import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EntwurfStore } from '../daten/store';
import type { Thread } from '../daten/typen';
import { relativeZeit } from '../gestaltung/format';
import { IconComponent } from '../gestaltung/icon';
import { nameMitRolle } from '../gestaltung/texte';

/**
 * Verlauf eines Threads: Nachrichten und Systemzeilen in zeitlicher Folge.
 * Das Eingabefeld sitzt fest ueber der unteren Leiste, damit es beim Lesen
 * erreichbar bleibt; ein Abstandhalter am Ende haelt die letzte Nachricht frei.
 */
@Component({
	selector: 'jf-verlauf',
	imports: [FormsModule, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<ol>
			@for (e of eintraege(); track e.id) {
				@if (e.id === ersterNeuer()) {
					<li class="trenner" aria-label="Neue Einträge"><span>Neu</span></li>
				}
				@if (e.art === 'system') {
					<li class="system">{{ e.text }} · {{ zeit(e.zeit) }}</li>
				} @else {
					<li class="nachricht" [class.eigen]="e.von === ich()">
						<div class="kopf">
							<strong>{{ e.von === ich() ? 'Du' : name(e.von!) }}</strong>
							<span class="gedaempft klein">{{ zeit(e.zeit) }}</span>
						</div>
						<p>{{ e.text }}</p>
					</li>
				}
			} @empty {
				<li class="leer gedaempft">Noch keine Nachrichten.</li>
			}
		</ol>
		@if (schreibbar()) {
			<div class="abstand" aria-hidden="true"></div>
			<form class="eingabe" (submit)="senden($event)">
				<label class="feld">
					<span class="unsichtbar">{{ platzhalter() }}</span>
					<input
						name="text"
						autocomplete="off"
						enterkeyhint="send"
						[placeholder]="platzhalter()"
						[(ngModel)]="text"
						(keydown.enter)="senden($event)"
					/>
				</label>
				<button type="submit" class="knopf primaer nur-icon" aria-label="Senden" [disabled]="!text().trim()">
					<jf-icon name="senden" />
				</button>
			</form>
		}
	`,
	styles: `
		ol {
			display: grid;
			gap: var(--a3);
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.nachricht {
			max-width: 88%;
			padding: var(--a2) var(--a3);
			border-radius: var(--radius);
			border-top-left-radius: 4px;
			background: var(--karte);
			border: 1px solid var(--linie);
		}
		.nachricht.eigen {
			justify-self: end;
			border-radius: var(--radius);
			border-top-right-radius: 4px;
			background: var(--akzent-flaeche);
		}
		.kopf {
			display: flex;
			flex-wrap: wrap;
			gap: 0 var(--a2);
			align-items: baseline;
			font-size: var(--schrift-klein);
		}
		p {
			margin: 2px 0 0;
			white-space: pre-line;
			overflow-wrap: anywhere;
		}
		.system {
			justify-self: center;
			text-align: center;
			color: var(--text-gedaempft);
			font-size: var(--schrift-klein);
		}
		.trenner {
			display: flex;
			align-items: center;
			gap: var(--a2);
			color: var(--akzent);
			font-size: var(--schrift-klein);
			font-weight: 700;
		}
		.trenner::before,
		.trenner::after {
			content: '';
			flex: 1;
			border-top: 1px solid currentColor;
		}
		.abstand {
			height: 72px;
		}
		.eingabe {
			position: fixed;
			z-index: 15;
			left: 0;
			right: 0;
			bottom: calc(56px + var(--sicher-unten));
			display: flex;
			gap: var(--a2);
			max-width: 480px;
			margin: 0 auto;
			padding: var(--a2) var(--a4);
			background: var(--seite);
			border-top: 1px solid var(--linie);
		}
		.eingabe .feld {
			flex: 1;
			min-width: 0;
		}
	`,
})
export class VerlaufBauteil {
	readonly thread = input.required<Thread>();
	/** Zeitpunkt des letzten Besuchs; spaetere fremde Eintraege gelten als neu. */
	readonly seit = input<string | undefined>(undefined);

	private readonly store = inject(EntwurfStore);
	protected readonly ich = this.store.ich;
	protected readonly text = signal('');

	protected readonly eintraege = computed(() =>
		[...this.thread().verlauf].sort((a, b) => a.zeit.localeCompare(b.zeit)),
	);
	protected readonly ersterNeuer = computed(() => {
		const seit = this.seit();
		return seit ? this.eintraege().find((e) => e.zeit > seit && e.von !== this.ich())?.id : undefined;
	});
	protected readonly schreibbar = computed(() => this.thread().modus !== 'aushang');
	protected readonly platzhalter = computed(() =>
		this.thread().modus === 'chat' ? 'Nachricht schreiben' : 'Kommentar schreiben',
	);

	protected name(id: string): string {
		return nameMitRolle(this.store.stand(), id);
	}

	protected zeit(iso: string): string {
		return relativeZeit(iso, this.store.jetzt());
	}

	protected senden(e: Event): void {
		e.preventDefault();
		this.store.nachrichtSchreiben(this.thread().id, this.text());
		this.text.set('');
	}
}
