import { threadDatenAus, type ModulDaten } from './ansicht.js';
import { istArchiviert } from './archiv.js';
import { threadSegment } from './pfad.js';
import { siehtThread } from './sichtbarkeit.js';
import { istNeu, nachAktivitaet, type NeuAenderung } from './start.js';
import type { ThreadKopf, ThreadPerson, Umfeld } from './typen.js';
import { naechsterTerminText } from './verwaltung.js';

// Ein geladener Thread, wie die Liste ihn braucht: der Kopf, die Module (für Suche und
// Termine), die letzte Aktivität zum Ordnen und die Änderungen, die der Server als
// Kandidaten für "neu" geladen hat. Ob eine davon zählt, entscheidet istNeu.
export interface ListenThread {
	kopf: ThreadKopf;
	module: readonly ModulDaten[];
	letzteAktivitaetAm: Date;
	gelesenBis: number | null;
	aenderungen: readonly NeuAenderung[];
}

export interface ThreadZeile {
	id: string;
	titel: string;
	segment: string;
	angepinnt: boolean;
	archiviert: boolean;
	entwurf: boolean;
	/** Anzeigetext des nächsten Termins (terminZeit), null ohne bevorstehenden. */
	naechsterTermin: string | null;
	neu: boolean;
}

export interface ThreadListe {
	threads: ThreadZeile[];
	/** Anzahl der archivierten Threads, die zur Suche passen, auch wenn sie nicht in threads stehen. */
	archiv: number;
}

// Kleinschreibung nach NFC und mit deutschen Regeln: "ÜBERNACHTEN" findet "übernachten",
// und ein zerlegtes "e" plus Akzent (wie es manche Tastaturen und Kopierquellen liefern)
// findet das zusammengesetzte "é".
function vergleichbar(text: string): string {
	return text.normalize('NFC').toLocaleLowerCase('de');
}

// Spec 4.1: Titel, Info-Texte und Orte. Die Frage einer Umfrage zählt nicht: Sie ist
// ein Teil der Abstimmung und würde Treffer liefern, deren Grund in der Liste nicht zu
// sehen ist. Im Speicher mit includes statt als ILIKE in der Datenbank: "%", "_" und
// "\" blieben so ganz gewöhnliche Zeichen, und ob "ä" auch "Ä" findet, hinge nicht an
// der Collation der Datenbank.
export function passtZuSuche(kopf: ThreadKopf, module: readonly ModulDaten[], suche: string): boolean {
	const gesucht = vergleichbar(suche);
	const texte = [kopf.titel];
	for (const m of module) {
		if (m.typ === 'INFO') texte.push(m.text);
		if (m.typ === 'TERMIN' && m.termin.ort !== null) texte.push(m.termin.ort);
	}
	return texte.some((t) => vergleichbar(t).includes(gesucht));
}

// Spec 6.5. Was die Person sieht, nach letzter Aktivität, neueste zuerst; die Abschnitte
// "Angepinnt", "Aktiv" und "Archiv" bildet der Client aus den Merkmalen der Zeilen.
// Die Sichtbarkeit wird hier geprüft und nicht dem Aufrufer überlassen (siehtThread): so
// kann ein Entwurf oder ein Jugendleiter-Thread nicht durch eine zu großzügige Abfrage
// in der Liste einer Familie landen.
// Die Suche gilt auch für die Archivzahl: "Archiv · 3" soll nennen, was beim Aufklappen
// kommt, nicht alles Archivierte im Verein.
// Ein archivierter Thread ist nie neu: Im Archiv kann nur noch nachgetragen werden, ein
// Punkt an "Threads" zeigte sonst auf einen Eintrag im eingeklappten Archiv, den
// niemand findet. Verworfen: das Archiv mitzuzählen.
export function threadListe(e: {
	ich: ThreadPerson;
	threads: readonly ListenThread[];
	umfeld: Umfeld;
	zugangSeit: Date;
	suche: string | null;
	mitArchiv: boolean;
	jetzt: Date;
}): ThreadListe {
	const suche = e.suche?.trim() || null;
	const zeilen: ThreadZeile[] = [];
	let archiv = 0;

	const sichtbar = e.threads
		.filter((t) => siehtThread(e.ich, t.kopf, e.umfeld))
		.filter((t) => suche === null || passtZuSuche(t.kopf, t.module, suche))
		.sort(nachAktivitaet);

	for (const t of sichtbar) {
		const daten = threadDatenAus(t.kopf, t.module);
		const archiviert = istArchiviert(t.kopf, daten.termine, e.jetzt);
		if (archiviert) {
			archiv++;
			if (!e.mitArchiv) continue;
		}
		zeilen.push({
			id: t.kopf.id,
			titel: t.kopf.titel,
			segment: threadSegment(t.kopf.id, t.kopf.titel),
			angepinnt: t.kopf.angepinnt,
			archiviert,
			entwurf: t.kopf.veroeffentlichtAm === null,
			naechsterTermin: naechsterTerminText(t.kopf, daten.termine, e.jetzt),
			neu:
				!archiviert &&
				istNeu({
					personId: e.ich.id,
					zugangSeit: e.zugangSeit,
					gelesenBis: t.gelesenBis,
					erstelltVonId: t.kopf.erstelltVonId,
					veroeffentlichtAm: t.kopf.veroeffentlichtAm,
					aenderungen: t.aenderungen,
				}),
		});
	}
	return { threads: zeilen, archiv };
}
