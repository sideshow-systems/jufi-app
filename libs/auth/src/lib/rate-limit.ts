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
	 * mehreren Schluesseln ganz oder gar nicht gezaehlt wird.
	 */
	platzFuer(keys: string[]): boolean {
		const neue = new Set(keys.filter((k) => !this.has(k))).size;
		const frei = MAX_SCHLUESSEL - this.states.size;
		if (neue <= frei) return true;
		return this.ohneSperre() >= neue - frei;
	}

	/** Kuerzeste Restsperre aller gemerkten Schluessel in ms; sagt, wann fruehestens wieder Platz wird. */
	naechsteFreigabeMs(): number {
		let kleinste = MAX_DELAY_MS;
		for (const key of this.states.keys()) {
			const rest = this.remaining(key);
			if (rest > 0) kleinste = Math.min(kleinste, rest);
		}
		return kleinste;
	}

	private ohneSperre(): number {
		let n = 0;
		for (const key of [...this.states.keys()]) if (this.remaining(key) === 0) n++;
		return n;
	}

	/**
	 * Zaehlt einen Fehlversuch. `undefined` heisst: der Schluessel ist neu, der
	 * Speicher voll und jeder gemerkte Schluessel gesperrt -- der neue wird
	 * abgelehnt (fail-closed, siehe `platzFuer`).
	 */
	fail(key: string): AttemptState | undefined {
		const vorher = this.aktuell(key);
		if (!vorher && this.states.size >= MAX_SCHLUESSEL && !this.verdraenge()) return undefined;
		const next = recordFailure(vorher, this.now());
		// Neu einfuegen statt ueberschreiben, damit die Map-Reihenfolge der letzten
		// Aktivitaet (dem letzten Fehlversuch) folgt. Nur `fail` aendert sie; Lesen
		// (`has`, `remaining`) laesst sie unberuehrt.
		this.states.delete(key);
		this.states.set(key, next);
		return next;
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
	private verdraenge(): boolean {
		for (const key of [...this.states.keys()]) {
			if (this.remaining(key) === 0) {
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
