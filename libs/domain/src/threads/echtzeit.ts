import { siehtThread } from './sichtbarkeit.js';
import type { AenderungArt, ThreadKopf, ThreadPerson, Umfeld } from './typen.js';
import { verlaufAnsicht, type VerlaufAnsicht, type VerlaufEintragDaten } from './verlauf.js';

/**
 * Was ein Socket erfaehrt. Es sagt nur, dass sich etwas geaendert hat, und nennt den
 * Thread; den Inhalt holt der Client ueber die gewohnte REST-Abfrage, die ohnehin jede
 * Sichtpruefung macht. Einzige Ausnahme sind Verlaufseintraege: Eine Nachricht kommt
 * als fertige Ansicht der Person mit, damit ein Chat nicht je Nachricht nachladen muss.
 */
export interface EchtzeitSignal {
	stand: number;
	// null: Es hat sich etwas am Umfeld des Vereins geaendert (Person, Untergruppe,
	// Recht), das keinem Thread gehoert. Der Client laedt dann alles neu, und objektId
	// ist leer (signaleFuer).
	threadId: string | null;
	art: AenderungArt;
	objektId: string;
	eintrag?: VerlaufAnsicht;
}

export interface SignalAenderung {
	threadId: string | null;
	art: AenderungArt;
	objektId: string;
}

// Der Eintrag samt Thread, denn die Route reicht die Eintraege einer Transaktion
// gesammelt weiter und die Zuordnung zur Aenderung laeuft ueber Thread und ID.
export type SignalEintrag = VerlaufEintragDaten & { threadId: string };

/**
 * Die Signale, die eine Person fuer die Aenderungen einer Transaktion bekommt.
 *
 * Die Pruefung laeuft je Ereignis gegen den frischen Kopf und das frische Umfeld, es gibt
 * kein Abo je Thread (Entscheidung 2). Verworfen: beim Verbinden festhalten, welche Threads
 * die Person sieht, weil sich das mit jeder Zielgruppen-, Rechte- oder Familienaenderung
 * aendert und der Socket es nicht mitbekaeme.
 *
 * SICHTBARKEIT und GELOESCHT gehen ohne Pruefung an jeden: Wer einen Thread gerade
 * verloren hat, bestuende die Pruefung gegen den neuen Kopf nicht mehr, und ein
 * geloeschter hat keinen. Genau diese Personen muessen es erfahren, damit ihre Ansicht
 * den Thread entfernt. Der Preis ist eine zufaellige Thread-ID, die niemand deuten kann.
 * Verworfen: den Kopf von vorher durch das Ereignis zu reichen, weil dann jede Route
 * ihn laden muesste.
 *
 * Eine Person ohne Eintrag im Umfeld (entfernt) bekommt nichts.
 *
 * Mehrere Aenderungen desselben Threads und derselben Art ergeben ein Signal, denn der
 * Client laedt ohnehin den ganzen Thread neu. Ausnahme sind Verlaufseintraege mit
 * bekanntem Inhalt: Jeder ist eine eigene Nachricht, die ankommen muss. Ein Verlaufseintrag,
 * den die Route nicht mitgegeben hat (etwa ein Systemeintrag), zaehlt wie jede andere Art.
 * Aenderungen ohne Thread werden alle zu einem Signal mit leerer objektId, weil der
 * Client daraufhin ohnehin alles laedt (Entscheidung 3).
 */
