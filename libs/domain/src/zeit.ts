/**
 * Zeit in der Zeitzone des Vereins (Europe/Berlin). Alle Rechnungen laufen
 * ueber Intl.DateTimeFormat, nie ueber die Zeitzone des Prozesses: Der Server
 * laeuft in UTC, ein Test auf dem Entwicklerrechner in Berlin, und beide muessen
 * dieselben Zeitpunkte liefern. Verworfen: eine Zeitzonen-Bibliothek, weil die
 * Plattform die Zeitzonendaten ohnehin mitbringt.
 */

const ZONE = 'Europe/Berlin';

// h23 statt h24: Manche Laufzeiten melden Mitternacht sonst als "24".
const WANDZEIT = new Intl.DateTimeFormat('en-US', {
	timeZone: ZONE,
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
});

const zwei = (n: number) => String(n).padStart(2, '0');

/** Berliner Wandzeit eines Zeitpunkts, als UTC-Millisekunden gelesen. */
function wandzeitAlsUtc(d: Date): number {
	const t: Record<string, number> = {};
	for (const teil of WANDZEIT.formatToParts(d)) {
		if (teil.type !== 'literal') t[teil.type] = Number(teil.value);
	}
	return Date.UTC(t['year'], t['month'] - 1, t['day'], t['hour'], t['minute'], t['second']);
}

/** Berliner Versatz zu UTC in Millisekunden am gegebenen Zeitpunkt (Sommerzeit 2 h, Winterzeit 1 h). */
function versatz(ms: number): number {
	// Sekundengenau abschneiden: formatToParts kennt keine Millisekunden.
	const ganz = ms - (((ms % 1000) + 1000) % 1000);
	return wandzeitAlsUtc(new Date(ganz)) - ganz;
}

/** Berliner Kalendertag eines Zeitpunkts als 'JJJJ-MM-TT'. */
export function berlinerTag(d: Date): string {
	const w = new Date(wandzeitAlsUtc(d));
	return `${w.getUTCFullYear()}-${zwei(w.getUTCMonth() + 1)}-${zwei(w.getUTCDate())}`;
}

/** Berliner Uhrzeit eines Zeitpunkts als 'HH:MM'. */
export function berlinerUhrzeit(d: Date): string {
	const w = new Date(wandzeitAlsUtc(d));
	return `${zwei(w.getUTCHours())}:${zwei(w.getUTCMinutes())}`;
}

const TAG_MS = 86_400_000;

/**
 * Berliner Wandzeit als Zeitpunkt; ohne Uhrzeit Mitternacht. Der Versatz
 * haengt vom Ergebnis ab, das Ergebnis vom Versatz. Deshalb werden die beiden
 * Versaetze ein Tag davor und ein Tag danach gemessen (eine Umstellung liegt
 * nie naeher an beiden), daraus je ein Kandidat gebildet und nur der behalten,
 * dessen Berliner Wandzeit wirklich die gewuenschte ist. Das entspricht
 * Temporal "compatible":
 * - doppelte Stunde im Herbst (02:30 am 25.10.): beide Kandidaten passen, der
 *   fruehere (Sommerzeit) gilt;
 * - uebersprungene Stunde im Fruehjahr (02:30 am 29.03.): kein Kandidat passt,
 *   es gilt der mit dem Versatz davor, die Uhrzeit rueckt also eine Stunde vor
 *   (03:30 Sommerzeit).
 * Verworfen: den Versatz am UTC-gelesenen Wandwert messen und am Ergebnis
 * nachpruefen. Das landete im Herbst auf der Winterzeit, weil der Wandwert
 * 02:30 "als UTC" schon nach der Umstellung liegt, und passte nicht zur
 * Regel, dass die Luecke im Fruehjahr nach vorn rueckt. Eine Uhrzeit
 * abzulehnen waere fuer eine Eingabe, die der Editor nicht kennen kann,
 * unfreundlicher.
 */
export function berlinZeitpunkt(tag: string, uhrzeit?: string | null): Date {
	const [j, m, t] = tag.split('-').map(Number);
	// || statt ??: Eine leere Uhrzeit heisst wie null "keine Uhrzeit", nicht Invalid Date.
	const [h, min] = (uhrzeit || '00:00').split(':').map(Number);
	const wand = Date.UTC(j, m - 1, t, h, min);
	const davor = wand - versatz(wand - TAG_MS);
	const danach = wand - versatz(wand + TAG_MS);
	const passend = [davor, danach].filter((ms) => wandzeitAlsUtc(new Date(ms)) === wand);
	return new Date(passend.length > 0 ? Math.min(...passend) : davor);
}

/** Kalendertag 'JJJJ-MM-TT' plus tage. Date.UTC statt lokaler Date-Objekte: Die Zeitumstellung verschiebt so keinen Tag. */
export function tagPlus(tag: string, tage: number): string {
	const [j, m, t] = tag.split('-').map(Number);
	const d = new Date(Date.UTC(j, m - 1, t + tage));
	return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`;
}

const TAG = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 'JJJJ-MM-TT' und ein Tag, den es gibt. 2026-02-30 passt auf die Form, aber
 * Date.UTC rollt ihn still in den Maerz; darum wird der Tag zurueckgelesen.
 * Verworfen: nur die Form pruefen (der Editor schriebe ein Datum, das die
 * Datenbank als Maerz speichert) und Date.parse (laeuft je nach Laufzeit anders).
 */
export function istKalendertag(tag: string): boolean {
	if (!TAG.test(tag)) return false;
	const [j, m, t] = tag.split('-').map(Number);
	const d = new Date(Date.UTC(j, m - 1, t));
	return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}
