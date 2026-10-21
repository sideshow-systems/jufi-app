import type { VereinTx } from '@jufi/db';
import type { DateiArt } from '@jufi/domain';
import { dateiSchluessel } from './speicher.js';

/**
 * Der einzige Weg, Dateien zu loeschen: Die Zeilen fallen, die Bytes bleiben noch 24 Stunden
 * liegen, und ihre Schluessel stehen auf der Loeschliste (Spec 2.7). Der Aufraeumer loescht sie
 * danach. Verworfen: die Bytes sofort loeschen -- dann kaeme ein Rollback der Transaktion mit
 * Zeile, aber ohne Bytes zurueck, und eine Sicherung von vor dem Loeschen fuehrte nach der
 * Wiederherstellung auf Zeilen ohne Bytes. Verworfen: Kaskade in der Datenbank -- sie umginge
 * diese Liste (Schema: NoAction).
 *
 * In der Transaktion des Aufrufers, damit Zeile und Listeneintrag zusammen gelten oder zusammen
 * ausbleiben. Bei Fotos steht die Vorschau extra auf der Liste, bei Dateien gibt es keine.
 */
export async function loescheDateien(
	tx: VereinTx,
	vereinId: string,
	dateien: readonly { id: string; art: DateiArt }[],
	jetzt: Date,
): Promise<void> {
	if (dateien.length === 0) return;
	await tx.datei.deleteMany({ where: { id: { in: dateien.map((d) => d.id) } } });
	await tx.dateiLoeschung.createMany({
		data: dateien.flatMap((d) => [
			{ schluessel: dateiSchluessel(vereinId, d.id), geloeschtAm: jetzt },
			...(d.art === 'FOTO' ? [{ schluessel: dateiSchluessel(vereinId, d.id, true), geloeschtAm: jetzt }] : []),
		]),
	});
}
