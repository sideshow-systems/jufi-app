import { STANDARD_KATEGORIEN } from '@jufi/domain';
import type { Prisma } from '../generated/client.js';

/**
 * Die Kategorien, die jeder Verein von Anfang an hat. Gedacht fuer ein verschachteltes
 * `kategorien: { create: standardKategorien() }` in `verein.create`, aus demselben
 * Grund wie bei `austauschAnlegen`: Ein eigener Aufruf nach dem Anlegen liesse einen
 * Verein ohne Kategorien zurueck, wenn ein Weg ihn vergisst oder dazwischen scheitert.
 *
 * Die Namen kommen aus libs/domain, damit Oberflaeche und Regeln dieselbe Liste
 * kennen; die Migration `dateien` schreibt sie fuer bestehende Vereine noch einmal
 * als SQL, weil SQL den Code nicht aufrufen kann.
 */
export function standardKategorien(): Prisma.DokumentKategorieCreateWithoutVereinInput[] {
	return STANDARD_KATEGORIEN.map((name, position) => ({ name, position }));
}
