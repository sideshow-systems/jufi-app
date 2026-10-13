/**
 * Passwort-Hashing mit Argon2id.
 *
 * Parameter nach OWASP-Empfehlung für Argon2id: 19 MiB Speicher, 2 Iterationen,
 * Parallelität 1. Der Login läuft einmal pro Sitzung, nicht pro Anfrage, deshalb
 * ist die konservative Einstellung auch auf einem kleinen Server vertretbar.
 *
 * Die Passwortregel (Mindestlänge, Sperrliste) steht bewusst nicht hier, sondern
 * in libs/domain: hwyd prüft die Länge in hashPassword, aber zwei Regeln an zwei
 * Orten würden auseinanderlaufen, und die Oberfläche braucht dieselbe Regel für
 * ihre Rückmeldung, ohne eine Hash-Bibliothek zu laden.
 */

import { hash, verify } from '@node-rs/argon2';

const OPTIONS = {
	// Algorithmus 2 = Argon2id
	algorithm: 2 as const,
	memoryCost: 19 * 1024,
	timeCost: 2,
	parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
}

/**
 * Wirft nicht bei falschem Passwort, sondern liefert false. Ein ungültiger
 * Hash-String liefert ebenfalls false, damit ein beschädigter Datensatz keinen
 * 500er erzeugt, der Rückschlüsse erlaubt.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
	try {
		return await verify(storedHash, password, OPTIONS);
	} catch {
		return false;
	}
}
