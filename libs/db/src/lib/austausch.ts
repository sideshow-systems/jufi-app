import type { Prisma } from '../generated/client.js';

export const AUSTAUSCH_TITEL = 'Jugendsprecher-Austausch';

/**
 * Daten des Jugendsprecher-Austauschs, den jeder Verein von Anfang an hat. Gedacht
 * fuer ein verschachteltes `threads: { create: austauschAnlegen(jetzt) }` in
 * `verein.create`: Verworfen wurde ein eigener Aufruf nach dem Anlegen, weil dann
 * ein Weg, der ihn vergisst oder zwischen beiden Schritten scheitert, einen Verein
 * ohne Austausch hinterliesse. Verschachtelt entsteht beides in einer Anweisung.
 *
 * Ohne Ersteller: Den Austausch legt das System an (CHECK thread_ersteller). `jetzt`
 * kommt vom Aufrufer, damit die Zeiten mit denen des Vereins uebereinstimmen und
 * Tests sie festlegen koennen.
 */
export function austauschAnlegen(jetzt: Date): Prisma.ThreadCreateWithoutVereinInput {
	return {
		art: 'JUGENDSPRECHER_AUSTAUSCH',
		titel: AUSTAUSCH_TITEL,
		modus: 'CHAT',
		rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER',
		alleUntergruppen: true,
		angepinnt: true,
		veroeffentlichtAm: jetzt,
		letzteAktivitaetAm: jetzt,
		angelegtAm: jetzt,
	};
}
