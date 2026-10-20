import type { ErrorRequestHandler } from 'express';

/**
 * Letzte Station der Kette. Der Body-Parser (express.json) wirft Fehler mit
 * echtem Status -- 413 bei zu grossem Body, 400 bei kaputtem JSON. Sie bleiben
 * erhalten: ein Client, der pauschal 500 bekaeme, hielte den Fehler fuer
 * voruebergehend und versuchte es wieder, obwohl ein zu grosser Body zu gross
 * bleibt (in hwyd stumm in der Outbox gelandet, siehe dort server.ts).
 *
 * Alles andere ist ein Programmfehler: 500 ohne Einzelheiten nach aussen. Fehler
 * der Klasse 4xx werden nicht geloggt -- sie sind Eingaben von aussen, kein
 * Befund, und ein Stacktrace je kaputter Anfrage fuellte das Log mit Rauschen.
 *
 * Ins Log kommen nur Name und Code des Fehlers, nie Meldung, meta oder Stack
 * (TP3-Spec 4.4). Prismas Meldungen und meta zitieren die beteiligten Werte, und
 * seit den Threads sind das Nachrichtentexte von Kindern und Familien; das Log
 * liegt ausserhalb der Zugriffsregeln der App. Name und Code (P2010, P2002 ...)
 * genuegen, um die Fehlerart zu finden, die Stelle liefert der Pfad. Verworfen:
 * die Meldung zu schwaerzen -- ein Filter erkennt fremde Inhalte nicht verlaesslich,
 * und der Stack allein sagt bei Prisma ohnehin nur "in der Laufzeit".
 *
 * Geloggt wird der Pfad ohne Query: spaetere Links tragen Einmal-Tokens in der
 * Query, die nicht im Log stehen sollen.
 */
export const fehlerbehandlung: ErrorRequestHandler = (error, req, res, next) => {
	const status = (error as { status?: unknown } | null)?.status;
	const code = typeof status === 'number' ? status : (error as { statusCode?: unknown } | null)?.statusCode;
	const istClientfehler = typeof code === 'number' && code >= 400 && code < 500;

	if (!istClientfehler) {
		const name = (error as { name?: unknown } | null)?.name;
		const fehlercode = (error as { code?: unknown } | null)?.code;
		console.error(
			`[${req.method} ${req.path}] ${typeof name === 'string' ? name : typeof error}${typeof fehlercode === 'string' ? ' ' + fehlercode : ''}`,
		);
	}
	// server.ts streamt die Angular-Antwort: Scheitert das nach den ersten Bytes, ist
	// der Status gesendet und eine JSON-Fehlerantwort nicht mehr moeglich. Einfach
	// zurueckzukehren liesse die Antwort offen, der Client wartete bis zum Timeout.
	// next(error) uebergibt an Expresss Standardbehandlung, die die Verbindung
	// abbricht -- ein abgebrochener Body ist fuer den Client ehrlicher als ein
	// stummes Haengen. Verworfen: selbst res.end() rufen, das taeuschte eine
	// vollstaendige, aber abgeschnittene Antwort vor.
	if (res.headersSent) {
		next(error);
		return;
	}

	if (istClientfehler) {
		res.status(code).json({ fehler: code === 413 ? 'Anfrage zu groß' : 'Ungültige Anfrage' });
		return;
	}
	res.status(500).json({ fehler: 'interner Fehler' });
};
