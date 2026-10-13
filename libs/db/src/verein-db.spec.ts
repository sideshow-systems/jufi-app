/**
 * vereinDb: der Verein steckt in jeder Abfrage, fremde Modelle und Rohabfragen
 * sind gesperrt. Laeuft gegen jufi_test_db (test-setup.ts).
 *
 * Jeder Test legt eigene Vereine mit eindeutigem Slug an. Darum darf ein Test
 * "alle Personen des Vereins" erwarten, ohne dass schema.spec.ts oder ein anderer
 * Test dazwischenfunkt.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, Prisma, VEREINS_MODELLE, vereinDb, VereinDbFehler } from './index.js';

// Ungebundener Client nur fuer Aufbau und Nachpruefung; die Tests selbst laufen
// ueber vereinDb.
const prisma = createPrismaClient();

afterAll(async () => {
	await prisma.$disconnect();
});

function eindeutig(): string {
	return randomBytes(4).toString('hex');
}

async function verein() {
	return prisma.verein.create({
		data: {
			slug: `vdb-${eindeutig()}`,
			name: 'Erfundener Angelverein 1950 e.V.',
			anzeigename: 'Jungfischer Erfunden',
			farbe: '#2a7f62',
		},
	});
}

async function erwachsener(vereinId: string, vorname = 'Sandra') {
	return prisma.person.create({ data: { vereinId, art: 'ERWACHSENER', vorname, nachname: 'Beispiel' } });
}

async function jungfischer(vereinId: string, vorname = 'Lena') {
	return prisma.person.create({
		data: { vereinId, art: 'JUNGFISCHER', vorname, nachname: 'Beispiel', geburtsdatum: new Date('2014-05-01') },
	});
}

/** Zwei frische Vereine mit je einem Erwachsenen, wie im Umsetzungsplan. */
async function zweiVereine() {
	const a = await verein();
	const b = await verein();
	return { a, b, erwachsenerA: await erwachsener(a.id), erwachsenerB: await erwachsener(b.id, 'Petra') };
}

/** Prisma-Fehlercode eines abgelehnten Vorgangs, z.B. P2025 oder P2003. */
async function fehlercode(vorgang: Promise<unknown>): Promise<string> {
	try {
		await vorgang;
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
		throw e;
	}
	throw new Error('Vorgang wurde nicht abgelehnt');
}

describe('vereinDb: Lesen', () => {
	it('findMany sieht nur Personen des eigenen Vereins', async () => {
		const { a, erwachsenerA } = await zweiVereine();

		const personen = await vereinDb(prisma, a.id).person.findMany();

		expect(personen.map((p) => p.id)).toEqual([erwachsenerA.id]);
	});

	it('findUnique mit ID aus fremdem Verein liefert null', async () => {
		const { a, erwachsenerB } = await zweiVereine();

		expect(await vereinDb(prisma, a.id).person.findUnique({ where: { id: erwachsenerB.id } })).toBeNull();
	});

	it('count, aggregate und groupBy zaehlen nur den eigenen Verein', async () => {
		const { a } = await zweiVereine();
		const db = vereinDb(prisma, a.id);

		expect(await db.person.count()).toBe(1);
		expect((await db.person.aggregate({ _count: { _all: true } }))._count._all).toBe(1);
		expect(await db.person.groupBy({ by: ['vereinId'], _count: { _all: true } })).toEqual([
			{ vereinId: a.id, _count: { _all: 1 } },
		]);
	});

	it('webauthnChallenge ohne Verein (Plattform-Admin) bleibt unsichtbar', async () => {
		const { a } = await zweiVereine();
		const ohneVerein = await prisma.webauthnChallenge.create({
			data: { challenge: eindeutig(), purpose: 'authenticate', expiresAt: new Date('2027-01-01') },
		});
		const db = vereinDb(prisma, a.id);
		const eigene = await db.webauthnChallenge.create({
			data: { challenge: eindeutig(), purpose: 'authenticate', expiresAt: new Date('2027-01-01') },
		});

		expect(eigene.vereinId).toBe(a.id);
		expect((await db.webauthnChallenge.findMany()).map((c) => c.id)).toEqual([eigene.id]);
		expect(await db.webauthnChallenge.findUnique({ where: { id: ohneVerein.id } })).toBeNull();
	});
});

