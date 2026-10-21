import type { PrismaClient } from '@jufi/db';

const TAG_MS = 24 * 60 * 60 * 1000;
/**
 * So lange bleibt eine Aenderung stehen (Plan-Entscheidung 13). Ein Client, der laenger fort war,
 * bekommt beim Sync vollstaendig: true und laedt alles neu (sync.ts erkennt den Abstand am
 * aeltesten aufbewahrten Stand); verloren geht also nichts, nur der kurze Weg. Verworfen: nie
 * aufraeumen -- die Tabelle wuechse mit jeder Nachricht, und nach 90 Tagen nachzuladen ist ohnehin
 * teurer als neu zu laden.
 */
export const AENDERUNG_AUFBEWAHRUNG_MS = 90 * TAG_MS;
export const AUFRAEUMEN_INTERVALL_MS = TAG_MS;

/** Loescht plattformweit, was vor jetzt minus 90 Tagen angelegt wurde; liefert die Anzahl. */
export async function raeumeAenderungenAuf(prisma: PrismaClient, jetzt: Date): Promise<number> {
	const { count } = await prisma.aenderung.deleteMany({
		where: { angelegtAm: { lt: new Date(jetzt.getTime() - AENDERUNG_AUFBEWAHRUNG_MS) } },
	});
	return count;
}

/**
 * Raeumt beim Start und dann im Takt auf, im App-Prozess (Plan-Entscheidung 13). Plattformweit ueber
 * den schlichten PrismaClient: Die Frist gilt fuer alle Vereine gleich, vereinDb passte nicht.
 * Sofort statt erst nach einem Takt, weil ein Prozess selten 24 Stunden am Stueck laeuft: Jeder
 * Deploy startet neu, und ein reiner Takt kaeme dann womoeglich nie dran. Verworfen: ein Cron-Job
 * auf dem Server (wie die Sicherung) -- ein zweiter Ort mit Datenbankzugang fuer eine Abfrage.
 *
 * Muster starteMailArbeiter: unref, damit der Takt den Prozess nicht am Beenden hindert, und
 * stoppe wartet auf einen laufenden Durchlauf, damit SIGTERM die Verbindung nicht unter einer
 * offenen Abfrage schliesst.
 */
export function starteAufraeumen(e: { prisma: PrismaClient; jetzt: () => Date; intervallMs?: number }): {
	stoppe(): Promise<void>;
} {
	const laufend = new Set<Promise<void>>();

	function durchlauf(): void {
		const lauf = raeumeAenderungenAuf(e.prisma, e.jetzt()).then(
			(anzahl) => {
				if (anzahl > 0) console.log(`Aufraeumen: ${anzahl} Aenderungen aelter als 90 Tage geloescht`);
			},
			(fehler: unknown) => {
				// Nur der Name (Spec 4.4): Die Meldung einer Verbindungsstoerung kann die DATABASE_URL tragen.
				console.error('Aufraeumen fehlgeschlagen:', fehler instanceof Error ? fehler.name : typeof fehler);
			},
		);
		laufend.add(lauf);
		void lauf.finally(() => laufend.delete(lauf));
	}

	durchlauf();
	const timer = setInterval(durchlauf, e.intervallMs ?? AUFRAEUMEN_INTERVALL_MS);
	timer.unref();

	return {
		async stoppe() {
			clearInterval(timer);
			await Promise.allSettled([...laufend]);
		},
	};
}
