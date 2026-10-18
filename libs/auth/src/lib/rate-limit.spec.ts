import { describe, expect, it } from 'vitest';
import {
	AttemptTracker,
	MAX_SCHLUESSEL,
	FREE_ATTEMPTS,
	isLocked,
	lockoutMs,
	MAX_DELAY_MS,
	recordFailure,
} from './rate-limit.js';

describe('lockoutMs', () => {
	it('sperrt die ersten Versuche nicht', () => {
		for (let i = 0; i <= FREE_ATTEMPTS; i++) expect(lockoutMs(i)).toBe(0);
	});

	it('verdoppelt ab dem vierten Fehlversuch', () => {
		expect(lockoutMs(4)).toBe(1_000);
		expect(lockoutMs(5)).toBe(2_000);
		expect(lockoutMs(6)).toBe(4_000);
		expect(lockoutMs(7)).toBe(8_000);
	});

	it('begrenzt auf 15 Minuten', () => {
		expect(lockoutMs(100)).toBe(MAX_DELAY_MS);
	});
});

describe('isLocked', () => {
	it('gilt nicht ohne Zustand', () => {
		expect(isLocked(undefined, 1_000)).toBe(false);
	});

	it('gilt während der Sperrzeit', () => {
		const state = { failures: 5, lastFailureAt: 1_000 };
		expect(isLocked(state, 1_500)).toBe(true);
	});

	it('endet genau am Ende der Sperrzeit', () => {
		const state = { failures: 5, lastFailureAt: 1_000 };
		expect(isLocked(state, 3_000)).toBe(false);
	});
});

describe('recordFailure', () => {
	it('zählt hoch und merkt den Zeitpunkt', () => {
		const a = recordFailure(undefined, 100);
		expect(a).toEqual({ failures: 1, lastFailureAt: 100 });
		expect(recordFailure(a, 200)).toEqual({ failures: 2, lastFailureAt: 200 });
	});
});

describe('AttemptTracker', () => {
	it('sperrt nach vier Fehlversuchen und gibt nach Ablauf frei', () => {
		let now = 0;
		const t = new AttemptTracker(() => now);
		for (let i = 0; i < 4; i++) t.fail('konto');
		expect(t.isLocked('konto')).toBe(true);
		now += 1_000;
		expect(t.isLocked('konto')).toBe(false);
	});

	it('hält Schlüssel getrennt, damit eine IP nicht das Konto sperrt', () => {
		const t = new AttemptTracker(() => 0);
		for (let i = 0; i < 5; i++) t.fail('ip:1.2.3.4');
		expect(t.isLocked('ip:1.2.3.4')).toBe(true);
		expect(t.isLocked('konto:flo')).toBe(false);
	});

	it('setzt bei erfolgreichem Login zurück', () => {
		const t = new AttemptTracker(() => 0);
		for (let i = 0; i < 5; i++) t.fail('konto');
		t.reset('konto');
		expect(t.isLocked('konto')).toBe(false);
	});

	it('Fehlversuche verfallen nach Ruhe', () => {
		let now = 0;
		const t = new AttemptTracker(() => now);
		for (let i = 0; i < 4; i++) t.fail('kind');
		expect(t.isLocked('kind')).toBe(true);
		now += 16 * 60 * 1_000;
		expect(t.remaining('kind')).toBe(0);
		expect(t.fail('kind')?.failures).toBe(1);
	});

	it('Der Speicher ist begrenzt', () => {
		const t = new AttemptTracker(() => 0);
		for (let i = 0; i <= MAX_SCHLUESSEL; i++) t.fail(`k${i}`);
		expect(t.has('k0')).toBe(false);
		expect(t.remaining('k0')).toBe(0);
		expect(t.has(`k${MAX_SCHLUESSEL}`)).toBe(true);
	});
});

describe('AttemptTracker: Ueberlauf', () => {
	/** Sperrt einen Schluessel (vier Fehlversuche). */
	function sperre(t: AttemptTracker, key: string): void {
		for (let i = 0; i <= FREE_ATTEMPTS; i++) t.fail(key);
	}

	it('Ueberlauf entfernt zuerst nicht gesperrte Schluessel, aelteste zuerst', () => {
		const t = new AttemptTracker(() => 0);
		sperre(t, 'gesperrt');
		t.fail('alt');
		t.fail('neu');
		for (let i = 0; i < MAX_SCHLUESSEL - 3; i++) t.fail(`k${i}`);
		expect(t.has('gesperrt') && t.has('alt') && t.has('neu')).toBe(true);
		t.fail('eins-zu-viel');
		// 'gesperrt' ist der aelteste Eintrag, bleibt aber; 'alt' geht als erster.
		expect(t.has('gesperrt')).toBe(true);
		expect(t.has('alt')).toBe(false);
		expect(t.has('neu')).toBe(true);
		t.fail('noch-einer');
		expect(t.has('neu')).toBe(false);
		expect(t.has('gesperrt')).toBe(true);
	});

	it('erneuter Fehlversuch macht einen Schluessel wieder juenger', () => {
		const t = new AttemptTracker(() => 0);
		t.fail('a');
		t.fail('b');
		t.fail('a');
		for (let i = 0; i < MAX_SCHLUESSEL - 2; i++) t.fail(`k${i}`);
		t.fail('ueberlauf');
		expect(t.has('b')).toBe(false);
		expect(t.has('a')).toBe(true);
	});

	it('Lesen aendert die Reihenfolge nicht', () => {
		const t = new AttemptTracker(() => 0);
		t.fail('a');
		t.fail('b');
		for (let i = 0; i < MAX_SCHLUESSEL - 2; i++) t.fail(`k${i}`);
		t.has('a');
		t.remaining('a');
		t.isLocked('a');
		t.fail('ueberlauf');
		expect(t.has('a')).toBe(false);
		expect(t.has('b')).toBe(true);
	});

	it('eine Sperre ueberlebt 10 000 Fremdschluessel', () => {
		const t = new AttemptTracker(() => 0);
		sperre(t, 'opfer');
		for (let i = 0; i < MAX_SCHLUESSEL; i++) t.fail(`fremd${i}`);
		expect(t.isLocked('opfer')).toBe(true);
		expect(t.has('fremd0')).toBe(false);
	});

	it('bei lauter Sperren wird ein neuer Schluessel abgelehnt', () => {
		const t = new AttemptTracker(() => 0);
		for (let i = 0; i < MAX_SCHLUESSEL; i++) sperre(t, `s${i}`);
		expect(t.platzFuer(['neu'])).toBe(false);
		expect(t.fail('neu')).toBeUndefined();
		expect(t.has('neu')).toBe(false);
		expect(t.isLocked('s0')).toBe(true);
		// Ein bekannter Schluessel zaehlt weiter.
		expect(t.platzFuer(['s0'])).toBe(true);
		expect(t.fail('s0')?.failures).toBe(5);
	});

	it('naechsteFreigabeMs nennt die kuerzeste Restsperre', () => {
		let now = 0;
		const t = new AttemptTracker(() => now);
		sperre(t, 'a');
		for (let i = 0; i < 5; i++) t.fail('b');
		now = 500;
		expect(t.naechsteFreigabeMs()).toBe(500);
	});
});
