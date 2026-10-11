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
