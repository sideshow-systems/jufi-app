import { createPrismaClient, mitAenderung, vereinDb, type PrismaClient } from '@jufi/db';
import { threadSegment } from '@jufi/domain';

/**
 * Daten fuer den Thread-Teil des Ablaufs, direkt in der Datenbank des E2E-Laufs. Der Aufbau legt die
 * URL in E2E_DATABASE_URL (aufbau.ts); die Worker erben sie wie TESTPASSWORT.
 *
 * Bowling legt die Leitung im Ablauf ueber den Editor an; hier steht nur, was die Oberflaeche nicht
 * lohnt: zehn Nachrichten im Austausch, die ueber die Oberflaeche zehnmal denselben Sendeweg pruefen
 * wuerden. Verworfen: den Demo-Verein des CLI einspielen -- der Ablauf prueft den Verein, den er
 * selbst aufgebaut hat (Admin, Leitung, Mutter, Kind), und ein zweiter Verein brauchte eigene Sitzungen.
 */

const NACHRICHTEN_AUSTAUSCH = [
	'Willkommen im Austausch der Jugendsprecher.',
	'Hier sammeln wir Ideen fuer die naechsten Gruppenstunden und stimmen sie mit der Leitung ab.',
	'Wer hat Lust, im Herbst eine Nachtangelei zu planen? Bitte kurz melden, dann suchen wir einen Termin.',
	'Die Gewaesserkarte haengt im Vereinsheim, ein Foto davon schicke ich nach.',
	'Vergesst nicht, die Ruten nach dem Angeln trocken zu lagern.',
	'Am Samstag brauchen wir zwei Helfer fuer den Aufbau am Teich.',
	'Danke an alle, die beim letzten Mal mit angepackt haben.',
	'Neue Mitglieder bitte bei der Leitung vorstellen, damit wir ihnen die Regeln zeigen koennen.',
	'Fragen zur Fangstatistik bitte direkt hier stellen, dann sehen es alle.',
	'Wir treffen uns diesmal eine halbe Stunde frueher.',
];

async function mitDatenbank<T>(arbeit: (prisma: PrismaClient) => Promise<T>): Promise<T> {
	const url = process.env['E2E_DATABASE_URL'];
	if (!url) throw new Error('E2E_DATABASE_URL fehlt, lief der Aufbau?');
	const prisma = createPrismaClient({ connectionString: url });
	try {
		return await arbeit(prisma);
	} finally {
		// Ohne trennen blieben Verbindungen des Pools offen und der Worker haengte am Ende des Laufs.
		await prisma.$disconnect();
	}
}

/** Die ID der Person mit dieser E-Mail-Adresse im Verein; der Ablauf kennt sie sonst nur aus der Oberflaeche. */
export async function personIdMitMail(slug: string, email: string): Promise<string> {
	return mitDatenbank(async (prisma) => {
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug }, select: { id: true } });
		const person = await vereinDb(prisma, verein.id).person.findFirstOrThrow({
			where: { email },
			select: { id: true },
		});
		return person.id;
	});
}

/**
 * Fuellt den Jugendsprecher-Austausch mit ein paar Nachrichten der Leitung und liefert sein Segment.
 * Den Austausch hat der Verein von Anfang an (austauschAnlegen); er wird gesucht, nicht ein zweiter
 * angelegt, den die Datenbank ohnehin verweigerte (thread_ein_austausch).
 *
 * Geschrieben wird wie in den Routen ueber mitAenderung, je Nachricht eine eigene Transaktion (ein
 * Stand je Transaktion), damit Vereinsstand und letzte Aktivitaet stimmen. Ohne die Nachrichten liesse
 * sich im Layouttest nicht messen, ob die letzte Nachricht nach dem Scrollen ueber dem Eingabefeld
 * endet: Die Seite waere kuerzer als der Bildschirm. Nur der Austausch, nicht Bowling: Dort zaehlt der
 * Ablauf die ungelesenen Eintraege des Kindes.
 */
export async function fuelleAustausch(slug: string, leitungId: string, jetzt: Date): Promise<string> {
	return mitDatenbank(async (prisma) => {
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug }, select: { id: true } });
		const vereinId = verein.id;
		const db = vereinDb(prisma, vereinId);

		const austausch = await db.thread.findFirstOrThrow({
			where: { art: 'JUGENDSPRECHER_AUSTAUSCH' },
			select: { id: true, titel: true },
		});
		for (const [nummer, text] of NACHRICHTEN_AUSTAUSCH.entries()) {
			const zeit = new Date(jetzt.getTime() + nummer * 1000);
			await db.$transaction((tx) =>
				mitAenderung(tx, vereinId, leitungId, zeit, async (stand) => {
					const eintrag = await tx.verlaufEintrag.create({
						data: { threadId: austausch.id, art: 'NACHRICHT', autorId: leitungId, text, stand, angelegtAm: zeit },
					});
					return {
						ergebnis: eintrag,
						aenderungen: [{ threadId: austausch.id, art: 'VERLAUF' as const, objektId: eintrag.id }],
					};
				}),
			);
		}
		return threadSegment(austausch.id, austausch.titel);
	});
}
