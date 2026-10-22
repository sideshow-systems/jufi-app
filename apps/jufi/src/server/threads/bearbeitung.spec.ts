import { createPrismaClientFromEnv, mitAenderung, vereinDb } from '@jufi/db';
import { threadDatenAus } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeVereinAn } from '../test-vereine.js';
import { ladeBearbeitung, loeschZaehler } from './bearbeitung.js';
import { ladeThread, ladeThreadUmfeld } from './laden.js';
import { legeThreadAn, trageEinTest } from './test-threads.js';

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

	it('liest die Version vor dem Inhalt: ein PUT dazwischen ergibt neuen Inhalt mit alter Version, nie umgekehrt', async () => {
		const { db, ersteller, t } = await szenario();
		const umfeld = await ladeThreadUmfeld(db);
		const ich = umfeld.personen.get(ersteller.personId);
		if (!ich) throw new Error('Person fehlt im Umfeld');

		// Ein Dazwischenschreiben genau nach dem Lesen der Version, ohne Haken im Produktionscode:
		// die Hilfe umhuellt nur den Aufruf thread.findUnique des Test-db.
		const nachDerVersion = new Proxy(db, {
			get(ziel, name, empfaenger) {
				const wert = Reflect.get(ziel, name, empfaenger) as unknown;
				if (name !== 'thread') return wert;
				return new Proxy(wert as object, {
					get(modell, methode, e) {
						const m = Reflect.get(modell, methode, e) as unknown;
						if (methode !== 'findUnique') return m;
						return async (...args: unknown[]) => {
							const ergebnis = await (m as (...a: unknown[]) => Promise<unknown>).apply(modell, args);
							await prisma.thread.update({
								where: { id: t.threadId },
								data: { titel: 'Von einem anderen Geraet', bearbeitetStand: 5 },
							});
							return ergebnis;
						};
					},
				});
			},
		});

		const b = await ladeBearbeitung(nachDerVersion, ich, t.threadId, umfeld, JETZT);
		// Neuer Inhalt mit alter Version: der naechste PUT scheitert an VERALTET, statt still zu ueberschreiben.
		expect(b?.version).toBe(0);
		expect(b?.entwurf.titel).toBe('Von einem anderen Geraet');
	});

	it('ein Helfer-Eintrag sperrt das Loeschen und steht in helferSperren unter dem Schluessel seiner Position', async () => {
		const { verein, db, ersteller } = await szenario();
		const t = await legeThreadAn(prisma, verein, JETZT, {
			titel: 'Sommerfest',
			erstelltVonId: ersteller.personId,
			module: [
				{
					typ: 'HELFER',
					positionen: [
						{ text: 'Kuchen', anzahl: 4 },
						{ text: 'Salat', anzahl: 2 },
					],
				},
			],
		});
		const umfeld = await ladeThreadUmfeld(db);
		const ich = umfeld.personen.get(ersteller.personId);
		if (!ich) throw new Error('Person fehlt im Umfeld');
		const modulId = t.modulIds[0] as string;

		const leer = await ladeBearbeitung(db, ich, t.threadId, umfeld, JETZT);
		expect(leer).toMatchObject({
			darfLoeschen: true,
			helferSperren: { [modulId]: { eingetragen: false, belegt: {} } },
		});

		await trageEinTest(db, t.positionIds['kuchen'] as string, ersteller.personId, ersteller.personId);
		const b = await ladeBearbeitung(db, ich, t.threadId, umfeld, JETZT);
		expect(b?.darfLoeschen).toBe(false);
		expect(b?.helferSperren).toEqual({ [modulId]: { eingetragen: true, belegt: { kuchen: 1 } } });
		// Die Umfrage-Sperren kennen die Helferliste nicht: Sie stehen nur unter helferSperren.
		expect(b?.sperren).toEqual({});

		const geladen = await ladeThread(db, t.threadId);
		if (!geladen) throw new Error('Thread fehlt');
		expect(await loeschZaehler(db, threadDatenAus(geladen.kopf, geladen.module))).toEqual({
			antworten: 1,
			nachrichten: 0,
		});
	});
});
