import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
	root: __dirname,
	cacheDir: '../../node_modules/.vite/libs/db',
	test: {
		name: 'db',
		// Kein Watch-Modus: Der Nx-Plugin-Modus "watch" wuerde sonst unter `pnpm test`
		// auf Eingaben warten. Entwickeln im Watch-Modus: `pnpm nx test db --watch`.
		watch: false,
		globals: true,
		environment: 'node',
		// Die Tests laufen gegen eine echte Postgres-Datenbank (jufi_test_db), weil
		// zusammengesetzte Fremdschluessel und CHECKs nur dort wirken. Der globale
		// Aufbau legt sie einmal je Lauf frisch an, die Datei unter setupFiles
		// reicht ihre URL in jedem Worker an DATABASE_URL weiter.
		globalSetup: ['src/test-setup.ts'],
		setupFiles: ['src/test-umgebung.ts'],
		include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
		reporters: ['default'],
		coverage: {
			reportsDirectory: './test-output/vitest/coverage',
			provider: 'v8' as const,
		},
	},
}));
