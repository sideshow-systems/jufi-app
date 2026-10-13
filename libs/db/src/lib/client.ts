/**
 * Prisma-Client mit Driver Adapter.
 *
 * Prisma 7 verlangt für alle SQL-Datenbanken einen Adapter — ohne ihn wirft der
 * Konstruktor. Die Verbindungs-URL steht nicht mehr im Schema, sondern kommt
 * hier aus der Umgebung.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/client.js';

export type { PrismaClient } from '../generated/client.js';
/** Die Modelltypen, die Server und Testhilfen nennen; sonst muessten sie in den generierten Ordner greifen. */
export type { PlattformAdmin, Verein } from '../generated/client.js';
/** Fuer getippte `where`-Klauseln (z.B. `Prisma.PersonWhereInput`) ausserhalb dieser Bibliothek. */
export { Prisma } from '../generated/client.js';
/** Die Enums des Schemas als Werte und Typen, damit niemand ausserhalb in den generierten Ordner greift. */
export * from '../generated/enums.js';

export interface CreateClientOptions {
	/** Überschreibt DATABASE_URL, z.B. für eine Testdatenbank. */
	connectionString?: string;
	log?: boolean;
}

export function createPrismaClient(options: CreateClientOptions = {}): PrismaClient {
	const connectionString = options.connectionString ?? process.env['DATABASE_URL'];
	if (!connectionString) {
		throw new Error('DATABASE_URL ist nicht gesetzt. Lokal kommt sie aus .env, auf dem Server aus env_file.');
	}

	const adapter = new PrismaPg({ connectionString });
	return new PrismaClient({
		adapter,
		log: options.log ? ['query', 'warn', 'error'] : ['warn', 'error'],
	});
}

/** Kurzform für Skripte: lädt .env, falls vorhanden, und baut den Client. */
export function createPrismaClientFromEnv(options: CreateClientOptions = {}): PrismaClient {
	try {
		process.loadEnvFile();
	} catch {
		// keine .env — Variablen kommen aus der Umgebung
	}
	return createPrismaClient(options);
}
