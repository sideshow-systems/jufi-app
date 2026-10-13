/**
 * Token- und Recovery-Code-Erzeugung.
 *
 * Reine Funktionen ohne Datenbank, damit die kryptografisch relevanten
 * Eigenschaften testbar sind.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 32 Byte Entropie, base64url — reicht für ein Session-Token deutlich aus. */
export function generateSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * Token für Einmal-Links (Einladung, Passwort zurücksetzen). Gleiche Erzeugung
 * wie beim Session-Token, aber eigener Name: der Zweck steht am Aufruf, und
 * sollte ein Link-Token später kürzer oder anders gebaut werden, bleibt das
 * Session-Token davon unberührt.
 */
export function generateLinkToken(): string {
	return randomBytes(32).toString('base64url');
}

/**
 * Gespeichert wird nur der Hash des Tokens. SHA-256 genügt hier und ist richtig:
 * das Token hat volle 256 Bit Entropie, ein langsames Passwort-Hashing wäre
 * wirkungslos gegen Brute Force und würde nur jede Anfrage verlangsamen.
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Zeitkonstanter Vergleich zweier Hex-Hashes gleicher Länge. */
export function safeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length || a.length === 0 || a.length % 2 !== 0) return false;
	const bufA = Buffer.from(a, 'hex');
	const bufB = Buffer.from(b, 'hex');
	// Buffer.from(..., 'hex') verwirft ungültige Zeichen still. Ohne diese Prüfung
	// wären zwei Nicht-Hex-Strings als zwei leere Puffer "gleich".
	if (bufA.length !== a.length / 2 || bufB.length !== b.length / 2) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * Alphabet ohne verwechselbare Zeichen (kein 0/O, 1/I/L, 2/Z, 5/S, 8/B).
 * Recovery-Codes werden von Papier abgetippt, oft unter Stress.
 */
const RECOVERY_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
export const RECOVERY_CODE_COUNT = 10;
const GROUP_LENGTH = 5;
const GROUPS = 3;

/** Format: `ACDEF-GHJKM-NPQRT` — 15 Zeichen aus 25 Symbolen, rund 70 Bit. */
export function generateRecoveryCode(): string {
	const groups: string[] = [];
	for (let g = 0; g < GROUPS; g++) {
		let group = '';
		for (let i = 0; i < GROUP_LENGTH; i++) {
			group += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
		}
		groups.push(group);
	}
	return groups.join('-');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
	const codes = new Set<string>();
	// Kollisionen sind bei 70 Bit praktisch ausgeschlossen, aber ein Duplikat
	// wäre ein still verlorener Code — deshalb explizit ausschließen.
	while (codes.size < count) codes.add(generateRecoveryCode());
	return [...codes];
}

/**
 * Vor dem Vergleich normalisieren: Großschreibung, Bindestriche und Leerraum
 * egal. Wer den Code abtippt, soll nicht an der Formatierung scheitern.
 */
export function normalizeRecoveryCode(input: string): string {
	return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Recovery-Codes werden gehasht gespeichert, nie im Klartext. */
export function hashRecoveryCode(code: string): string {
	return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}
