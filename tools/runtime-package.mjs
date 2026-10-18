/**
 * Erzeugt die package.json fuer die Laufzeitschicht des Images (Dockerfile,
 * Stufe 3). Muster: ../hwyd/tools/runtime-package.mjs.
 *
 * Warum ueberhaupt: Server-Buendel (Angular-Bau) und CLI-Buendel (esbuild) sind
 * gebuendelt, aber einige Pakete bleiben extern -- native Module, der
 * Prisma-Client mit seiner WASM-Abfragemaschine, und was Nx/Angular aus anderen
 * Gruenden aussen laesst. Die muessen im Image als echte Pakete liegen.
 *
 * Warum generiert und nicht handgepflegt: eine zweite Liste von Versionen ist
 * eine Liste, die auseinanderlaeuft. Hier werden die **tatsaechlich im Workspace
 * installierten** Versionen exakt uebernommen, damit im Image nichts anderes
 * laeuft als lokal getestet.
 *
 * Dass die Liste vollstaendig ist, prueft kein statischer Scan, sondern der
 * Rauchtest in tools/deploy.sh: er startet die App **und** die CLI im Image.
 * Beide Buendel haben verschiedene externe Pakete -- in HWYD ist genau das
 * durchgerutscht, weil der Rauchtest nur die App startete und dem Importer
 * @simplewebauthn/server fehlte; aufgefallen ist es erst beim Anlegen des
 * ersten Nutzers auf dem Server. (Ein Regex-Scan der Buendel ist dort ebenfalls
 * verworfen: minifizierter Code enthaelt Zeichenketten, die wie Importe
 * aussehen. Falsche Treffer in einem Waechter sind schlimmer als keiner.)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pakete, die zur Laufzeit im Image liegen muessen. Herkunft je Eintrag, damit
 * beim Aufraeumen niemand raten muss:
 *
 * - Server (apps/jufi/project.json, externalDependencies): @node-rs/argon2,
 *   @prisma/client, @prisma/adapter-pg, pg, otplib, express, nodemailer, sharp.
 * - CLI (apps/cli/package.json, external): @prisma/client, @prisma/adapter-pg,
 *   pg, @node-rs/argon2. Dazu otplib und @simplewebauthn/server, die nirgends
 *   ausdruecklich als extern stehen: @nx/esbuild laesst die Abhaengigkeiten der
 *   Workspace-Bibliotheken aussen, und libs/auth/package.json nennt beide. Im
 *   Server-Buendel ist @simplewebauthn/server dagegen eingebuendelt.
 * - sharp: native Bildverarbeitung (Logo, Icons). Die Plattformpakete
 *   (@img/sharp-linuxmusl-*) holt `npm install` in Stufe 3 selbst, passend zur
 *   Architektur des Images; die Versionsangabe hier legt nur sharp fest.
 * - pg: Peer von @prisma/adapter-pg, auch wo kein Buendel es direkt importiert.
 * - prisma: die Kommandozeile fuer `prisma migrate deploy` im Dienst
 *   jufi-migrate. Seit Prisma 7 ohne Rust-Engines und klein genug fuer dasselbe
 *   Image; ein eigenes Migrations-Image waere ein zweites Ding zum Bauen und
 *   Uebertragen.
 *
 * Der generierte Prisma-Client (libs/db/src/generated) steht hier nicht: er ist
 * TypeScript-Quelle und wird in beide Buendel eingebaut. Zur Laufzeit braucht er
 * nur @prisma/client/runtime, und das liegt in @prisma/client.
 */
const RUNTIME_PACKAGES = [
	'@node-rs/argon2',
	'@prisma/adapter-pg',
	'@prisma/client',
	'@simplewebauthn/server',
	'express',
	'nodemailer',
	'otplib',
	'pg',
	'prisma',
	'sharp',
];

/**
 * Version aus dem installierten Baum lesen. Nicht ueber
 * require.resolve('<paket>/package.json'): @prisma/adapter-pg gibt seine
 * package.json nicht im exports-Feld frei (ERR_PACKAGE_PATH_NOT_EXPORTED).
 */
function installedVersion(name) {
	const path = join(workspaceRoot, 'node_modules', name, 'package.json');
	return JSON.parse(readFileSync(path, 'utf8')).version;
}

const dependencies = {};
for (const name of [...RUNTIME_PACKAGES].sort()) {
	// Exakt gepinnt, ohne Caret: das Image soll genau die getestete Version tragen.
	dependencies[name] = installedVersion(name);
}

const manifest = {
	name: 'jufi-runtime',
	private: true,
	// ESM, weil das CLI-Buendel (apps/cli/dist/main.js) als .js mit import-Syntax
	// gebaut wird und Node den Modultyp aus der naechsten package.json liest --
	// im Image ist das diese hier. Das Server-Buendel ist .mjs und davon unberuehrt.
	type: 'module',
	dependencies,
};

const target = argv[2] ?? 'runtime-package.json';
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.error(`${target}: ${RUNTIME_PACKAGES.length} Laufzeitpakete, Versionen aus dem Workspace`);
