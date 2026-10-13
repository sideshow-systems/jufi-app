import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
	root: __dirname,
	cacheDir: '../../node_modules/.vite/libs/auth',
	test: {
		name: 'auth',
		// Kein Watch-Modus: Der Nx-Plugin-Modus "watch" wuerde sonst unter `pnpm test`
		// auf Eingaben warten. Entwickeln im Watch-Modus: `pnpm nx test auth --watch`.
		watch: false,
		globals: true,
		environment: 'node',
		include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
		reporters: ['default'],
		coverage: {
			reportsDirectory: './test-output/vitest/coverage',
			provider: 'v8' as const,
		},
	},
}));
