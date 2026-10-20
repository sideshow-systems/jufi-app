import type { TerminDaten } from '../module/termin/termin.js';
import { letzterTag } from '../module/termin/termin.js';
import { berlinerTag, tagPlus } from '../zeit.js';
import type { ThreadKopf } from './typen.js';

// Karenz nach dem letzten Tag des letzten Termins, bevor der Thread ins Archiv wandert.
const KARENZ_TAGE = 7;

// Spec 3.7, zur Lesezeit berechnet: kein Cron, kein gespeichertes Flag, das bei jeder
// Terminaenderung nachzuziehen waere. Die Reihenfolge ist Teil der Regel: ein
// manuelles ARCHIVIERT schlaegt Anpinnen und Austausch, AKTIV_HALTEN schlaegt die
// Datumsregel.
// Die Grenze ist ein Berliner Kalendertag, kein Zeitpunkt im Abstand von 7 x 24 Stunden:
// Die Woche ueber die Zeitumstellung (25.10.2026) ist 168 oder 169 Stunden lang, und
// "ab 00:00 Uhr am siebten Tag" soll in beiden Faellen um Mitternacht Berlin greifen.
// Verglichen wird als 'JJJJ-MM-TT'-Zeichenkette, die sich lexikografisch wie das Datum
// ordnet.
export function istArchiviert(kopf: ThreadKopf, termine: readonly TerminDaten[], jetzt: Date): boolean {
	if (kopf.archivModus === 'ARCHIVIERT') return true;
	if (kopf.archivModus === 'AKTIV_HALTEN') return false;
	if (kopf.angepinnt || kopf.art === 'JUGENDSPRECHER_AUSTAUSCH') return false;
	if (termine.length === 0) return false;

	const spaetester = termine.map(letzterTag).reduce((a, b) => (a >= b ? a : b));
	return berlinerTag(jetzt) >= tagPlus(spaetester, KARENZ_TAGE);
}
