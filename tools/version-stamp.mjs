#!/usr/bin/env node
/**
 * Schreibt apps/jufi/src/version.generated.ts -- Version und Commit, die
 * /healthz meldet.
 *
 * Warum generiert und nicht zur Laufzeit aus Git gelesen: .dockerignore laesst
 * .git nicht in den Build-Kontext, im Image gibt es also kein Git. Der Deploy
 * gibt den SHA als JUFI_COMMIT herein. Lokal faellt das Skript auf git zurueck.
 *
 * Warum ausserhalb von Git: die Datei aendert sich mit jedem Commit. Getrackt
 * waere sie ein Diff bei jedem Bau und liesse das Arbeitsverzeichnis unsauber
 * wirken. Sie steht in .gitignore und wird vom Ziel stamp erzeugt, an dem
 * build, serve, test-server und typecheck haengen.
 *
 * Hier steht absichtlich keine Formatierungslogik, dieses Skript sammelt nur
 * Fakten.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'apps', 'jufi', 'src', 'version.generated.ts');

function git(...args) {
	try {
		return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		// Kein Git, kein Repository, kein Problem -- dann eben ohne Commit.
		return '';
	}
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const commit = process.env['JUFI_COMMIT']?.trim() || git('rev-parse', 'HEAD');

const file = `// Erzeugt von tools/version-stamp.mjs. Nicht bearbeiten, nicht committen.
export const VERSION = { version: '${version}', commit: '${commit}' };
`;

// Nur schreiben, wenn sich etwas geaendert hat: ein unveraenderter Zeitstempel
// haelt die Watches von nx serve ruhig.
let previous = '';
try {
	previous = readFileSync(TARGET, 'utf8');
} catch {
	/* gibt es beim ersten Lauf nicht */
}
if (previous !== file) writeFileSync(TARGET, file);

process.stdout.write(`v${version} ${commit.slice(0, 8) || 'ohne Commit'}\n`);
