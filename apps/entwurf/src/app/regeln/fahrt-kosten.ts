import type { Auto, Datenstand, FahrModul, Id, KostenModul, KostenStatus, Person, Thread } from '../daten/typen';
import { zusagen } from './antworten';
import { kinderImThread } from './sichtbarkeit';

export function freiePlaetze(a: Auto): number {
	return a.plaetze - a.mitfahrer.length;
}

/**
 * "Braucht noch Mitfahrt" (Rahmen 6.4.1): gibt es eine Teilnahme-Umfrage, nur
 * die zugesagten Kinder, sonst alle Kinder des Threads — jeweils ohne die, die
 * in dieser Richtung schon sitzen.
 */
export function mitfahrtOffen(stand: Datenstand, t: Thread, m: FahrModul, richtung: 'hin' | 'rueck'): Person[] {
	const z = zusagen(t);
	const sitzen = new Set(m.autos.filter((a) => a.richtung === richtung).flatMap((a) => a.mitfahrer));
	const kandidaten = z === null ? kinderImThread(stand, t) : z.map((id) => stand.personen.find((p) => p.id === id)!);
	return kandidaten.filter((k) => k && !sitzen.has(k.id));
}

/** Wer zahlen muss (Rahmen 6.4.2): die Zugesagten, ohne Teilnahme-Umfrage alle Kinder des Threads. */
export function zahlungspflichtig(stand: Datenstand, t: Thread): Id[] {
	return zusagen(t) ?? kinderImThread(stand, t).map((k) => k.id);
}

export function kostenStatus(m: KostenModul, kindId: Id): KostenStatus {
	return m.status[kindId] ?? 'offen';
}
