import type { RequestHandler } from 'express';

/** Lesende Methoden aendern nichts; ein fremder Ursprung kann mit ihnen nichts ausloesen. */
const LESEND = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Schreibende Anfragen nur vom eigenen Ursprung (Spec 4.5). SameSite=Lax haelt
 * das Cookie schon von fremden Seiten fern, deckt aber nicht alles: eine andere
 * Subdomain derselben Seite gilt fuer SameSite als "same-site". Der Origin-Header
 * ist dagegen genau, und Browser senden ihn bei jeder schreibenden Anfrage.
 *
 * Ohne Origin wird abgelehnt statt durchgelassen: Der eigene Client ist immer
 * ein Browser, der ihn setzt; eine Anfrage ohne ist ein Skript, und das soll
 * sich nicht durch Weglassen eines Headers an der Pruefung vorbeimogeln.
 * Verworfen: auf Referer ausweichen -- Referrer-Policy kann ihn kappen, und eine
 * zweite Quelle hiesse zwei Regeln. Verworfen: CSRF-Token -- braucht Zustand
 * und Formularfelder fuer etwas, das der Origin-Header schon leistet.
 */
export function pruefeUrsprung(erlaubt: string): RequestHandler {
	return (req, res, next) => {
		if (LESEND.has(req.method) || req.get('origin') === erlaubt) {
			next();
			return;
		}
		res.status(403).json({ fehler: 'Ursprung nicht erlaubt' });
	};
}
