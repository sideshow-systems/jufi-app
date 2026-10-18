import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MeldungService } from '../gestaltung/meldung';
import { KarteComponent } from '../gestaltung/ui';
import { zeitpunktBerlin } from '../gestaltung/format';
import type { Einladung } from './admin-api';

/**
 * Der fertige Einladungstext mit Link, zum Kopieren und Weitergeben.
 * Der Admin schickt den Text selbst, etwa per Messenger; die Mail ist nur ein
 * zusaetzlicher Weg, den er bei Bedarf ankreuzt.
 */
@Component({
	selector: 'jf-einladung-anzeige',
	imports: [KarteComponent],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<jf-karte>
			<div class="text" tabindex="0" aria-label="Einladungstext">{{ einladung().text }}</div>
			<div class="reihe">
				<button type="button" class="knopf primaer" (click)="kopiere(einladung().text)">Text kopieren</button>
				<button type="button" class="knopf" (click)="kopiere(einladung().link)">Link kopieren</button>
			</div>
			@if (kopierenFehlt()) {
				<p class="klein fehler" role="alert">
					Kopieren geht hier nicht – klicke auf den Text, er wird markiert, und kopiere ihn von Hand.
				</p>
			}
			<p class="klein gedaempft">{{ frist() }}</p>
		</jf-karte>
	`,
	styles: `
		:host {
			display: block;
		}
		.text {
			margin: 0 0 var(--a3);
			padding: var(--a3);
			border: 1px solid var(--linie);
			border-radius: var(--radius-klein);
			background: var(--seite);
			white-space: pre-wrap;
			overflow-wrap: anywhere;
			/* Ein Klick markiert alles: Das ist der Weg, wenn die Zwischenablage nicht erreichbar ist. */
			user-select: all;
		}
		.reihe {
			display: flex;
			flex-wrap: wrap;
			gap: var(--a3);
		}
		p {
			margin: var(--a3) 0 0;
		}
		.fehler {
			color: var(--fehler);
		}
	`,
})
export class EinladungAnzeigeComponent {
	readonly einladung = input.required<Einladung>();

	// Die Frist kommt vom Server: Ein Reset fuer ein Kind mit Zugang gilt nur eine Stunde, eine
	// Einladung 14 Tage. Ein fester Satz stimmte nur fuer einen der beiden. Die Verwaltungs-Antwort
	// nennt noch keinen Ablauf; dort bleibt es bei den 14 Tagen der Leitungseinladung.
	protected readonly frist = computed(() => {
		const ablauf = this.einladung().ablauf;
		if (!ablauf) return 'Der Link gilt 14 Tage.';
		const [tag, zeit] = zeitpunktBerlin(ablauf).split(' ');
		return `Der Link gilt bis ${tag}, ${zeit} Uhr.`;
	});

	private readonly meldung = inject(MeldungService);
	protected readonly kopierenFehlt = signal(false);

	protected async kopiere(inhalt: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(inhalt);
			this.kopierenFehlt.set(false);
			this.meldung.zeige('Kopiert');
		} catch {
			// Ohne Zwischenablage (unsicherer Kontext, verweigert) bleibt das Markieren von Hand.
			this.kopierenFehlt.set(true);
		}
	}
}
