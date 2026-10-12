import type { TerminModul } from '../daten/typen';
import { endeIso, istMehrtaegig, letzterTag, tagPlus } from './terminzeit';

/**
 * Kalendereintrag aus einem Termin (Spec 2026-10-12, 3.3 und 3.4). Alles hier
 * ist rein: Download und Link-Oeffnen macht das Bauteil.
 */
export interface KalenderEintrag {
	titel: string;
	ort: string;
	beschreibung: string;
	link: string;
	ganztaegig: boolean;
	/** ganztaegig JJJJ-MM-TT, sonst JJJJ-MM-TTTHH:MM (Berliner Wandzeit) */
	beginn: string;
	/** ganztaegig der exklusive Folgetag, sonst Wandzeit */
	ende: string;
}

const zwei = (n: number) => String(n).padStart(2, '0');

function wandzeitMs(wandzeit: string): number {
	const [j, mo, t, h, mi] = wandzeit.split(/[-T:]/).map(Number);
	return Date.UTC(j, mo - 1, t, h, mi);
}

/** Eine Stunde auf Wandzeit, ueber Date.UTC, damit 23:30 sauber in den Folgetag laeuft. */
function plusStunde(wandzeit: string): string {
	const d = new Date(wandzeitMs(wandzeit) + 3_600_000);
	return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}T${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())}`;
}

/**
 * Die vier Regeln der Spec 3.3. Ohne Beginnzeit ganztaegig: ein Eintrag ab
 * Mitternacht waere irrefuehrend. Mit Beginn ohne Ende eintaegig eine Stunde,
 * wie es die Kalender-Apps selbst vorgeben. Keine Personennamen.
 */
export function kalenderEintrag(m: TerminModul, threadTitel: string, link: string): KalenderEintrag {
	const zeilen: string[] = [];
	if (m.treffpunkt) zeilen.push(`Treffpunkt: ${m.treffpunkt}`);
	let ganztaegig = false;
	let beginn: string;
	let ende: string;
	if (!m.beginnZeit) {
		ganztaegig = true;
		beginn = m.von;
		ende = tagPlus(letzterTag(m), 1);
		if (m.endeZeit) zeilen.push(`Ende ${m.endeZeit}`);
	} else {
		beginn = `${m.von}T${m.beginnZeit}`;
		if (m.endeZeit || istMehrtaegig(m)) {
			ende = endeIso(m);
		} else {
			ende = plusStunde(beginn);
			zeilen.push('Ende offen');
		}
	}
	zeilen.push(link);
	return {
		titel: m.titel ? `${threadTitel} · ${m.titel}` : threadTitel,
		ort: m.ort,
		beschreibung: zeilen.join('\n'),
		link,
		ganztaegig,
		beginn,
		ende,
	};
}

const BERLIN = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Berlin',
	hourCycle: 'h23',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: 'numeric',
	second: 'numeric',
});

/** Versatz Berlins gegen UTC in Millisekunden zum Zeitpunkt ms. */
function versatz(ms: number): number {
	const t = Object.fromEntries(BERLIN.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
	return Date.UTC(+t['year'], +t['month'] - 1, +t['day'], +t['hour'], +t['minute'], +t['second']) - ms;
}

/**
 * Berliner Wandzeit nach UTC ("JJJJMMTTTHHMMSSZ"). Termine gelten in Berlin,
 * nicht in der Zeitzone des Browsers: wer im Urlaub eintraegt, bekaeme sonst
 * verschobene Zeiten. Der zweite Schritt mit dem Versatz des Ergebnisses
 * faengt die Umstellungstage ab. Verworfen: TZID mit eigenem VTIMEZONE-Block
 * in der .ics — laenger, fehleranfaellig, und UTC verstehen alle Kalender.
 */
export function berlinNachUtc(wandzeit: string): string {
	const ziel = wandzeitMs(wandzeit);
	const utc = ziel - versatz(ziel - versatz(ziel));
	return utcStempel(new Date(utc));
}

function utcStempel(d: Date): string {
	return d
		.toISOString()
		.replace(/\.\d{3}/, '')
		.replace(/[-:]/g, '');
}

/** TEXT-Werte nach RFC 5545 3.3.11. */
function text(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const UTF8 = new TextEncoder();

/**
 * Faltung nach RFC 5545 3.1: hoechstens 75 Bytes je Zeile, Fortsetzung mit
 * einem Leerzeichen. Iteriert ueber Code-Points, damit kein UTF-8-Zeichen
 * zerrissen wird — sonst zeigt der Kalender Umlaute und Emojis als Kaestchen.
 */
function falten(zeile: string): string {
	const teile: string[] = [];
	let aktuell = '';
	let bytes = 0;
	for (const z of zeile) {
		const b = UTF8.encode(z).length;
		if (bytes + b > 75) {
			teile.push(aktuell);
			aktuell = ' ';
			bytes = 1;
		}
		aktuell += z;
		bytes += b;
	}
	teile.push(aktuell);
	return teile.join('\r\n');
}

const datum = (tag: string) => tag.replace(/-/g, '');

export function alsIcs(e: KalenderEintrag, uid: string, jetzt: Date): string {
	const zeit = e.ganztaegig
		? [`DTSTART;VALUE=DATE:${datum(e.beginn)}`, `DTEND;VALUE=DATE:${datum(e.ende)}`]
		: [`DTSTART:${berlinNachUtc(e.beginn)}`, `DTEND:${berlinNachUtc(e.ende)}`];
	return (
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//JuFi App//Entwurf//DE',
			'CALSCALE:GREGORIAN',
			'METHOD:PUBLISH',
			'BEGIN:VEVENT',
			`UID:${uid}`,
			`DTSTAMP:${utcStempel(jetzt)}`,
			...zeit,
			`SUMMARY:${text(e.titel)}`,
			`LOCATION:${text(e.ort)}`,
			`DESCRIPTION:${text(e.beschreibung)}`,
			`URL:${e.link}`,
			'END:VEVENT',
			'END:VCALENDAR',
		]
			.map(falten)
			.join('\r\n') + '\r\n'
	);
}

/**
 * Link zum Anlegen im Google-Kalender. dates bleibt Berliner Wandzeit mit
 * ctz=Europe/Berlin statt UTC: Google rechnet selbst um, und der Link bleibt
 * lesbar. dates bleibt unkodiert, weil Google den Schraegstrich so erwartet.
 */
export function googleLink(e: KalenderEintrag): string {
	const wand = (s: string) => s.replace(/[-:]/g, '') + (e.ganztaegig ? '' : '00');
	const q = [
		'action=TEMPLATE',
		`text=${encodeURIComponent(e.titel)}`,
		`dates=${wand(e.beginn)}/${wand(e.ende)}`,
		`details=${encodeURIComponent(e.beschreibung)}`,
		`location=${encodeURIComponent(e.ort)}`,
		'ctz=Europe/Berlin',
	];
	return `https://calendar.google.com/calendar/render?${q.join('&')}`;
}
