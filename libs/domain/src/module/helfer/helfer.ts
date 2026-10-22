import type { ModulDaten } from '../../threads/ansicht.js';
import { antwortZeilen, darfAntworten, type AntwortErlaubnis } from '../../threads/antworten.js';
import { istArchiviert } from '../../threads/archiv.js';
import { GRENZEN, type PositionEntwurf } from '../../threads/entwurf.js';
import { absenderName, eingetragenVon } from '../../threads/namen.js';
import { darfBearbeiten } from '../../threads/rechte.js';
import { siehtThread } from '../../threads/sichtbarkeit.js';
import type {
	AntwortEinheit,
	AntwortRegel,
	HelferDaten,
	HelferPositionDaten,
	ThreadDaten,
	ThreadPerson,
	Umfeld,
} from '../../threads/typen.js';

// Der Server macht aus ARCHIVIERT dieselbe 409 wie beim Schreiben im Archiv.
export type EintragErlaubnis = AntwortErlaubnis | 'ARCHIVIERT';

// Kopf fuer Sichtbarkeit und Rechte, Termine fuer die Archivregel.
type HelferThread = Pick<ThreadDaten, 'kopf' | 'termine'>;

// Spec 5 und 8, Plan-Entscheidung 3. Wer eingetragen werden darf, entscheidet dieselbe
// Regel wie bei der Umfrage (darfAntworten): 404 fuer alles, was die Person nicht sehen
// oder nicht beantworten darf, dann Entwurf. Erst danach das Archiv, damit es niemandem
// verraten wird, der den Thread gar nicht sieht, aber vor der Frist: Im Archiv ist "nur
// noch Leitung" (Spec 8) der Grund, auch wenn die Frist ebenfalls vorbei ist. Wer
// bearbeiten darf, traegt auch im Archiv nach, wie nach der Frist.
// Verworfen: die Archivpruefung in darfAntworten selbst, denn dann aenderte sich nebenbei
// die Umfrage. Dass ihr die Archivpruefung fehlt, ist eine offene Frage an den
// Eigentuemer und nicht Teil dieser Etappe.
export function darfEintragen(
	person: ThreadPerson,
	fuerId: string,
	helfer: AntwortRegel,
	daten: HelferThread,
	umfeld: Umfeld,
	jetzt: Date,
): EintragErlaubnis {
	const antwort = darfAntworten(person, fuerId, helfer, daten.kopf, umfeld, jetzt);
	if (antwort === 'NICHT_GEFUNDEN' || antwort === 'ENTWURF') return antwort;
	if (!darfBearbeiten(person, daten.kopf) && istArchiviert(daten.kopf, daten.termine, jetzt)) return 'ARCHIVIERT';
	return antwort;
}

// Plan-Entscheidung 2. Ein Eintrag bleibt stehen, wenn seine Person nicht mehr gefragt ist
// (entfernt oder aus der Zielgruppe gefallen); wegnehmen kann ihn dann nur, wer den Thread
// bearbeiten darf. Fuer alle anderen gilt darfEintragen, und dort ist eine nicht mehr
// gefragte Person "nicht gefunden". Verworfen: auch der Familie das Austragen eines
// fremden verwaisten Eintrags zu erlauben, weil sie dafuer kein Recht an der Zeile hat.
export function darfAustragen(
	person: ThreadPerson,
	eintrag: { fuerId: string },
	helfer: AntwortRegel,
	daten: HelferThread,
	umfeld: Umfeld,
	jetzt: Date,
): EintragErlaubnis {
	if (darfBearbeiten(person, daten.kopf) && siehtThread(person, daten.kopf, umfeld) && daten.kopf.veroeffentlichtAm) {
		return 'ERLAUBT';
	}
	return darfEintragen(person, eintrag.fuerId, helfer, daten, umfeld, jetzt);
}

