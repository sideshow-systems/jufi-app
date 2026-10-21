import { computed, inject, Injectable, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ThreadApi } from './thread-api';

/**
 * Die Thread-Liste der Huelle, damit die untere Leiste ihren Punkt "neu" zeigen kann, ohne dass die
 * Seite "Threads" offen ist. Die Huelle stellt sie bereit (providers), nicht die Wurzel: Pro Verein
 * und Sitzung gibt es genau eine Huelle, und die Liste darf beim Verlassen des Vereins nicht
 * stehenbleiben. Die Listenseite holt sich dieselbe Instanz und zeigt dieselben Daten, statt ein
 * zweites Mal zu fragen (verworfen: je eine eigene Anfrage von Leiste und Seite, das waeren zwei
 * Antworten, die sich widersprechen koennen).
 *
 * Neu laden muss nach jeder Navigation, weil Lesen und Antworten den Stand "neu" aendern; ein
 * Zeitgeber oder eine Verbindung zum Server kaeme erst mit TP4 und waere hier mehr als noetig.
 */
@Injectable()
export class ThreadUebersicht {
	private readonly api = inject(ThreadApi);

	/** Gesetzt von der Huelle; ohne Slug ruht die Ressource und schickt nichts. */
	readonly slug = signal<string | null>(null);

	readonly liste = rxResource({
		params: () => this.slug() ?? undefined,
		stream: ({ params }) => this.api.liste(params, {}),
	});

	/** Irgendeine Zeile ist neu. Waehrend des Neuladens bleibt der alte Wert stehen, der Punkt blinkt nicht. */
	readonly punkt = computed(() => (this.liste.hasValue() ? this.liste.value().threads.some((t) => t.neu) : false));

	/** Eine laufende Anfrage bleibt, die Ressource startet keine zweite; ohne Slug passiert nichts. */
	neuLaden(): void {
		this.liste.reload();
	}
}
