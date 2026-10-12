import type { TerminModul } from '../daten/typen';

/**
 * Form und Anzeige eines Termins (Spec 2026-10-12, 3.1 und 3.2): Startdatum
 * Pflicht, Enddatum und Uhrzeiten optional. Alle Datumsrechnungen laufen ueber
 * Date.UTC auf reinen Kalendertagen — ueber lokale Date-Objekte verschoebe die
 * Zeitumstellung oder eine fremde Browser-Zeitzone sonst den Tag.
 */

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const zwei = (n: number) => String(n).padStart(2, '0');

function utc(tag: string): Date {
	const [j, m, t] = tag.split('-').map(Number);
	return new Date(Date.UTC(j, m - 1, t));
}

/** Kalendertag JJJJ-MM-TT plus tage. */
export function tagPlus(tag: string, tage: number): string {
	const d = utc(tag);
	d.setUTCDate(d.getUTCDate() + tage);
	return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`;
}

/** "Sa 17.10." */
function tagKurz(tag: string): string {
	return `${WT[utc(tag).getUTCDay()]} ${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
}

/** bis gleich von zaehlt als eintaegig, damit ein doppelt gesetztes Datum nichts aendert. */
export function letzterTag(m: TerminModul): string {
	return m.bis && m.bis !== m.von ? m.bis : m.von;
}

export function istMehrtaegig(m: TerminModul): boolean {
	return letzterTag(m) !== m.von;
}

/** Startzeitpunkt "JJJJ-MM-TTTHH:MM"; ohne Uhrzeit Mitternacht, damit ganztaegige Termine eines Tages zuerst sortieren. */
export function beginnIso(m: TerminModul): string {
	return `${m.von}T${m.beginnZeit ?? '00:00'}`;
}

/** Endzeitpunkt; ohne Endezeit das Ende des letzten Tages (Mitternacht des Folgetags). */
export function endeIso(m: TerminModul): string {
	return m.endeZeit ? `${letzterTag(m)}T${m.endeZeit}` : `${tagPlus(letzterTag(m), 1)}T00:00`;
}

/** Anzeige nach Spec 2026-10-12, 3.1. */
export function terminZeit(m: TerminModul): string {
	if (istMehrtaegig(m)) {
		const anfang = [tagKurz(m.von), m.beginnZeit].filter(Boolean).join(' ');
		const ende = [tagKurz(letzterTag(m)), m.endeZeit].filter(Boolean).join(' ');
		return `${anfang} – ${ende}`;
	}
	const zeit = m.beginnZeit
		? m.endeZeit
			? `${m.beginnZeit}–${m.endeZeit}`
			: m.beginnZeit
		: m.endeZeit
			? `bis ${m.endeZeit}`
			: 'ganztägig';
	return `${tagKurz(m.von)} · ${zeit}`;
}
