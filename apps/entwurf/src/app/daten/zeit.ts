/**
 * Die eingefrorene Zeit des Entwurfs.
 *
 * Alle Termine und Fristen der Beispieldaten haengen am Bezugstag, dem Tag des
 * ersten Oeffnens (Spec TP1 3.1). Damit eine Testperson, die nach drei Wochen
 * wiederkommt, nicht vor archiviertem Bowling und abgelaufenen Fristen steht,
 * bleibt auch "jetzt" auf diesem Tag stehen; nur die Uhrzeit laeuft mit.
 * Verworfen: die Beispieldaten bei jedem Oeffnen neu zu verschieben — dann
 * wuerden die Eintraege der Testperson gegen neue Daten laufen.
 */

const zwei = (n: number) => String(n).padStart(2, '0');

function ausTag(tag: string): Date {
	const [j, m, t] = tag.split('-').map(Number);
	return new Date(j, m - 1, t);
}

function alsTag(d: Date): string {
	return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

/** Lokaler Kalendertag als "YYYY-MM-DD". */
export function bezugstagHeute(echt: Date): string {
	return alsTag(echt);
}

/** Datum des Bezugstags mit der Uhrzeit von echt. */
export function jetzt(bezugstag: string, echt: Date): Date {
	const d = ausTag(bezugstag);
	d.setHours(echt.getHours(), echt.getMinutes(), echt.getSeconds(), 0);
	return d;
}

/** Lokaler Zeitpunkt "YYYY-MM-DDTHH:MM", tage nach dem Bezugstag. */
export function relativ(bezugstag: string, tage: number, uhrzeit: string): string {
	const d = ausTag(bezugstag);
	d.setDate(d.getDate() + tage);
	return `${alsTag(d)}T${uhrzeit}`;
}

/** Tage bis zum naechsten Wochentag (0 = Sonntag); am selben Wochentag eine Woche. */
export function naechsterWochentag(bezugstag: string, wochentag: number): number {
	const heute = ausTag(bezugstag).getDay();
	return ((wochentag - heute + 6) % 7) + 1;
}

/** Ein Zeitpunkt als Date (lokal). */
export function zeitpunkt(iso: string): Date {
	return new Date(iso);
}

/** Ein Date als lokaler Zeitpunkt "YYYY-MM-DDTHH:MM". */
export function alsIso(d: Date): string {
	return `${alsTag(d)}T${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
}
