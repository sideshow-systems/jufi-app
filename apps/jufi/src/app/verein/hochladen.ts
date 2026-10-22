import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { type DateiArt, FEHLER_TEXT, GRENZE_BYTES } from '@jufi/domain';
import { catchError, filter, map, type Observable, of } from 'rxjs';
import { alsApiFehler, fehlertext } from '../gemeinsam/api-fehler';
import { istNichtAngemeldet } from './sitzung-abgelaufen';

/**
 * Der Code, unter dem ein 401 "nicht angemeldet" aus dem Upload kommt. Kein Code des Servers: Der
 * Server nennt hier keinen, die Aufrufer entscheiden aber am Code und nie am Text (wie bei den
 * Fehlercodes der Dateien), und die Anmeldung ist ein eigener Weg.
 */
export const NICHT_ANGEMELDET = 'NICHT_ANGEMELDET';

/**
 * Der Code fuer 429 "zu viele Uploads" (60 je zehn Minuten, Spec 9.2). Wie NICHT_ANGEMELDET ein Code
 * des Clients: Der Server nennt fuer 429 keinen, die Warteschlange haelt daran aber die ganze Reihe an.
 */
export const ZU_VIELE = 'ZU_VIELE';

export type HochladenStand =
	| { art: 'fortschritt'; anteil: number }
	| { art: 'fertig'; antwort: unknown }
	| { art: 'fehler'; text: string; code?: string; wiederholenNach?: number };

/** Vorgabe von Retry-After, wenn der Server die Zeit nicht nennt (Plan-Entscheidung 16). */
export const WIEDERHOLEN_NACH_VORGABE_S = 2;

/**
 * Der Server weist Uploads, die er schon an Kopf oder Fenster ablehnt (404, 413, 429), mit
 * Connection: close ab, solange der Koerper noch unterwegs ist. Der Browser meldet das mal als
 * JSON-Antwort, mal als Netzfehler ohne Status. Ein Satz, der dazu passt, statt "Keine Verbindung",
 * denn die Person hat Verbindung und soll es einfach noch einmal versuchen.
 */
const ABGEBROCHEN = 'Die Verbindung ist abgebrochen. Bitte versuch es nochmal.';
const ABGELAUFEN = 'Deine Sitzung ist abgelaufen. Bitte melde dich neu an.';

/** Retry-After in Sekunden, nur als ganze Zahl; ein Datum (die andere erlaubte Form) nennt der Server nie. */
function retryAfter(e: unknown): number | null {
	if (!(e instanceof HttpErrorResponse)) return null;
	const roh = e.headers.get('Retry-After');
	if (roh === null || !/^\d+$/.test(roh)) return null;
	return Number(roh);
}

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
 * Ein 401 "nicht angemeldet" kommt als Code NICHT_ANGEMELDET zurueck; den Weg zur Anmeldung geht der
 * Aufrufer mit demselben Helfer wie jede andere Seite (zurAnmeldung). Verworfen: hier einen
 * Interceptor oder den Router anfassen, denn der Upload-Client laeuft bewusst ohne Interceptoren
 * (siehe DateienApi) und ladeHoch bleibt eine freie Funktion ohne Injektionskontext.
 * Bei einer vollen Foto-Warteschlange (503) und bei zu vielen Uploads (429, Code ZU_VIELE) steht in
 * wiederholenNach, wie lange der Server zu warten bittet (Retry-After); die Warteschlange der Seite
 * macht dann von selbst weiter.
 *
 * Der HttpClient kommt vom Aufrufer, weil ladeHoch eine freie Funktion ist und inject nur im
 * Injektionskontext laeuft; DateienApi reicht den passenden durch (siehe dort zum Backend).
 */
export function ladeHoch(
	url: string,
	datei: File,
	methode: 'POST' | 'PUT',
	http: HttpClient,
	art: DateiArt = 'DATEI',
): Observable<HochladenStand> {
	if (datei.size > GRENZE_BYTES[art]) {
		return of({ art: 'fehler', text: FEHLER_TEXT.GROESSE[art], code: 'GROESSE' });
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
				if (istNichtAngemeldet(f)) {
					return of<HochladenStand>({ art: 'fehler', text: ABGELAUFEN, code: NICHT_ANGEMELDET });
				}
				const nach = retryAfter(e);
				const code = f.code ?? (f.status === 429 ? ZU_VIELE : undefined);
				return of<HochladenStand>({
					art: 'fehler',
					text: f.status === 0 ? ABGEBROCHEN : fehlertext(f),
					...(code !== undefined ? { code } : {}),
					...(nach !== null ? { wiederholenNach: nach } : {}),
				});
			}),
		);
}
