import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { threadSegment, type MedienAntwort, type ThreadListe } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeThreadAn, ordneZu, steckeInUntergruppe, type TestModul } from '../threads/test-threads.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';

const JETZT = new Date('2026-10-22T10:00:00.000Z');

describe('GET /medien', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => JETZT,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Ein Verein je Test mit Thomas (Jugendleiter), Sandra (Mutter von Lena) und Lena. */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `medien-${randomUUID().slice(0, 8)}` });
		const db = vereinDb(prisma, verein.id);
		const thomas = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Thomas',
			rechte: ['THREADS_ERSTELLEN'],
			jetzt: JETZT,
		});
		const sandra = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Sandra',
			nachname: 'Mutter',
			jetzt: JETZT,
		});
		const lena = await legeMitgliedAn(prisma, verein, {
			art: 'JUNGFISCHER',
			vorname: 'Lena',
			nachname: 'Mutter',
			jetzt: JETZT,
		});
		await ordneZu(prisma, verein, sandra.personId, lena.personId);

		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const medien = async (cookie: string) => {
			const r = await sende(server.url, api('/medien'), { cookie });
			expect(r.status).toBe(200);
			return (await r.json()) as MedienAntwort;
		};
		const thread = (titel: string, module: TestModul[], erweiterung: Parameters<typeof legeThreadAn>[3] = {}) =>
			legeThreadAn(prisma, verein, JETZT, { titel, erstelltVonId: thomas.personId, module, ...erweiterung });
		const fotos = (n: number): TestModul => ({ typ: 'FOTOS', fotos: Array.from({ length: n }, () => ({})) });
		const dateien = (n: number): TestModul => ({
			typ: 'DATEIEN',
			dateien: Array.from({ length: n }, (_, i) => ({ name: `datei-${i + 1}.pdf` })),
		});
		return { verein, db, thomas, sandra, lena, api, medien, thread, fotos, dateien };
	}

	it('ist ohne Anmeldung 401', async () => {
		const s = await szenario();
		expect((await sende(server.url, s.api('/medien'))).status).toBe(401);
	});

	it('liefert je Thread mit Medien einen Block samt Segment, Zahl, Vorschau und Dateizeilen', async () => {
		const s = await szenario();
		const t = await s.thread('Zeltlager', [s.fotos(8), s.dateien(2)]);

		const antwort = await s.medien(s.sandra.cookie);

		expect(antwort.bloecke).toHaveLength(1);
		const [block] = antwort.bloecke;
		expect(block).toMatchObject({
			threadId: t.threadId,
			segment: threadSegment(t.threadId, 'Zeltlager'),
			titel: 'Zeltlager',
			archiviert: false,
			fotos: 8,
			weitereDateien: 0,
		});
		const fotoIds = (
			await s.db.datei.findMany({ where: { art: 'FOTO', modul: { threadId: t.threadId } }, select: { id: true } })
		).map((f) => f.id);
		expect(block.vorschau).toHaveLength(6);
		expect(fotoIds).toEqual(expect.arrayContaining(block.vorschau));
		expect(block.dateien.map((d) => d.name)).toEqual(['datei-1.pdf', 'datei-2.pdf']);
		expect(block.dateien[0]).toEqual({
			id: expect.any(String),
			name: 'datei-1.pdf',
			typ: 'application/pdf',
			groesse: 1000,
			hochgeladenAm: JETZT.toISOString(),
		});
	});

	it('kuerzt auf 10 Dateien und zaehlt die weiteren', async () => {
		const s = await szenario();
		await s.thread('Packliste', [s.dateien(13)]);

		const [block] = (await s.medien(s.sandra.cookie)).bloecke;

		expect(block.dateien).toHaveLength(10);
		expect(block.weitereDateien).toBe(3);
		expect(block.fotos).toBe(0);
		expect(block.vorschau).toEqual([]);
	});

	it('laesst Threads ohne Fotos und Dateien weg', async () => {
		const s = await szenario();
		await s.thread('Nur Text', [{ typ: 'INFO', text: 'Hallo' }]);
		await s.thread('Leere Module', [s.fotos(0), s.dateien(0)]);
		const mit = await s.thread('Mit Foto', [s.fotos(1)]);

		const antwort = await s.medien(s.sandra.cookie);

		expect(antwort.bloecke.map((b) => b.threadId)).toEqual([mit.threadId]);
	});

	it('zeigt keinen Entwurf, auch nicht dem Jugendleiter', async () => {
		const s = await szenario();
		await s.thread('Geplant', [s.fotos(2)], { veroeffentlicht: false });
		const offen = await s.thread('Offen', [s.fotos(1)]);

		for (const cookie of [s.thomas.cookie, s.sandra.cookie]) {
			const antwort = await s.medien(cookie);
			expect(antwort.bloecke.map((b) => b.threadId)).toEqual([offen.threadId]);
		}
	});

	it('zeigt einen Thread nicht, den die Person nach der Sichtbarkeit nicht sieht', async () => {
		const s = await szenario();
		const gruppe = await steckeInUntergruppe(
			prisma,
			s.verein,
			(await s.db.person.findFirstOrThrow({ where: { vorname: 'Thomas' } })).id,
			'Andere',
		);
		await s.thread('Nur Leiter', [s.fotos(2)], { rollenfilter: 'NUR_JUGENDLEITER' });
		await s.thread('Andere Gruppe', [s.fotos(2)], { untergruppenIds: [gruppe] });
		const sichtbar = await s.thread('Fuer alle', [s.fotos(1)]);

		const sandra = await s.medien(s.sandra.cookie);
		expect(sandra.bloecke.map((b) => b.threadId)).toEqual([sichtbar.threadId]);

		// Der Jugendleiter sieht dieselben Threads, die er sehen darf, also alle drei.
		const thomas = await s.medien(s.thomas.cookie);
		expect(thomas.bloecke).toHaveLength(3);
	});

	it('zeigt einen archivierten Thread mit archiviert: true', async () => {
		const s = await szenario();
		const alt = await s.thread('Altes Lager', [s.fotos(1)], { archivModus: 'ARCHIVIERT' });
		const neu = await s.thread('Neues Lager', [s.fotos(1)]);

		const antwort = await s.medien(s.sandra.cookie);

		expect(antwort.bloecke.find((b) => b.threadId === alt.threadId)?.archiviert).toBe(true);
		expect(antwort.bloecke.find((b) => b.threadId === neu.threadId)?.archiviert).toBe(false);
	});

	it('nimmt Segment und Reihenfolge von der Thread-Liste', async () => {
		const s = await szenario();
		const a = await s.thread('Erster', [s.fotos(1)]);
		const b = await s.thread('Zweiter', [s.dateien(1)]);
		await s.db.thread.update({
			where: { id: a.threadId },
			data: { letzteAktivitaetAm: new Date('2026-10-20T10:00:00Z') },
		});
		await s.db.thread.update({
			where: { id: b.threadId },
			data: { letzteAktivitaetAm: new Date('2026-10-21T10:00:00Z') },
		});

		const medien = await s.medien(s.sandra.cookie);
		const r = await sende(server.url, s.api('/threads'), { cookie: s.sandra.cookie });
		const liste = (await r.json()) as ThreadListe;

		expect(medien.bloecke.map((x) => x.threadId)).toEqual([b.threadId, a.threadId]);
		for (const block of medien.bloecke) {
			expect(block.segment).toBe(liste.threads.find((z) => z.id === block.threadId)?.segment);
		}
	});

	it('zeigt Threads aus einem anderen Verein nicht', async () => {
		const s = await szenario();
		const fremd = await szenario();
		await fremd.thread('Fremdes Lager', [fremd.fotos(3)]);
		await s.thread('Eigenes Lager', [s.fotos(1)]);

		const antwort = await s.medien(s.thomas.cookie);

		expect(antwort.bloecke.map((b) => b.titel)).toEqual(['Eigenes Lager']);
	});

	it('ist ohne Medien eine leere Liste', async () => {
		const s = await szenario();
		expect(await s.medien(s.sandra.cookie)).toEqual({ bloecke: [] });
	});
});
