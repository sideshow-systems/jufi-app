import { createPrismaClient, mitAenderung, vereinDb, type PrismaClient } from '@jufi/db';
import { berlinerTag, berlinZeitpunkt, tagPlus, teilnahmeOptionen, threadSegment } from '@jufi/domain';

/**
 * Daten fuer den Thread-Teil des Ablaufs, direkt in der Datenbank des E2E-Laufs. Der Aufbau legt die
 * URL in E2E_DATABASE_URL (aufbau.ts); die Worker erben sie wie TESTPASSWORT.
 *
 * Direkt statt ueber die Oberflaeche: Eine Oberflaeche zum Erstellen von Threads gibt es noch nicht.
 * Verworfen: den Demo-Verein des CLI
 * einspielen -- der Ablauf prueft den Verein, den er selbst aufgebaut hat (Admin, Leitung, Mutter,
 * Kind), und ein zweiter Verein brauchte eigene Sitzungen.
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
 * Legt den Thread Bowling an (Info, Termin, Teilnahme-Umfrage je Jungfischer mit Frist in einer Woche,
 * wie die Demo) und liefert dessen Segment und das des Jugendsprecher-Austauschs. Den Austausch hat der
 * Verein von Anfang an (austauschAnlegen); er wird gesucht, nicht ein zweiter angelegt, den die
 * Datenbank ohnehin verweigerte (thread_ein_austausch).
 *
 * Geschrieben wird wie in den Routen ueber mitAenderung, damit Vereinsstand und letzte Aktivitaet
 * stimmen. Der Termin liegt zwei Tage nach der Frist, damit die Frist in jedem Fall zuerst kommt.
 *
 * Der Austausch bekommt ein paar Nachrichten der Leitung, je Nachricht eine eigene Transaktion
 * (ein Stand je Transaktion). Ohne sie liesse sich im Layouttest nicht messen, ob die letzte
 * Nachricht nach dem Scrollen ueber dem Eingabefeld endet: Die Seite waere kuerzer als der Bildschirm.
 * Nur der Austausch, nicht Bowling: Dort zaehlt der Ablauf die ungelesenen Eintraege des Kindes.
 */
export async function legeE2eThreadAn(
	slug: string,
	leitungId: string,
	jetzt: Date,
): Promise<{ bowling: string; austausch: string }> {
	return mitDatenbank(async (prisma) => {
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug }, select: { id: true } });
		const vereinId = verein.id;
		const db = vereinDb(prisma, vereinId);

		const fristTag = tagPlus(berlinerTag(jetzt), 7);
		const terminTag = tagPlus(fristTag, 2);

		const { ergebnis: bowling } = await db.$transaction((tx) =>
			mitAenderung(tx, vereinId, leitungId, jetzt, async () => {
				const thread = await tx.thread.create({
					data: {
						titel: '🎳 Bowling',
						modus: 'KOMMENTARE',
						rollenfilter: 'JUNGFISCHER_FAMILIE',
						alleUntergruppen: true,
						veroeffentlichtAm: jetzt,
						erstelltVonId: leitungId,
						angelegtAm: jetzt,
					},
				});
				const info = await tx.threadModul.create({ data: { threadId: thread.id, typ: 'INFO', position: 0 } });
				await tx.infoModul.create({
					data: { id: info.id, text: 'Wir gehen zusammen **Bowling**. Bitte bis zur Frist anmelden.' },
				});
				const termin = await tx.threadModul.create({
					data: { threadId: thread.id, typ: 'TERMIN', position: 1, titel: 'Bowling' },
				});
				await tx.terminModul.create({
					data: {
						id: termin.id,
						// Spalte @db.Date: Mitternacht UTC des Kalendertags, ohne Zeitzonenversatz.
						startDatum: new Date(`${terminTag}T00:00:00Z`),
						beginn: '14:00',
						ende: '17:00',
						ort: 'Bowlingcenter',
						treffpunkt: '13:30 am Vereinsheim',
					},
				});
				const umfrage = await tx.threadModul.create({ data: { threadId: thread.id, typ: 'UMFRAGE', position: 2 } });
				await tx.umfrageModul.create({
					data: {
						id: umfrage.id,
						threadId: thread.id,
						frage: 'Kommst du mit?',
						einheit: 'JUNGFISCHER',
						teilnahme: true,
						vielleicht: true,
						frist: berlinZeitpunkt(fristTag, '18:00'),
						ergebnisse: 'ALLE',
					},
				});
				await tx.umfrageOption.createMany({
					data: teilnahmeOptionen(true).map((o, position) => ({ umfrageId: umfrage.id, position, ...o })),
				});
				return {
					ergebnis: thread,
					aenderungen: [
						{ threadId: thread.id, art: 'THREAD' as const, objektId: thread.id },
						...[info.id, termin.id, umfrage.id].map((id) => ({
							threadId: thread.id,
							art: 'MODUL' as const,
							objektId: id,
						})),
					],
				};
			}),
		);

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
		return {
			bowling: threadSegment(bowling.id, bowling.titel),
			austausch: threadSegment(austausch.id, austausch.titel),
		};
	});
}
