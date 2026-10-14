import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legeVereinAn } from '../test-vereine.js';
import { legeMailAn } from './warteschlange.js';

describe('legeMailAn', () => {
	const prisma = createPrismaClientFromEnv();
	const jetzt = new Date('2026-10-13T08:00:00Z');
	let verein: { id: string };
	let fremd: { id: string };

	beforeAll(async () => {
		[verein, fremd] = await Promise.all([
			legeVereinAn(prisma, { slug: 'warteschlange-eigen' }),
			legeVereinAn(prisma, { slug: 'warteschlange-fremd' }),
		]);
	});

	afterAll(() => prisma.$disconnect());

	it('legt mit schlichtem Client eine Zeile mit vereinId an, ohne zu senden', async () => {
		await prisma.$transaction((tx) =>
			legeMailAn(tx, {
				vereinId: verein.id,
				empfaenger: 'a@jufi.test',
				betreff: 'Betreff A',
				text: 'Text A',
				bezug: 'einladung:1',
				jetzt,
			}),
		);
		const zeile = await prisma.mailWarteschlange.findFirstOrThrow({ where: { betreff: 'Betreff A' } });
		expect(zeile).toMatchObject({
			vereinId: verein.id,
			empfaenger: 'a@jufi.test',
			text: 'Text A',
			versuche: 0,
			gesendetAm: null,
			fehler: null,
			bezug: 'einladung:1',
		});
		expect(zeile.naechsterVersuch).toEqual(jetzt);
	});

	it('landet ueber vereinDb im richtigen Verein, auch ohne vereinId im Aufruf', async () => {
		await vereinDb(prisma, fremd.id).$transaction((tx) =>
			legeMailAn(tx, { empfaenger: 'b@jufi.test', betreff: 'Betreff B', text: 'Text B', jetzt }),
		);
		const zeile = await prisma.mailWarteschlange.findFirstOrThrow({ where: { betreff: 'Betreff B' } });
		expect(zeile.vereinId).toBe(fremd.id);
		expect(zeile.bezug).toBeNull();
	});

	it('legt ohne Verein eine Plattform-Mail an', async () => {
		await prisma.$transaction((tx) =>
			legeMailAn(tx, { empfaenger: 'c@jufi.test', betreff: 'Betreff C', text: 'Text C', jetzt }),
		);
		const zeile = await prisma.mailWarteschlange.findFirstOrThrow({ where: { betreff: 'Betreff C' } });
		expect(zeile.vereinId).toBeNull();
	});
});
