import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const lib = (pfad: string) => resolve(import.meta.dirname, '../../libs', pfad);

export default defineConfig({
	root: import.meta.dirname,
	cacheDir: '../../node_modules/.vite/apps/jufi-server',
	// Dieselben Bibliotheken wie in tsconfig.json (paths). Die App ist kein
	// pnpm-Paket und hat keine Eintraege in node_modules/@jufi; Angular loest
	// ueber paths auf, hier muss Vite es ausdruecklich tun. Die laengeren Namen
	// stehen vorn, weil der erste passende Eintrag gewinnt.
	resolve: {
		alias: [
			{ find: '@jufi/db/testing', replacement: lib('db/src/testing.ts') },
			{ find: /^@jufi\/db$/, replacement: lib('db/src/index.ts') },
			{ find: /^@jufi\/auth$/, replacement: lib('auth/src/index.ts') },
			{ find: /^@jufi\/domain$/, replacement: lib('domain/src/index.ts') },
		],
	},
	test: {
		name: 'jufi-server',
		// Kein Watch-Modus: sonst wartet `pnpm test` auf Eingaben.
		watch: false,
		globals: true,
		environment: 'node',
		// Echte Datenbank jufi_test_server; Aufbau und Weitergabe wie in libs/db.
		globalSetup: ['src/server/test-datenbank.ts'],
		setupFiles: ['src/server/test-umgebung.ts'],
		include: ['src/server/**/*.spec.ts'],
		reporters: ['default'],
	},
});
