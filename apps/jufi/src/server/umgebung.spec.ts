import { describe, expect, it } from 'vitest';
import { umgebungAusEnv } from './umgebung.js';

const GUELTIG = {
	SESSION_SECRET: 'x'.repeat(32),
	TOTP_ENC_KEY: Buffer.alloc(32, 1).toString('base64'),
	DATABASE_URL: 'postgresql://erfunden',
	BASIS_URL: 'https://jufi.test',
};

describe('umgebungAusEnv', () => {
	it('baut die Umgebung, leere WebAuthn-Werte werden undefined', () => {
		expect(umgebungAusEnv({ ...GUELTIG, WEBAUTHN_RP_ID: '', WEBAUTHN_ORIGIN: '' })).toEqual({
			basisUrl: 'https://jufi.test',
			sitzungsGeheimnis: 'x'.repeat(32),
			webauthnRpId: undefined,
			webauthnOrigin: undefined,
		});
	});

	it('uebernimmt gesetzte WebAuthn-Werte', () => {
		const u = umgebungAusEnv({ ...GUELTIG, WEBAUTHN_RP_ID: 'jufi.test', WEBAUTHN_ORIGIN: 'https://jufi.test' });
		expect(u.webauthnRpId).toBe('jufi.test');
		expect(u.webauthnOrigin).toBe('https://jufi.test');
	});

	it('wirft bei fehlenden Geheimnissen, ohne Werte zu nennen', () => {
		expect(() => umgebungAusEnv({ ...GUELTIG, SESSION_SECRET: 'kurz' })).toThrow(/SESSION_SECRET/);
		expect(() => umgebungAusEnv({ ...GUELTIG, SESSION_SECRET: 'kurz' })).not.toThrow(/kurz/);
	});
});
