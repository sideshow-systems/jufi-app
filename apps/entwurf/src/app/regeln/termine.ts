import type { Datenstand, Id, TerminModul, Thread } from '../daten/typen';
import { zeitpunkt } from '../daten/zeit';
import { siehtThread } from './sichtbarkeit';
import { beginnIso, endeIso, letzterTag } from './terminzeit';

export interface TerminEintrag {
	threadId: Id;
	nr: number;
	threadTitel: string;
	modul: TerminModul;
}

const WOCHE_MS = 7 * 86_400_000;

/**
 * Archiv-Regel (Rahmen 5.3): manuell archiviert, oder eine Woche nach dem
 * Ende des letzten Termins (ohne Endezeit: Ende seines letzten Tages). Threads ohne Termin bleiben aktiv, bis
 * jemand sie archiviert — sonst verschwaende "Wichtige Infos" ohne Datum nie
 * und ein Orga-Chat sofort.
 */
export function istArchiviert(t: Thread, jetzt: Date): boolean {
	if (t.archiviert) return true;
	const enden = t.module
		.filter((m): m is TerminModul => m.typ === 'termin')
		.map((m) => zeitpunkt(endeIso(m)).getTime());
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
		.sort((a, b) => beginnIso(a.modul).localeCompare(beginnIso(b.modul)));
}

/**
 * Ein Termin bleibt unter "Als Naechstes", bis sein Ende vorbei ist (Spec
 * 2026-10-12, 3.2): das laufende Zeltlager am Samstag gehoert noch dazu.
 * Verworfen: ab Beginn ausblenden — dann verschwaende ein Termin, waehrend
 * er laeuft, und mit ihm Ort und Treffpunkt.
 */
export function naechsteTermine(stand: Datenstand, personId: Id, jetzt: Date, anzahl: number): TerminEintrag[] {
	return termineVon(stand, personId)
		.filter((e) => zeitpunkt(endeIso(e.modul)) >= jetzt)
		.slice(0, anzahl);
}

/** Termine, die einen Monat beruehren, auch ueber die Monatsgrenze; monat zaehlt wie bei Date von 0 bis 11. */
export function termineImMonat(stand: Datenstand, personId: Id, jahr: number, monat: number): TerminEintrag[] {
	const praefix = `${jahr}-${String(monat + 1).padStart(2, '0')}`;
	const erster = `${praefix}-01`;
	const letzter = `${praefix}-31`;
	return termineVon(stand, personId).filter((e) => e.modul.von <= letzter && letzterTag(e.modul) >= erster);
}

const fremdSeit = (t: Thread, personId: Id, seit: string) =>
	t.verlauf.filter((v) => v.zeit > seit && v.von !== personId);

/**
 * Neu fuer eine Person ist, was andere nach seit getan haben. Hat sie selbst
 * zuletzt gehandelt, zaehlt nur noch fremder Verlauf: fremde Antworten davor
 * gehen dann unter — verschmerzbar, denn sie war in dem Moment im Thread.
 */
export function istNeu(t: Thread, personId: Id, seit: string): boolean {
	if (t.letzteAktivitaet <= seit) return false;
	return t.letzteAktivitaetVon !== personId || fremdSeit(t, personId, seit).length > 0;
}

/** Fuer "Neu seit deinem letzten Besuch": sichtbare Threads mit fremder Aktivitaet nach seit. */
export function neuigkeiten(
	stand: Datenstand,
	personId: Id,
	seit: string,
): { threadId: Id; titel: string; text: string }[] {
	return stand.threads
		.filter((t) => siehtThread(stand, personId, t) && istNeu(t, personId, seit))
		.sort((a, b) => b.letzteAktivitaet.localeCompare(a.letzteAktivitaet))
		.map((t) => {
			const n = fremdSeit(t, personId, seit).length;
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
