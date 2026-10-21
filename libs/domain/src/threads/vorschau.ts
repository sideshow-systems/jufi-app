import type { Rollenfilter } from './typen.js';

// Spec 7.2. Die Vorschau eines Links laeuft ohne Anmeldung: Der Messenger holt die Seite
// ohne Cookie. Den Titel bekommt deshalb nur ein Thread, den jede Person der Familie ohnehin
// kennt -- veroeffentlicht und fuer Familien bestimmt. Alles andere (Jugendleiter-Thread,
// Entwurf, Austausch, fremde oder unbekannte ID) faellt auf den Vereinsnamen zurueck, damit
// die Antwort nichts ueber die Existenz des Threads verraet. Verworfen: den Titel auch bei
// "nur Jugendleiter" zeigen, weil schon ein Titel wie "Elterngespraech Tom" mehr verraet,
// als ein Link in einer Gruppe preisgeben darf.
const OEFFENTLICH: ReadonlySet<Rollenfilter> = new Set(['JUNGFISCHER_FAMILIE', 'NUR_FAMILIE']);

export function vorschauTitel(
	thread: { titel: string; veroeffentlichtAm: Date | null; rollenfilter: Rollenfilter } | null,
): string | null {
	if (!thread || thread.veroeffentlichtAm === null) return null;
	return OEFFENTLICH.has(thread.rollenfilter) ? thread.titel : null;
}
