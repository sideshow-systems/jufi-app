import { berlinerTag, berlinerUhrzeit, tagPlus } from '../../zeit.js';
import { beginnZeitpunkt, endeZeitpunkt, istMehrtaegig, letzterTag, type TerminDaten } from './termin.js';

/**
 * Kalendereintrag aus einem Termin (Spec 2026-10-12, 3.3 und 3.4). Alles hier
 * ist rein: Download und Link-Oeffnen machen die Oberflaeche.
 */
export interface KalenderEintrag {
	titel: string;
	ort: string | null;
	beschreibung: string;
	ganztaegig: boolean;
	/** ganztaegig 'JJJJ-MM-TT', sonst UTC-ISO ('2026-10-24T12:00:00.000Z') */
	beginn: string;
	/** ganztaegig der exklusive Folgetag, sonst UTC-ISO */
	ende: string;
}

const STUNDE_MS = 3_600_000;

/**
 * Die vier Zeilen der Spec 3.3. Ohne Beginnzeit ganztaegig: ein Eintrag ab
 * Mitternacht waere irrefuehrend. Mit Beginn ohne Ende eintaegig eine Stunde,
 * wie es die Kalender-Apps selbst vorgeben; mehrtaegig bis Mitternacht des
 * letzten Tages. Zeitpunkte als UTC-ISO, weil die Zeitrechnung (Umstellung!)
 * in beginnZeitpunkt und endeZeitpunkt steckt und hier nicht ein zweites Mal
 * entstehen soll. Keine Personennamen.
 */
export function kalenderEintrag(
	termin: TerminDaten,
	threadTitel: string,
	modulTitel: string | null,
	link: string,
): KalenderEintrag {
	const zeilen: string[] = [];
	if (termin.treffpunkt) zeilen.push(`Treffpunkt: ${termin.treffpunkt}`);
	let ganztaegig = false;
	let beginn: string;
	let ende: string;
	if (!termin.beginn) {
		ganztaegig = true;
		beginn = termin.startDatum;
		ende = tagPlus(letzterTag(termin), 1);
		if (termin.ende) zeilen.push(`Ende ${termin.ende}`);
	} else {
		const anfang = beginnZeitpunkt(termin);
		beginn = anfang.toISOString();
		if (termin.ende || istMehrtaegig(termin)) {
			ende = endeZeitpunkt(termin).toISOString();
		} else {
			// Eine Stunde auf der Zeitachse, nicht auf der Wanduhr: so stimmt es auch in der Umstellungsnacht.
			ende = new Date(anfang.getTime() + STUNDE_MS).toISOString();
			zeilen.push('Ende offen');
		}
	}
	zeilen.push(link);
	return {
		titel: modulTitel ? `${threadTitel} · ${modulTitel}` : threadTitel,
		ort: termin.ort,
		beschreibung: zeilen.join('\n'),
		ganztaegig,
		beginn,
		ende,
	};
}

/** UTC-Stempel der iCalendar-Form: 'JJJJMMTTTHHMMSSZ'. */
function utcStempel(d: Date): string {
	return d
		.toISOString()
		.replace(/\.\d{3}/, '')
		.replace(/[-:]/g, '');
}

/** TEXT-Werte nach RFC 5545 3.3.11. */
function text(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const UTF8 = new TextEncoder();

/**
 * Faltung nach RFC 5545 3.1: hoechstens 75 Bytes je Zeile, Fortsetzung mit
 * einem Leerzeichen. Iteriert ueber Code-Points, damit kein UTF-8-Zeichen
 * zerrissen wird; sonst zeigt der Kalender Umlaute und Emojis als Kaestchen.
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

const ohneStriche = (tag: string) => tag.replace(/-/g, '');

/**
 * Die .ics-Datei. Zeiten in UTC statt TZID mit eigenem VTIMEZONE-Block: der
 * ist laenger und fehleranfaellig, und UTC verstehen alle Kalender. Die UID
 * kommt vom Aufrufer, damit erneutes Eintragen den Eintrag aktualisiert statt
 * ihn zu verdoppeln.
 */
export function alsIcs(eintrag: KalenderEintrag, uid: string, jetzt: Date): string {
	const zeit = eintrag.ganztaegig
		? [`DTSTART;VALUE=DATE:${ohneStriche(eintrag.beginn)}`, `DTEND;VALUE=DATE:${ohneStriche(eintrag.ende)}`]
		: [`DTSTART:${utcStempel(new Date(eintrag.beginn))}`, `DTEND:${utcStempel(new Date(eintrag.ende))}`];
	return (
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//JuFi App//Kalender//DE',
			'CALSCALE:GREGORIAN',
			'METHOD:PUBLISH',
			'BEGIN:VEVENT',
			`UID:${uid}`,
			`DTSTAMP:${utcStempel(jetzt)}`,
			...zeit,
			`SUMMARY:${text(eintrag.titel)}`,
			...(eintrag.ort ? [`LOCATION:${text(eintrag.ort)}`] : []),
			`DESCRIPTION:${text(eintrag.beschreibung)}`,
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
export function googleKalenderLink(eintrag: KalenderEintrag): string {
	const wandzeit = (iso: string): string => {
		const d = new Date(iso);
		return `${ohneStriche(berlinerTag(d))}T${berlinerUhrzeit(d).replace(':', '')}00`;
	};
	const dates = eintrag.ganztaegig
		? `${ohneStriche(eintrag.beginn)}/${ohneStriche(eintrag.ende)}`
		: `${wandzeit(eintrag.beginn)}/${wandzeit(eintrag.ende)}`;
	const q = [
		'action=TEMPLATE',
		`text=${encodeURIComponent(eintrag.titel)}`,
		`dates=${dates}`,
		`details=${encodeURIComponent(eintrag.beschreibung)}`,
		...(eintrag.ort ? [`location=${encodeURIComponent(eintrag.ort)}`] : []),
		'ctz=Europe/Berlin',
	];
	return `https://calendar.google.com/calendar/render?${q.join('&')}`;
}
