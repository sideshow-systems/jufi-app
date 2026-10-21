import { computed, inject, Injectable, Injector, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Echtzeit } from '../echtzeit';
import { nachlader } from './nachladen';
import { ThreadApi } from './thread-api';

/**
 * Die Thread-Liste der Huelle, damit die untere Leiste ihren Punkt "neu" zeigen kann, ohne dass die
 * Seite "Threads" offen ist. Die Huelle stellt sie bereit (providers), nicht die Wurzel: Pro Verein
 * und Sitzung gibt es genau eine Huelle, und die Liste darf beim Verlassen des Vereins nicht
 * stehenbleiben. Die Listenseite holt sich dieselbe Instanz und zeigt dieselben Daten, statt ein
 * zweites Mal zu fragen (verworfen: je eine eigene Anfrage von Leiste und Seite, das waeren zwei
 * Antworten, die sich widersprechen koennen).
 *
 * Neu geladen wird auf jedes Ereignis der Echtzeit: Jede Aenderung an einem Thread, den die Person
 * sieht, kann Zeile, Reihenfolge oder "neu" aendern, und ein Abgleich nennt nur Threads. Verworfen:
 * nur Ereignisse zu Threads der geladenen Liste, denn ein neu sichtbarer Thread steht dort noch nicht.
 * Ohne Verbindung laedt die Huelle bei Navigation neu (Entscheidung 9).
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

	private readonly nachladen = nachlader(this.liste, inject(Injector));

	constructor() {
		inject(Echtzeit)
			.ereignisse.pipe(takeUntilDestroyed())
			.subscribe(() => this.nachladen());
	}

	/**
	 * Entprellt und vorgemerkt (Entscheidung 10): Laeuft gerade eine Anfrage, folgt nach ihr genau
	 * eine weitere; ohne Slug passiert nichts.
	 */
	neuLaden(): void {
		this.nachladen();
	}
}
