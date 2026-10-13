/**
 * Prueft die sicherheitsrelevanten Umgebungsvariablen und die Basis-URL beim Start.
 *
 * **Warum das noetig war:** `TOTP_ENC_KEY` wurde erst geprueft, wenn er
 * gebraucht wird — also beim Anlegen eines Nutzers oder bei der Anmeldung. Ein
 * Schluessel mit 31 statt 32 Byte liess die App fehlerfrei starten,
 * `/api/health` blieb gruen, und der Fehler zeigte sich erst, wenn sich jemand
 * anmelden wollte. Auf einem Server, den man nach dem Deploy nicht sofort
 * benutzt, heisst das: der Deploy sieht gelungen aus und ist es nicht.
 *
 * Beim Start zu scheitern ist die richtige Reaktion. Der Container laeuft dann
 * in eine Neustartschleife, was im Compose-Status und im Healthcheck sofort
 * sichtbar ist — anders als eine stille Fehlkonfiguration.
 */

/** Mindestlaenge fuer das Signaturgeheimnis. 32 Zeichen sind kein Zufall: `openssl rand -base64 32` liefert 44. */
const MIN_SESSION_SECRET_LENGTH = 32;

/** AES-256 braucht genau 32 Byte. */
const TOTP_KEY_BYTES = 32;

function isAbsoluteHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

export interface SecretProblem {
	variable: string;
	problem: string;
}

/**
 * Sammelt alle Beanstandungen, statt bei der ersten abzubrechen — wer eine
 * Umgebung einrichtet, will alle Fehler auf einmal sehen.
 */
export function checkSecrets(env: Record<string, string | undefined> = process.env): SecretProblem[] {
	const problems: SecretProblem[] = [];

	const session = env['SESSION_SECRET'];
	if (!session) {
		problems.push({ variable: 'SESSION_SECRET', problem: 'ist nicht gesetzt' });
	} else if (session.length < MIN_SESSION_SECRET_LENGTH) {
		problems.push({
			variable: 'SESSION_SECRET',
			problem: `ist nur ${session.length} Zeichen lang, mindestens ${MIN_SESSION_SECRET_LENGTH} erwartet`,
		});
	}

	const totp = env['TOTP_ENC_KEY'];
	if (!totp) {
		problems.push({ variable: 'TOTP_ENC_KEY', problem: 'ist nicht gesetzt' });
	} else {
		// `Buffer.from(…, 'base64')` verschluckt ungueltige Zeichen still, statt zu
		// meckern. Deshalb zaehlt hier allein die Laenge des Ergebnisses.
		const bytes = Buffer.from(totp, 'base64').length;
		if (bytes !== TOTP_KEY_BYTES) {
			problems.push({
				variable: 'TOTP_ENC_KEY',
				problem: `ergibt ${bytes} Byte, genau ${TOTP_KEY_BYTES} erwartet (openssl rand -base64 32)`,
			});
		}
	}

	if (!env['DATABASE_URL']) {
		problems.push({ variable: 'DATABASE_URL', problem: 'ist nicht gesetzt' });
	}

	const basis = env['BASIS_URL'];
	if (!basis) {
		problems.push({ variable: 'BASIS_URL', problem: 'ist nicht gesetzt' });
	} else if (!isAbsoluteHttpUrl(basis)) {
		problems.push({ variable: 'BASIS_URL', problem: 'muss eine absolute http(s)-URL sein' });
	} else if (basis.endsWith('/')) {
		// Links in E-Mails entstehen als BASIS_URL + "/pfad". Ein Schrägstrich am
		// Ende ergäbe "//" im Link, den manche Mailprogramme und Proxys nicht
		// zusammenfassen. Verworfen: den Schrägstrich still abschneiden — dann
		// stimmte die Konfiguration nicht mit dem überein, was im Log steht.
		problems.push({ variable: 'BASIS_URL', problem: 'darf nicht mit einem Schrägstrich enden' });
	}

	return problems;
}

/**
 * Wirft mit einer Meldung, die alle Beanstandungen nennt. Die Werte selbst
 * stehen nie in der Meldung — ein Log ist kein Ort fuer Geheimnisse.
 */
export function assertSecrets(env: Record<string, string | undefined> = process.env): void {
	const problems = checkSecrets(env);
	if (problems.length === 0) return;
	const list = problems.map((p) => `  - ${p.variable} ${p.problem}`).join('\n');
	throw new Error(`Fehlerhafte Umgebung, Start abgebrochen:\n${list}`);
}