describe('vereinDb: Schreiben', () => {
	it('create setzt vereinId selbst', async () => {
		const { a } = await zweiVereine();

		const neu = await vereinDb(prisma, a.id).person.create({
			data: { art: 'ERWACHSENER', vorname: 'Jana', nachname: 'Beispiel' },
		});

		expect(neu.vereinId).toBe(a.id);
	});

	it('createMany und upsert setzen vereinId selbst', async () => {
		const { a } = await zweiVereine();
		const db = vereinDb(prisma, a.id);

		await db.untergruppe.createMany({ data: [{ name: 'Hechte' }, { name: 'Barsche' }] });
		const zander = await db.untergruppe.upsert({
			where: { vereinId_name: { vereinId: a.id, name: 'Zander' } },
			create: { name: 'Zander' },
			update: {},
		});

		expect(zander.vereinId).toBe(a.id);
		expect(await prisma.untergruppe.count({ where: { vereinId: a.id } })).toBe(3);
	});

	it('create mit fremder vereinId wirft VereinDbFehler', async () => {
		const { a, b } = await zweiVereine();

		await expect(
			vereinDb(prisma, a.id).person.create({
				// @ts-expect-error vereinId setzt vereinDb selbst, der Typ verbietet es schon
				data: { vereinId: b.id, art: 'ERWACHSENER', vorname: 'Jana', nachname: 'Beispiel' },
			}),
		).rejects.toThrow(VereinDbFehler);
		expect(await prisma.person.count({ where: { vereinId: b.id } })).toBe(1);
	});

	it('update einer fremden Person wirft P2025 und aendert nichts', async () => {
		const { a, erwachsenerB } = await zweiVereine();

		expect(
			await fehlercode(
				vereinDb(prisma, a.id).person.update({ where: { id: erwachsenerB.id }, data: { vorname: 'Geaendert' } }),
			),
		).toBe('P2025');
		expect((await prisma.person.findUniqueOrThrow({ where: { id: erwachsenerB.id } })).vorname).toBe('Petra');
	});

	it('update mit vereinId im data wirft und verschiebt die Person nicht', async () => {
		const { a, b, erwachsenerA } = await zweiVereine();

		await expect(
			vereinDb(prisma, a.id).person.update({
				where: { id: erwachsenerA.id },
				// @ts-expect-error vereinId ist ueber vereinDb nicht schreibbar
				data: { vereinId: b.id },
			}),
		).rejects.toThrow(VereinDbFehler);
		expect((await prisma.person.findUniqueOrThrow({ where: { id: erwachsenerA.id } })).vereinId).toBe(a.id);
	});

	it('updateMany mit vereinId im data wirft VereinDbFehler', async () => {
		const { a, b, erwachsenerA } = await zweiVereine();

		await expect(
			vereinDb(prisma, a.id).person.updateMany({
				// Eingegrenzt, damit der Test vor der Umsetzung (rot) nicht fremde Zeilen trifft.
				where: { id: erwachsenerA.id },
				// @ts-expect-error vereinId ist ueber vereinDb nicht schreibbar
				data: { vereinId: b.id },
			}),
		).rejects.toThrow(VereinDbFehler);
		expect(await prisma.person.count({ where: { vereinId: a.id } })).toBe(1);
	});

	it('connect auf eine Zeile eines fremden Vereins wirft VereinDbFehler', async () => {
		// Ohne die Sperre zoege connect den fremden Zugang in den eigenen Verein:
		// Prisma setzt dabei (vereinId, personId) des Zugangs neu, und ein Zugang
		// ohne Passkeys und Sitzungen haelt kein Fremdschluessel fest.
		const { a, b, erwachsenerA, erwachsenerB } = await zweiVereine();
		const zugangB = await prisma.zugang.create({ data: { vereinId: b.id, personId: erwachsenerB.id } });

		await expect(
			vereinDb(prisma, a.id).person.update({
				where: { id: erwachsenerA.id },
				data: { zugang: { connect: { id: zugangB.id } } },
			}),
		).rejects.toThrow(VereinDbFehler);
		expect((await prisma.zugang.findUniqueOrThrow({ where: { id: zugangB.id } })).vereinId).toBe(b.id);
	});

	it('deleteMany loescht nur im eigenen Verein', async () => {
		const { a, b } = await zweiVereine();

		// Beide Erwachsenen heissen Beispiel; der Filter haelt den Test vor der
		// Umsetzung (rot) von den Zeilen aus schema.spec.ts fern.
		const geloescht = await vereinDb(prisma, a.id).person.deleteMany({ where: { nachname: 'Beispiel' } });

		expect(geloescht.count).toBe(1);
		expect(await prisma.person.count({ where: { vereinId: a.id } })).toBe(0);
		expect(await prisma.person.count({ where: { vereinId: b.id } })).toBe(1);
	});

	it('verschachteltes create mit Person aus fremdem Verein scheitert an der Datenbank', async () => {
		// vereinDb sieht nur die oberste Ebene einer Abfrage. Die Bezugsperson
		// erbt (vereinId, jungfischerId) vom Kind aus Verein a, erwachsenerId zeigt
		// nach b — der zusammengesetzte Fremdschluessel (Spec 3.1) lehnt das ab.
		const { a, erwachsenerB } = await zweiVereine();
		const kindA = await jungfischer(a.id);

		expect(
			await fehlercode(
				vereinDb(prisma, a.id).person.update({
					where: { id: kindA.id },
					data: {
						alsJungfischer: {
							create: { erwachsenerId: erwachsenerB.id, beziehung: 'MUTTER', erziehungsberechtigt: true },
						},
					},
				}),
			),
		).toBe('P2003');
		expect(await prisma.bezugsperson.count({ where: { jungfischerId: kindA.id } })).toBe(0);
	});
});

