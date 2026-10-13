/**
 * Testdatenbanken fuer Vitest (Einstieg `@jufi/db/testing`).
 *
 * Jedes Projekt bekommt seine eigene Datenbank `jufi_test_<name>`, damit parallel
 * laufende Projekte sich nicht gegenseitig zuruecksetzen. Verwendung:
 *
 * - globalSetup-Datei: `export default testDatenbankAufbau('<name>');`
 * - setupFiles-Datei: `uebernimmTestDatenbank();`
 *
 * Warum zwei Dateien: Der globalSetup laeuft im Hauptprozess, die Tests in eigenen
 * Workern. Die URL wandert per `project.provide` / `inject` hinueber, dem Weg, den
 * die Vitest-Dokumentation fuer genau diesen Zweck nennt. Verworfen: im globalSetup
 * `process.env.DATABASE_URL` setzen — das kommt in Vitest 4.1 zwar an, aber nur,
 * weil der Pool `process.env` zufaellig erst nach dem globalSetup abschreibt. Das
 * ist nirgends zugesagt, und ein stilles Zurueckfallen auf die `.env` wuerde die
 * Entwicklungsdatenbank statt der Testdatenbank treffen.
 */

import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { inject } from 'vitest';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
	export interface ProvidedContext {
		jufiTestDatenbankUrl: string;
	}
}

/** Passt zu docker-compose.dev.yml; ueberschreibbar mit TEST_DATABASE_HOST_URL. */
const VORGABE_HOST_URL = 'postgresql://jufi:jufi_dev_only@127.0.0.1:5433/postgres';

/** Workspace-Wurzel, dort liegen prisma.config.ts und die Migrationen. */
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const execFileAsync = promisify(execFile);

/**
 * Loescht `jufi_test_<name>`, legt sie neu an und spielt alle Migrationen ein.
 * Liefert die Verbindungs-URL.
 *
 * Frisch statt aufgeraeumt: So prueft jeder Lauf zugleich, dass die Migrationen
 * auf einer leeren Datenbank durchlaufen, und Reste eines abgebrochenen Laufs
 * stoeren nie.
 */
export async function bereiteTestDatenbankVor(name: string): Promise<string> {
	// Der Name landet unmaskiert in DROP/CREATE DATABASE.
	if (!/^[a-z0-9_]+$/.test(name)) {
		throw new Error(`Ungueltiger Name fuer eine Testdatenbank: ${name}`);
	}
	const hostUrl = process.env['TEST_DATABASE_HOST_URL'] || VORGABE_HOST_URL;
	const datenbank = `jufi_test_${name}`;

	// Kurze Frist: Ohne laufenden Container soll der Lauf sofort mit Anleitung
	// scheitern, nicht erst nach dem Standard-Timeout.
	const client = new pg.Client({ connectionString: hostUrl, connectionTimeoutMillis: 5_000 });
	try {
		await client.connect();
	} catch (cause) {
		throw new Error('Postgres auf 127.0.0.1:5433 nicht erreichbar – erst pnpm run db:up', { cause });
	}
	try {
		// FORCE trennt haengengebliebene Verbindungen eines abgebrochenen Laufs.
		await client.query(`DROP DATABASE IF EXISTS "${datenbank}" WITH (FORCE)`);
		await client.query(`CREATE DATABASE "${datenbank}"`);
	} finally {
		await client.end();
	}

	const url = new URL(hostUrl);
	url.pathname = `/${datenbank}`;
	const datenbankUrl = url.toString();

	try {
		await execFileAsync(join(WURZEL, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
			cwd: WURZEL,
			// DATABASE_URL aus der Umgebung schlaegt die .env, die prisma.config.ts laedt
			// (process.loadEnvFile ueberschreibt keine gesetzten Variablen).
			env: { ...process.env, DATABASE_URL: datenbankUrl },
		});
	} catch (fehler) {
		const stderr = (fehler as { stderr?: string }).stderr ?? '';
		throw new Error(`prisma migrate deploy fuer ${datenbank} gescheitert:\n${stderr}`, { cause: fehler });
	}
	return datenbankUrl;
}

/** Baut die globalSetup-Funktion eines Testprojekts. */
export function testDatenbankAufbau(name: string): (project: TestProject) => Promise<void> {
	return async (project) => {
		project.provide('jufiTestDatenbankUrl', await bereiteTestDatenbankVor(name));
	};
}

/**
 * Fuer die setupFiles eines Testprojekts: legt die URL aus dem globalSetup in
 * `DATABASE_URL`, bevor eine Testdatei einen Client baut. So greifen auch
 * `createPrismaClientFromEnv` und alles, was den Client selbst erzeugt.
 */
export function uebernimmTestDatenbank(): void {
	const url = inject('jufiTestDatenbankUrl');
	// Ohne globalSetup bliebe sonst die DATABASE_URL der .env stehen, und die Tests
	// liefen gegen die Entwicklungsdatenbank.
	if (!url) {
		throw new Error('Keine Testdatenbank: globalSetup mit testDatenbankAufbau fehlt in der Vitest-Konfiguration');
	}
	process.env['DATABASE_URL'] = url;
}
