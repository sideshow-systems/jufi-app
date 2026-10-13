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

	remaining(key: string): number {
		return remainingLockoutMs(this.states.get(key), this.now());
	}

	isLocked(key: string): boolean {
		return this.remaining(key) > 0;
	}

	fail(key: string): AttemptState {
		const next = recordFailure(this.states.get(key), this.now());
		this.states.set(key, next);
		return next;
	}

	reset(key: string): void {
		this.states.delete(key);
	}
}
