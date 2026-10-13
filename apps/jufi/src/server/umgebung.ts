import { assertSecrets } from '@jufi/auth';

/**
 * Was die App aus der Umgebung braucht, einmal beim Start gelesen und geprueft.
 * Die Routen bekommen es ueber AppDeps statt selbst in process.env zu greifen:
 * so steht ein Fehler beim Start im Log und nicht erst bei der ersten Anmeldung,
 * und Tests geben feste Werte vor, ohne process.env umzubiegen.
 */
export interface Umgebung {
	/** Reiner Ursprung (assertSecrets prueft das); Origin-Pruefung und Links bauen darauf. */
	basisUrl: string;
	sitzungsGeheimnis: string;
	/** Leer heisst: aus dem Host-Header ableiten (resolveRelyingParty), lokal genuegt das. */
	webauthnRpId?: string;
	webauthnOrigin?: string;
}

/**
 * Wirft mit allen Beanstandungen auf einmal (assertSecrets), nie mit den Werten.
 * TOTP_ENC_KEY und DATABASE_URL werden mitgeprueft, stehen aber nicht im
 * Ergebnis: encryptSecret und der Prisma-Client lesen sie selbst.
 */
export function umgebungAusEnv(env: Record<string, string | undefined>): Umgebung {
	assertSecrets(env);
	return {
		// Nach assertSecrets gesetzt; der Typ weiss das nicht.
		basisUrl: env['BASIS_URL'] ?? '',
		sitzungsGeheimnis: env['SESSION_SECRET'] ?? '',
		// Die .env-Vorlage fuehrt beide als "" -- leer soll wie nicht gesetzt wirken,
		// sonst haette resolveRelyingParty eine leere rpId.
		webauthnRpId: env['WEBAUTHN_RP_ID'] || undefined,
		webauthnOrigin: env['WEBAUTHN_ORIGIN'] || undefined,
	};
}
