import { createPrismaClientFromEnv, mitAenderung, vereinDb } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeVereinAn } from '../test-vereine.js';
import { ladeBearbeitung } from './bearbeitung.js';
import { ladeThread, ladeThreadUmfeld } from './laden.js';
import { legeThreadAn } from './test-threads.js';

const JETZT = new Date('2026-10-22T10:00:00Z');

describe('ladeBearbeitung', () => {
	const prisma = createPrismaClientFromEnv();

	afterAll(async () => {
		await prisma.$disconnect();
	});

	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `bearbeitung-${randomUUID().slice(0, 8)}` });
		const db = vereinDb(prisma, verein.id);
		const ersteller = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Thomas',
			rechte: ['THREADS_ERSTELLEN'],
		});
		const anderer = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Tina',
			rechte: ['THREADS_ERSTELLEN'],
		});
		const t = await legeThreadAn(prisma, verein, JETZT, { titel: 'Zeltlager', erstelltVonId: ersteller.personId });
		return { verein, db, ersteller, anderer, t };
	}

	it('liefert die Bearbeitung des Erstellers und null fuer jemanden ohne Recht am Thread', async () => {
		const { db, ersteller, anderer, t } = await szenario();
		const umfeld = await ladeThreadUmfeld(db);
		const ich = umfeld.personen.get(ersteller.personId);
		const du = umfeld.personen.get(anderer.personId);
		if (!ich || !du) throw new Error('Personen fehlen im Umfeld');

		const b = await ladeBearbeitung(db, ich, t.threadId, umfeld, JETZT);
		expect(b).toMatchObject({ id: t.threadId, darfLoeschen: true, version: 0 });
		expect(await ladeBearbeitung(db, du, t.threadId, umfeld, JETZT)).toBeNull();
		expect(await ladeBearbeitung(db, ich, 'gibt-es-nicht', umfeld, JETZT)).toBeNull();
	});

	it('laeuft auch in der Transaktion von mitAenderung: ladeThread und ladeBearbeitung sehen dort den eigenen Stand', async () => {
		const { verein, db, ersteller, t } = await szenario();
		const umfeld = await ladeThreadUmfeld(db);
		const ich = umfeld.personen.get(ersteller.personId);
		if (!ich) throw new Error('Person fehlt im Umfeld');

		const { ergebnis } = await db.$transaction((tx) =>
			mitAenderung(tx, verein.id, ersteller.personId, JETZT, async () => {
				// Ein Titel, den nur diese Transaktion kennt: Aus der Verbindung ausserhalb waere er unsichtbar.
				await tx.thread.update({ where: { id: t.threadId }, data: { titel: 'Nur in der Transaktion' } });
				const geladen = await ladeThread(tx, t.threadId);
				const bearbeitung = await ladeBearbeitung(tx, ich, t.threadId, umfeld, JETZT);
				return {
					ergebnis: { titel: geladen?.kopf.titel, entwurfTitel: bearbeitung?.entwurf.titel },
					aenderungen: [{ threadId: t.threadId, art: 'THREAD' as const, objektId: t.threadId }],
				};
			}),
		);
		expect(ergebnis).toEqual({ titel: 'Nur in der Transaktion', entwurfTitel: 'Nur in der Transaktion' });
	});
});
