import type { ErrorRequestHandler } from 'express';

/**
 * Letzte Station der Kette. Der Body-Parser (express.json) wirft Fehler mit
 * echtem Status -- 413 bei zu grossem Body, 400 bei kaputtem JSON. Sie bleiben
 * erhalten: ein Client, der pauschal 500 bekaeme, hielte den Fehler fuer
 * voruebergehend und versuchte es wieder, obwohl ein zu grosser Body zu gross
 * bleibt (in hwyd stumm in der Outbox gelandet, siehe dort server.ts).
 *
 * Alles andere ist ein Programmfehler: 500 ohne Einzelheiten nach aussen, die
 * Ursache steht im Log. Fehler der Klasse 4xx werden nicht geloggt -- sie sind
 * Eingaben von aussen, kein Befund, und ein Stacktrace je kaputter Anfrage
 * fuellte das Log mit Rauschen.
 *
 * Geloggt wird der Pfad ohne Query: spaetere Links tragen Einmal-Tokens in der
 * Query, die nicht im Log stehen sollen.
 */
export const fehlerbehandlung: ErrorRequestHandler = (error, req, res, _next) => {
	const status = (error as { status?: unknown } | null)?.status;
	const code = typeof status === 'number' ? status : (error as { statusCode?: unknown } | null)?.statusCode;
	const istClientfehler = typeof code === 'number' && code >= 400 && code < 500;

	if (!istClientfehler) console.error(`[${req.method} ${req.path}]`, error);
	if (res.headersSent) return;

	if (istClientfehler) {
		res.status(code).json({ fehler: code === 413 ? 'Anfrage zu groß' : 'Ungültige Anfrage' });
		return;
	}
	res.status(500).json({ fehler: 'interner Fehler' });
};