// Plan-Entscheidung 1: Jeder Eintrag belegt seinen Platz, auch der einer Person, die nicht
// mehr gefragt ist. Gezaehlt werden deshalb alle Zeilen der Position, dieselben wie im
// Fuellstand und in der Editor-Pruefung. Verworfen: wie bei der Umfrage nur Gefragte zu
// zaehlen, denn dann gaebe ein verwaister Eintrag seinen Platz frei, und kaeme die Person
// zurueck, waere die Position ueberbucht. Wer schon eingetragen ist, aendert nur seine
// Notiz und belegt keinen zweiten Platz; das geht auch in einer vollen Position.
export function hatPlatzFuer(position: HelferPositionDaten, fuerId: string): boolean {
	return position.eintraege.some((e) => e.fuerId === fuerId) || position.eintraege.length < position.anzahl;
}

// Steuer- und Formatzeichen (etwa die Richtungsumkehr U+202E) koennten den Namen daneben
// optisch verdrehen; eine Notiz ist ein kurzer Satz und braucht keines davon.
const UNSICHTBAR = /[\p{Cc}\p{Cf}]/u;

// Spec 8. Laenge in Codepunkten nach trim, wie alle Grenzen in GRENZEN (laenge in
// entwurf.ts): ein Emoji zaehlt einmal, obwohl es in UTF-16 zwei Einheiten belegt.
// Verworfen: String.length, das einer Notiz mit Emojis weniger Zeichen liesse als der
// Editor anzeigt. Leer heisst "keine Notiz" (null), damit eine geleerte Notiz nicht als
// leerer String neben dem Namen steht.
export function pruefeNotiz(roh: unknown): { ok: true; notiz: string | null } | { ok: false } {
	if (roh === undefined || roh === null) return { ok: true, notiz: null };
	if (typeof roh !== 'string') return { ok: false };
	const notiz = roh.trim();
	if (notiz === '') return { ok: true, notiz: null };
	if (UNSICHTBAR.test(notiz) || [...notiz].length > GRENZEN.notiz) return { ok: false };
	return { ok: true, notiz };
}

// Was an einer Helferliste durch Eintraege festliegt. Der Editor sperrt damit Entfernen, Einheit
// und die Anzahl nach unten, bevor der Server mit 409 antworten muss; beide fragen dieselben
// Zahlen (wie umfrageSperre).
export interface HelferSperre {
	/** Irgendeine Position hat einen Eintrag: Modul und Einheit liegen fest. */
	eingetragen: boolean;
	/**
	 * Schluessel -> Zahl der Eintraege, nur belegte Positionen; eine fehlende heisst 0. Gezaehlt
	 * wird jede Zeile, auch die einer Person, die nicht mehr gefragt ist (Plan-Entscheidung 1).
	 */
	belegt: Record<string, number>;
}

export function helferSperre(h: HelferDaten): HelferSperre {
	const belegt: Record<string, number> = {};
	for (const p of h.positionen) {
		if (p.eintraege.length > 0) belegt[p.schluessel] = p.eintraege.length;
	}
	return { eingetragen: Object.keys(belegt).length > 0, belegt };
}

export type HelferKonflikt =
	{ feld: 'positionen'; schluessel: string; art: 'ENTFERNT' | 'ANZAHL'; belegt: number } | { feld: 'einheit' };

// Spec 5.2 und Plan-Entscheidung 9, analog pruefeUmfrageAenderung: Mit Eintraegen verweigert der
// Server Aenderungen, die sie entwerten wuerden. Verworfen: Eintraege dabei still zu loeschen
// oder eine zu kleine Anzahl zu kappen, denn dann staende eine Familie ohne Nachricht nicht
// mehr auf der Liste, obwohl sie den Kuchen backt. Positionen werden ueber den Schluessel
// verglichen, nicht ueber Text oder Index: Umbenennen und Umsortieren bleiben frei. Eine Position
// ohne Schluessel ist neu und ersetzt keine alte, auch wenn sie gleich heisst.
export function pruefeHelferAenderung(
	alt: HelferDaten,
	neu: { einheit: AntwortEinheit; positionen: readonly PositionEntwurf[] },
): HelferKonflikt[] {
	const anzahlNeu = new Map(neu.positionen.flatMap((p) => (p.schluessel === null ? [] : [[p.schluessel, p.anzahl]])));
	const konflikte: HelferKonflikt[] = [];
	for (const p of alt.positionen) {
		const belegt = p.eintraege.length;
		if (belegt === 0) continue;
		const anzahl = anzahlNeu.get(p.schluessel);
		if (anzahl === undefined) konflikte.push({ feld: 'positionen', schluessel: p.schluessel, art: 'ENTFERNT', belegt });
		else if (anzahl < belegt) konflikte.push({ feld: 'positionen', schluessel: p.schluessel, art: 'ANZAHL', belegt });
	}
	if (neu.einheit !== alt.einheit && helferSperre(alt).eingetragen) konflikte.push({ feld: 'einheit' });
	return konflikte;
}

