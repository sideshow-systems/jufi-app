const KUERZEL = new Map<string, string>([
	['application/pdf', 'PDF'],
	['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word'],
	['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel'],
	['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PowerPoint'],
	['application/vnd.oasis.opendocument.text', 'OpenDocument'],
	['application/vnd.oasis.opendocument.spreadsheet', 'OpenDocument'],
	['image/jpeg', 'Bild'],
	['image/png', 'Bild'],
	['image/webp', 'Bild'],
]);

/**
 * Nur das, was der Server inline ausliefert (INLINE_TYPEN in server/dateien/ausliefern.ts): Alles
 * andere zeigt der Browser nicht an, und ein neuer Tab, der gleich wieder herunterlaedt, bliebe
 * leer zurueck. WebP steht dabei, obwohl der Server als Datei nur JPEG und PNG annimmt: Es gilt fuer
 * jede Zeile, die der Server inline ausliefern wuerde, und kostet nichts, wenn keine vorkommt.
 */
const IM_BROWSER = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/**
 * Wie das accept-Attribut der Dokumente und Datei-Module: nur Endungen, der Typ zaehlt dort am
 * Inhalt (Server). Eine Liste fuer beide Orte, damit sie nicht auseinanderlaeuft.
 */
export const ENDUNGEN_DATEI = '.pdf,.docx,.xlsx,.pptx,.odt,.ods,.jpg,.jpeg,.png';

/** Kurzer Name der Dateiart fuer die Zeile ("PDF", "Word"); alles Unbekannte heisst schlicht "Datei". */
export function typKuerzel(typ: string): string {
	return KUERZEL.get(typ) ?? 'Datei';
}

export function imBrowser(typ: string): boolean {
	return IM_BROWSER.has(typ);
}

/** Der Anfang aller Routen eines Vereins; DateienApi baut seine Adressen darauf. */
export function vereinsApi(slug: string): string {
	return `/${encodeURIComponent(slug)}/api/v1`;
}

/**
 * Adresse einer Datei fuer einen Link, kein Aufruf: Der Browser holt sie selbst (neuer Tab oder
 * Speichern), die Sitzung haengt am Cookie. Verworfen: ein Blob ueber HttpClient, das hielte die
 * ganze Datei im Speicher des Handys, nur um sie gleich wieder abzulegen.
 */
export function dateiAdresse(slug: string, dateiId: string, herunterladen = false): string {
	return `${vereinsApi(slug)}/dateien/${encodeURIComponent(dateiId)}${herunterladen ? '?herunterladen=1' : ''}`;
}

/**
 * Link einer Datei: Was der Browser zeigen kann, oeffnet in neuem Tab; alles andere laedt herunter
 * (herunterladen=1), statt einen leeren Tab zu hinterlassen.
 */
export function dateiLink(slug: string, datei: { id: string; typ: string }): { href: string; neuerTab: boolean } {
	const neuerTab = imBrowser(datei.typ);
	return { href: dateiAdresse(slug, datei.id, !neuerTab), neuerTab };
}
