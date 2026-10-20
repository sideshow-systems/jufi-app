/**
 * Laedt einen im Browser erzeugten Text als Datei herunter. Ueber ein
 * unsichtbares a mit download statt data:-URL: iOS Safari bietet eine .ics so
 * direkt "Zum Kalender hinzufuegen" an, und lange Inhalte stossen an keine
 * URL-Grenze. Die Blob-URL wird erst nach einer Minute freigegeben: iOS
 * Safari fragt vor dem Download nach, und erst die Antwort liest die URL.
 * Verworfen: sofort nach dem Klick freigeben — dann fuehrt das Bestaetigen
 * ins Leere. Eine Minute haelt eine kleine Datei im Speicher, mehr nicht.
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
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
