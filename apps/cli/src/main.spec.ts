import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, describe, expect, it } from 'vitest';
import { fuehreAus } from './main.js';

describe('fuehreAus', () => {
	const ausgabe: string[] = [];
	let prisma: PrismaClient | undefined;
	const deps = {
		// Lazy wie im echten Aufruf: Die Hilfe darf keine Datenbank brauchen.
		prisma: () => (prisma ??= createPrismaClientFromEnv()),
		jetzt: () => new Date('2026-10-12T12:00:00Z'),
		ausgabe: (s: string) => {
			ausgabe.push(s);
		},
	};

	afterAll(async () => {
		await prisma?.$disconnect();
	});

	it('ohne Argumente zeigt die Hilfe und liefert 0', async () => {
		ausgabe.length = 0;
		expect(
			await fuehreAus([], {
				...deps,
				prisma: () => {
					throw new Error('Hilfe braucht keine Datenbank');
				},
			}),
		).toBe(0);
		expect(ausgabe.join('\n')).toContain('demo einspielen');
	});

	it('hilfe liefert 0', async () => {
		ausgabe.length = 0;
		expect(await fuehreAus(['hilfe'], deps)).toBe(0);
		expect(ausgabe.join('\n')).toContain('demo einspielen');
	});

	it('mit unbekanntem Befehl liefert 2', async () => {
		ausgabe.length = 0;
		expect(await fuehreAus(['gibtsnicht'], deps)).toBe(2);
		expect(ausgabe).toEqual(['Unbekannter Befehl. Hilfe: pnpm run cli hilfe']);
	});

	it('demo einspielen liefert 0 und meldet den Verein', async () => {
		ausgabe.length = 0;
		expect(await fuehreAus(['demo', 'einspielen'], deps)).toBe(0);
		expect(ausgabe).toEqual(['Demo-Verein angelegt: /demo/ (7 Personen)']);
	});
});
