import { istErziehungsberechtigt, type PersonSicht, type Zuordnung } from './rechte.js';

export const EINWILLIGUNG_TEXT_VERSION = '1';

// Platzhalter. Der verbindliche Wortlaut steht in Spec 8.6 und wird dort juristisch
// festgelegt; bei einer Aenderung die Version hochzaehlen, damit erteilte
// Einwilligungen ihren damaligen Wortlaut behalten.
export const EINWILLIGUNG_TEXT =
	'Ich willige ein, dass die Jugendgruppe die Daten meines Kindes zur Organisation der Gruppe verarbeitet.';

// Entscheidung 6: Eine Einwilligung gilt nicht fuer sich, sondern nur, solange ihr
// Erteiler heute noch fuer das Kind einwilligen duerfte. Wird er entfernt, die
// Zuordnung geloest oder das Kind volljaehrig, verfaellt sie ohne eigenen Widerruf.
// Das wird bei jeder Abfrage berechnet statt beim Ereignis gespeichert; ein
// Verfallsflag waere bei jedem dieser Wege nachzupflegen und liefe leicht auseinander.
export function hatGueltigeEinwilligung(
	kind: PersonSicht,
	einwilligungen: readonly { erteiltVon: string; widerrufenAm: Date | null }[],
	erteiler: ReadonlyMap<string, PersonSicht>,
	zuordnungen: readonly Zuordnung[],
	jetzt: Date,
): boolean {
	return einwilligungen.some((w) => {
		if (w.widerrufenAm) return false;
		const e = erteiler.get(w.erteiltVon);
		return !!e && darfEinwilligen(e, kind, zuordnungen, jetzt);
	});
}

export function darfEinwilligen(
	erwachsener: PersonSicht,
	kind: PersonSicht,
	zuordnungen: readonly Zuordnung[],
	jetzt: Date,
): boolean {
	if (erwachsener.entferntAm) return false;
	return zuordnungen.some(
		(z) => z.erwachsenerId === erwachsener.id && z.jungfischerId === kind.id && istErziehungsberechtigt(z, kind, jetzt),
	);
}
