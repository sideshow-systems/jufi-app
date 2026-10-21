import { randomUUID } from 'node:crypto';
import { createPrismaClient, mitAenderung, vereinDb, vermerkeUmfeld, type PrismaClient } from '@jufi/db';
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

/**
 * Legt einen Jungfischer an, dessen erziehungsberechtigte Mutter der Erwachsene ist, und liefert seine ID.
 * Geschrieben wird wie in POST /personen und PUT /personen/:id/familie/:erwachsenerId: eine Transaktion, die
 * zuerst mit vermerkeUmfeld den Stand erhoeht (und damit die Vereinszeile sperrt) und danach Person und
 * Bezugsperson schreibt, beide IDs als Umfeld-Aenderung. Ohne den Vermerk wuesste ein offener Client nie, dass
 * das Kind da ist.
 *
 * Direkt in der Datenbank statt ueber die Oberflaeche, weil der Ablauf Mia schon ueber das Formular anlegt
 * und ein zweites Kind denselben Weg nur wiederholte; es geht hier um das, was danach mit zwei Kindern
 * geschieht (Start, Antworten, Teilen). Der Bus bleibt still: Der Ablauf laedt die Seiten danach neu.
 */
export async function legeKindAn(
	slug: string,
	erwachsenerId: string,
	vorname: string,
	nachname: string,
): Promise<string> {
	return mitDatenbank(async (prisma) => {
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug }, select: { id: true } });
		const db = vereinDb(prisma, verein.id);
		const id = randomUUID();
		await db.$transaction(async (tx) => {
			await vermerkeUmfeld(tx, verein.id, erwachsenerId, new Date(), [id, erwachsenerId]);
			// Geboren 2015 wie Mia: ein Kind, das lange minderjaehrig bleibt, damit die Erziehungsberechtigung gilt.
			await tx.person.create({
				data: { id, art: 'JUNGFISCHER', vorname, nachname, geburtsdatum: new Date('2015-08-01') },
				select: { id: true },
			});
			await tx.bezugsperson.create({
				data: { erwachsenerId, jungfischerId: id, beziehung: 'MUTTER', erziehungsberechtigt: true },
			});
		});
		return id;
	});
}

/**
 * Setzt die Frist aller Umfragen des Threads auf `frist` (null = ohne Frist). Je Umfrage eine
 * MODUL-Aenderung in einer Transaktion (mitAenderung), wie es ein Speichern im Editor taete: So aendert
 * sich der Stand des Vereins, und die Ansicht der Familie rechnet fristAbgelaufen neu.
 */
export async function setzeFrist(
	slug: string,
	threadId: string,
	frist: Date | null,
	jetzt = new Date(),
): Promise<void> {
	await mitDatenbank(async (prisma) => {
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug }, select: { id: true } });
		const db = vereinDb(prisma, verein.id);
		await db.$transaction((tx) =>
			mitAenderung(tx, verein.id, null, jetzt, async () => {
				const umfragen = await tx.umfrageModul.findMany({ where: { threadId }, select: { id: true } });
				if (umfragen.length === 0) throw new Error(`Thread ${threadId} hat keine Umfrage`);
				await tx.umfrageModul.updateMany({ where: { threadId }, data: { frist } });
				return {
					ergebnis: undefined,
					aenderungen: umfragen.map((u) => ({ threadId, art: 'MODUL' as const, objektId: u.id })),
				};
			}),
		);
	});
}

/**
 * Die gemeinsame Frist der Umfragen des Threads, zum Zurueckstellen nach einem Test. Haben die Umfragen
 * verschiedene Fristen, wirft sie: Ein einzelner Wert stellte sie nicht wieder her (setzeFrist setzt alle gleich).
 */
export async function leseFrist(slug: string, threadId: string): Promise<Date | null> {
	return mitDatenbank(async (prisma) => {
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug }, select: { id: true } });
		const umfragen = await vereinDb(prisma, verein.id).umfrageModul.findMany({
			where: { threadId },
			select: { frist: true },
		});
		if (umfragen.length === 0) throw new Error(`Thread ${threadId} hat keine Umfrage`);
		const zeiten = new Set(umfragen.map((u) => u.frist?.getTime() ?? null));
		if (zeiten.size > 1) throw new Error(`Umfragen von ${threadId} haben verschiedene Fristen`);
		const zeit = [...zeiten][0];
		return zeit === null ? null : new Date(zeit);
	});
}

/**
 * Setzt die Frist aller Umfragen eine Minute vor `jetzt`, also auf "abgelaufen", ohne dass der Ablauf auf
 * eine echte Frist warten muss. Eine Minute zurueck statt genau jetzt, weil Server und Test verschiedene
 * Uhren lesen und "ab jetzt >= frist" sonst an einer Millisekunde haengt. Verworfen: so lange warten, bis
 * eine echte Frist verstreicht -- der Ablauf liefe dann minutenlang leer.
 */
export async function beendeFrist(slug: string, threadId: string, jetzt: Date): Promise<void> {
	await setzeFrist(slug, threadId, new Date(jetzt.getTime() - 60_000), jetzt);
}
