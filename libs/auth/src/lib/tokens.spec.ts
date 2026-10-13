import { describe, expect, it } from 'vitest';
import {
	generateRecoveryCode,
	generateLinkToken,
	generateRecoveryCodes,
	generateSessionToken,
	hashRecoveryCode,
	hashToken,
	normalizeRecoveryCode,
	RECOVERY_CODE_COUNT,
	safeEqualHex,
} from './tokens.js';

describe('Session-Token', () => {
	it('ist base64url und lang genug für 256 Bit', () => {
		const t = generateSessionToken();
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(Buffer.from(t, 'base64url')).toHaveLength(32);
	});

	it('ist bei 1000 Ziehungen kollisionsfrei', () => {
		const set = new Set(Array.from({ length: 1000 }, generateSessionToken));
		expect(set.size).toBe(1000);
	});

	it('wird stabil gehasht', () => {
		expect(hashToken('abc')).toBe(hashToken('abc'));
		expect(hashToken('abc')).not.toBe(hashToken('abd'));
		expect(hashToken('abc')).toHaveLength(64);
	});
});

describe('Link-Token', () => {
	it('generateLinkToken liefert 43 base64url-Zeichen und nie zweimal dasselbe', () => {
		const a = generateLinkToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(generateLinkToken()).not.toBe(a);
	});
});

describe('safeEqualHex', () => {
	it('erkennt Gleichheit', () => {
		expect(safeEqualHex(hashToken('x'), hashToken('x'))).toBe(true);
	});

	it('erkennt Ungleichheit', () => {
		expect(safeEqualHex(hashToken('x'), hashToken('y'))).toBe(false);
	});

	it('liefert false bei unterschiedlicher Länge statt zu werfen', () => {
		expect(safeEqualHex('aa', 'aabb')).toBe(false);
	});

	it('liefert false bei Nicht-Hex statt zu werfen', () => {
		expect(safeEqualHex('zz', 'zz')).toBe(false);
	});
});

describe('Recovery-Codes', () => {
	it('haben das Format ABCDE-FGHIJ-KLMNO', () => {
		expect(generateRecoveryCode()).toMatch(/^[ACDEFGHJKMNPQRTUVWXY34679]{5}(-[ACDEFGHJKMNPQRTUVWXY34679]{5}){2}$/);
	});

	it('enthalten keine verwechselbaren Zeichen', () => {
		// Codes werden von Papier abgetippt: 0/O, 1/I/L, 2/Z, 5/S, 8/B fehlen bewusst.
		const codes = generateRecoveryCodes(50).join('');
		for (const forbidden of ['0', 'O', '1', 'I', 'L', '2', 'Z', '5', 'S', '8', 'B']) {
			expect(codes, `enthält ${forbidden}`).not.toContain(forbidden);
		}
	});

	it('erzeugt standardmäßig zehn eindeutige Codes', () => {
		const codes = generateRecoveryCodes();
		expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
		expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
	});

	it('normalisiert Kleinschreibung, Bindestriche und Leerraum', () => {
		expect(normalizeRecoveryCode('acdef-ghjkm-npqrt')).toBe('ACDEFGHJKMNPQRT');
		expect(normalizeRecoveryCode(' ACDEF GHJKM NPQRT ')).toBe('ACDEFGHJKMNPQRT');
	});

	it('hasht formatunabhängig auf denselben Wert', () => {
		expect(hashRecoveryCode('acdef-ghjkm-npqrt')).toBe(hashRecoveryCode('ACDEFGHJKMNPQRT'));
	});

	it('hasht verschiedene Codes verschieden', () => {
		expect(hashRecoveryCode('ACDEF-GHJKM-NPQRT')).not.toBe(hashRecoveryCode('ACDEF-GHJKM-NPQRU'));
	});
});
