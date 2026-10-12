/**
 * Laedt einen im Browser erzeugten Text als Datei herunter. Ueber ein
 * unsichtbares a mit download statt data:-URL: iOS Safari bietet eine .ics so
 * direkt "Zum Kalender hinzufuegen" an, und lange Inhalte stossen an keine
 * URL-Grenze. Die Blob-URL wird erst nach dem Klick freigegeben — sofort
 * freigegeben bricht Safari den Download ab.
 */
export function herunterladen(doc: Document, dateiname: string, inhalt: string, typ: string): void {
	const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
	const a = doc.createElement('a');
	a.href = url;
	a.download = dateiname;
	a.style.display = 'none';
	doc.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url));
}
