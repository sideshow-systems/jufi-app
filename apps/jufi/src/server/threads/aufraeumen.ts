import type { PrismaClient } from '@jufi/db';
import { raeumeDateienAuf } from '../dateien/aufraeumen.js';
import type { DateiSpeicher } from '../dateien/speicher.js';

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
export function starteAufraeumen(e: {
	prisma: PrismaClient;
	jetzt: () => Date;
	intervallMs?: number;
	/**
	 * Mit Speicher raeumt jeder Durchlauf auch die Dateien auf (dateien/aufraeumen.ts). Optional,
	 * weil die Aenderungen allein auskommen und die Tests nicht jeder einen Speicher bauen sollen.
	 */
	speicher?: DateiSpeicher;
}): {
	stoppe(): Promise<void>;
} {
	const laufend = new Set<Promise<void>>();

	/** Nur der Name (Spec 4.4): Die Meldung einer Verbindungsstoerung kann die DATABASE_URL tragen. */
	function meldeFehler(was: string, fehler: unknown): void {
		console.error(`${was} fehlgeschlagen:`, fehler instanceof Error ? fehler.name : typeof fehler);
	}

	async function aenderungen(): Promise<void> {
		try {
			const anzahl = await raeumeAenderungenAuf(e.prisma, e.jetzt());
			if (anzahl > 0) console.log(`Aufraeumen: ${anzahl} Aenderungen aelter als 90 Tage geloescht`);
		} catch (fehler) {
			meldeFehler('Aufraeumen', fehler);
		}
	}

	/** Eigener Fang: Scheitern die Dateien, sollen die Aenderungen trotzdem drankommen, und umgekehrt. */
	async function dateien(speicher: DateiSpeicher): Promise<void> {
		try {
			const b = await raeumeDateienAuf(e.prisma, speicher, e.jetzt());
			if (b.geloescht + b.waisen + b.temp > 0) {
				console.log(
					`Aufraeumen: Dateien ${b.geloescht} von der Loeschliste, ${b.waisen} Waisen, ${b.temp} Temp-Dateien entfernt`,
				);
			}
		} catch (fehler) {
			meldeFehler('Aufraeumen der Dateien', fehler);
		}
	}

	function durchlauf(): void {
		const lauf = (async () => {
			await aenderungen();
			if (e.speicher) await dateien(e.speicher);
		})();
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
