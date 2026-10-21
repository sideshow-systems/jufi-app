import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeThreadAn } from '../threads/test-threads.js';
import { legeVereinAn } from '../test-vereine.js';
import { contentDisposition, darfDateiSehen } from './ausliefern.js';
import { dateiSchluessel, VerzeichnisSpeicher, type DateiSpeicher } from './speicher.js';

describe('contentDisposition', () => {
	it('nennt inline oder attachment und beide Namensformen', () => {
		expect(contentDisposition('Ordnung.pdf', true)).toBe(
			`inline; filename="Ordnung.pdf"; filename*=UTF-8''Ordnung.pdf`,
		);
		expect(contentDisposition('Ordnung.pdf', false)).toMatch(/^attachment; /u);
	});

	it('ersetzt Nicht-ASCII im einfachen Namen und kodiert den echten Namen', () => {
		const kopf = contentDisposition('Übersicht 🎣 (neu).docx', false);
		expect(kopf).toMatch(/^[\x20-\x7e]*$/u);
		expect(kopf).toContain('filename="_bersicht _ (neu).docx"');
		const kodiert = /filename\*=UTF-8''(.*)$/u.exec(kopf)?.[1] ?? '';
		expect(decodeURIComponent(kodiert)).toBe('Übersicht 🎣 (neu).docx');
		// Die Zeichen, die RFC 5987 nicht im Klartext erlaubt, stehen prozent-kodiert.
		expect(kodiert).not.toMatch(/['()*]/u);
	});

	it('wirft Anfuehrungszeichen und Rueckstrich aus dem einfachen Namen', () => {
		const kopf = contentDisposition('a"b\\c.pdf', true);
		const einfach = /filename="([^"]*)"/u.exec(kopf)?.[1];
		expect(einfach).toBe('abc.pdf');
		expect(kopf).not.toContain('\\');
		const kodiert = /filename\*=UTF-8''(.*)$/u.exec(kopf)?.[1] ?? '';
		expect(decodeURIComponent(kodiert)).toBe('a"b\\c.pdf');
	});

	it('uebersteht Steuerzeichen und halbe Surrogate', () => {
		const kopf = contentDisposition('a\nb\ud800.pdf', false);
		expect(kopf).toMatch(/^[\x20-\x7e]*$/u);
	});
});

describe('darfDateiSehen', () => {
	it('gibt Dokumenten jedem Mitglied frei, Modulen noch niemandem', () => {
		expect(darfDateiSehen({ dokumentId: 'd', modulId: null })).toBe(true);
		expect(darfDateiSehen({ dokumentId: null, modulId: 'm' })).toBe(false);
	});
});

