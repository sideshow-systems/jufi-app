import { describe, expect, it } from 'vitest';
import { AttemptTracker, FREE_ATTEMPTS, isLocked, lockoutMs, MAX_DELAY_MS, recordFailure } from './rate-limit.js';

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
});
