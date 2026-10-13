import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { pathToFileURL } from 'node:url';
import { DemoGeschuetztFehler, demoEinspielen } from './demo.js';

export interface Abhaengigkeiten {
	/** Als Funktion, damit Befehle ohne Datenbank (die Hilfe) keine Verbindung aufbauen. */
	prisma: () => PrismaClient;
	/** Das einzige `new Date()` des CLI steckt in `starte`; Regeln und Befehle bekommen die Zeit gereicht. */
	jetzt: () => Date;
	ausgabe: (s: string) => void;
}

const HILFE = [
	'JuFi-Kommandozeile. Aufruf: pnpm run cli <befehl>',
	'',
	'  hilfe              diese Uebersicht',
	'  demo einspielen    legt den erfundenen Verein "Jungfischer Demo" (/demo/) neu an',
];

/** Rueckgabe ist der Exit-Code. Admin- und Loeschbefehle folgen in Etappe 2. */
export async function fuehreAus(argv: string[], deps: Abhaengigkeiten): Promise<number> {
	const [befehl, unterbefehl] = argv;

	if (befehl === undefined || befehl === 'hilfe') {
		HILFE.forEach(deps.ausgabe);
		return 0;
	}
	if (befehl === 'demo' && unterbefehl === 'einspielen') {
		try {
			const { personen } = await demoEinspielen(deps.prisma(), deps.jetzt());
			deps.ausgabe(`Demo-Verein angelegt: /demo/ (${personen} Personen)`);
			return 0;
		} catch (fehler) {
			// Nur die erwartete Verweigerung wird hier gemeldet; alles andere (Datenbank
			// weg, Schema veraltet) faengt starte() ab, mit demselben Exit-Code 1.
			if (!(fehler instanceof DemoGeschuetztFehler)) throw fehler;
			deps.ausgabe(fehler.message);
			return 1;
		}
	}

	deps.ausgabe('Unbekannter Befehl. Hilfe: pnpm run cli hilfe');
	return 2;
}

async function starte(): Promise<void> {
	let prisma: PrismaClient | undefined;
	try {
		process.exitCode = await fuehreAus(process.argv.slice(2), {
			prisma: () => (prisma ??= createPrismaClientFromEnv()),
			jetzt: () => new Date(),
			ausgabe: (s) => console.log(s),
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
