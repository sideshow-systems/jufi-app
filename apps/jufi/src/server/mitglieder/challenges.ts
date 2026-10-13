import { WEBAUTHN_CHALLENGE_TTL_MS, type ChallengePurpose } from '@jufi/auth';
import type { VereinDb } from '@jufi/db';

/**
 * WebAuthn-Challenges der Vereine. Beides geht nur ueber vereinDb: Die Tabelle
 * teilt sich der Verein mit dem Admin-Bereich (admin/passkeys.ts), und vereinDb
 * haengt vereinId an jede Abfrage. Eine Challenge eines anderen Vereins oder
 * eine Admin-Challenge ohne vereinId ist hier deshalb unsichtbar.
 */

type Challenge = { challenge: string; purpose: ChallengePurpose; personId?: string; jetzt: Date };

/**
 * Raeumt vorher die abgelaufenen Zeilen dieses Vereins weg, damit es keinen
 * eigenen Aufraeum-Takt braucht (wie speichereAdminChallenge). Verworfen: ein
 * Zeitgeber, die Tabelle waechst nur durch Anmeldeversuche.
 */
export async function speichereChallenge(db: VereinDb, e: Challenge): Promise<void> {
	await db.webauthnChallenge.deleteMany({ where: { expiresAt: { lte: e.jetzt } } });
	await db.webauthnChallenge.create({
		data: {
			challenge: e.challenge,
			purpose: e.purpose,
			personId: e.personId,
			expiresAt: new Date(e.jetzt.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
		},
	});
}

/**
 * Loest eine Challenge ein: genau einmal. Geloescht wird zuerst, geprueft
 * danach -- eine abgelaufene oder fuer eine andere Person angelegte Challenge
 * ist damit auch verbraucht, und wer sie raet, hat keinen zweiten Versuch. Das Loeschen entscheidet, nicht das vorherige Lesen: deleteMany
 * zaehlt 1 nur fuer den einen Aufruf, der die Zeile wirklich entfernt hat,
 * zwei gleichzeitige Anfragen kaemen sonst beide durch. Verworfen: delete, das
 * fuer die zweite Anfrage wirft und ein try/catch um einen Prisma-Fehlercode
 * braeuchte.
 */
export async function nimmChallenge(db: VereinDb, e: Challenge): Promise<boolean> {
	const zeile = await db.webauthnChallenge.findFirst({ where: { challenge: e.challenge, purpose: e.purpose } });
	if (!zeile) return false;
	const { count } = await db.webauthnChallenge.deleteMany({ where: { id: zeile.id } });
	if (count !== 1) return false;
	if (zeile.expiresAt <= e.jetzt) return false;
	if (e.personId !== undefined && zeile.personId !== e.personId) return false;
	return true;
}
