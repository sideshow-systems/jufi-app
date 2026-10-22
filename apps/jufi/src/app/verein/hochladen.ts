import { HttpClient, HttpEventType } from '@angular/common/http';
import { FEHLER_TEXT, GRENZE_BYTES } from '@jufi/domain';
import { catchError, filter, map, type Observable, of } from 'rxjs';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';

export type HochladenStand =
	| { art: 'fortschritt'; anteil: number }
	| { art: 'fertig'; antwort: unknown }
	| { art: 'fehler'; text: string; code?: string };

/**
 * Der Server weist Uploads, die er schon an Kopf oder Fenster ablehnt (404, 413, 429), mit
 * Connection: close ab, solange der Koerper noch unterwegs ist. Der Browser meldet das mal als
 * JSON-Antwort, mal als Netzfehler ohne Status. Ein Satz, der dazu passt, statt "Keine Verbindung",
 * denn die Person hat Verbindung und soll es einfach noch einmal versuchen.
 */
const ABGEBROCHEN = 'Die Verbindung ist abgebrochen. Bitte versuch es nochmal.';

/**
 * Schickt eine Datei roh als Koerper (nicht multipart: der Server hat dafuer keinen Parser, Plan,
 * Entscheidung 8) und meldet den Verlauf als Strom: Fortschritt, dann fertig oder fehler. Fehler
 * kommen als Wert und nicht als Observable-Fehler, damit die Zeile der Datei sie zeigt, ohne dass
 * ein Aufrufer die Abmeldung des Stroms bedenken muss.
 *
 * Die Groesse wird vorab geprueft: Eine zu grosse Datei geht sonst erst ueber die Leitung, bis der
 * Server sie ablehnt. Der Typ wird nicht vorab geprueft; er zaehlt nur am Inhalt (Server), und eine
 * Endung vorab zu pruefen gaebe eine Sicherheit vor, die es nicht gibt.
 *
 * Der HttpClient kommt vom Aufrufer, weil ladeHoch eine freie Funktion ist und inject nur im
 * Injektionskontext laeuft; DateienApi reicht den passenden durch (siehe dort zum Backend).
 */
export function ladeHoch(
	url: string,
	datei: File,
	methode: 'POST' | 'PUT',
	http: HttpClient,
): Observable<HochladenStand> {
	if (datei.size > GRENZE_BYTES.DATEI) {
		return of({ art: 'fehler', text: FEHLER_TEXT.GROESSE.DATEI, code: 'GROESSE' });
	}
	return http
		.request(methode, url, {
			body: datei,
			headers: { 'Content-Type': 'application/octet-stream', 'X-Dateiname': encodeURIComponent(datei.name) },
			observe: 'events',
			reportProgress: true,
		})
		.pipe(
			map((ereignis): HochladenStand | null => {
				if (ereignis.type === HttpEventType.UploadProgress) {
					const anteil = ereignis.total ? Math.min(1, ereignis.loaded / ereignis.total) : 0;
					return { art: 'fortschritt', anteil };
				}
				if (ereignis.type === HttpEventType.Response) return { art: 'fertig', antwort: ereignis.body };
				return null;
			}),
			filter((stand): stand is HochladenStand => stand !== null),
			catchError((e: unknown) => {
				const f = alsApiFehler(e);
				return of<HochladenStand>({
					art: 'fehler',
					text: f.status === 0 ? ABGEBROCHEN : fehlertext(f),
					...(f.code !== undefined ? { code: f.code } : {}),
				});
			}),
		);
}
