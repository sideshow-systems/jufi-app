import { berlinZeitpunkt, tagPlus } from '../../zeit.js';

/**
 * Form und Anzeige eines Termins (Spec 2026-10-12, 3.1 und 3.2): Startdatum
 * Pflicht, Enddatum und Uhrzeiten optional. Daten sind 'JJJJ-MM-TT', Zeiten
 * 'HH:MM'; der Server wandelt @db.Date mit toISOString().slice(0, 10). Als
 * Zeichenketten rechnet die Domaene unabhaengig von Prisma und von der
 * Zeitzone des Prozesses.
 */
export interface TerminDaten {
	modulId: string;
	startDatum: string;
	endDatum: string | null;
	beginn: string | null;
	ende: string | null;
	ort: string | null;
	treffpunkt: string | null;
}

export interface TerminEintrag {
	threadId: string;
	titel: string;
	termin: TerminDaten;
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "Sa" */
export function wochentagKurz(tag: string): string {
	const [j, m, t] = tag.split('-').map(Number);
	return WOCHENTAG[new Date(Date.UTC(j, m - 1, t)).getUTCDay()];
}

/**
 * "Sa 17.10." Exportiert, damit Fristen und Systemsaetze dieselbe Datumsform
 * zeigen wie die Karte. Verworfen: die Form in verlauf.ts und umfrage.ts
 * nachbauen, weil die Anzeigen dann auseinanderlaufen.
 */
export function tagKurz(tag: string): string {
	return `${wochentagKurz(tag)} ${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
}

/** Ein Enddatum gleich dem Startdatum zaehlt als eintaegig, damit ein doppelt gesetztes Datum nichts aendert. */
export function letzterTag(t: TerminDaten): string {
	return t.endDatum && t.endDatum !== t.startDatum ? t.endDatum : t.startDatum;
}

export function istMehrtaegig(t: TerminDaten): boolean {
	return letzterTag(t) !== t.startDatum;
}

/** Anzeige nach Spec 2026-10-12, 3.1. */
export function terminZeit(t: TerminDaten): string {
	if (istMehrtaegig(t)) {
		const anfang = [tagKurz(t.startDatum), t.beginn].filter(Boolean).join(' ');
		const schluss = [tagKurz(letzterTag(t)), t.ende].filter(Boolean).join(' ');
		return `${anfang} – ${schluss}`;
	}
	const zeit = t.beginn ? (t.ende ? `${t.beginn}–${t.ende}` : t.beginn) : t.ende ? `bis ${t.ende}` : 'ganztägig';
	return `${tagKurz(t.startDatum)} · ${zeit}`;
}

/**
 * Pruefung im Editor (Spec 2026-10-12, 3.1). Ende vor Beginn ist nur an einem
 * Tag ein Fehler: mehrtaegig ist "Fr 17:00 bis So 12:00" der Normalfall. Am
 * selben Tag ist auch Gleichheit einer, ein Termin ohne Dauer ist ein
 * Eingabefehler. Ein Ende ohne Beginn ist erlaubt ("bis 12:00"), es gibt nichts
 * zu vergleichen. Die Uhrzeit wird vor dem Vergleich geprueft, weil
 * Zeichenketten wie "25:00" sonst scheinbar vernuenftig sortieren.
 */
export function terminFehler(t: TerminDaten): string | null {
	if (t.endDatum && t.endDatum < t.startDatum) return 'Das Enddatum liegt vor dem Startdatum.';
	for (const zeit of [t.beginn, t.ende]) {
		if (zeit !== null && !UHRZEIT.test(zeit)) return 'Uhrzeit bitte als HH:MM.';
	}
	if (!istMehrtaegig(t) && t.beginn && t.ende && t.ende <= t.beginn) return 'Das Ende liegt vor dem Beginn.';
	return null;
}

/** Ohne Beginn Mitternacht Berlin, damit ganztaegige Termine eines Tages zuerst kommen. */
export function beginnZeitpunkt(t: TerminDaten): Date {
	return berlinZeitpunkt(t.startDatum, t.beginn);
}

/**
 * Ohne Ende endet der Termin mit dem letzten Tag, also um Mitternacht Berlin
 * danach. Das gilt auch fuer einen eintaegigen Termin mit Beginn ohne Ende:
 * Verworfen: Beginn plus eine feste Dauer, die niemand eingegeben hat — der
 * Termin verschwaende sonst mitten im Nachmittag aus "Als Naechstes".
 */
export function endeZeitpunkt(t: TerminDaten): Date {
	return berlinZeitpunkt(t.ende ? letzterTag(t) : tagPlus(letzterTag(t), 1), t.ende);
}

/** Startdatum, dann Beginn (ohne Beginn zuerst), dann threadId: stabil, auch bei Gleichstand. */
function vergleiche(a: TerminEintrag, b: TerminEintrag): number {
	return (
		vergleicheText(a.termin.startDatum, b.termin.startDatum) ||
		vergleicheText(a.termin.beginn ?? '', b.termin.beginn ?? '') ||
		vergleicheText(a.threadId, b.threadId)
	);
}

// Kein localeCompare: Die Ordnung darf nicht von der Sprache des Prozesses abhaengen.
function vergleicheText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Ein Termin bleibt unter "Als Naechstes", bis sein Ende vorbei ist (Spec
 * 2026-10-12, 3.2): das laufende Zeltlager am Samstag gehoert noch dazu.
 * Verworfen: ab Beginn ausblenden — dann verschwaende ein Termin, waehrend er
 * laeuft, und mit ihm Ort und Treffpunkt.
 */
export function naechsteTermine(eintraege: readonly TerminEintrag[], jetzt: Date, anzahl: number): TerminEintrag[] {
	return eintraege
		.filter((e) => endeZeitpunkt(e.termin).getTime() > jetzt.getTime())
		.sort(vergleiche)
		.slice(0, anzahl);
}

/** Termine, die einen Monat beruehren, auch ueber die Monatsgrenze; monat zaehlt von 1 bis 12. */
export function termineImMonat(eintraege: readonly TerminEintrag[], jahr: number, monat: number): TerminEintrag[] {
	const praefix = `${jahr}-${String(monat).padStart(2, '0')}`;
	const erster = `${praefix}-01`;
	// Der 31. genuegt als Obergrenze: Es gibt keinen Tag zwischen dem 30. und dem 1. des Folgemonats, der dazugehoerte.
	const letzter = `${praefix}-31`;
	return eintraege.filter((e) => e.termin.startDatum <= letzter && letzterTag(e.termin) >= erster).sort(vergleiche);
}

export type Geraet = 'IOS' | 'ANDROID' | 'ANDERE';

export function geraetAus(userAgent: string): Geraet {
	if (/iPhone|iPad|iPod/.test(userAgent)) return 'IOS';
	if (/Android/.test(userAgent)) return 'ANDROID';
	return 'ANDERE';
}

/**
 * Kartenlink je Geraet: Das Betriebssystem oeffnet seine eigene Karten-App.
 * Verworfen: ueberall der Google-Link, weil Handys dann den Browser statt der
 * eingerichteten Karten-App oeffnen.
 */
export function kartenLink(ort: string, geraet: Geraet): string {
	const suche = encodeURIComponent(ort);
	if (geraet === 'IOS') return `maps://?q=${suche}`;
	if (geraet === 'ANDROID') return `geo:0,0?q=${suche}`;
	return `https://www.google.com/maps/search/?api=1&query=${suche}`;
}
