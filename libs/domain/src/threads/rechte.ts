import type { TerminDaten } from '../module/termin/termin.js';
import { hatRecht } from '../rechte.js';
import { istArchiviert } from './archiv.js';
import { siehtThread } from './sichtbarkeit.js';
import type { ThreadKopf, ThreadPerson, Umfeld } from './typen.js';

// Spec 3.5. Ein Thread mit "Threads erstellen" gehoert seinem Ersteller: Moderation,
// Modus und Archiv haengen an derselben Regel wie der Inhalt. Verworfen: Modus, Archiv und
// Moderation nur mit "Alle Threads bearbeiten" (Rahmen 4.2 woertlich) -- wer einen
// Termin anlegt, soll ihn nach der Veranstaltung auch selbst auf "Nur Aushang" stellen
// koennen. Den Austausch bearbeiten nur Inhaber von "Alle Threads bearbeiten" (FAM 2.5);
// dort hilft auch das Erstellen nichts, weil der Austausch keinem Ersteller gehoert.
// Entfernte duerfen nichts, auch wenn ihnen noch Rechte anhaengen (wie siehtThread).
export function darfBearbeiten(person: ThreadPerson, kopf: ThreadKopf): boolean {
	if (person.entferntAm) return false;
	if (hatRecht(person, 'ALLE_THREADS')) return true;
	if (kopf.art === 'JUGENDSPRECHER_AUSTAUSCH') return false;
	return hatRecht(person, 'THREADS_ERSTELLEN') && kopf.erstelltVonId === person.id;
}

// Der Austausch ist dauerhaft: er wandert nie ins Archiv (istArchiviert), also laesst er
// sich auch nicht von Hand dorthin schieben.
export function darfArchivieren(person: ThreadPerson, kopf: ThreadKopf): boolean {
	return kopf.art !== 'JUGENDSPRECHER_AUSTAUSCH' && darfBearbeiten(person, kopf);
}

// Loeschen ist endgueltig, deshalb nur ein leerer Thread: Familien sollen nicht
// kommentarlos verlieren, was sie eingetragen haben, dafuer gibt es das Archiv. Die
// Zaehler kommen vom Aufrufer und enthalten keine Systemeintraege.
export function darfLoeschen(
	person: ThreadPerson,
	kopf: ThreadKopf,
	zaehler: { antworten: number; nachrichten: number },
): boolean {
	return (
		kopf.art !== 'JUGENDSPRECHER_AUSTAUSCH' &&
		darfBearbeiten(person, kopf) &&
		zaehler.antworten === 0 &&
		zaehler.nachrichten === 0
	);
}

export type SchreibSperre = 'NICHT_GEFUNDEN' | 'ENTWURF' | 'NUR_AUSHANG' | 'ARCHIVIERT';

// Entwuerfe sind auch fuer Jugendleiter stumm (Spec 3.6), und im Archiv ist das
// Schreiben gesperrt (3.7); wer bearbeiten darf, traegt dort nach, ohne zu schreiben.
// Der Grund steht hier und nicht nur ein Ja/Nein, weil Server (404/409) und Oberflaeche
// (Hinweis statt Eingabefeld) dieselbe Reihenfolge brauchen: wer den Thread nicht sieht,
// erfaehrt nichts ueber Entwurf oder Modus. Verworfen: den Grund in Server und Client
// je einzeln herleiten, weil beide Seiten dann auseinanderliefen.
export function schreibSperre(
	person: ThreadPerson,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	termine: readonly TerminDaten[],
	jetzt: Date,
): SchreibSperre | null {
	if (!siehtThread(person, kopf, umfeld)) return 'NICHT_GEFUNDEN';
	if (!kopf.veroeffentlichtAm) return 'ENTWURF';
	if (kopf.modus === 'AUSHANG') return 'NUR_AUSHANG';
	if (istArchiviert(kopf, termine, jetzt)) return 'ARCHIVIERT';
	return null;
}

export function darfSchreiben(
	person: ThreadPerson,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	termine: readonly TerminDaten[],
	jetzt: Date,
): boolean {
	return schreibSperre(person, kopf, umfeld, termine, jetzt) === null;
}

// Systemeintraege ("veroeffentlicht" usw.) sind Verlauf, keine Meinungsaeusserung, und
// bleiben stehen. Eine geloeschte Nachricht noch einmal zu loeschen waere ein
// Leerlauf, der nur eine zweite Aenderung erzeugte. Die eigene Nachricht darf immer
// weg, auch im Archiv; Entfernte kommen nicht mehr in den Thread.
export function darfLoeschenNachricht(
	person: ThreadPerson,
	eintrag: { autorId: string | null; art: 'NACHRICHT' | 'SYSTEM'; geloeschtAm: Date | null },
	kopf: ThreadKopf,
): boolean {
	if (person.entferntAm) return false;
	if (eintrag.art !== 'NACHRICHT' || eintrag.geloeschtAm) return false;
	if (eintrag.autorId === person.id) return true;
	return darfBearbeiten(person, kopf);
}

export type FotoHochladen = 'JUGENDLEITER' | 'ALLE';

// Wer Fotos in ein Foto-Modul laden darf. Bearbeiter immer, auch im Entwurf und im Archiv:
// Wer den Thread pflegt, laedt die Bilder der Veranstaltung auch Wochen danach noch hoch.
// Leser nur, wenn der Ersteller es mit "Alle Leser laden hoch" erlaubt hat, und dann nur in
// einem lebenden Thread: ein Entwurf ist fuer sie unsichtbar, und ein Archiv ist
// abgeschlossen (3.7). Verworfen: das Recht an die Schreibsperre zu haengen, weil sie den
// Modus "Nur Aushang" sperrt -- ein Aushang kann trotzdem Fotos sammeln.
export function darfFotosHochladen(
	person: ThreadPerson,
	kopf: ThreadKopf,
	hochladen: FotoHochladen,
	e: { umfeld: Umfeld; termine: readonly TerminDaten[]; jetzt: Date },
): boolean {
	if (darfBearbeiten(person, kopf)) return true;
	return (
		hochladen === 'ALLE' &&
		siehtThread(person, kopf, e.umfeld) &&
		!!kopf.veroeffentlichtAm &&
		!istArchiviert(kopf, e.termine, e.jetzt)
	);
}

// Das eigene Foto darf jeder zurueckziehen, auch im Archiv (wie die eigene Nachricht), das
// fremde nur, wer den Thread bearbeitet. Ob die Person den Thread sieht, prueft der Aufrufer:
// hier steht nur die Frage nach dem Foto.
export function darfFotoLoeschen(person: ThreadPerson, kopf: ThreadKopf, vonId: string): boolean {
	return vonId === person.id || darfBearbeiten(person, kopf);
}
