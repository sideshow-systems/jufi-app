/**
 * Exponentielles Backoff für Login-Versuche, pro Konto und pro IP.
 *
 * Reine Zustandslogik ohne Timer und ohne Datenbank: die aktuelle Zeit wird
 * hineingegeben, damit das Verhalten deterministisch testbar ist.
 */

export interface AttemptState {
	failures: number;
	/** Zeitpunkt des letzten Fehlversuchs in ms. */
	lastFailureAt: number;
}

/** Ab dem vierten Fehlversuch wird gesperrt, dann verdoppelnd bis 15 Minuten. */
export const FREE_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 15 * 60 * 1_000;
/** Obergrenze für gemerkte Schlüssel, damit erfundene Kennungen den Speicher nicht füllen. */
export const MAX_SCHLUESSEL = 10_000;

export function lockoutMs(failures: number): number {
	if (failures <= FREE_ATTEMPTS) return 0;
	const exponent = failures - FREE_ATTEMPTS - 1;
	return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}

/** Verbleibende Sperrzeit in ms, 0 wenn ein Versuch erlaubt ist. */
export function remainingLockoutMs(state: AttemptState | undefined, now: number): number {
	if (!state) return 0;
	const until = state.lastFailureAt + lockoutMs(state.failures);
	return Math.max(0, until - now);
}

export function isLocked(state: AttemptState | undefined, now: number): boolean {
	return remainingLockoutMs(state, now) > 0;
}

export function recordFailure(state: AttemptState | undefined, now: number): AttemptState {
	return { failures: (state?.failures ?? 0) + 1, lastFailureAt: now };
}

/**
 * Ein In-Memory-Speicher genügt: es gibt einen Nutzer und einen Prozess. Bei
 * einem Neustart ist der Zähler weg — das ist hinnehmbar, weil davor noch TOTP
 * steht und zusätzlich fail2ban auf dem Host greift.
 */
export class AttemptTracker {
	private readonly states = new Map<string, AttemptState>();

	constructor(private readonly now: () => number = () => Date.now()) {}

	/**
	 * Ein Schlüssel, dessen letzter Fehlversuch länger als die Höchstsperre
	 * zurückliegt, wird vergessen. Anmeldenamen von Kindern sind erratbar: ohne
	 * Verfall sperrte ein Fehlversuch von letzter Woche die Kennung dauerhaft
	 * lang, und ein Angreifer könnte den Speicher mit erfundenen Kennungen füllen.
	 */
	private aktuell(key: string): AttemptState | undefined {
		const state = this.states.get(key);
		if (state && this.now() - state.lastFailureAt > MAX_DELAY_MS) {
			this.states.delete(key);
			return undefined;
		}
		return state;
	}

	has(key: string): boolean {
		return this.aktuell(key) !== undefined;
	}

	remaining(key: string): number {
		return remainingLockoutMs(this.aktuell(key), this.now());
	}

	isLocked(key: string): boolean {
		return this.remaining(key) > 0;
	}

	/**
	 * Ob alle Schluessel gezaehlt werden koennen, ohne eine aktive Sperre zu
	 * verdraengen. Der Aufrufer fragt vor dem Zaehlen, damit eine Anfrage mit
	 * mehreren Schluesseln ganz oder gar nicht gezaehlt wird. Die Schluessel der
	 * Anfrage selbst gelten als geschuetzt: ein eigener, ungesperrter Schluessel
	 * wird nicht fuer einen anderen der Anfrage verdraengt, sonst stimmte die
	 * Zusage "ganz oder gar nicht" nicht.
	 */
	platzFuer(keys: string[]): boolean {
		const neue = new Set(keys.filter((k) => !this.has(k))).size;
		const frei = MAX_SCHLUESSEL - this.states.size;
		if (neue <= frei) return true;
		return this.ohneSperre(keys) >= neue - frei;
	}