export function signaleFuer(e: {
	ich: ThreadPerson | undefined;
	umfeld: Umfeld;
	koepfe: ReadonlyMap<string, ThreadKopf>;
	stand: number;
	aenderungen: readonly SignalAenderung[];
	eintraege: readonly SignalEintrag[];
}): EchtzeitSignal[] {
	const { ich } = e;
	if (!ich) return [];

	const eintragNach = new Map(e.eintraege.map((eintrag) => [`${eintrag.threadId}\n${eintrag.id}`, eintrag]));
	const gesehen = new Set<string>();
	const signale: EchtzeitSignal[] = [];

	for (const a of e.aenderungen) {
		if (a.threadId === null) {
			if (gesehen.has('')) continue;
			gesehen.add('');
			// Leer statt der ID der Person oder Untergruppe: Das Signal geht an jeden Socket des
			// Vereins, auch an Familien und Jungfischer, und die ID verriete, bei welchem Kind sich
			// wann Rechte, Einwilligung, Familie oder Zugang geaendert haben. Der Client braucht sie
			// nicht, er laedt ohnehin alles neu. Verworfen: die ID weitergeben wie bei Threads, deren
			// zufaellige ID nichts ueber eine Person sagt.
			signale.push({ stand: e.stand, threadId: null, art: 'SICHTBARKEIT', objektId: '' });
			continue;
		}

		const kopf = e.koepfe.get(a.threadId);
		const ohnePruefung = a.art === 'SICHTBARKEIT' || a.art === 'GELOESCHT';
		if (!ohnePruefung && (!kopf || !siehtThread(ich, kopf, e.umfeld))) continue;

		const eintrag = a.art === 'VERLAUF' ? eintragNach.get(`${a.threadId}\n${a.objektId}`) : undefined;
		if (eintrag && kopf) {
			const schluessel = `${a.threadId}\nEINTRAG\n${eintrag.id}`;
			if (gesehen.has(schluessel)) continue;
			gesehen.add(schluessel);
			signale.push({
				stand: e.stand,
				threadId: a.threadId,
				art: a.art,
				objektId: eintrag.id,
				eintrag: verlaufAnsicht(ich, kopf, eintrag, e.umfeld),
			});
			continue;
		}

		const schluessel = `${a.threadId}\n${a.art}`;
		if (gesehen.has(schluessel)) continue;
		gesehen.add(schluessel);
		signale.push({ stand: e.stand, threadId: a.threadId, art: a.art, objektId: a.objektId });
	}
	return signale;
}

export interface SyncAntwort {
	stand: number;
	// Threads, die sich seit dem Stand des Clients geaendert haben und die er sieht.
	geaendert: string[];
	// Threads mit Aenderung, die er nicht (mehr) sieht oder die es nicht mehr gibt. Beides
	// ist fuer ihn dasselbe, und die Antwort verraet nicht, welcher Fall vorliegt.
	unsichtbar: string[];
	// Wahr: Der Client laedt alles neu, die Listen sind leer.
	vollstaendig: boolean;
}

/**
 * Antwort auf "was ist seit Stand n passiert" (Entscheidung 6). Der Client kann Signale
 * verpasst haben, solange er getrennt war; dieser Abgleich holt sie nach.
 *
 * Alles neu laden gilt, wenn sich der Abstand nicht belegen laesst: kein seit (erster
 * Sync), ein seit hinter dem Stand (die Datenbank stammt aus einer Sicherung), ein seit
 * vor der aeltesten aufbewahrten Aenderung (aufgeraeumt; "aeltester - 1" ist noch
 * lueckenlos, denn der aelteste Stand selbst liegt vor) oder eine Aenderung ohne Thread
 * (Entscheidung 3). Ohne Zeilen gibt es nichts, woran sich Luecken messen liessen; dann
 * ist nur "seit gleich Stand" gewiss. Ein leerer Stand (Transaktion ohne Aenderung) kann
 * so ein ueberfluessiges Neuladen ausloesen, nie ein verpasstes. Verworfen: den
 * Aufraeum-Stand im Verein zu speichern, weil das eine Spalte fuer ein gelegentlich
 * ueberfluessiges Neuladen waere.
 */
export function syncAntwort(e: {
	ich: ThreadPerson;
	umfeld: Umfeld;
	koepfe: ReadonlyMap<string, ThreadKopf>;
	seit: number | null;
	stand: number;
	aeltesterStand: number | null;
	// Die verschiedenen threadId der Aenderungen mit stand > seit.
	threadIds: readonly (string | null)[];
}): SyncAntwort {
	const alles: SyncAntwort = { stand: e.stand, geaendert: [], unsichtbar: [], vollstaendig: true };
	if (e.seit === null || e.seit > e.stand) return alles;
	const luecke = e.aeltesterStand === null ? e.seit < e.stand : e.seit < e.aeltesterStand - 1;
	if (luecke || e.threadIds.includes(null)) return alles;

	const antwort: SyncAntwort = { stand: e.stand, geaendert: [], unsichtbar: [], vollstaendig: false };
	for (const id of new Set(e.threadIds as readonly string[])) {
		const kopf = e.koepfe.get(id);
		(kopf && siehtThread(e.ich, kopf, e.umfeld) ? antwort.geaendert : antwort.unsichtbar).push(id);
	}
	return antwort;
}
