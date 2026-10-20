/**
 * Der Aenderungszaehler: ein lueckenloser Stand je schreibender Transaktion,
 * vergeben unter der Sperre der Vereinszeile. Laeuft gegen jufi_test_db.
 */

import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, mitAenderung, vereinDb } from './index.js';

const prisma = createPrismaClient();

afterAll(async () => {
	await prisma.$disconnect();
});

const JETZT = new Date('2026-10-20T10:00:00Z');

async function verein() {
	return prisma.verein.create({
		data: {
			slug: `aenderung-${randomBytes(4).toString('hex')}`,
			name: 'Erfundener Fischereiverein 1900 e.V.',
			anzeigename: 'Jungfischer Test',
			farbe: '#1f6f8b',
		},
	});
}

async function leiter(vereinId: string) {
	return prisma.person.create({ data: { vereinId, art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Muster' } });
}

async function thread(vereinId: string, erstelltVonId: string) {
	return prisma.thread.create({
		data: {
			vereinId,
			erstelltVonId,
			titel: 'Sommerfest',
			modus: 'KOMMENTARE',
			rollenfilter: 'JUNGFISCHER_FAMILIE',
			letzteAktivitaetAm: new Date('2026-01-01T00:00:00Z'),
			letzteAktivitaetStand: 0,
		},
	});
}

describe('mitAenderung', () => {
	it('vergibt fortlaufende Staende ab 1 und schreibt je Eingabe eine Aenderung', async () => {
		const v = await verein();
		const p = await leiter(v.id);
		const db = vereinDb(prisma, v.id);

		const erste = await db.$transaction((tx) =>
			mitAenderung(tx, v.id, p.id, JETZT, async () => ({
				ergebnis: 'a',
				aenderungen: [
					{ threadId: null, art: 'THREAD', objektId: 'o1' },
					{ threadId: null, art: 'MODUL', objektId: 'o2' },
				],
			})),
		);
		const zweite = await db.$transaction((tx) =>
			mitAenderung(tx, v.id, null, JETZT, async () => ({
				ergebnis: 'b',
				aenderungen: [{ threadId: null, art: 'ANTWORT', objektId: 'o3' }],
			})),
		);

		expect(erste.stand).toBe(1);
		expect(erste.ergebnis).toBe('a');
		expect(erste.aenderungen).toHaveLength(2);
		expect(zweite.stand).toBe(2);
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: v.id } })).aenderungsstand).toBe(2);

		const zeilen = await prisma.aenderung.findMany({
			where: { vereinId: v.id },
			orderBy: [{ stand: 'asc' }, { objektId: 'asc' }],
		});
		expect(zeilen.map((z) => [z.stand, z.art, z.objektId, z.urheberId])).toEqual([
			[1, 'THREAD', 'o1', p.id],
			[1, 'MODUL', 'o2', p.id],
			[2, 'ANTWORT', 'o3', null],
		]);
		expect(zeilen.every((z) => z.angelegtAm.getTime() === JETZT.getTime())).toBe(true);
	});

	it('20 gleichzeitige Transaktionen ergeben genau die Staende 1 bis 20', async () => {
		const v = await verein();
		const db = vereinDb(prisma, v.id);

		const staende = await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				db.$transaction((tx) =>
					mitAenderung(tx, v.id, null, JETZT, async () => ({
						ergebnis: i,
						aenderungen: [{ threadId: null, art: 'THREAD' as const, objektId: `o${i}` }],
					})),
				),
			),
		);

		expect(staende.map((s) => s.stand).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: v.id } })).aenderungsstand).toBe(20);
		const zeilen = await prisma.aenderung.findMany({ where: { vereinId: v.id } });
		expect(zeilen.map((z) => z.stand).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
	});

	it('eine Transaktion, deren Arbeit wirft, verbraucht keinen Stand', async () => {
		const v = await verein();
		const db = vereinDb(prisma, v.id);

		await expect(
			db.$transaction((tx) =>
				mitAenderung(tx, v.id, null, JETZT, async () => {
					throw new Error('Arbeit gescheitert');
				}),
			),
		).rejects.toThrow('Arbeit gescheitert');

		const danach = await db.$transaction((tx) =>
			mitAenderung(tx, v.id, null, JETZT, async () => ({ ergebnis: null, aenderungen: [] })),
		);
		expect(danach.stand).toBe(1);
		expect(await prisma.aenderung.count({ where: { vereinId: v.id } })).toBe(0);
	});

	it('setzt letzteAktivitaet des Threads, nicht bei GELOESCHT und SICHTBARKEIT', async () => {
		const v = await verein();
		const p = await leiter(v.id);
		const db = vereinDb(prisma, v.id);
		const aktiv = await thread(v.id, p.id);
		const geloescht = await thread(v.id, p.id);
		const sichtbar = await thread(v.id, p.id);

		await db.$transaction((tx) =>
			mitAenderung(tx, v.id, p.id, JETZT, async () => ({
				ergebnis: null,
				aenderungen: [
					{ threadId: aktiv.id, art: 'ANTWORT' as const, objektId: 'a1' },
					{ threadId: aktiv.id, art: 'VERLAUF' as const, objektId: 'a2' },
					{ threadId: geloescht.id, art: 'GELOESCHT' as const, objektId: geloescht.id },
					{ threadId: sichtbar.id, art: 'SICHTBARKEIT' as const, objektId: sichtbar.id },
				],
			})),
		);

		const lies = (id: string) => prisma.thread.findUniqueOrThrow({ where: { id } });
		const a = await lies(aktiv.id);
		expect(a.letzteAktivitaetAm).toEqual(JETZT);
		expect(a.letzteAktivitaetStand).toBe(1);
		for (const t of [geloescht, sichtbar]) {
			const unveraendert = await lies(t.id);
			expect(unveraendert.letzteAktivitaetAm).toEqual(new Date('2026-01-01T00:00:00Z'));
			expect(unveraendert.letzteAktivitaetStand).toBe(0);
		}
	});

	it('zweiter Verein zaehlt unabhaengig', async () => {
		const a = await verein();
		const b = await verein();
		const eintrag = () => ({
			ergebnis: null,
			aenderungen: [{ threadId: null, art: 'THREAD' as const, objektId: 'o' }],
		});

		await vereinDb(prisma, a.id).$transaction((tx) => mitAenderung(tx, a.id, null, JETZT, async () => eintrag()));
		await vereinDb(prisma, a.id).$transaction((tx) => mitAenderung(tx, a.id, null, JETZT, async () => eintrag()));
		const ersteVonB = await vereinDb(prisma, b.id).$transaction((tx) =>
			mitAenderung(tx, b.id, null, JETZT, async () => eintrag()),
		);

		expect(ersteVonB.stand).toBe(1);
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: a.id } })).aenderungsstand).toBe(2);
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: b.id } })).aenderungsstand).toBe(1);
	});

	it('die Arbeit kennt ihren Stand vorab', async () => {
		const v = await verein();
		const p = await leiter(v.id);
		const t = await thread(v.id, p.id);
		const db = vereinDb(prisma, v.id);

		// Zwei Vorlaeufer, damit der Stand nicht zufaellig 1 ist.
		for (let i = 0; i < 2; i++) {
			await db.$transaction((tx) =>
				mitAenderung(tx, v.id, null, JETZT, async () => ({ ergebnis: null, aenderungen: [] })),
			);
		}

		const erg = await db.$transaction((tx) =>
			mitAenderung(tx, v.id, p.id, JETZT, async (stand) => {
				const eintrag = await tx.verlaufEintrag.create({
					data: { threadId: t.id, art: 'NACHRICHT', autorId: p.id, text: 'Hallo', stand },
				});
				return {
					ergebnis: eintrag,
					aenderungen: [{ threadId: t.id, art: 'VERLAUF' as const, objektId: eintrag.id }],
				};
			}),
		);

		expect(erg.stand).toBe(3);
		expect(erg.ergebnis.stand).toBe(erg.stand);
		const gespeichert = await prisma.verlaufEintrag.findUniqueOrThrow({ where: { id: erg.ergebnis.id } });
		expect(gespeichert.stand).toBe(3);
	});
});
