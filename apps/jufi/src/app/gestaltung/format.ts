/**
 * Deutsche Datums- und Betragsformate. Von Hand statt Intl.DateTimeFormat:
 * Intl liefert je nach Browser "Sa." oder "Sa" und "Okt." oder "Okt" — fuer
 * Tests und fuer gleich breite Datumsbloecke brauchen wir feste Formen.
 */
const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONATE = [
	'Januar',
	'Februar',
	'März',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Dezember',
];
const zwei = (n: number) => String(n).padStart(2, '0');
const d = (iso: string) => new Date(iso);

export const uhrzeit = (iso: string) => iso.slice(11, 16);
export const wochentag = (iso: string) => TAGE[d(iso).getDay()];
export const wochentagKurz = (iso: string) => TAGE[d(iso).getDay()].slice(0, 2);
export const monatKurz = (iso: string) => MONATE[d(iso).getMonth()].slice(0, 3);
export const tagImMonat = (iso: string) => d(iso).getDate();
export const datumLang = (iso: string) => `${wochentag(iso)}, ${tagImMonat(iso)}. ${MONATE[d(iso).getMonth()]}`;
export const datumKurz = (iso: string) => `${zwei(d(iso).getDate())}.${zwei(d(iso).getMonth() + 1)}.`;
export const monatName = (monat: number) => MONATE[monat];

/** "heute 08:30", "gestern", Wochentag innerhalb einer Woche, sonst "30.08.". */
export function relativeZeit(iso: string, jetzt: Date): string {
	const tag = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const tage = Math.round((tag(jetzt) - tag(d(iso))) / 86_400_000);
	if (tage === 0) return `heute ${uhrzeit(iso)}`;
	if (tage === 1) return 'gestern';
	if (tage > 1 && tage < 7) return wochentagKurz(iso);
	return datumKurz(iso);
}

export function betrag(cent: number): string {
	return `${Math.floor(cent / 100)},${zwei(cent % 100)} €`;
}

/** "2026-10-13" wird "13.10.2026"; das Datum kommt schon als Berliner Kalendertag, es wird nicht umgerechnet. */
export function datumDeutsch(tag: string): string {
	const [jahr, monat, tagImM] = tag.split('-');
	return `${tagImM}.${monat}.${jahr}`;
}

// formatToParts mit festen Teilen statt eines de-DE-Musters: Das Muster haengt an den
// ICU-Daten (Komma, Leerzeichen), die Teile nicht. h23, weil h24 in manchen Engines
// Mitternacht als 24 schreibt.
const BERLINER_ZEIT = new Intl.DateTimeFormat('en', {
	timeZone: 'Europe/Berlin',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

/** Ein UTC-Zeitpunkt (ISO) als "13.10.2026 14:05" in Berliner Zeit, unabhaengig von der Zeitzone des Browsers. */
export function zeitpunktBerlin(iso: string): string {
	const t = Object.fromEntries(BERLINER_ZEIT.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
	return `${t['day']}.${t['month']}.${t['year']} ${t['hour']}:${t['minute']}`;
}

/** Nur der Berliner Kalendertag eines UTC-Zeitpunkts, "13.10.2026"; um 23:30 UTC ist in Berlin schon der naechste Tag. */
export function datumBerlin(iso: string): string {
	return zeitpunktBerlin(iso).slice(0, 10);
}
