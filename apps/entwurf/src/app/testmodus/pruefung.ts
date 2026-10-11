import { erzeugeBeispieldaten, P } from '../daten/beispieldaten';
import type { Testereignis } from '../daten/ereignisse';
import type { Datenstand, Id, Modul } from '../daten/typen';
import type { Aufgabe, PersonKey } from './typen';

export const PERSON_ID: Record<PersonKey, Id> = { sandra: P.sandra, lena: P.lena, thomas: P.thomas };

/**
 * Handlungsaufgaben pruefen ihren Datenstand; Suchaufgaben erledigt die
 * Antwortwahl im Band, deshalb hier nie erfuellt (Spec TP1 5.3).
 */
export function istErfuellt(a: Aufgabe, s: Datenstand, e: Testereignis[]): boolean {
	return a.art === 'handlung' && a.erfuellt(s, e);
}

/** Ein Modul eines Threads mit passendem Typ, sonst undefined. */
export function modul<T extends Modul['typ']>(
	s: Datenstand,
	threadId: Id,
	modulId: Id,
	typ: T,
): Extract<Modul, { typ: T }> | undefined {
	const m = s.threads.find((t) => t.id === threadId)?.module.find((x) => x.id === modulId);
	return m?.typ === typ ? (m as Extract<Modul, { typ: T }>) : undefined;
}

let ursprung: { bezugstag: string; personen: Set<Id>; verlauf: Set<Id> } | null = null;

/**
 * Was die Beispieldaten von sich aus mitbringen. "Neu" heisst: nicht darin.
 * Die IDs der Beispieldaten sind fest; neue IDs tragen einen Zeitstempel.
 */
export function ausBeispieldaten(s: Datenstand): { personen: Set<Id>; verlauf: Set<Id> } {
	if (ursprung?.bezugstag !== s.bezugstag) {
		const b = erzeugeBeispieldaten(s.bezugstag);
		ursprung = {
			bezugstag: s.bezugstag,
			personen: new Set(b.personen.map((p) => p.id)),
			verlauf: new Set(b.threads.flatMap((t) => t.verlauf.map((v) => v.id))),
		};
	}
	return ursprung;
}
