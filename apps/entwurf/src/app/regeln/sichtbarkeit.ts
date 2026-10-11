import type { Datenstand, Id, Person, Thread } from '../daten/typen';
import { istJugendleiter, kinderVon, person } from './personen';

/**
 * Jungfischer, die zur Zielgruppe eines Threads gehoeren. Leer bei
 * Jugendleiter-Threads. Bei "nurEltern" sind es die Kinder, ueber die ihre
 * Eltern den Thread sehen.
 */
export function kinderImThread(stand: Datenstand, t: Thread): Person[] {
	if (t.zielgruppe.rollen === 'nurJugendleiter') return [];
	const ug = t.zielgruppe.untergruppen;
	const mitglieder =
		ug === 'alle' ? null : new Set(stand.untergruppen.filter((u) => ug.includes(u.id)).flatMap((u) => u.mitglieder));
	return stand.personen.filter((p) => p.art === 'jungfischer' && (mitglieder === null || mitglieder.has(p.id)));
}

/**
 * Sichtbarkeit nach Rahmen 6.2: Jugendleiter sehen alles, auch unveroeffentlichte
 * Threads. Jungfischer sehen Threads ihrer Untergruppen, sofern die Rollen sie
 * einschliessen. Eltern sehen, was ihre Kinder sehen, und dazu die
 * Eltern-Threads, in denen ein eigenes Kind zur Untergruppe gehoert.
 */
export function siehtThread(stand: Datenstand, personId: Id, t: Thread): boolean {
	const p = person(stand, personId);
	if (!p) return false;
	if (istJugendleiter(p)) return true;
	if (!t.veroeffentlicht || t.zielgruppe.rollen === 'nurJugendleiter') return false;
	const kinder = new Set(kinderImThread(stand, t).map((k) => k.id));
	if (p.art === 'jungfischer') return t.zielgruppe.rollen === 'jungfischerUndEltern' && kinder.has(p.id);
	return kinderVon(stand, p.id).some((k) => kinder.has(k.id));
}

/**
 * Thread zu einer Nummer aus der Adresse. Unbekannt und unsichtbar ergeben
 * dasselbe undefined: wer einen Link auf einen fremden Thread bekommt, soll
 * nicht erfahren, dass es ihn gibt (Rahmen 8, 404 statt 403).
 */
export function threadZuNr(stand: Datenstand, personId: Id, nr: number): Thread | undefined {
	const t = stand.threads.find((x) => x.nr === nr);
	return t && siehtThread(stand, personId, t) ? t : undefined;
}
