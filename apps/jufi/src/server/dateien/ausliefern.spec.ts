import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeThreadAn, ordneZu } from '../threads/test-threads.js';
import { legeVereinAn } from '../test-vereine.js';
import { contentDisposition, darfDateiSehen, INLINE_TYPEN } from './ausliefern.js';
import { dateiSchluessel, VerzeichnisSpeicher, type DateiSpeicher } from './speicher.js';
import { erzeugeBild } from './test-bilder.js';

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

describe('INLINE_TYPEN', () => {
	it('zeigt PDF, JPEG, PNG und WebP selbst an, alles andere nicht', () => {
		expect([...INLINE_TYPEN].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
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
		const hole = (id: string, optionen: { cookie?: string; anhang?: string; vorschau?: boolean } = {}) =>
			sende(
				server.url,
				`/${verein.slug}/api/v1/dateien/${id}${optionen.vorschau ? '/vorschau' : ''}${optionen.anhang ?? ''}`,
				{
					cookie: 'cookie' in optionen ? optionen.cookie : person.cookie,
				},
			);

		const leiter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['ALLE_THREADS'] });
		const mutter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Maria', nachname: 'Mutter' });
		const kind = await db.person.create({
			data: { art: 'JUNGFISCHER', vorname: 'Max', nachname: 'Mutter', geburtsdatum: new Date('2015-05-05') },
		});
		await ordneZu(prisma, verein, mutter.personId, kind.id);

		/**
		 * Ein Foto an einem Thread; die Hauptfassung ist absichtlich groesser als die Vorschau und
		 * `groesse` zaehlt beide, wie es die Upload-Route tut (Spec 2.1).
		 */
		async function foto(daten: { veroeffentlicht?: boolean; rollenfilter?: 'JUGENDLEITER_JUGENDSPRECHER' } = {}) {
			const { dateiIds, modulIds } = await legeThreadAn(prisma, verein, new Date(), {
				erstelltVonId: leiter.personId,
				module: [{ typ: 'FOTOS', fotos: [{}] }],
				...daten,
			});
			const id = dateiIds[0] as string;
			const haupt = await erzeugeBild({ breite: 640, hoehe: 480, format: 'jpeg' });
			const vorschau = await erzeugeBild({ breite: 160, hoehe: 120, format: 'jpeg' });
			await db.datei.update({ where: { id }, data: { groesse: haupt.length + vorschau.length } });
			for (const [schluessel, inhalt] of [
				[dateiSchluessel(verein.id, id), haupt],
				[dateiSchluessel(verein.id, id, true), vorschau],
			] as const) {
				const temp = await speicher.neueTempDatei();
				await writeFile(temp, inhalt);
				await speicher.uebernimm(temp, schluessel);
			}
			return { id, modulId: modulIds[0] as string, haupt, vorschau };
		}
		return { verein, person, leiter, mutter, kind, db, dokumentDatei, foto, hole };
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

	it('liefert ein Foto in einem sichtbaren Thread: Hauptfassung mit der Laenge der Datei, nicht der Zeilengroesse', async () => {
		const s = await szenario();
		const foto = await s.foto();
		const zeile = await s.db.datei.findUniqueOrThrow({ where: { id: foto.id } });
		// Die Zeile zaehlt beide Fassungen: Als Content-Length laeuft die Antwort sonst ueber oder bricht ab.
		expect(zeile.groesse).toBe(foto.haupt.length + foto.vorschau.length);
		for (const cookie of [s.mutter.cookie, s.leiter.cookie]) {
			const r = await s.hole(foto.id, { cookie });
			expect(r.status).toBe(200);
			const bytes = Buffer.from(await r.arrayBuffer());
			expect(bytes).toEqual(foto.haupt);
			expect(r.headers.get('content-length')).toBe(String(foto.haupt.length));
			expect(r.headers.get('content-length')).toBe(
				String((await stat(join(wurzel, dateiSchluessel(s.verein.id, foto.id)))).size),
			);
			expect(r.headers.get('content-type')).toBe('image/jpeg');
			expect(r.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
			expect(r.headers.get('x-content-type-options')).toBe('nosniff');
			expect(r.headers.get('content-disposition')).toBe(
				`inline; filename="foto-${foto.id.slice(0, 8)}.jpg"; filename*=UTF-8''foto-${foto.id.slice(0, 8)}.jpg`,
			);
		}
	});

	it('liefert die Vorschau eines Fotos ebenso mit der Laenge der Vorschau-Datei', async () => {
		const s = await szenario();
		const foto = await s.foto();
		const r = await s.hole(foto.id, { cookie: s.mutter.cookie, vorschau: true });
		expect(r.status).toBe(200);
		expect(Buffer.from(await r.arrayBuffer())).toEqual(foto.vorschau);
		expect(r.headers.get('content-length')).toBe(String(foto.vorschau.length));
		expect(r.headers.get('content-length')).toBe(
			String((await readFile(join(wurzel, dateiSchluessel(s.verein.id, foto.id, true)))).length),
		);
		expect(r.headers.get('content-type')).toBe('image/jpeg');
		expect(r.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
		expect(r.headers.get('content-disposition')).toMatch(/^inline; filename="foto-[0-9a-z]{8}\.jpg"/u);
	});

	it('antwortet 404 fuer Haupt- und Vorschaufassung, wenn der Thread ein Entwurf ist und die Person kein Jugendleiter', async () => {
		const s = await szenario();
		const foto = await s.foto({ veroeffentlicht: false });
		expect((await s.hole(foto.id, { cookie: s.mutter.cookie })).status).toBe(404);
		expect((await s.hole(foto.id, { cookie: s.mutter.cookie, vorschau: true })).status).toBe(404);
		// Gegenprobe: Der Jugendleiter sieht den Entwurf, das 404 oben kommt also von der Sichtbarkeit.
		expect((await s.hole(foto.id, { cookie: s.leiter.cookie })).status).toBe(200);
		expect((await s.hole(foto.id, { cookie: s.leiter.cookie, vorschau: true })).status).toBe(200);
	});

	it('antwortet 404 fuer beide Fassungen, wenn der Rollenfilter den Thread vor der Person verbirgt', async () => {
		const s = await szenario();
		const foto = await s.foto({ rollenfilter: 'JUGENDLEITER_JUGENDSPRECHER' });
		expect((await s.hole(foto.id, { cookie: s.mutter.cookie })).status).toBe(404);
		expect((await s.hole(foto.id, { cookie: s.mutter.cookie, vorschau: true })).status).toBe(404);
		expect((await s.hole(foto.id, { cookie: s.leiter.cookie })).status).toBe(200);
	});

	it('antwortet 404 fuer eine entfernte Person, auch wenn ihre Sitzung noch gilt', async () => {
		const s = await szenario();
		const foto = await s.foto();
		await s.db.person.update({ where: { id: s.mutter.personId }, data: { entferntAm: new Date() } });
		expect((await s.hole(foto.id, { cookie: s.mutter.cookie })).status).toBe(401);
		expect((await s.hole(foto.id, { cookie: s.mutter.cookie, vorschau: true })).status).toBe(401);
	});

	it('antwortet 404 auf /vorschau einer DATEI, im Modul wie am Dokument', async () => {
		const s = await szenario();
		const dokument = await s.dokumentDatei({
			name: 'Ordnung.pdf',
			typ: 'application/pdf',
			inhalt: Buffer.from('%PDF-1.7 x'),
		});
		expect((await s.hole(dokument.id, { vorschau: true })).status).toBe(404);
		const { dateiIds } = await legeThreadAn(prisma, s.verein, new Date(), {
			erstelltVonId: s.leiter.personId,
			module: [{ typ: 'DATEIEN', dateien: [{}] }],
		});
		const modulDatei = dateiIds[0] as string;
		// Auch mit Bytes unter dem Vorschau-Schluessel: Die Art entscheidet, nicht der Speicher.
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, 'x');
		await speicher.uebernimm(temp, dateiSchluessel(s.verein.id, modulDatei, true));
		expect((await s.hole(modulDatei, { cookie: s.leiter.cookie, vorschau: true })).status).toBe(404);
	});

	it('liefert eine Datei eines Moduls nur, wo die Person den Thread sieht', async () => {
		const s = await szenario();
		const sichtbar = await legeThreadAn(prisma, s.verein, new Date(), {
			erstelltVonId: s.leiter.personId,
			module: [{ typ: 'DATEIEN', dateien: [{}] }],
		});
		const verborgen = await legeThreadAn(prisma, s.verein, new Date(), {
			erstelltVonId: s.leiter.personId,
			veroeffentlicht: false,
			module: [{ typ: 'DATEIEN', dateien: [{}] }],
		});
		for (const id of [sichtbar.dateiIds[0], verborgen.dateiIds[0]] as string[]) {
			const temp = await speicher.neueTempDatei();
			await writeFile(temp, '%PDF-1.7 x');
			await speicher.uebernimm(temp, dateiSchluessel(s.verein.id, id));
		}
		expect((await s.hole(sichtbar.dateiIds[0] as string, { cookie: s.mutter.cookie })).status).toBe(200);
		expect((await s.hole(verborgen.dateiIds[0] as string, { cookie: s.mutter.cookie })).status).toBe(404);
	});

	it('darfDateiSehen: Dokument fuer jeden, Modul nach der Sichtbarkeit des Threads', async () => {
		const s = await szenario();
		const db = vereinDb(prisma, s.verein.id);
		const offen = await legeThreadAn(prisma, s.verein, new Date(), {
			erstelltVonId: s.leiter.personId,
			module: [{ typ: 'INFO', text: 'x' }],
		});
		const entwurf = await legeThreadAn(prisma, s.verein, new Date(), {
			erstelltVonId: s.leiter.personId,
			veroeffentlicht: false,
			module: [{ typ: 'INFO', text: 'x' }],
		});
		expect(await darfDateiSehen(db, s.mutter.personId, { dokumentId: 'd', modulId: null })).toBe(true);
		expect(
			await darfDateiSehen(db, s.mutter.personId, { dokumentId: null, modulId: offen.modulIds[0] as string }),
		).toBe(true);
		expect(
			await darfDateiSehen(db, s.mutter.personId, { dokumentId: null, modulId: entwurf.modulIds[0] as string }),
		).toBe(false);
		expect(
			await darfDateiSehen(db, s.leiter.personId, { dokumentId: null, modulId: entwurf.modulIds[0] as string }),
		).toBe(true);
		// Ohne Dokument und ohne Modul gibt es nichts, wonach sich die Sicht richtete.
		expect(await darfDateiSehen(db, s.mutter.personId, { dokumentId: null, modulId: null })).toBe(false);
		expect(await darfDateiSehen(db, s.mutter.personId, { dokumentId: null, modulId: 'gibt-es-nicht' })).toBe(false);
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
			const r = await s.hole(datei.id);
			expect(r.status).toBe(404);
			// Auch die Fehlerantwort bleibt abgeschottet (Rueckstand Etappe 1).
			expect(r.headers.get('x-content-type-options')).toBe('nosniff');
			expect(r.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
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
				lies: async () => ({ strom: createReadStream(join(wurzel, 'gibt-es-nicht')), bytes: 10 }),
			} as unknown as DateiSpeicher;
			try {
				const r = await s.hole(datei.id);
				expect(r.status).toBe(404);
				expect(r.headers.get('cache-control') ?? '').not.toContain('immutable');
				expect(r.headers.get('content-disposition')).toBeNull();
				expect(r.headers.get('content-length')).not.toBe('10');
				// Die Fehlerantwort behaelt nosniff und die Datei-CSP (Rueckstand Etappe 1).
				expect(r.headers.get('x-content-type-options')).toBe('nosniff');
				expect(r.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
			} finally {
				ersatz = undefined;
			}
		} finally {
			fehler.mockRestore();
		}
	});
});
