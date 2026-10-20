import type { AntwortEinheit, Rollenfilter, UmfrageDaten } from '../../threads/typen.js';
import { berlinerTag, berlinerUhrzeit, tagPlus } from '../../zeit.js';
import { tagKurz, wochentagKurz } from '../termin/termin.js';

// Spec 3.12. Nur "dabei" gilt als Teilnahme (Grundlage fuer Mitfahrt und Zahlung in TP4,
// Erinnerungen in TP5); "vielleicht" gilt als beantwortet. Die Schluessel sind fest und
// dienen den Folgeprojekten als Anker, die Texte nicht: sie lassen sich umbenennen.
export const TEILNAHME_OPTIONEN: readonly {
	readonly schluessel: 'dabei' | 'vielleicht' | 'abgesagt';
	readonly text: string;
}[] = [
	{ schluessel: 'dabei', text: 'Dabei' },
	{ schluessel: 'vielleicht', text: 'Vielleicht' },
	{ schluessel: 'abgesagt', text: 'Abgesagt' },
];

export function teilnahmeOptionen(vielleicht: boolean): { schluessel: string; text: string }[] {
	return TEILNAHME_OPTIONEN.filter((o) => vielleicht || o.schluessel !== 'vielleicht').map((o) => ({ ...o }));
}

// Was der Editor beim Anlegen einer Umfrage vorbelegt (Spec 3.12): eine Teilnahme-Umfrage,
// weil das der haeufigste Fall ist. Frische Objekte bei jedem Aufruf, damit der Editor
// sie veraendern darf, ohne die Konstante zu beschaedigen.
export function neueUmfrageVorlage(): {
	frage: string;
	einheit: AntwortEinheit;
	mehrfach: false;
	teilnahme: true;
	vielleicht: true;
	frist: null;
	ergebnisse: 'ALLE';
	optionen: { schluessel: string; text: string }[];
} {
	return {
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: true,
		frist: null,
		ergebnisse: 'ALLE',
		optionen: teilnahmeOptionen(true),
	};
}

// "Pro Jungfischer" setzt Kinder in der Zielgruppe voraus; bei "Nur Familie" und "Nur
// Jugendleiter" waere niemand gefragt (Spec 3.2), also bietet der Editor die Einheit dort
// nicht an. Im Austausch gibt es sie, die Gefragten sind die Jugendsprecher.
export function einheitenFuer(rollenfilter: Rollenfilter): AntwortEinheit[] {
	if (rollenfilter === 'NUR_FAMILIE' || rollenfilter === 'NUR_JUGENDLEITER') return ['ERWACHSENER', 'PERSON'];
	return ['JUNGFISCHER', 'ERWACHSENER', 'PERSON'];
}

export type UmfrageKonflikt =
	{ feld: 'optionen'; schluessel: string } | { feld: 'einheit' } | { feld: 'teilnahme' } | { feld: 'mehrfach' };

// Spec 3.14: mit gespeicherten Antworten verweigert der Server Aenderungen, die sie
// entwerten wuerden (409, Hinweis am Feld). Verworfen: Antworten dabei still loeschen.
// Optionen werden ueber den Schluessel verglichen, nicht ueber die ID, weil der Editor
// neue Optionen ohne ID schickt; Umbenennen und Umsortieren bleiben dadurch frei.
// Es zaehlen alle gespeicherten Antworten mit Option, auch die nicht mehr Gefragter: sie bleiben in
// der Datenbank und kaemen mit der Zielgruppe zurueck.
export function pruefeUmfrageAenderung(
	alt: UmfrageDaten,
	neu: {
		einheit: AntwortEinheit;
		mehrfach: boolean;
		teilnahme: boolean;
		optionen: readonly { schluessel: string }[];
	},
): UmfrageKonflikt[] {
	// Antworten ohne Option gelten als nicht beantwortet und blockieren nichts.
	if (!alt.antworten.some((a) => a.optionIds.length > 0)) return [];
	const konflikte: UmfrageKonflikt[] = [];
	const bleibt = new Set(neu.optionen.map((o) => o.schluessel));
	for (const option of alt.optionen) {
		if (bleibt.has(option.schluessel)) continue;
		if (alt.antworten.some((a) => a.optionIds.includes(option.id))) {
			konflikte.push({ feld: 'optionen', schluessel: option.schluessel });
		}
	}
	if (neu.einheit !== alt.einheit) konflikte.push({ feld: 'einheit' });
	if (neu.teilnahme !== alt.teilnahme) konflikte.push({ feld: 'teilnahme' });
	if (alt.mehrfach && !neu.mehrfach && alt.antworten.some((a) => a.optionIds.length > 1)) {
		konflikte.push({ feld: 'mehrfach' });
	}
	return konflikte;
}

/**
 * Frist in der Kopfzeile einer Umfrage. Innerhalb der naechsten sechs Berliner
 * Kalendertage genuegt der Wochentag ("bis Do 18:00"), danach braucht es das
 * Datum, weil derselbe Wochentag sonst auch die Woche darauf meinen koennte.
 * Gerechnet wird in Kalendertagen, nicht in 24-Stunden-Spannen: Eine Frist
 * "So 23:59" ist am Montag davor noch der sechste Tag. Ab jetzt >= frist gilt
 * sie als abgelaufen, passend zum Server (410 in der Fristsekunde).
 */
export function fristText(frist: Date, jetzt: Date): string {
	if (jetzt.getTime() >= frist.getTime()) return 'Frist abgelaufen';
	const tag = berlinerTag(frist);
	const innerhalbEinerWoche = tag <= tagPlus(berlinerTag(jetzt), 6);
	const wann = innerhalbEinerWoche ? wochentagKurz(tag) : tagKurz(tag);
	return `bis ${wann} ${berlinerUhrzeit(frist)}`;
}

/**
 * Immer die volle Form "Do 22.10. 18:00": Der Systemsatz im Verlauf bleibt
 * stehen, und "Do" waere in einer Woche nicht mehr eindeutig. Verworfen:
 * fristText dafuer verwenden, weil es vom Lesezeitpunkt abhaengt.
 */
export function fristZeitpunkt(frist: Date): string {
	return `${tagKurz(berlinerTag(frist))} ${berlinerUhrzeit(frist)}`;
}
