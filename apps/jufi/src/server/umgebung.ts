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
	/** Ausgehender Mailserver; lokal Mailpit. Zugangsdaten nur, wenn der Server sie verlangt. */
	smtp: { host: string; port: number; user?: string; pass?: string };
	mailAbsender: string;
	/** Reply-To: Antworten auf Systemmails sollen bei einem Menschen landen, nicht beim Absenderpostfach. */
	mailAntwort: string;
	/** Steht vor jedem Betreff; leer in Produktion. */
	mailBetreffPraefix: string;
	/**
	 * Nur unter ng serve: Port, auf dem der Hub lauscht (proxy.conf.json leitet /<slug>/ws dorthin,
	 * Plan-Entscheidung 12). Im Betrieb haengt der Hub am Server aus app.listen und braucht keinen.
	 */
	wsDevPort: number;
	/**
	 * Verzeichnis der hochgeladenen Dateien (Volume jufi-dateien unter /daten im Betrieb). Pflicht und ohne
	 * Vorgabe: Ein Pfad, der still ins Arbeitsverzeichnis des Containers fiele, liesse Uploads
	 * mit dem Container verschwinden, ohne dass jemand es merkt. Verworfen: Vorgabe unter dem
	 * Arbeitsverzeichnis wie bei JUFI_WS_DEV_PORT -- dort ist ein Fehlwert harmlos, hier nicht.
	 */
	dateienPfad: string;
}

/** Steht so auch in apps/jufi/proxy.conf.json; wer ihn aendert, aendert beide. */
export const WS_DEV_PORT_VORGABE = 4201;

const MAIL_PFLICHT = ['SMTP_HOST', 'SMTP_PORT', 'MAIL_ABSENDER', 'MAIL_ANTWORT'] as const;

const PFAD_PFLICHT = ['DATEIEN_PFAD'] as const;

/**
 * Wirft mit allen Beanstandungen auf einmal (assertSecrets), nie mit den Werten.
 * TOTP_ENC_KEY und DATABASE_URL werden mitgeprueft, stehen aber nicht im
 * Ergebnis: encryptSecret und der Prisma-Client lesen sie selbst.
 */
export function umgebungAusEnv(env: Record<string, string | undefined>): Umgebung {
	assertSecrets(env);
	// Eigene Pruefung statt assertSecrets zu erweitern: das sind keine Geheimnisse
	// und gehoeren nicht in die Bibliothek fuer die Anmeldung. Wie dort nennt die
	// Meldung nur die Namen, nie Werte.
	const beanstandet: string[] = [...MAIL_PFLICHT, ...PFAD_PFLICHT].filter((name) => !env[name]);
	const port = Number(env['SMTP_PORT']);
	if (env['SMTP_PORT'] && !istPort(port)) {
		beanstandet.push('SMTP_PORT (keine Portnummer)');
	}
	// Leer wie nicht gesetzt, wie bei den WebAuthn-Werten: Die .env-Vorlage fuehrt Variablen als "".
	const wsDevPort = env['JUFI_WS_DEV_PORT'] ? Number(env['JUFI_WS_DEV_PORT']) : WS_DEV_PORT_VORGABE;
	if (!istPort(wsDevPort)) beanstandet.push('JUFI_WS_DEV_PORT (keine Portnummer)');
	if (beanstandet.length > 0) {
		throw new Error(`Umgebung unvollstaendig oder ungueltig: ${beanstandet.join(', ')}`);
	}
	return {
		// Nach assertSecrets gesetzt; der Typ weiss das nicht.
		basisUrl: env['BASIS_URL'] ?? '',
		sitzungsGeheimnis: env['SESSION_SECRET'] ?? '',
		// Die .env-Vorlage fuehrt beide als "" -- leer soll wie nicht gesetzt wirken,
		// sonst haette resolveRelyingParty eine leere rpId.
		webauthnRpId: env['WEBAUTHN_RP_ID'] || undefined,
		webauthnOrigin: env['WEBAUTHN_ORIGIN'] || undefined,
		smtp: {
			host: env['SMTP_HOST'] ?? '',
			port,
			// Leer wie nicht gesetzt: nodemailer wuerde sonst mit leerem Benutzer eine Anmeldung versuchen.
			user: env['SMTP_USER'] || undefined,
			pass: env['SMTP_PASS'] || undefined,
		},
		mailAbsender: env['MAIL_ABSENDER'] ?? '',
		mailAntwort: env['MAIL_ANTWORT'] ?? '',
		mailBetreffPraefix: env['MAIL_BETREFF_PRAEFIX'] ?? '',
		wsDevPort,
		dateienPfad: env['DATEIEN_PFAD'] ?? '',
	};
}

function istPort(n: number): boolean {
	return Number.isInteger(n) && n > 0 && n < 65536;
}
