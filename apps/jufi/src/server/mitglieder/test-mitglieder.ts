import { hashPassword, MITGLIEDER_COOKIE } from '@jufi/auth';
import { vereinDb, type PrismaClient, type Recht } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { legeSitzungAn } from './sitzung.js';

/**
 * Legt eine erfundene Person mit Zugang und Sitzung direkt in der Datenbank an
 * und liefert das Cookie dazu. Eindeutige Namen und Adressen, weil alle
 * Testdateien dieselbe Datenbank teilen und parallel laufen. Der Weg ueber
 * Einladung und Anmeldung steht in deren eigenen Tests; hier geht es um alles
 * dahinter.
 *
 * jetzt ist der Anmeldezeitpunkt; Tests mit eigener Uhr geben ihn vor, damit
 * die Sitzung zu ihrer Uhr passt und nicht zur Wanduhr.
 */
export async function legeMitgliedAn(
	prisma: PrismaClient,
	verein: { id: string; slug: string },
	e: {
		art: 'ERWACHSENER' | 'JUNGFISCHER';
		vorname?: string;
		nachname?: string;
		email?: string;
		anmeldename?: string;
		passwort?: string;
		rechte?: Recht[];
		jetzt?: Date;
	},
): Promise<{ personId: string; zugangId: string; cookie: string }> {
	const db = vereinDb(prisma, verein.id);
	const kuerzel = randomUUID().slice(0, 8);
	const person = await db.person.create({
		data: {
			art: e.art,
			vorname: e.vorname ?? 'Erika',
			nachname: e.nachname ?? 'Muster',
			// Die Kennung Erwachsener ist die Adresse, die der Jungfischer nur freiwillig hat.
			email: e.email ?? (e.art === 'ERWACHSENER' ? `person-${kuerzel}@example.test` : undefined),
			// Die Datenbank verlangt es bei Jungfischern (CHECK person_art_felder), verbietet es bei Erwachsenen.
			geburtsdatum: e.art === 'JUNGFISCHER' ? new Date('2015-05-05') : undefined,
			rechte: e.rechte ?? [],
		},
	});
	const zugang = await db.zugang.create({
		data: {
			personId: person.id,
			anmeldename: e.anmeldename ?? (e.art === 'JUNGFISCHER' ? `kind-${kuerzel}` : undefined),
			passwortHash: e.passwort === undefined ? undefined : await hashPassword(e.passwort),
		},
	});
	const token = await legeSitzungAn(db, { zugangId: zugang.id, jetzt: e.jetzt ?? new Date() });
	return { personId: person.id, zugangId: zugang.id, cookie: `${MITGLIEDER_COOKIE}=${token}` };
}
