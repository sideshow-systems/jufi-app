import type { Person, VereinDb } from '@jufi/db';

/** Der Transaktions-Client, den db.$transaction der Vereins-Routen reicht. */
type Transaktion = Parameters<Parameters<VereinDb['$transaction']>[0]>[0];

/**
 * Haken fuer Wege, die einem Kind die Einwilligung nehmen koennen (Familie loesen,
 * spaeter Erwachsene entfernen): hat das Kind danach keine gueltige Einwilligung mehr,
 * verliert sein Zugang die Gueltigkeit. Task 9 liefert den Rumpf (zusammen mit
 * entzieheZugang); Task 6 ruft ihn schon, damit die Aufrufstelle steht und Task 9
 * nur noch hier fuellt, nicht in jeder Route nachruesten muss.
 */
export async function entzieheZugangWennUngueltig(_tx: Transaktion, _kind: Person): Promise<void> {
	// Bewusst leer bis Task 9.
}
