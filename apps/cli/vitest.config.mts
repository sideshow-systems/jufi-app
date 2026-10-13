import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
	root: __dirname,
	cacheDir: '../../node_modules/.vite/apps/cli',
	test: {
		name: 'cli',
		// Kein Watch-Modus: sonst wartet `pnpm test` auf Eingaben.
		watch: false,
		globals: true,
		environment: 'node',
		// Beide Testdateien leeren und befuellen denselben Verein `demo` in einer
		// Datenbank; parallel liefen sie sich in die Quere (doppelter Slug).
		fileParallelism: false,
		// Echte Datenbank jufi_test_cli; Aufbau und Weitergabe wie in libs/db.
		globalSetup: ['src/test-datenbank.ts'],
		setupFiles: ['src/test-umgebung.ts'],
		include: ['src/**/*.spec.ts'],
		reporters: ['default'],
	},
}));
