import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generate } from 'otplib';
import { decryptSecret, encryptSecret, generateTotpSecret, TOTP_ISSUER, totpUri, verifyTotp } from './totp.js';

describe('TOTP', () => {
	it('erzeugt ein Secret in Base32', () => {
		expect(generateTotpSecret()).toMatch(/^[A-Z2-7]+$/);
	});

	it('bestätigt einen gültigen Code', async () => {
		const secret = generateTotpSecret();
		expect(await verifyTotp(secret, await generate({ secret }))).toBe(true);
	});

	it('lehnt einen falschen Code ab', async () => {
		const secret = generateTotpSecret();
		expect(await verifyTotp(secret, '000000')).toBe(false);
	});

	it('akzeptiert einen Code mit Leerzeichen', async () => {
		const secret = generateTotpSecret();
		const code = await generate({ secret });
		expect(await verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
	});

	it('liefert false statt zu werfen bei Unsinn', async () => {
		expect(await verifyTotp('kein-base32!', 'abcdef')).toBe(false);
	});

	it('baut eine otpauth-URI mit Aussteller', () => {
		const uri = totpUri('JBSWY3DPEHPK3PXP', 'flo');
		expect(uri).toContain('otpauth://totp/');
		expect(TOTP_ISSUER).toBe('JuFi App');
		// Das Leerzeichen im Aussteller steht in der URI prozentkodiert.
		expect(decodeURIComponent(uri)).toContain('JuFi App');
		expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
		expect(uri).toContain('flo');
	});
});

describe('Verschlüsselung des Secrets', () => {
	const KEY = Buffer.alloc(32, 7).toString('base64');

	beforeEach(() => {
		process.env['TOTP_ENC_KEY'] = KEY;
	});

	afterEach(() => {
		delete process.env['TOTP_ENC_KEY'];
	});

	it('verschlüsselt und entschlüsselt verlustfrei', () => {
		const secret = generateTotpSecret();
		expect(decryptSecret(encryptSecret(secret))).toBe(secret);
	});

	it('erzeugt bei gleichem Klartext verschiedene Chiffrate', () => {
		// Zufälliger IV: sonst wäre am Dump erkennbar, dass zwei Secrets gleich sind.
		expect(encryptSecret('ABCDEF')).not.toBe(encryptSecret('ABCDEF'));
	});

	it('erkennt Manipulation am Chiffrat', () => {
		const enc = encryptSecret('ABCDEF');
		const [iv, data, tag] = enc.split('.');
		const flipped = Buffer.from(data, 'base64');
		flipped[0] ^= 0xff;
		expect(() => decryptSecret([iv, flipped.toString('base64'), tag].join('.'))).toThrow();
	});

	it('lehnt ein unerwartetes Format ab', () => {
		expect(() => decryptSecret('nur-ein-teil')).toThrow(/Format/);
	});

	it('verlangt einen 32-Byte-Schlüssel', () => {
		process.env['TOTP_ENC_KEY'] = Buffer.alloc(16).toString('base64');
		expect(() => encryptSecret('x')).toThrow(/32 Byte/);
	});

	it('verlangt, dass der Schlüssel überhaupt gesetzt ist', () => {
		delete process.env['TOTP_ENC_KEY'];
		expect(() => encryptSecret('x')).toThrow(/TOTP_ENC_KEY/);
	});
});
