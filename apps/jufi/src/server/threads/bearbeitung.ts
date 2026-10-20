import type { VereinDb, VereinTx } from '@jufi/db';
import {
	darfArchivieren,
	darfBearbeiten,
	darfLoeschen,
	entwurfAusThread,
	istArchiviert,
	siehtThread,
	threadDatenAus,
	threadSegment,
	umfrageSperre,
	type ThreadBearbeitung,
	type ThreadDaten,
	type ThreadPerson,
	type Umfeld,
} from '@jufi/domain';
import { ladeThread } from './laden.js';

/**
 * Alle Untergruppen des Vereins, nach Name sortiert wie im Rest der Oberflaeche
 * (localeCompare 'de'). Sortiert in der Anwendung statt im orderBy: die Datenbank ordnet nach
 * ihrer Sortierfolge, und "Zander" stuende vor "aal", wenn sie ASCII-lastig waere.
 */
export async function ladeUntergruppen(db: VereinDb | VereinTx): Promise<{ id: string; name: string }[]> {
	const gruppen = await db.untergruppe.findMany({ select: { id: true, name: true } });
	return gruppen.sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
}

/**
 * Was einen Thread unloeschbar macht (Plan-Entscheidung 9): jede Antwortzeile, auch eine
 * ohne Option, und von den Nachrichten nur die nicht geloeschten; eine geloeschte hat keinen
 * Text mehr, und Systemeintraege sind Verlauf, keine Meinungsaeusserung. Die Antworten sind
 * mit dem Thread schon geladen (`daten`), die Nachrichten kommen aus einer eigenen Zaehlung.
 * Eine Stelle fuer beides: darfLoeschen der Bearbeitung und DELETE zaehlen so dasselbe.
 */
export async function loeschZaehler(
	db: VereinDb | VereinTx,
	daten: ThreadDaten,
): Promise<{ antworten: number; nachrichten: number }> {
	const nachrichten = await db.verlaufEintrag.count({
		where: { threadId: daten.kopf.id, art: 'NACHRICHT', geloeschtAm: null },
	});
	const antworten = daten.umfragen.reduce((summe, u) => summe + u.antworten.length, 0);
	return { antworten, nachrichten };
}

/**
 * Der Thread in bearbeitbarer Form, oder null: unbekannt, nicht sichtbar und nicht
 * bearbeitbar sind dieselbe Antwort (Rahmen-Spec 8), die Route macht daraus die 404.
 * Verworfen: fuer Leser ohne Bearbeitungsrecht eine schreibgeschuetzte Fassung --
 * Schluessel und Sperren gehoeren nicht an Leute, die den Thread nicht aendern koennen,
 * und der Editor hat dann auch nichts zu zeigen.
 *
 * Nimmt auch die Transaktion einer Schreibroute: PUT und Veroeffentlichen laden den Thread
 * nach der Sperre der Vereinszeile (Plan-Entscheidung 3) und bauen darauf Version, Sperren
 * und Loeschbarkeit auf. `umfeld` und `ich` kommen vom Aufrufer und stammen aus demselben
 * Ladevorgang, damit die Rechte nicht aus zwei Staenden zusammengesetzt werden.
 *
 * Geloescht werden darf nur ein leerer Thread; gezaehlt wird in loeschZaehler.
 *
 * Die Version wird VOR dem Inhalt gelesen, wie ladeVereinsstand vor den Daten: Unter READ
 * COMMITTED ist alles, was danach geladen wird, mindestens so neu wie die Version. Committet
 * ein PUT dazwischen, hat der Client neueren Inhalt mit der alten Version, und sein naechster
 * PUT endet in einem harmlosen 409 VERALTET. Andersherum (erst Inhalt, dann Version) bekaeme
 * er alten Inhalt mit der neuen Version, und sein PUT ueberschriebe die fremde Aenderung
 * still -- genau das, was die Version verhindern soll (Entscheidung 2). Verworfen: eine
 * Transaktion mit hoeherer Isolation (Global Constraint: keine isolationLevel) oder eine
 * Sperre der Vereinszeile fuer einen Lesevorgang. In der Transaktion einer Schreibroute
 * haelt die Sperre ohnehin alle Schreiber fern, dort ist die Reihenfolge gleichgueltig.
 */
export async function ladeBearbeitung(
	db: VereinDb | VereinTx,
	ich: ThreadPerson,
	threadId: string,
	umfeld: Umfeld,
	jetzt: Date,
): Promise<ThreadBearbeitung | null> {
	const stand = await db.thread.findUnique({ where: { id: threadId }, select: { bearbeitetStand: true } });
	if (!stand) return null;
	const geladen = await ladeThread(db, threadId);
	// Zwischen den beiden Abfragen geloescht: wie unbekannt behandeln.
	if (!geladen) return null;
	const { kopf, module } = geladen;
	if (!siehtThread(ich, kopf, umfeld) || !darfBearbeiten(ich, kopf)) return null;

	const daten = threadDatenAus(kopf, module);
	const [zaehler, untergruppen] = await Promise.all([loeschZaehler(db, daten), ladeUntergruppen(db)]);
	return {
		id: kopf.id,
		segment: threadSegment(kopf.id, kopf.titel),
		art: kopf.art,
		version: stand.bearbeitetStand,
		veroeffentlicht: kopf.veroeffentlichtAm !== null,
		angepinnt: kopf.angepinnt,
		archiviert: istArchiviert(kopf, daten.termine, jetzt),
		darfLoeschen: darfLoeschen(ich, kopf, zaehler),
		darfArchivieren: darfArchivieren(ich, kopf),
		entwurf: entwurfAusThread(kopf, module),
		sperren: Object.fromEntries(daten.umfragen.map((u) => [u.modulId, umfrageSperre(u)])),
		untergruppen,
	};
}
