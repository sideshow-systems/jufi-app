import type { RequestHandler } from 'express';

/**
 * Sicherheits-Header auf jeder Antwort des Node-Servers. Die Werte sind die aus
 * deploy/nginx-sicherheit.conf, Zeichen fuer Zeichen; die Begruendungen (warum
 * style-src 'unsafe-inline', warum kein inline-Skript) stehen dort und nicht
 * doppelt hier. Der Entwurf wird von nginx ausgeliefert, die App von diesem
 * Server -- beide muessen dieselbe Richtlinie senden, sonst verhaelt sich die
 * eine Seite anders als die andere.
 *
 * img-src erlaubt blob:, weil der Browser ein gewaehltes Bild vor dem Hochladen als
 * Objekt-URL anzeigt (Vorschau, Etappe 2). Verworfen: data: -- ein 20-MB-Foto als
 * Base64 in einem Attribut wuerde den Speicher des Telefons doppelt belasten, und data:
 * oeffnete Bilder aus beliebigem Text. blob: gibt es nur fuer Bytes, die diese Seite selbst
 * erzeugt hat.
 */
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export const sicherheitsHeader: RequestHandler = (_req, res, next) => {
	res.setHeader('Content-Security-Policy', CSP);
	// Fuer Browser ohne frame-ancestors.
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	next();
};