export interface HelferEintragAnsicht {
	fuerId: string;
	/** absenderName: wie ein Absender im Verlauf, damit "Sandra M. (Mutter von Lena)" ueberall gleich heisst. */
	name: string;
	notiz: string | null;
	/** Nur fuer Betroffene und Leitung (Plan-Entscheidung 11), sonst null. */
	eingetragenVon: string | null;
}

export interface HelferModulAnsicht {
	typ: 'HELFER';
	id: string;
	titel: string | null;
	einheit: AntwortEinheit;
	/** ISO-Zeitpunkt; den Text rechnet der Client mit fristText, wie bei der Umfrage. */
	frist: string | null;
	fristAbgelaufen: boolean;
	positionen: { id: string; text: string; anzahl: number; belegt: number; eintraege: HelferEintragAnsicht[] }[];
	zeilen: { fuerId: string; vorname: string; selbst: boolean; darfEintragen: boolean }[];
}

/**
 * Die Helferliste so, wie die Person sie sieht. Fuellstand und Eingetragene sieht jeder Leser
 * (Spec 5.2: wer sich eintraegt, will gesehen werden), auch Eintraege von Personen, die nicht
 * mehr gefragt sind, denn sie belegen ihren Platz (Plan-Entscheidung 1). "eingetragen von"
 * dagegen nur, wer fuer diese Zeile antworten oder den Thread bearbeiten darf (Entscheidung 11):
 * Fuer fremde Leser waere es ein Blick in die Abstimmung einer anderen Familie. Das Recht je
 * Zeile kommt aus darfEintragen, damit Frist, Archiv, Entwurf und Nachtragen an einer Stelle
 * entschieden werden.
 */
export function helferAnsicht(
	ich: ThreadPerson,
	modul: Extract<ModulDaten, { typ: 'HELFER' }>,
	daten: ThreadDaten,
	umfeld: Umfeld,
	jetzt: Date,
): HelferModulAnsicht {
	const h = modul.helfer;
	const zeilen = antwortZeilen(ich, h, daten.kopf, umfeld);
	const eigene = new Set(zeilen.map((z) => z.fuerId));
	const leitung = darfBearbeiten(ich, daten.kopf);
	return {
		typ: 'HELFER',
		id: modul.id,
		titel: modul.titel,
		einheit: h.einheit,
		frist: h.frist ? h.frist.toISOString() : null,
		fristAbgelaufen: h.frist !== null && jetzt.getTime() >= h.frist.getTime(),
		positionen: h.positionen.map((p) => ({
			id: p.id,
			text: p.text,
			anzahl: p.anzahl,
			belegt: p.eintraege.length,
			eintraege: p.eintraege.map((e): HelferEintragAnsicht => ({
				fuerId: e.fuerId,
				name: absenderName(e.fuerId, umfeld),
				notiz: e.notiz,
				eingetragenVon: leitung || eigene.has(e.fuerId) ? eingetragenVon(e.vonId, e.fuerId, ich.id, umfeld) : null,
			})),
		})),
		zeilen: zeilen.map((z) => ({
			fuerId: z.fuerId,
			vorname: z.vorname,
			selbst: z.selbst,
			darfEintragen: darfEintragen(ich, z.fuerId, h, daten, umfeld, jetzt) === 'ERLAUBT',
		})),
	};
}
