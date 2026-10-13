/**
 * TOTP nach RFC 6238 über otplib 13, plus Verschlüsselung des Secrets.
 *
 * Das TOTP-Secret liegt verschlüsselt in der Datenbank: ein Datenbank-Dump
 * allein darf nicht genügen, um den zweiten Faktor nachzubilden. Der Schlüssel
 * kommt aus `TOTP_ENC_KEY` und liegt nur in der Umgebung, nie im Dump.
 *
 * Hinweis zur Bibliothek: otplib 13 ist eine Neuschreibung. Das frühere
 * `authenticator`-Singleton gibt es nicht mehr; die API ist funktional
 * (`generateSecret`, `generateURI`, `verify`) und arbeitet mit Plugins.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';

export const TOTP_ISSUER = 'JuFi App';

/** Ein Zeitschritt Toleranz in beide Richtungen — 30 s Uhrendrift sind normal. */
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
	return generateSecret();
}

export function totpUri(secret: string, account: string): string {
	return generateURI({ issuer: TOTP_ISSUER, label: account, secret });
}

export async function verifyTotp(secret: string, token: string): Promise<boolean> {
	try {
		const result = await verify({
			secret,
			token: token.replace(/\s/g, ''),
			epochTolerance: EPOCH_TOLERANCE_SECONDS,
		});
		return result.valid;
	} catch {
		return false;
	}
}

// --- Verschlüsselung des Secrets ---------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function key(): Buffer {
	const raw = process.env['TOTP_ENC_KEY'];
	if (!raw) throw new Error('TOTP_ENC_KEY ist nicht gesetzt.');
	const buf = Buffer.from(raw, 'base64');
	if (buf.length !== 32) {
		throw new Error('TOTP_ENC_KEY muss 32 Byte base64-kodiert sein (openssl rand -base64 32).');
	}
	return buf;
}

/** Format: `iv.ciphertext.authTag`, alle Teile base64. */
export function encryptSecret(plain: string): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key(), iv);
	const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return [iv.toString('base64'), enc.toString('base64'), cipher.getAuthTag().toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
	const [ivB64, dataB64, tagB64] = stored.split('.');
	if (!ivB64 || !dataB64 || !tagB64) throw new Error('Verschlüsseltes TOTP-Secret hat ein unerwartetes Format.');
	const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
	decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
	return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
