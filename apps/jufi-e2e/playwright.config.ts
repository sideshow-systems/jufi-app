import { defineConfig, devices } from '@playwright/test';
import { BASIS_URL } from './src/hilfen';

/**
 * Ende-zu-Ende gegen den Produktionsbau (Aufbau in src/aufbau.ts). Aufruf ueber
 * pnpm run e2e, das vorher App und CLI baut; nicht Teil von pnpm test, weil es
 * einen Bau braucht und Minuten dauert.
 *
 * Ein Worker und nur Chromium: Der Ablauf baut Schritt fuer Schritt auf einer
 * gemeinsamen Datenbank auf (Admin legt Verein an, Leitung laedt ein, ...), und
 * der virtuelle Authenticator ist eine CDP-Funktion, die es nur in Chromium gibt.
 * Verworfen: zusaetzlich Firefox und WebKit -- sie braechten einen zweiten Weg
 * fuer Passkeys, und der Ablauf prueft Fachliches, keine Browserunterschiede.
 */
export default defineConfig({
	testDir: './src',
	outputDir: './test-results',
	workers: 1,
	fullyParallel: false,
	// Kein zweiter Versuch: Ein serieller Ablauf, der beim zweiten Mal gruen wird, verdeckte eine Wettlaufsituation.
	retries: 0,
	forbidOnly: !!process.env['CI'],
	reporter: [['list']],
	globalSetup: './src/aufbau.ts',
	use: {
		...devices['Desktop Chrome'],
		baseURL: BASIS_URL,
		locale: 'de-DE',
		timezoneId: 'Europe/Berlin',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'ablauf', testMatch: 'ablauf.spec.ts' },
		// Haengt an ablauf, weil es dessen Sitzungen und Mias ID aus ZUSTAND liest.
		{ name: 'layout', testMatch: 'layout.spec.ts', dependencies: ['ablauf'] },
	],
});
