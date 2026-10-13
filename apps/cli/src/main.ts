import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { normalisiereBenutzername } from '@jufi/domain';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { adminAnlegen, adminZuruecksetzen } from './admin.js';
import { pruefeBasisUrl } from './basis-url.js';
import { demoEinspielen } from './demo.js';
import { CliFehler } from './fehler.js';
import { vereinLoeschen, vereinZumLoeschen } from './verein-loeschen.js';

export interface Abhaengigkeiten {
	/** Als Funktion, damit Befehle ohne Datenbank (die Hilfe) keine Verbindung aufbauen. */
	prisma: () => PrismaClient;
	/** Das einzige `new Date()` des CLI steckt in `starte`; Regeln und Befehle bekommen die Zeit gereicht. */
	jetzt: () => Date;
	ausgabe: (s: string) => void;
	/**
	 * Ursprung der App fuer Links. Als Funktion wie prisma: Hilfe und Verein loeschen
	 * brauchen ihn nicht und sollen an einer fehlenden BASIS_URL nicht scheitern.
	 * Wirft CliFehler, wenn der Wert fehlt oder kein reiner Ursprung ist.
	 */
	basisUrl: () => string;
	/** Stellt eine Frage am Terminal und liefert die Antwort ohne Zeilenende. */
	frage: (text: string) => Promise<string>;
}

const HILFE = [
	'JuFi-Kommandozeile. Aufruf: pnpm run cli <befehl>',
	'',
	'  hilfe                       diese Uebersicht',
	'  demo einspielen             legt den erfundenen Verein "Jungfischer Demo" (/demo/) neu an',
	'  admin anlegen <name>        legt einen Plattform-Admin an und gibt den Einrichtungslink aus',
	'  admin zuruecksetzen <name>  loescht Passwort, Passkeys, TOTP und Sitzungen, gibt einen neuen Link aus',
	'  verein loeschen <slug>      loescht einen Verein mit allen Daten, nach Rueckfrage',
];

/** Rueckgabe ist der Exit-Code. */
export async function fuehreAus(argv: string[], deps: Abhaengigkeiten): Promise<number> {
	const [befehl, unterbefehl, argument] = argv;

	if (befehl === undefined || befehl === 'hilfe') {
		HILFE.forEach(deps.ausgabe);
		return 0;
	}

	try {
		if (befehl === 'demo' && unterbefehl === 'einspielen') {
			const { personen } = await demoEinspielen(deps.prisma(), deps.jetzt());
			deps.ausgabe(`Demo-Verein angelegt: /demo/ (${personen} Personen)`);
			return 0;
		}

		if (befehl === 'admin' && (unterbefehl === 'anlegen' || unterbefehl === 'zuruecksetzen')) {
			if (argument === undefined) return fehlendesArgument(deps);
			// Vor jedem Schreiben: Ohne gueltige BASIS_URL taugte der Link nichts, und
			// ein angelegter Admin ohne Link liesse sich nur per zuruecksetzen retten.
			const basis = deps.basisUrl();
			const name = normalisiereBenutzername(argument);
			const link = (token: string) => `${basis}/admin/einrichten#${token}`;
			if (unterbefehl === 'anlegen') {
				const token = await adminAnlegen(deps.prisma(), argument, deps.jetzt());
				deps.ausgabe(`Admin ${name} angelegt. Einrichtungslink (1 Stunde gültig, nur einmal):`);
				deps.ausgabe(link(token));
			} else {
				const token = await adminZuruecksetzen(deps.prisma(), argument, deps.jetzt());
				deps.ausgabe(
					`Admin ${name} zurückgesetzt: Passwort, Passkeys, TOTP und Sitzungen gelöscht. Neuer Einrichtungslink (1 Stunde gültig, nur einmal):`,
				);
				deps.ausgabe(link(token));
			}
			return 0;
		}

		if (befehl === 'verein' && unterbefehl === 'loeschen') {
			if (argument === undefined) return fehlendesArgument(deps);
			const prisma = deps.prisma();
			const verein = await vereinZumLoeschen(prisma, argument);
			if (!verein) throw new CliFehler(`Verein ${argument} gibt es nicht.`);
			const antwort = await deps.frage(
				`Verein „${verein.anzeigename}" (${argument}) mit ${verein.personen} Personen endgültig löschen? Zur Bestätigung den Slug eintippen: `,
			);
			if ((await vereinLoeschen(prisma, argument, antwort)) === 'abgebrochen') {
				throw new CliFehler('Abgebrochen, nichts gelöscht.');
			}
			deps.ausgabe(`Verein ${argument} gelöscht.`);
			return 0;
		}

		if ((befehl === 'admin' || befehl === 'verein') && unterbefehl === undefined) return fehlendesArgument(deps);
	} catch (fehler) {
		// Nur erwartete Verweigerungen werden hier gemeldet; alles andere (Datenbank
		// weg, Schema veraltet) faengt starte() ab, mit demselben Exit-Code 1.
		if (!(fehler instanceof CliFehler)) throw fehler;
		deps.ausgabe(fehler.message);
		return 1;
	}

	deps.ausgabe('Unbekannter Befehl. Hilfe: pnpm run cli hilfe');
	return 2;
}

function fehlendesArgument(deps: Abhaengigkeiten): number {
	deps.ausgabe('Argument fehlt. Hilfe: pnpm run cli hilfe');
	return 2;
}

/** Wie createPrismaClientFromEnv: .env laden, falls vorhanden; gesetzte Variablen gewinnen. */
function ladeEnv(): void {
	try {
		process.loadEnvFile();
	} catch {
		// keine .env -- Variablen kommen aus der Umgebung
	}
}

/**
 * Endet die Eingabe, ohne dass eine Antwort kam (stdin zu, Strg-D), liefert die
 * Frage eine leere Antwort. Ohne das beendete sich der Prozess still mit Exit-Code 0,
 * als sei geloescht worden: ein Promise, das nie aufgeloest wird, laesst Node ohne
 * Fehler aussteigen.
 */
async function frage(text: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await Promise.race([rl.question(text), once(rl, 'close').then(() => '')]);
	} finally {
		rl.close();
	}
}

async function starte(): Promise<void> {
	let prisma: PrismaClient | undefined;
	try {
		process.exitCode = await fuehreAus(process.argv.slice(2), {
			prisma: () => (prisma ??= createPrismaClientFromEnv()),
			jetzt: () => new Date(),
			ausgabe: (s) => console.log(s),
			basisUrl: () => {
				ladeEnv();
				return pruefeBasisUrl(process.env['BASIS_URL']);
			},
			frage,
		});
	} catch (fehler) {
		console.error(fehler instanceof Error ? fehler.message : fehler);
		process.exitCode = 1;
	} finally {
		// Ohne Trennen haelt der Verbindungspool den Prozess offen.
		await prisma?.$disconnect();
	}
}

// Nur beim direkten Aufruf starten, nicht beim Import durch die Tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void starte();
}
