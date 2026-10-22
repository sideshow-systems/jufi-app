import { darfAntworten, type AntwortErlaubnis } from '../../threads/antworten.js';
import { istArchiviert } from '../../threads/archiv.js';
import { GRENZEN } from '../../threads/entwurf.js';
import { darfBearbeiten } from '../../threads/rechte.js';
import { siehtThread } from '../../threads/sichtbarkeit.js';
import type { AntwortRegel, HelferPositionDaten, ThreadDaten, ThreadPerson, Umfeld } from '../../threads/typen.js';

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
