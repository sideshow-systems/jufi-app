import type { NavigationError } from '@angular/router';

/**
 * Wie die Browser einen nicht ladbaren dynamischen Import melden: Chrome und Edge, Safari, Firefox.
 * Nach einem Deployment tragen die Dateinamen der Chunks neue Pruefsummen; ein offener Tab kennt
 * noch die alten, und der Server hat sie nicht mehr.
 */
const MELDUNGEN = [
	'Failed to fetch dynamically imported module',
	'Importing a module script failed',
	'error loading dynamically imported module',
];

/** Tiefer als das schachtelt kein Framework; die Grenze schuetzt nur vor einer Ursachenschleife. */
const MAX_TIEFE = 5;

/** Ob der Fehler ein fehlender Lazy-Chunk ist; Angular verpackt den Import-Fehler je nach Weg als cause. */
export function istFehlenderChunk(fehler: unknown): boolean {
	let aktuell: unknown = fehler;
	for (let tiefe = 0; tiefe < MAX_TIEFE && aktuell !== null && aktuell !== undefined; tiefe++) {
		const text = aktuell instanceof Error ? aktuell.message : typeof aktuell === 'string' ? aktuell : '';
		if (MELDUNGEN.some((m) => text.includes(m))) return true;
		aktuell = typeof aktuell === 'object' ? (aktuell as { cause?: unknown }).cause : undefined;
	}
	return false;
}

const MARKE = 'jufi-chunk-neuladen';
const ABSTAND_MS = 10_000;

/**
 * Router-Fehlerhandler: Fehlt nach einem Deployment ein Chunk, laedt er die Zielseite komplett
 * neu, denn erst die neue index.html kennt die neuen Dateinamen (Spec 6.8). Er laedt die Adresse
 * der gescheiterten Navigation und nicht die aktuelle: Die Person wollte dorthin, und location.reload()
 * brachte sie zurueck auf die Seite davor.
 *
 * Hoechstens einmal je zehn Sekunden: Fehlt der Chunk auch nach dem Neuladen (Server kaputt, Netz weg),
 * soll die Seite den Fehler zeigen statt endlos zu laden. Die Marke steht in sessionStorage, nicht im
 * Speicher, weil der Speicher mit dem Neuladen verschwindet. Ist der Speicher nicht benutzbar (privater
 * Modus, gesperrt), gibt es keine Marke und damit keine Schleifensperre; dann laedt der Handler gar
 * nicht erst neu. Alle anderen Fehler laufen unveraendert weiter: Er gibt nichts zurueck.
 *
 * neuLaden und jetzt sind Parameter, damit der Test weder die Seite verlassen noch warten muss.
 */
export function chunkFehlerHandler(
	neuLaden: (url: string) => void = (url) => window.location.assign(url),
	jetzt: () => number = () => Date.now(),
): (fehler: NavigationError) => void {
	return (fehler) => {
		if (!istFehlenderChunk(fehler.error)) return;
		try {
			const zuletzt = Number(sessionStorage.getItem(MARKE));
			if (jetzt() - zuletzt < ABSTAND_MS) return;
			sessionStorage.setItem(MARKE, String(jetzt()));
		} catch {
			return;
		}
		neuLaden(fehler.url);
	};
}
