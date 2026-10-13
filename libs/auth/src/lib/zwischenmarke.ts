/**
 * Zwischenmarke zwischen Passwort und TOTP bei der Admin-Anmeldung.
 *
 * Nach dem richtigen Passwort braucht der Browser etwas, das er mit dem Code
 * zurueckschicken kann, damit der Server weiss, wer das Passwort bestanden hat.
 * Format `id.ablauf.nonce.hmac`, zustandslos, wie `signChallenge` in hwyd:
 * eine Tabelle fuer fuenf Minuten Lebensdauer waere mehr Aufwand als Nutzen.
 *
 * **Die Marke ist kein Sitzungstoken.** Sie beweist nur, dass das Passwort
 * stimmte, und fuehrt allein in den Schritt TOTP; dort greift der Backoff je
 * Admin. Eine abgefangene Marke gibt in fuenf Minuten genau einen Versuchsstrom
 * auf den Code, den der Backoff ohnehin bremst.
 *
 * Geheimnis und Zeit sind Parameter statt `process.env` und `Date.now()`:
 * die Bibliothek liest keine Umgebung (der Server uebergibt `SESSION_SECRET`),
 * und der Ablauf ist ohne Uhrenspiel testbar.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Fuenf Minuten, so lange darf man zwischen Passwort und Code in die App wechseln. */
export const ZWISCHENMARKE_GUELTIG_MS = 5 * 60 * 1000;

function mac(nutzlast: string, geheimnis: string): string {
	return createHmac('sha256', geheimnis).update(nutzlast).digest('base64url');
}

export function signiereZwischenmarke(id: string, geheimnis: string, jetztMs: number): string {
	// Der Punkt trennt die Teile. Eine ID mit Punkt wuerde beim Pruefen anders
	// zerlegt und still abgelehnt; hier laut zu scheitern findet den Fehler beim
	// Aufrufer statt beim Anwender.
	if (id.includes('.')) throw new Error('Zwischenmarke: die ID darf keinen Punkt enthalten');
	const ablauf = jetztMs + ZWISCHENMARKE_GUELTIG_MS;
	// Die Nonce macht jede Marke einzigartig, auch fuer dieselbe ID in derselben
	// Millisekunde.
	const nonce = randomBytes(8).toString('base64url');
	const nutzlast = `${id}.${ablauf}.${nonce}`;
	return `${nutzlast}.${mac(nutzlast, geheimnis)}`;
}

/** Liefert die ID, oder `undefined` bei jeder Abweichung (kein Grund wird verraten). */
export function pruefeZwischenmarke(marke: string, geheimnis: string, jetztMs: number): string | undefined {
	const teile = marke.split('.');
	if (teile.length !== 4) return undefined;
	const [id, ablauf, nonce, signatur] = teile;
	const erwartet = Buffer.from(mac(`${id}.${ablauf}.${nonce}`, geheimnis));
	const vorgelegt = Buffer.from(signatur);
	// `timingSafeEqual` wirft bei ungleicher Laenge, daher zuerst die Laenge. Sie
	// verraet nichts: die Laenge einer SHA-256-Signatur ist fest.
	if (vorgelegt.length !== erwartet.length || !timingSafeEqual(vorgelegt, erwartet)) return undefined;
	// `<=`: zur Ablaufzeit ist die Marke schon abgelaufen. `Number('abc')` ist NaN,
	// und NaN <= x ist falsch, daher eigens pruefen; bei gueltiger Signatur kommt
	// das nur vor, wenn der Server selbst Muell signiert haette.
	const ablaufMs = Number(ablauf);
	if (!Number.isFinite(ablaufMs) || ablaufMs <= jetztMs) return undefined;
	return id;
}
