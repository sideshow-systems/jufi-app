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

/**
 * Berliner Wandzeit als Zeitpunkt; ohne Uhrzeit Mitternacht. Der Versatz haengt
 * vom Ergebnis ab, das Ergebnis vom Versatz: Erst am Kandidaten gemessen, dann
 * am Ergebnis nachgeprueft. In der uebersprungenen Stunde der Sommerzeit
 * (02:30 am 29.03.) fuehrt das zur Stunde danach (03:30 Sommerzeit); eine
 * Uhrzeit abzulehnen waere fuer eine Eingabe, die der Editor nicht kennen kann,
 * unfreundlicher. In der doppelten Stunde im Herbst bleibt es bei der
 * zweiten (Winterzeit); die Eingabe ist dort ohnehin mehrdeutig, wichtig ist
 * nur, dass das Ergebnis eindeutig und stabil ist.
 */
export function berlinZeitpunkt(tag: string, uhrzeit?: string | null): Date {
	const [j, m, t] = tag.split('-').map(Number);
	const [h, min] = (uhrzeit ?? '00:00').split(':').map(Number);
	const wand = Date.UTC(j, m - 1, t, h, min);
	const kandidat = wand - versatz(wand);
	const ergebnis = wand - versatz(kandidat);
	return new Date(ergebnis);
}

/** Kalendertag 'JJJJ-MM-TT' plus tage. Date.UTC statt lokaler Date-Objekte: Die Zeitumstellung verschiebt so keinen Tag. */
export function tagPlus(tag: string, tage: number): string {
	const [j, m, t] = tag.split('-').map(Number);
	const d = new Date(Date.UTC(j, m - 1, t + tage));
	return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`;
}
