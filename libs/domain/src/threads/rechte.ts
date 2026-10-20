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

// Entwuerfe sind auch fuer Jugendleiter stumm (Spec 3.6), und im Archiv ist das
// Schreiben gesperrt (3.7); wer bearbeiten darf, traegt dort nach, ohne zu schreiben.
export function darfSchreiben(
	person: ThreadPerson,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	termine: readonly TerminDaten[],
	jetzt: Date,
): boolean {
	if (!siehtThread(person, kopf, umfeld)) return false;
	if (!kopf.veroeffentlichtAm) return false;
	if (kopf.modus === 'AUSHANG') return false;
	return !istArchiviert(kopf, termine, jetzt);
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