describe('vereinDb: gesperrte Modelle und Wege', () => {
	it('verein.findMany liefert nur den eigenen Verein; verein.create wirft', async () => {
		const { a } = await zweiVereine();
		const db = vereinDb(prisma, a.id);

		expect((await db.verein.findMany()).map((v) => v.id)).toEqual([a.id]);
		await expect(
			// @ts-expect-error Vereine legt nur der Plattform-Admin an
			db.verein.create({ data: { slug: `vdb-${eindeutig()}`, name: 'X', anzeigename: 'X', farbe: '#000000' } }),
		).rejects.toThrow(VereinDbFehler);
	});

	it('verein.update aendert nur den eigenen Verein', async () => {
		const { a, b } = await zweiVereine();
		const db = vereinDb(prisma, a.id);

		await db.verein.update({ where: { id: a.id }, data: { kontakt: 'Jugendwart' } });
		expect(await fehlercode(db.verein.update({ where: { id: b.id }, data: { kontakt: 'Fremd' } }))).toBe('P2025');
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: b.id } })).kontakt).toBeNull();
	});

	it('vereinDb ohne vereinId wirft sofort', () => {
		// Prisma ignoriert where-Felder mit undefined; ohne die Pruefung saehe ein
		// solcher Client alle Vereine.
		expect(() => vereinDb(prisma, undefined as unknown as string)).toThrow(VereinDbFehler);
		expect(() => vereinDb(prisma, '')).toThrow(VereinDbFehler);
	});

	it('plattformAdmin ueber vereinDb wirft', async () => {
		const { a } = await zweiVereine();

		// @ts-expect-error Admin-Tabellen fehlen im Typ von vereinDb
		await expect(vereinDb(prisma, a.id).plattformAdmin.findMany()).rejects.toThrow(VereinDbFehler);
	});

	it('$queryRaw ueber vereinDb wirft', async () => {
		const { a } = await zweiVereine();
		const db = vereinDb(prisma, a.id);

		// @ts-expect-error Rohabfragen fehlen im Typ von vereinDb
		await expect(db.$queryRaw`SELECT 1`).rejects.toThrow(VereinDbFehler);
		// @ts-expect-error Rohabfragen fehlen im Typ von vereinDb
		await expect(db.$queryRawUnsafe('SELECT 1')).rejects.toThrow(VereinDbFehler);
		// @ts-expect-error Rohabfragen fehlen im Typ von vereinDb
		await expect(db.$executeRaw`SELECT 1`).rejects.toThrow(VereinDbFehler);
		// @ts-expect-error Rohabfragen fehlen im Typ von vereinDb
		await expect(db.$executeRawUnsafe('SELECT 1')).rejects.toThrow(VereinDbFehler);
	});

	it('in $transaction sieht tx nur den eigenen Verein', async () => {
		const { a, erwachsenerA, erwachsenerB } = await zweiVereine();

		const ergebnis = await vereinDb(prisma, a.id).$transaction(async (tx) => ({
			personen: (await tx.person.findMany()).map((p) => p.id),
			fremde: await tx.person.findUnique({ where: { id: erwachsenerB.id } }),
			neu: await tx.person.create({ data: { art: 'ERWACHSENER', vorname: 'Jana', nachname: 'Beispiel' } }),
		}));

		expect(ergebnis.personen).toEqual([erwachsenerA.id]);
		expect(ergebnis.fremde).toBeNull();
		expect(ergebnis.neu.vereinId).toBe(a.id);
	});
});

describe('VEREINS_MODELLE', () => {
	it('VEREINS_MODELLE stimmt mit dem Schema ueberein', () => {
		const schema = readFileSync(fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)), 'utf8');
		const mitVereinId = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
			.filter(([, , rumpf]) => /^\s+vereinId\s/m.test(rumpf))
			.map(([, name]) => name)
			// AdminProtokoll traegt vereinId nur als Notiz ohne Fremdschluessel; es ist
			// ein Admin-Modell und bleibt fuer vereinDb gesperrt.
			.filter((name) => name !== 'AdminProtokoll');

		expect([...VEREINS_MODELLE].sort()).toEqual(mitVereinId.sort());
	});
});