describe('GET /dateien/:id', () => {
	const prisma = createPrismaClientFromEnv();
	let wurzel: string;
	let speicher: VerzeichnisSpeicher;
	let server: TestServer;
	let ersatz: DateiSpeicher | undefined;

	beforeAll(async () => {
		wurzel = await mkdtemp(join(tmpdir(), 'jufi-ausliefern-'));
		speicher = new VerzeichnisSpeicher(wurzel);
		// Ein Speicher, der sich je Test austauschen laesst, ohne den Server neu zu starten.
		const weiche = new Proxy(speicher, {
			get: (ziel, name, empfaenger) => Reflect.get(ersatz ?? ziel, name, empfaenger) as unknown,
		});
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				dateiSpeicher: weiche,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
		await rm(wurzel, { recursive: true, force: true });
	});

	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `ausliefern-${randomUUID().slice(0, 8)}` });
		const person = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER' });
		const db = vereinDb(prisma, verein.id);
		const kategorie = await db.dokumentKategorie.findFirstOrThrow({ orderBy: { position: 'asc' } });

		/** Ein Dokument mit einer Datei; mit bytes: false liegen die Bytes nicht im Speicher. */
		async function dokumentDatei(e: { name: string; typ: string; inhalt: Buffer; bytes?: boolean }) {
			const dokument = await db.dokument.create({
				data: { kategorieId: kategorie.id, titel: 'Titel', angelegtAm: new Date() },
			});
			const datei = await db.datei.create({
				data: {
					art: 'DATEI',
					dokumentId: dokument.id,
					name: e.name,
					typ: e.typ,
					groesse: e.inhalt.length,
					sha256: 'x',
					vonId: person.personId,
					hochgeladenAm: new Date(),
				},
			});
			if (e.bytes !== false) {
				const temp = await speicher.neueTempDatei();
				await writeFile(temp, e.inhalt);
				await speicher.uebernimm(temp, dateiSchluessel(verein.id, datei.id));
			}
			return datei;
		}
		const hole = (id: string, optionen: { cookie?: string; anhang?: string } = {}) =>
			sende(server.url, `/${verein.slug}/api/v1/dateien/${id}${optionen.anhang ?? ''}`, {
				cookie: 'cookie' in optionen ? optionen.cookie : person.cookie,
			});
		return { verein, person, db, dokumentDatei, hole };
	}

	it('liefert Inhalt und alle Koepfe, ein PDF inline', async () => {
		const s = await szenario();
		const inhalt = Buffer.from('%PDF-1.7 Inhalt der Ordnung');
		const datei = await s.dokumentDatei({ name: 'Ordnung.pdf', typ: 'application/pdf', inhalt });
		const r = await s.hole(datei.id);
		expect(r.status).toBe(200);
		expect(Buffer.from(await r.arrayBuffer())).toEqual(inhalt);
		expect(r.headers.get('content-type')).toBe('application/pdf');
		expect(r.headers.get('content-length')).toBe(String(inhalt.length));
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
		expect(r.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
		expect(r.headers.get('content-disposition')).toBe(`inline; filename="Ordnung.pdf"; filename*=UTF-8''Ordnung.pdf`);
	});

	it('liefert JPEG und PNG inline, alles andere als Anhang', async () => {
		const s = await szenario();
		const docx = await s.dokumentDatei({
			name: 'Formular.docx',
			typ: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			inhalt: Buffer.from('PK'),
		});
		const png = await s.dokumentDatei({ name: 'Bild.png', typ: 'image/png', inhalt: Buffer.from('png') });
		const jpeg = await s.dokumentDatei({ name: 'Bild.jpg', typ: 'image/jpeg', inhalt: Buffer.from('jpg') });
		expect((await s.hole(docx.id)).headers.get('content-disposition')).toMatch(/^attachment; /u);
		expect((await s.hole(png.id)).headers.get('content-disposition')).toMatch(/^inline; /u);
		expect((await s.hole(jpeg.id)).headers.get('content-disposition')).toMatch(/^inline; /u);
		// Dieselbe strenge CSP wie beim PDF: Bild und Anhang sind kein Grund fuer weniger Abschottung.
		for (const datei of [docx, png, jpeg]) {
			expect((await s.hole(datei.id)).headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
		}
	});

	it('?herunterladen=1 macht auch ein PDF zum Anhang', async () => {
		const s = await szenario();
		const datei = await s.dokumentDatei({
			name: 'Ordnung.pdf',
			typ: 'application/pdf',
			inhalt: Buffer.from('%PDF-1.7 x'),
		});
		const r = await s.hole(datei.id, { anhang: '?herunterladen=1' });
		expect(r.status).toBe(200);
		expect(r.headers.get('content-disposition')).toMatch(/^attachment; /u);
	});

	it('macht aus einem Namen mit Umlaut, Emoji und Klammern einen gueltigen Kopf', async () => {
		const s = await szenario();
		const name = 'Übersicht 🎣 (neu).docx';
		const datei = await s.dokumentDatei({ name, typ: 'application/zip', inhalt: Buffer.from('PK') });
		const kopf = (await s.hole(datei.id)).headers.get('content-disposition') ?? '';
		expect(kopf).toMatch(/^[\x20-\x7e]+$/u);
		const einfach = /filename="([^"]*)"/u.exec(kopf)?.[1] ?? '';
		expect(einfach).not.toMatch(/["\\]/u);
		const kodiert = /filename\*=UTF-8''(.*)$/u.exec(kopf)?.[1] ?? '';
		expect(decodeURIComponent(kodiert)).toBe(name);
	});

	it('antwortet 404 fuer eine Datei an einem Modul', async () => {
		const s = await szenario();
		const { modulIds } = await legeThreadAn(prisma, s.verein, new Date(), {
			titel: 'Thread mit Datei',
			module: [{ typ: 'INFO', text: 'Info' }],
		});
		const datei = await s.db.datei.create({
			data: {
				art: 'DATEI',
				modulId: modulIds[0] as string,
				name: 'Modul.pdf',
				typ: 'application/pdf',
				groesse: 5,
				sha256: 'x',
				vonId: s.person.personId,
				hochgeladenAm: new Date(),
			},
		});
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, '%PDF-');
		await speicher.uebernimm(temp, dateiSchluessel(s.verein.id, datei.id));
		expect((await s.hole(datei.id)).status).toBe(404);
	});

	it('antwortet 404 fuer eine unbekannte ID und 401 ohne Sitzung', async () => {
		const s = await szenario();
		expect((await s.hole('gibt-es-nicht')).status).toBe(404);
		const datei = await s.dokumentDatei({
			name: 'Ordnung.pdf',
			typ: 'application/pdf',
			inhalt: Buffer.from('%PDF-1.7 x'),
		});
		expect((await s.hole(datei.id, { cookie: undefined })).status).toBe(401);
	});

	it('antwortet 404 und loggt nur die ID, wenn die Bytes fehlen', async () => {
		const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const s = await szenario();
			const datei = await s.dokumentDatei({
				name: 'Geheimer-Name.pdf',
				typ: 'application/pdf',
				inhalt: Buffer.from('%PDF-1.7 x'),
				bytes: false,
			});
			expect((await s.hole(datei.id)).status).toBe(404);
			const log = fehler.mock.calls.flat().join(' ');
			expect(log).toContain(datei.id);
			expect(log).not.toContain('Geheimer-Name');
		} finally {
			fehler.mockRestore();
		}
	});

	it('antwortet 404 ohne Dokument-Koepfe, wenn die Bytes erst nach dem Pruefen verschwinden', async () => {
		const fehler = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const s = await szenario();
			const datei = await s.dokumentDatei({
				name: 'Ordnung.pdf',
				typ: 'application/pdf',
				inhalt: Buffer.from('%PDF-1.7 x'),
				bytes: false,
			});
			// stat fand die Datei, das Oeffnen scheitert: der Strom meldet ENOENT erst spaeter.
			ersatz = {
				...speicher,
				lies: async () => createReadStream(join(wurzel, 'gibt-es-nicht')),
			} as unknown as DateiSpeicher;
			try {
				const r = await s.hole(datei.id);
				expect(r.status).toBe(404);
				expect(r.headers.get('cache-control') ?? '').not.toContain('immutable');
				expect(r.headers.get('content-disposition')).toBeNull();
			} finally {
				ersatz = undefined;
			}
		} finally {
			fehler.mockRestore();
		}
	});
});
