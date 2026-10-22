import { AttemptTracker, verifyAuthentication, verifyRegistration } from '@jufi/auth';
import type { PrismaClient } from '@jufi/db';
import type { Request } from 'express';
import { VerzeichnisSpeicher, type DateiSpeicher } from './dateien/speicher.js';
import { Bus } from './echtzeit/bus.js';
import { Nachlauf } from './nachlauf.js';
import { Fensterzaehler } from './threads/fenster.js';
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
	/** Nachrichten je Person und Minute (TP3-Spec 4.4); ein Test bekommt so einen frischen Zaehler. */
	nachrichtenFenster?: Fensterzaehler;
	/** Antworten auf Umfragen je Person und Minute. */
	antwortenFenster?: Fensterzaehler;
	/**
	 * Wo hochgeladene Dateien liegen. Von aussen, damit ein Test ein Temp-Verzeichnis oder einen
	 * Speicher mit Fehlern geben kann. Der Vorgabewert legt beim Erzeugen nichts an (das Verzeichnis
	 * entsteht beim ersten Schreiben), darf also auch beim Bau in server.ts entstehen.
	 */
	dateiSpeicher?: DateiSpeicher;
	/** Uploads je Person und zehn Minuten; ein Test bekommt so einen frischen Zaehler. */
	uploadFenster?: Fensterzaehler;
	/**
	 * Was die Routen nach einem Commit melden (Etappe 5); der Hub abonniert ihn. Von aussen,
	 * damit ein Test die Ereignisse einer App sammeln kann und server.ts Hub und Routen an
	 * denselben Bus haengt.
	 */
	bus?: Bus;
	/**
	 * Die Seite, die Angular fuer diese Anfrage ausliefern wuerde, als Text (null: Angular
	 * beansprucht den Pfad nicht). Die Link-Vorschau setzt ihre Tags darin ein. Von aussen, weil
	 * nur server.ts den Angular-Handler kennt; Tests geben ein festes Geruest vor.
	 */
	seitenHtml?: (req: Request) => Promise<string | null>;
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
	const jetzt = deps.jetzt ?? (() => new Date());
	return {
		...deps,
		jetzt,
		anmeldeVersuche: deps.anmeldeVersuche ?? new AttemptTracker(),
		webauthn: deps.webauthn ?? { verifyRegistration, verifyAuthentication },
		nachlauf: deps.nachlauf ?? new Nachlauf(),
		// Die Uhr der App statt Date.now(), damit ein Test, der `jetzt` stellt, auch das Fenster
		// mitstellt und nicht eine Minute wartet.
		nachrichtenFenster: deps.nachrichtenFenster ?? new Fensterzaehler(30, 60_000, () => jetzt().getTime()),
		antwortenFenster: deps.antwortenFenster ?? new Fensterzaehler(60, 60_000, () => jetzt().getTime()),
		dateiSpeicher: deps.dateiSpeicher ?? new VerzeichnisSpeicher(deps.umgebung.dateienPfad),
		// 60 je 10 Minuten: genug fuer das Anlegen einer ganzen Dokumentensammlung auf einmal, zu
		// wenig, um mit einer Schleife die Platte oder den Verbrauch eines Vereins zu fuellen.
		uploadFenster: deps.uploadFenster ?? new Fensterzaehler(60, 600_000, () => jetzt().getTime()),
		bus: deps.bus ?? new Bus(),
		seitenHtml: deps.seitenHtml ?? (async () => null),
	};
}
