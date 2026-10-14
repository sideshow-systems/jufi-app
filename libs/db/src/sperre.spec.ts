/**
 * Die Vereinszeile als Sperre: Wer sie zuerst anfasst, haelt sie bis zum Ende
 * seiner Transaktion; jede weitere Transaktion wartet. Laeuft gegen jufi_test_db.
 */

import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, sperreVereinszeile, vereinDb } from './index.js';

const prisma = createPrismaClient();

afterAll(async () => {
	await prisma.$disconnect();
});

const warte = (ms: number) => new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms));

async function verein() {
	return prisma.verein.create({
		data: {
			slug: `sperre-${randomBytes(4).toString('hex')}`,
			name: 'Erfundener Fischereiverein 1900 e.V.',
			anzeigename: 'Jungfischer Test',
			farbe: '#1f6f8b',
		},
	});
}

describe('sperreVereinszeile', () => {
	it('Zweite Transaktion wartet auf die erste', async () => {
		const v = await verein();
		let freigeben!: () => void;
		const haelt = new Promise<void>((r) => (freigeben = r));
		let aHatGesperrt!: () => void;
		const aGesperrt = new Promise<void>((r) => (aHatGesperrt = r));

		const a = prisma.$transaction(async (tx) => {
			await sperreVereinszeile(tx, v.id);
			aHatGesperrt();
			await haelt;
		});
		await aGesperrt;

		const b = prisma.$transaction(async (tx) => {
			await sperreVereinszeile(tx, v.id);
		});
		const vorCommit = await Promise.race([b.then(() => 'fertig' as const), warte(200)]);
		expect(vorCommit).toBe('timeout');

		freigeben();
		await a;
		await b;
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: v.id } })).sperrzaehler).toBe(2);
	});

	it('funktioniert auch mit dem Client aus vereinDb', async () => {
		const v = await verein();
		await vereinDb(prisma, v.id).$transaction(async (tx) => {
			await sperreVereinszeile(tx, v.id);
		});
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: v.id } })).sperrzaehler).toBe(1);
	});
});
