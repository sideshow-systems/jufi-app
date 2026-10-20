import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, describe, expect, it } from 'vitest';
import { pruefeBasisUrl } from './basis-url.js';
import { CliFehler } from './fehler.js';
import { fuehreAus, type Abhaengigkeiten } from './main.js';

describe('fuehreAus', () => {
	const ausgabe: string[] = [];
	let prisma: PrismaClient | undefined;
	const deps: Abhaengigkeiten = {
		// Lazy wie im echten Aufruf: Die Hilfe darf keine Datenbank brauchen.
		prisma: () => (prisma ??= createPrismaClientFromEnv()),
		jetzt: () => new Date('2026-10-12T12:00:00Z'),
		ausgabe: (s: string) => {
			ausgabe.push(s);
		},
		basisUrl: () => 'https://jufi.example.org',
		frage: () => Promise.reject(new Error('In diesen Tests wird nichts gefragt')),
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

	it('demo einspielen liefert 1 und nennt den Grund, wenn der Verein demo ein echter ist', async () => {
		const p = (prisma ??= createPrismaClientFromEnv());
		await p.verein.deleteMany();
		const verein = await p.verein.create({
			data: { slug: 'demo', name: 'Echter Verein e.V.', anzeigename: 'Echter Verein', farbe: '#1d4ed8' },
		});
		await p.person.create({
			data: { vereinId: verein.id, art: 'ERWACHSENER', vorname: 'Erika', nachname: 'Echt', email: 'leitung@verein.de' },
		});

		ausgabe.length = 0;
		expect(await fuehreAus(['demo', 'einspielen'], deps)).toBe(1);
		expect(ausgabe.join('\n')).toMatch(/example\.org/);
		expect(await p.verein.count({ where: { id: verein.id } })).toBe(1);

		await p.verein.deleteMany();
	});

	it('demo einspielen liefert 0, meldet den Verein und druckt die Adresse jedes Threads', async () => {
		ausgabe.length = 0;
		expect(await fuehreAus(['demo', 'einspielen'], deps)).toBe(0);
		expect(ausgabe[0]).toBe('Demo-Verein angelegt: /demo/ (10 Personen)');
		expect(ausgabe).toHaveLength(4);
		expect(ausgabe[1]).toMatch(/^Wichtige Infos: https:\/\/jufi\.example\.org\/demo\/t\/[a-z0-9]+-wichtige-infos$/);
		expect(ausgabe[2]).toMatch(/^🎳 Bowling: https:\/\/jufi\.example\.org\/demo\/t\/[a-z0-9]+-bowling$/);
		expect(ausgabe[3]).toMatch(
			/^Jugendsprecher-Austausch: https:\/\/jufi\.example\.org\/demo\/t\/[a-z0-9]+-jugendsprecher-austausch$/,
		);
	});

	it('demo einspielen druckt ohne BASIS_URL nur den Pfad und liefert trotzdem 0', async () => {
		ausgabe.length = 0;
		const ohneBasis: Abhaengigkeiten = {
			...deps,
			basisUrl: () => {
				throw new CliFehler('BASIS_URL fehlt.');
			},
		};
		expect(await fuehreAus(['demo', 'einspielen'], ohneBasis)).toBe(0);
		expect(ausgabe[1]).toMatch(/^Wichtige Infos: \/demo\/t\/[a-z0-9]+-wichtige-infos$/);
		expect(ausgabe).toHaveLength(4);
	});

	it('die Hilfe nennt alle Befehle', async () => {
		ausgabe.length = 0;
		await fuehreAus(['hilfe'], deps);
		const text = ausgabe.join('\n');
		expect(text).toContain('admin anlegen <name>');
		expect(text).toContain('admin zuruecksetzen <name>');
		expect(text).toContain('verein loeschen <slug>');
	});

	it('fehlendes Argument liefert 2 mit Hinweis auf die Hilfe und fasst weder Datenbank noch Umgebung an', async () => {
		const streng: Abhaengigkeiten = {
			...deps,
			prisma: () => {
				throw new Error('Kein Zugriff auf die Datenbank');
			},
			basisUrl: () => {
				throw new Error('Kein Zugriff auf BASIS_URL');
			},
		};
		for (const argv of [
			['admin'],
			['admin', 'anlegen'],
			['admin', 'zuruecksetzen'],
			['verein'],
			['verein', 'loeschen'],
		]) {
			ausgabe.length = 0;
			expect(await fuehreAus(argv, streng), argv.join(' ')).toBe(2);
			expect(ausgabe).toEqual(['Argument fehlt. Hilfe: pnpm run cli hilfe']);
		}
	});

	it('ein CliFehler aus der Umgebung wird zur Meldung mit Exit 1', async () => {
		ausgabe.length = 0;
		const ohne: Abhaengigkeiten = {
			...deps,
			basisUrl: () => {
				throw new CliFehler('BASIS_URL fehlt.');
			},
		};
		expect(await fuehreAus(['admin', 'anlegen', 'florian'], ohne)).toBe(1);
		expect(ausgabe).toEqual(['BASIS_URL fehlt.']);
	});
});

describe('pruefeBasisUrl', () => {
	it('lässt reine Ursprünge durch', () => {
		expect(pruefeBasisUrl('http://localhost:4200')).toBe('http://localhost:4200');
		expect(pruefeBasisUrl('https://jufi-app.de')).toBe('https://jufi-app.de');
	});

	it('weist fehlende, ungültige und nicht reine Werte mit Meldung ab', () => {
		expect(() => pruefeBasisUrl(undefined)).toThrow(CliFehler);
		expect(() => pruefeBasisUrl('')).toThrow(/BASIS_URL fehlt/);
		expect(() => pruefeBasisUrl('jufi-app.de')).toThrow(/keine gültige Adresse/);
		expect(() => pruefeBasisUrl('https://jufi-app.de/')).toThrow(/reiner Ursprung/);
		expect(() => pruefeBasisUrl('https://jufi-app.de/app')).toThrow(/reiner Ursprung/);
		expect(() => pruefeBasisUrl('HTTPS://JUFI-APP.DE')).toThrow(/reiner Ursprung/);
	});
});
