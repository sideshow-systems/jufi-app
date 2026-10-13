import { generateLinkToken, hashToken } from '@jufi/auth';
import { createPrismaClientFromEnv } from '@jufi/db';
import { EINLADUNG_GUELTIG_MS } from '@jufi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { einladungsLink, erzeugeEinladung, leitungsEinladungsText } from './einladung.js';
import { legeVereinAn } from './test-vereine.js';

describe('Einladungen', () => {
	const prisma = createPrismaClientFromEnv();
	const jetzt = new Date('2026-10-13T08:00:00Z');
	let vereinId = '';
	let personId = '';

	beforeAll(async () => {
		const verein = await legeVereinAn(prisma, { slug: 'einladung-test' });
		vereinId = verein.id;
		const person = await prisma.person.create({
			data: { vereinId, art: 'ERWACHSENER', vorname: 'Thomas', nachname: 'Beispiel' },
		});
		personId = person.id;
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	function erzeuge(art: 'EINLADUNG' | 'RESET') {
		return prisma.$transaction((tx) =>
			erzeugeEinladung(tx, { vereinId, personId, art, erstelltVonPersonId: null, jetzt }),
		);
	}

	it('neue Einladung macht die offene alte derselben Art ungueltig', async () => {
		const eingeloest = await prisma.einladung.create({
			data: {
				vereinId,
				personId,
				art: 'EINLADUNG',
				tokenHash: hashToken(generateLinkToken()),
				ablauf: new Date(jetzt.getTime() + EINLADUNG_GUELTIG_MS),
				eingeloestAm: jetzt,
			},
		});
		const alt = await erzeuge('EINLADUNG');
		const neu = await erzeuge('EINLADUNG');

		const zeilen = await prisma.einladung.findMany({ where: { personId, art: 'EINLADUNG' } });
		expect(zeilen.map((z) => z.tokenHash).sort()).toEqual([eingeloest.tokenHash, hashToken(neu)].sort());
		expect(zeilen.some((z) => z.tokenHash === hashToken(alt))).toBe(false);
		const frisch = zeilen.find((z) => z.tokenHash === hashToken(neu));
		expect(frisch?.ablauf).toEqual(new Date(jetzt.getTime() + EINLADUNG_GUELTIG_MS));
		expect(frisch?.erstelltVonPersonId).toBeNull();
		expect(frisch?.eingeloestAm).toBeNull();
	});

	it('RESET laesst EINLADUNG stehen', async () => {
		const einladung = await erzeuge('EINLADUNG');
		const reset = await erzeuge('RESET');

		const zeilen = await prisma.einladung.findMany({ where: { personId, eingeloestAm: null } });
		expect(zeilen.map((z) => [z.art, z.tokenHash]).sort()).toEqual(
			[
				['EINLADUNG', hashToken(einladung)],
				['RESET', hashToken(reset)],
			].sort(),
		);
	});

	it('Link und Text', () => {
		const link = einladungsLink('http://jufi.test', 'glonntal', 'abc_123-XYZ');
		expect(link).toBe('http://jufi.test/glonntal/einladung#abc_123-XYZ');
		expect(leitungsEinladungsText({ vorname: 'Thomas', anzeigename: 'Jungfischer Glonntal', link })).toBe(
			'Hallo Thomas, du bist als Leitung von „Jungfischer Glonntal“ in die JuFi App eingeladen. ' +
				'Richte hier deinen Zugang ein – der Link gilt 14 Tage und nur für dich:\n' +
				'http://jufi.test/glonntal/einladung#abc_123-XYZ',
		);
	});
});
