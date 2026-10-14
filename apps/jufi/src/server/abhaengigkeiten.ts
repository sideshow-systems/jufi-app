import { AttemptTracker, verifyAuthentication, verifyRegistration } from '@jufi/auth';
import type { PrismaClient } from '@jufi/db';
import { Nachlauf } from './nachlauf.js';
import type { Umgebung } from './umgebung.js';

// Eigene Datei statt in app.ts: admin/ braucht mitStandardwerten, und app.ts
// importiert admin/ -- ein Kreis, der nur haelt, solange keiner der beiden
// Teile beim Laden etwas vom anderen aufruft.

/** Die zwei WebAuthn-Pruefungen; ersetzbar, weil ein Test keinen echten Authenticator hat. */
export interface WebauthnPruefer {
	verifyRegistration: typeof verifyRegistration;
	verifyAuthentication: typeof verifyAuthentication;
}

export interface AppDeps {
	prisma: PrismaClient;
	/** Kommt als Abhaengigkeit herein, damit Tests einen festen Wert vorgeben koennen. */
	version: { version: string; commit: string };
	umgebung: Umgebung;
	/** Die Uhr der App; Tests stellen sie, statt 12 Stunden zu warten. */
	jetzt?: () => Date;
	/** Backoff der Anmeldung; ein Test bekommt so einen frischen Zaehler. */
	anmeldeVersuche?: AttemptTracker;
	webauthn?: WebauthnPruefer;
	/**
	 * Arbeit nach der Antwort ("Passwort vergessen?"). Von aussen, damit server.ts
	 * beim Beenden auf denselben warten kann und Tests auf das Ergebnis.
	 */
	nachlauf?: Nachlauf;
}

/** AppDeps ohne Luecken, wie die Routen sie brauchen. */
export type VolleAppDeps = Required<AppDeps>;

/**
 * Fuellt fehlende Abhaengigkeiten mit den echten. Gesetzte Werte bleiben, damit
 * ein zweiter Aufruf mit dem Ergebnis nichts aendert: createApp ruft das einmal
 * und reicht dasselbe Objekt an alle Teile weiter, sonst zaehlte jeder Teil
 * Fehlversuche in seinem eigenen AttemptTracker.
 */
export function mitStandardwerten(deps: AppDeps): VolleAppDeps {
	return {
		...deps,
		jetzt: deps.jetzt ?? (() => new Date()),
		anmeldeVersuche: deps.anmeldeVersuche ?? new AttemptTracker(),
		webauthn: deps.webauthn ?? { verifyRegistration, verifyAuthentication },
		nachlauf: deps.nachlauf ?? new Nachlauf(),
	};
}
