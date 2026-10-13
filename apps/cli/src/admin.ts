import { generateLinkToken, hashToken } from '@jufi/auth';
import type { PrismaClient } from '@jufi/db';
import { EINRICHTUNG_GUELTIG_MS, normalisiereBenutzername, pruefeBenutzername } from '@jufi/domain';
import { CliFehler } from './fehler.js';

export const BENUTZERNAME_REGEL =
	'Benutzername: 3 bis 30 Zeichen, Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.';

/**
 * Token und Hash entstehen hier und nur hier; zurueck geht das Token, in der
 * Datenbank steht nur der Hash. Das Token zeigt die Kommandozeile genau einmal.
 */
function neueEinrichtung(adminId: string, jetzt: Date) {
	const token = generateLinkToken();
	return {
		token,
		daten: {
			adminId,
			tokenHash: hashToken(token),
			ablauf: new Date(jetzt.getTime() + EINRICHTUNG_GUELTIG_MS),
		},
	};
}

/**
 * Legt einen Plattform-Admin ohne Passwort an und liefert das Einrichtungs-Token.
 * Den Admin legt nur die Kommandozeile an, nie die Oberflaeche: Wer an die
 * Oberflaeche kommt, soll sich keinen zweiten Admin schaffen koennen (Spec 7.1).
 */
export async function adminAnlegen(prisma: PrismaClient, benutzername: string, jetzt: Date): Promise<string> {
	const name = normalisiereBenutzername(benutzername);
	if (!pruefeBenutzername(name)) throw new CliFehler(BENUTZERNAME_REGEL);

	return prisma.$transaction(async (tx) => {
		if (await tx.plattformAdmin.findUnique({ where: { benutzername: name }, select: { id: true } })) {
			throw new CliFehler(`Admin ${name} gibt es schon.`);
		}
		const admin = await tx.plattformAdmin.create({ data: { benutzername: name } });
		const { token, daten } = neueEinrichtung(admin.id, jetzt);
		await tx.adminEinrichtung.create({ data: daten });
		return token;
	});
}

/**
 * Notausgang, wenn Passwort, TOTP und Passkeys verloren sind: raeumt alles weg,
 * womit man sich anmelden koennte, und gibt einen frischen Einrichtungslink aus.
 * Der Admin bleibt derselbe Datensatz, weil das Protokoll an seiner id haengt
 * (Restrict) -- Loeschen und neu Anlegen scheitert, sobald er etwas protokolliert hat.
 *
 * Alles in einer Transaktion: Mitten im Lauf abgebrochen stuende sonst ein Admin
 * ohne Zugangsdaten, aber mit alten Sitzungen da, oder umgekehrt.
 */
export async function adminZuruecksetzen(prisma: PrismaClient, benutzername: string, jetzt: Date): Promise<string> {
	const name = normalisiereBenutzername(benutzername);

	return prisma.$transaction(async (tx) => {
		const admin = await tx.plattformAdmin.findUnique({ where: { benutzername: name }, select: { id: true } });
		if (!admin) throw new CliFehler(`Admin ${name} gibt es nicht.`);

		const where = { adminId: admin.id };
		await tx.adminSession.deleteMany({ where });
		await tx.adminPasskey.deleteMany({ where });
		await tx.adminRecoveryCode.deleteMany({ where });
		// Auch die noch offene Einrichtung: Ein aelterer Link neben dem neuen bliebe eine zweite Tuer.
		await tx.adminEinrichtung.deleteMany({ where });
		await tx.webauthnChallenge.deleteMany({ where });
		await tx.plattformAdmin.update({
			where: { id: admin.id },
			data: { passwortHash: null, totpGeheimnis: null, totpAktivAm: null },
		});
		const { token, daten } = neueEinrichtung(admin.id, jetzt);
		await tx.adminEinrichtung.create({ data: daten });
		return token;
	});
}
