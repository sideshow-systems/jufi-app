/**
 * Nimmt aus der Antwort von Angular den HTML-Text, aber nur bei einer echten Seite
 * (2xx, text/html). Alles andere ist null, und die Link-Vorschau reicht dann weiter, sodass
 * der normale Handler mit dem Originalstatus antwortet. Ohne die Pruefung machte die Vorschau
 * aus der 400-Antwort der Host-Pruefung (text/plain, gibt einen Header-Wert wieder) ein
 * 200 text/html mit fremdem Text, und kuenftige Weiterleitungen oder 404 aus Angular
 * wuerden ebenso zu 200. Verworfen: den Status in der Route durchreichen -- die Route
 * braeuchte dann eine zweite Antwortform nur fuer Faelle, in denen sie nichts zu sagen hat.
 *
 * Eigene Datei statt in server.ts, weil diese Datei auch beim Bau laeuft und dort nichts
 * ausser dem Aufbau tun darf; hier steht eine reine Funktion, die sich mit echten
 * Response-Objekten testen laesst.
 */
export async function htmlAusAntwort(antwort: Response | null): Promise<string | null> {
	if (!antwort || !antwort.ok) return null;
	if (!(antwort.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) return null;
	return antwort.text();
}
