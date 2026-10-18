import type { AttemptTracker } from '@jufi/auth';
import type { Response } from 'express';

/** Die laengste Sperre unter den Schluesseln in ms, 0 wenn ein Versuch erlaubt ist. */
export function sperre(versuche: AttemptTracker, schluessel: string[]): number {
	return Math.max(0, ...schluessel.map((s) => versuche.remaining(s)));
}

export function zuVieleVersuche(res: Response, ms: number): void {
	res.status(429).json({ fehler: 'Zu viele Versuche', wartenSekunden: Math.ceil(ms / 1000) });
}

/**
 * Reserviert den Versuch, bevor geprueft wird. Ist einer der Schluessel
 * gesperrt, liefert sie die Wartezeit und zaehlt nichts. Sonst zaehlt sie den
 * Versuch sofort als Fehlversuch; ein Erfolg setzt danach mit versuche.reset
 * zurueck. loestSperreAus merkt sich, ob genau dieser Versuch die Sperre
 * ausgeloest hat. Scheitert dieser Versuch, antwortet scheitere mit 429 statt
 * 401; Versuche, die vorher reserviert wurden, bleiben bei 401.
 *
 * Muss vor dem ersten await der Route stehen, damit gleichzeitige Anfragen das
 * Sperrfenster nicht umgehen: Node fuehrt diesen Teil einer Anfrage am Stueck
 * aus, jede weitere Anfrage sieht also schon die Zaehlung der vorigen.
 * Verworfen: erst nach der Pruefung zaehlen wie hwyd -- alle gleichzeitigen
 * Anfragen saehen dann dieselbe alte Zahl, und wer das Passwort kennt,
 * probierte je Sperrfenster beliebig viele TOTP-Codes parallel.
 * Verworfen auch: hoechstens eine laufende Anfrage je Schluessel -- ein
 * Doppelklick bekaeme 429, und jede Route braeuchte ein finally zum Freigeben.
 */
export function reserviere(
	versuche: AttemptTracker,
	schluessel: string[],
): { wartenMs: number; loestSperreAus: boolean } {
	const wartenMs = sperre(versuche, schluessel);
	if (wartenMs > 0) return { wartenMs, loestSperreAus: false };
	// Voller Speicher, lauter Sperren: ein neuer Schluessel wird abgelehnt statt
	// eine Sperre zu verdraengen (fail-closed, siehe AttemptTracker). Das ist
	// dieselbe Antwort wie eine Sperre, kein 500; gewartet wird, bis die
	// naechste Sperre ablaeuft und wieder Platz ist.
	if (!versuche.platzFuer(schluessel)) return { wartenMs: versuche.naechsteFreigabeMs(), loestSperreAus: false };
	for (const s of schluessel) versuche.fail(s, schluessel);
	return { wartenMs: 0, loestSperreAus: sperre(versuche, schluessel) > 0 };
}

/**
 * Antwort auf einen gescheiterten, schon reservierten Versuch. Hat genau dieser
 * Versuch die Sperre ausgeloest, kommt schon 429 mit der Wartezeit statt 401:
 * sonst erfuhre der Browser erst beim naechsten Versuch, dass er warten muss
 * ("der vierte Fehlversuch ist 429"). Verraten wird damit nichts -- die Antwort
 * haengt nur an der Zahl der Fehlversuche, nicht daran, was falsch war.
 * Fruehere, gleichzeitig laufende Versuche bleiben bei 401, wie nacheinander.
 */
export function scheitere(
	versuche: AttemptTracker,
	schluessel: string[],
	loestSperreAus: boolean,
	res: Response,
	fehler: object,
): void {
	const ms = sperre(versuche, schluessel);
	if (loestSperreAus && ms > 0) {
		zuVieleVersuche(res, ms);
		return;
	}
	res.status(401).json(fehler);
}

/**
 * Ein Erfolg erstattet nur seine eigene Reservierung (siehe reserviere), die
 * Fehlversuche anderer bleiben stehen.
 */
export function erstatte(versuche: AttemptTracker, schluessel: string[]): void {
	for (const s of schluessel) versuche.erstatte(s);
}