	/** Kuerzeste Restsperre aller gemerkten Schluessel in ms; sagt, wann fruehestens wieder Platz wird. */
	naechsteFreigabeMs(): number {
		let kleinste = MAX_DELAY_MS;
		// Loeschen waehrend der Iteration einer Map ist in JavaScript erlaubt
		// (`remaining` verwirft verfallene Schluessel), eine Kopie ist unnoetig.
		for (const key of this.states.keys()) {
			const rest = this.remaining(key);
			if (rest > 0) kleinste = Math.min(kleinste, rest);
		}
		return kleinste;
	}

	private ohneSperre(geschuetzt: readonly string[]): number {
		let n = 0;
		for (const key of this.states.keys()) {
			if (!geschuetzt.includes(key) && this.remaining(key) === 0) n++;
		}
		return n;
	}

	/**
	 * Zaehlt einen Fehlversuch. `undefined` heisst: der Schluessel ist neu, der
	 * Speicher voll und jeder gemerkte Schluessel gesperrt -- der neue wird
	 * abgelehnt (fail-closed, siehe `platzFuer`). `geschuetzt` sind die weiteren
	 * Schluessel derselben Anfrage, die nicht verdraengt werden duerfen.
	 *
	 * Restrisiko der Verdraengung: ungesperrte und noch nicht eskalierte Zaehler
	 * sind verdraengbar. Wer ca. 10 000 neue Schluessel einschleust (je
	 * Zuruecksetzen), setzt Zaehler unterhalb der Sperrschwelle zurueck; eine
	 * laufende Sperre bleibt. Kosten von fail-closed: es gibt einen gemeinsamen
	 * Tracker, 10 000 gesperrte Fremdschluessel blockieren also alle neuen
	 * Schluessel, auch den des Admins. Spaetere Option: getrennte Tracker oder
	 * Kontingente je Praefix (m-ip, m, admin ...).
	 */
	fail(key: string, geschuetzt: readonly string[] = []): AttemptState | undefined {
		const vorher = this.aktuell(key);
		if (!vorher && this.states.size >= MAX_SCHLUESSEL && !this.verdraenge([key, ...geschuetzt])) return undefined;
		const next = recordFailure(vorher, this.now());
		// Neu einfuegen statt ueberschreiben, damit die Map-Reihenfolge der letzten
		// Aktivitaet (dem letzten Fehlversuch) folgt. Nur `fail` aendert sie; Lesen
		// (`has`, `remaining`) laesst sie unberuehrt.
		this.states.delete(key);
		this.states.set(key, next);
		return next;
	}

	/**
	 * Nimmt einen Fehlversuch zurueck: ein Erfolg erstattet nur seine eigene
	 * Reservierung, die Fehlversuche anderer bleiben stehen. `lastFailureAt`
	 * bleibt, sonst verlaengerte die Erstattung eine laufende Sperre. Verworfen:
	 * den Schluessel bei Erfolg ganz zuruecksetzen -- dann loeschte ein eigenes
	 * Konto den Zaehler eines Angreifers derselben IP.
	 */
	erstatte(key: string): void {
		const state = this.aktuell(key);
		if (!state || state.failures <= 0) return;
		if (state.failures === 1) this.states.delete(key);
		else this.states.set(key, { ...state, failures: state.failures - 1 });
	}

	/**
	 * Entfernt den aeltesten Schluessel ohne aktive Sperre. Gesperrte bleiben,
	 * auch wenn sie die aeltesten sind. Verworfen: weiter schlicht den aeltesten
	 * zu entfernen -- ein Angreifer loeschte so mit 10 000 erfundenen Schluesseln
	 * eine laufende Sperre. Sind alle gesperrt, wird nichts entfernt (der Aufrufer
	 * lehnt den neuen Schluessel ab): Verworfen: den neuen Schluessel ungezaehlt
	 * durchlassen -- dann umginge, wer den Speicher voller Sperren haelt, jeden
	 * Backoff fuer neue Schluessel.
	 */
	private verdraenge(geschuetzt: readonly string[]): boolean {
		for (const key of this.states.keys()) {
			if (!geschuetzt.includes(key) && this.remaining(key) === 0) {
				this.states.delete(key);
				return true;
			}
		}
		return false;
	}

	reset(key: string): void {
		this.states.delete(key);
	}
}
