import type { SignalAenderung, SignalEintrag } from '@jufi/domain';

/**
 * Was die Routen dem Echtzeit-Teil melden.
 *
 * `aenderung`: Eine Transaktion ist committet; Stand, Aenderungen und die Verlaufseintraege,
 * deren Inhalt die Route kennt. `pruefen`: Im Umfeld eines Vereins hat sich etwas geaendert,
 * das Sitzungen beenden kann; die offenen Sockets des Vereins pruefen sich neu.
 */
export type BusEreignis =
	| {
			typ: 'aenderung';
			vereinId: string;
			stand: number;
			aenderungen: readonly SignalAenderung[];
			eintraege: readonly SignalEintrag[];
	  }
	| { typ: 'pruefen'; vereinId: string };

/**
 * Der Draht zwischen den Routen und dem Hub (Plan-Entscheidung 1): Routen kennen nur
 * `deps.bus` und melden nach dem Commit, der Hub abonniert. Verworfen: Routen rufen den Hub
 * direkt -- jeder Routen-Test braeuchte dann einen Hub, und unter ng serve lebt der Hub auf
 * einem eigenen Port, die Routen koennten ihn nicht ohne weiteres erreichen.
 *
 * Die Zustellung ist synchron und ohne Warteschlange: Die Reihenfolge der Meldungen ist die
 * der Commits, die der Aufrufer hier hineingibt. Ein Abonnent, der wirft (oder dessen Promise
 * scheitert), haelt die anderen nicht auf und nicht die Route, deren Antwort schon feststeht.
 * Geloggt wird nur der Name des Fehlers (Spec 4.4): message und Stack koennen Inhalte tragen.
 */
export class Bus {
	private readonly abonnenten = new Set<(e: BusEreignis) => void>();

	melde(e: BusEreignis): void {
		// Eine Kopie, denn ein Abonnent darf sich beim Zustellen abbestellen.
		for (const abonnent of [...this.abonnenten]) {
			try {
				const ergebnis: unknown = abonnent(e);
				if (ergebnis instanceof Promise) ergebnis.catch(logge);
			} catch (error) {
				logge(error);
			}
		}
	}

	/** Liefert die Funktion zum Abbestellen. */
	abonniere(f: (e: BusEreignis) => void): () => void {
		// Ein Umweg, damit dieselbe Funktion zweimal abonniert werden kann und jedes
		// Abbestellen nur ihr eigenes Abo trifft.
		const eintrag = (e: BusEreignis) => f(e);
		this.abonnenten.add(eintrag);
		return () => {
			this.abonnenten.delete(eintrag);
		};
	}
}

function logge(error: unknown): void {
	console.error('Bus-Abonnent fehlgeschlagen:', error instanceof Error ? error.name : typeof error);
}
