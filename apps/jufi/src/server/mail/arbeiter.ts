import type { PrismaClient } from '@jufi/db';
import type { MailVersand } from './versand.js';

export const MAIL_INTERVALL_MS = 30_000;
export const MAIL_MAX_VERSUCHE = 10;

const MINUTE_MS = 60 * 1000;
const TAG_MS = 24 * 60 * MINUTE_MS;
/** Mails je Durchlauf; der Rest kommt im naechsten, damit ein Stau den Takt nicht ewig blockiert. */
const STAPEL = 50;

/** 5 Minuten, dann doppelt so lang je Fehlversuch, hoechstens ein Tag. */
export function naechsterAbstandMs(versuche: number): number {
	// Der Exponent wird gedeckelt, bevor potenziert wird: 2^1000 ist Infinity, und
	// Infinity ist als Zeitabstand kein Datum.
	return Math.min(5 * MINUTE_MS * 2 ** Math.min(Math.max(versuche - 1, 0), 20), TAG_MS);
}

/**
 * Nur Klasse und Code des Fehlers, nie die Meldung: SMTP-Antworten wiederholen
 * gern die Empfaengeradresse ("<a@b.de>: Recipient address rejected"), und
 * weder Datenbank noch Log sollen Adressen aus einem Fehlertext sammeln.
 * Verworfen: die Meldung nach der Adresse durchsuchen und schwaerzen -- das
 * verlaesst sich auf das Format fremder Server.
 */
function fehlerKlasse(fehler: unknown): string {
	if (!(fehler instanceof Error)) return 'Unbekannt';
	const { code, responseCode } = fehler as { code?: unknown; responseCode?: unknown };
	const teile = [fehler.name, code, responseCode].filter(
		(t): t is string | number => (typeof t === 'string' || typeof t === 'number') && /^[\w.-]{1,40}$/.test(String(t)),
	);
	return teile.join(' ') || 'Unbekannt';
}

export interface MailArbeiter {
	tick(): Promise<void>;
	stoppe(): Promise<void>;
}

/**
 * Sendet faellige Mails und raeumt nebenbei ab. Laeuft plattformweit ueber den
 * schlichten PrismaClient: Die Warteschlange und die Wartung gehoeren keinem
 * einzelnen Verein, vereinDb passte hier nicht.
 *
 * Geloggt wird nie Adresse, Betreff, Text oder Token -- nur die Mail-ID und die
 * Fehlerklasse.
 */
export function starteMailArbeiter(e: {
	prisma: PrismaClient;
	versand: MailVersand;
	jetzt: () => Date;
	intervallMs?: number;
	log?: (zeile: string) => void;
}): MailArbeiter {
	const log = e.log ?? ((zeile: string) => console.log(zeile));
	const laufend = new Set<Promise<void>>();

	async function sendeFaellige(): Promise<void> {
		const faellig = await e.prisma.mailWarteschlange.findMany({
			where: { gesendetAm: null, versuche: { lt: MAIL_MAX_VERSUCHE }, naechsterVersuch: { lte: e.jetzt() } },
			orderBy: { naechsterVersuch: 'asc' },
			take: STAPEL,
		});
		for (const mail of faellig) {
			// Beanspruchen vor dem Senden: Wer die Zeile mit dem bisherigen Stand von
			// versuche und naechsterVersuch noch vorfindet, gewinnt (Anzahl 1). Eine
			// zweite Instanz oder ein ueberlappender Durchlauf geht leer aus. Stuerzt der
			// Prozess mitten im Senden ab, ist die Zeile schon in die Zukunft verschoben
			// und kommt verzoegert wieder, statt sofort doppelt. Verworfen: erst senden,
			// dann markieren -- ein Absturz dazwischen verschickte die Mail doppelt.
			const jetzt = e.jetzt();
			const versuche = mail.versuche + 1;
			const beansprucht = await e.prisma.mailWarteschlange.updateMany({
				where: { id: mail.id, gesendetAm: null, versuche: mail.versuche, naechsterVersuch: mail.naechsterVersuch },
				data: { versuche, naechsterVersuch: new Date(jetzt.getTime() + naechsterAbstandMs(versuche)) },
			});
			if (beansprucht.count !== 1) continue;
			try {
				await e.versand.sende({ empfaenger: mail.empfaenger, betreff: mail.betreff, text: mail.text });
				await e.prisma.mailWarteschlange.update({
					where: { id: mail.id },
					data: { gesendetAm: e.jetzt(), fehler: null },
				});
				log(`Mail ${mail.id} gesendet`);
			} catch (fehler) {
				const klasse = fehlerKlasse(fehler);
				await e.prisma.mailWarteschlange.update({ where: { id: mail.id }, data: { fehler: klasse } });
				log(`Mail ${mail.id} nicht gesendet (Versuch ${versuche}): ${klasse}`);
			}
		}
	}

	/** Abgelaufene Challenges und Sitzungen: sonst wuchsen die Tabellen mit jeder Anmeldung. */
	async function warte(): Promise<void> {
		const jetzt = e.jetzt();
		await e.prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lt: jetzt } } });
		await e.prisma.session.deleteMany({ where: { ablauf: { lt: jetzt } } });
	}

	function tick(): Promise<void> {
		const lauf = (async () => {
			// Getrennt, damit eine kaputte Wartung den Versand nicht aufhaelt und umgekehrt.
			try {
				await sendeFaellige();
			} catch (fehler) {
				log(`Mail-Arbeiter: Versand-Durchlauf fehlgeschlagen: ${fehlerKlasse(fehler)}`);
			}
			try {
				await warte();
			} catch (fehler) {
				log(`Mail-Arbeiter: Wartung fehlgeschlagen: ${fehlerKlasse(fehler)}`);
			}
		})();
		laufend.add(lauf);
		return lauf.finally(() => laufend.delete(lauf));
	}

	const intervallMs = e.intervallMs ?? MAIL_INTERVALL_MS;
	// unref: Der Takt allein soll den Prozess nicht am Beenden hindern.
	const timer = setInterval(() => void tick(), intervallMs);
	timer.unref();
	log(`Mail-Arbeiter gestartet (Takt ${intervallMs} ms)`);

	return {
		tick,
		async stoppe() {
			clearInterval(timer);
			await Promise.allSettled([...laufend]);
		},
	};
}
