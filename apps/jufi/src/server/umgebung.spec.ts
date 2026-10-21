import { describe, expect, it } from 'vitest';
import { umgebungAusEnv } from './umgebung.js';

const GUELTIG = {
	SESSION_SECRET: 'x'.repeat(32),
	TOTP_ENC_KEY: Buffer.alloc(32, 1).toString('base64'),
	DATABASE_URL: 'postgresql://erfunden',
	BASIS_URL: 'https://jufi.test',
	SMTP_HOST: 'mail.jufi.test',
	SMTP_PORT: '587',
	MAIL_ABSENDER: 'app@jufi.test',
	MAIL_ANTWORT: 'kontakt@jufi.test',
};

describe('umgebungAusEnv', () => {
	it('baut die Umgebung, leere WebAuthn-Werte werden undefined', () => {
		expect(umgebungAusEnv({ ...GUELTIG, WEBAUTHN_RP_ID: '', WEBAUTHN_ORIGIN: '' })).toEqual({
			basisUrl: 'https://jufi.test',
			sitzungsGeheimnis: 'x'.repeat(32),
			webauthnRpId: undefined,
			webauthnOrigin: undefined,
			smtp: { host: 'mail.jufi.test', port: 587, user: undefined, pass: undefined },
			mailAbsender: 'app@jufi.test',
			mailAntwort: 'kontakt@jufi.test',
			mailBetreffPraefix: '',
			wsDevPort: 4201,
		});
	});

	it('liest JUFI_WS_DEV_PORT; leer gilt als nicht gesetzt', () => {
		expect(umgebungAusEnv({ ...GUELTIG, JUFI_WS_DEV_PORT: '4301' }).wsDevPort).toBe(4301);
		expect(umgebungAusEnv({ ...GUELTIG, JUFI_WS_DEV_PORT: '' }).wsDevPort).toBe(4201);
	});

	it.each(['abc', '0', '65536', '4201.5'])('wirft bei JUFI_WS_DEV_PORT %s, ohne den Wert zu nennen', (wert) => {
		expect(() => umgebungAusEnv({ ...GUELTIG, JUFI_WS_DEV_PORT: wert })).toThrow(/JUFI_WS_DEV_PORT/);
		expect(() => umgebungAusEnv({ ...GUELTIG, JUFI_WS_DEV_PORT: wert })).not.toThrow(wert);
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

	it('liest SMTP-Zugangsdaten und Betreffpraefix; leere Zugangsdaten gelten als nicht gesetzt', () => {
		const u = umgebungAusEnv({
			...GUELTIG,
			SMTP_USER: 'nutzer',
			SMTP_PASS: 'erfunden',
			MAIL_BETREFF_PRAEFIX: '[Lokal] ',
		});
		expect(u.smtp).toEqual({ host: 'mail.jufi.test', port: 587, user: 'nutzer', pass: 'erfunden' });
		expect(u.mailBetreffPraefix).toBe('[Lokal] ');
		expect(umgebungAusEnv({ ...GUELTIG, SMTP_USER: '', SMTP_PASS: '' }).smtp.user).toBeUndefined();
	});

	it.each(['SMTP_HOST', 'SMTP_PORT', 'MAIL_ABSENDER', 'MAIL_ANTWORT'])(
		'wirft ohne %s und nennt nur den Namen',
		(name) => {
			const env: Record<string, string | undefined> = { ...GUELTIG, [name]: undefined };
			expect(() => umgebungAusEnv(env)).toThrow(new RegExp(name));
			expect(() => umgebungAusEnv({ ...GUELTIG, [name]: '' })).toThrow(new RegExp(name));
			// Kein Wert einer anderen Variable gelangt in die Meldung.
			expect(() => umgebungAusEnv(env)).not.toThrow(/jufi\.test/);
		},
	);

	it('wirft bei einem Port, der keine Portnummer ist, ohne den Wert zu nennen', () => {
		expect(() => umgebungAusEnv({ ...GUELTIG, SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/);
		expect(() => umgebungAusEnv({ ...GUELTIG, SMTP_PORT: 'abc' })).not.toThrow(/abc/);
	});
});
