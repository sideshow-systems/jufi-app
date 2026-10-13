import { ADMIN_COOKIE } from '@jufi/auth';
import type { PlattformAdmin, PrismaClient } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { legeAdminSitzungAn } from './sitzung.js';

/**
 * Legt einen erfundenen Admin mit Sitzung an und liefert das Cookie dazu. Der
 * Name ist eindeutig, weil alle Testdateien dieselbe Datenbank teilen und
 * parallel laufen. Kein Passwort, kein TOTP: wer die Anmeldung prueft, legt
 * seinen Admin selbst an; hier geht es um alles hinter der Anmeldung.
 *
 * jetzt ist der Anmeldezeitpunkt; Tests mit eigener Uhr geben ihn vor, damit
 * die Sitzung zu ihrer Uhr passt und nicht zur Wanduhr.
 */
export async function meldeAdminAn(
	prisma: PrismaClient,
	jetzt: Date = new Date(),
): Promise<{ admin: PlattformAdmin; cookie: string }> {
	const admin = await prisma.plattformAdmin.create({
		data: { benutzername: `admin-${randomUUID().slice(0, 8)}` },
	});
	const token = await legeAdminSitzungAn(prisma, admin.id, jetzt);
	return { admin, cookie: `${ADMIN_COOKIE}=${token}` };
}
