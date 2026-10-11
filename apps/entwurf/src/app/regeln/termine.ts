import type { Datenstand, Id, TerminModul, Thread } from '../daten/typen';
import { zeitpunkt } from '../daten/zeit';
import { siehtThread } from './sichtbarkeit';

export interface TerminEintrag {
	threadId: Id;
	nr: number;
	threadTitel: string;
	modul: TerminModul;
}

const WOCHE_MS = 7 * 86_400_000;

/**
 * Archiv-Regel (Rahmen 5.3): manuell archiviert, oder eine Woche nach Ende
 * (sonst Beginn) des letzten Termins. Threads ohne Termin bleiben aktiv, bis
 * jemand sie archiviert — sonst verschwaende "Wichtige Infos" ohne Datum nie
 * und ein Orga-Chat sofort.
 */
export function istArchiviert(t: Thread, jetzt: Date): boolean {
	if (t.archiviert) return true;
	const enden = t.module
		.filter((m): m is TerminModul => m.typ === 'termin')
		.map((m) => zeitpunkt(m.ende ?? m.beginn).getTime());
	if (enden.length === 0) return false;
	return Math.max(...enden) + WOCHE_MS < jetzt.getTime();
}

export function termineVon(stand: Datenstand, personId: Id): TerminEintrag[] {
	return stand.threads
		.filter((t) => siehtThread(stand, personId, t))
		.flatMap((t) =>
			t.module
				.filter((m): m is TerminModul => m.typ === 'termin')
				.map((modul) => ({ threadId: t.id, nr: t.nr, threadTitel: t.titel, modul })),
		)
		.sort((a, b) => a.modul.beginn.localeCompare(b.modul.beginn));
}

export function naechsteTermine(stand: Datenstand, personId: Id, jetzt: Date, anzahl: number): TerminEintrag[] {
	return termineVon(stand, personId)
		.filter((e) => zeitpunkt(e.modul.beginn) >= jetzt)
		.slice(0, anzahl);
}

/** Termine eines Monats; monat zaehlt wie bei Date von 0 bis 11. */
export function termineImMonat(stand: Datenstand, personId: Id, jahr: number, monat: number): TerminEintrag[] {
	const praefix = `${jahr}-${String(monat + 1).padStart(2, '0')}`;
	return termineVon(stand, personId).filter((e) => e.modul.beginn.startsWith(praefix));
}

/** Fuer "Neu seit deinem letzten Besuch": sichtbare Threads mit Aktivitaet nach seit. */
export function neuigkeiten(
	stand: Datenstand,
	personId: Id,
	seit: string,
): { threadId: Id; titel: string; text: string }[] {
	return stand.threads
		.filter((t) => siehtThread(stand, personId, t) && t.letzteAktivitaet > seit)
		.sort((a, b) => b.letzteAktivitaet.localeCompare(a.letzteAktivitaet))
		.map((t) => {
			const n = t.verlauf.filter((v) => v.zeit > seit).length;
			const wort =
				t.modus === 'chat'
					? n === 1
						? 'neue Nachricht'
						: 'neue Nachrichten'
					: n === 1
						? 'neuer Kommentar'
						: 'neue Kommentare';
			return { threadId: t.id, titel: t.titel, text: n > 0 ? `${n} ${wort}` : 'Neue Antworten' };
		});
}
