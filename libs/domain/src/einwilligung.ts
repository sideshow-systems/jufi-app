import { istErziehungsberechtigt, istVolljaehrig, type PersonSicht, type Zuordnung } from './rechte.js';

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

// Die Foto-Einwilligung ist eine eigene Einwilligung mit eigenem Text und eigener Version
// (Plan, Entscheidung 8): Die DSGVO-Einwilligung oeffnet den Zugang zur App, diese erlaubt
// nur, ein Kind auf Fotos zu zeigen. Eine ersetzt die andere nicht, und der Widerruf der
// einen zieht die andere nicht mit. Platzhalter wie oben; tools/pruefe-texte.sh findet sie hier.
export const FOTO_EINWILLIGUNG_TEXT_VERSION = '1';

export const FOTO_EINWILLIGUNG_TEXT =
	'Ich willige ein, dass in der Jugendgruppe Fotos meines Kindes für die Mitglieder des Vereins sichtbar sind.';

// Ein Volljaehriger willigt fuer sich selbst ein, deshalb eigener Wortlaut in der Ich-Form.
export const FOTO_EINWILLIGUNG_TEXT_SELBST =
	'Ich willige ein, dass in der Jugendgruppe Fotos von mir für die Mitglieder des Vereins sichtbar sind.';

export type EinwilligungZeile = { erteiltVon: string; widerrufenAm: Date | null };

// Plan, Entscheidung 6: Mit dem 18. Geburtstag entscheidet der Jungfischer selbst. Die
// Einwilligung der Eltern erlischt dann (darfEinwilligen gilt fuer Volljaehrige nicht mehr),
// und es zaehlt nur noch eine Zeile, die er selbst erteilt hat. Das ist dieselbe Rechnung wie
// bei der DSGVO-Einwilligung und wird wie dort bei jeder Abfrage gerechnet, nicht gespeichert.
// Verworfen: die Elterneinwilligung ueber 18 hinaus gelten zu lassen -- ein Erwachsener
// entscheidet ueber Fotos von sich selbst. Nach dem Geburtstag steht er so lange im Hinweis,
// bis er einwilligt; das ist die sichere Richtung.
export function fotoEinwilligungGilt(
	kind: PersonSicht,
	zeilen: readonly EinwilligungZeile[],
	erteiler: ReadonlyMap<string, PersonSicht>,
	zuordnungen: readonly Zuordnung[],
	jetzt: Date,
): boolean {
	if (istVolljaehrig(kind, jetzt)) return zeilen.some((z) => !z.widerrufenAm && z.erteiltVon === kind.id);
	return hatGueltigeEinwilligung(kind, zeilen, erteiler, zuordnungen, jetzt);
}
