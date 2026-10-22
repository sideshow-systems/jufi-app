import { createPrismaClientFromEnv, vereinDb, type PrismaClient } from '@jufi/db';
import { FEHLER_TEXT, MB, type DateiZeile, type FotoHochladen, type FotoZeile } from '@jufi/domain';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { Bus, type BusEreignis } from '../echtzeit/bus.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { legeThreadAn, ordneZu, type TestModul } from '../threads/test-threads.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { FotoSchlange } from './foto-schlange.js';
import { dateiSchluessel, VerzeichnisSpeicher, type DateiSpeicher } from './speicher.js';
import { erzeugeBild } from './test-bilder.js';

const PDF = (laenge = 40) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, laenge - 9), 0x20)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(20)]);

describe('Dateien und Fotos in Modulen', () => {
	const prisma: PrismaClient = createPrismaClientFromEnv();
	const bus = new Bus();
	const ereignisse: BusEreignis[] = [];
	bus.abonniere((e) => ereignisse.push(e));
	// Ohne Wartende: Ein einziger blockierter Lauf fuellt die Schlange (Fall BESCHAEFTIGT). Die
	// Faelle laufen nacheinander, ein Foto-Upload findet sie sonst immer leer.
	const schlange = new FotoSchlange(0);
	let wurzel: string;
	let server: TestServer;
	/** Haelt jeden Upload in uebernimm an, solange gesetzt (Barriere wie in dokumente.spec.ts). */
	let anUebernimm: (() => Promise<void>) | undefined;
	/**
	 * Gesetzt: Jede Temp-Datei nach der ersten zeigt in ein Verzeichnis, das es nicht gibt. Die erste
	 * ist die des Uploads, die folgenden sind die Ausgaben der Fotoverarbeitung.
	 */
	let kaputteAusgaben: { aufrufe: number } | undefined;

	beforeAll(async () => {
		wurzel = await mkdtemp(join(tmpdir(), 'jufi-module-'));
		const speicher = new VerzeichnisSpeicher(wurzel);
		const weiche = new Proxy<DateiSpeicher>(speicher, {
			get: (ziel, name, empfaenger) => {
				if (name === 'uebernimm' && anUebernimm) {
					return async (...args: Parameters<DateiSpeicher['uebernimm']>) => {
						await anUebernimm?.();
						return ziel.uebernimm(...args);
					};
				}
				if (name === 'neueTempDatei' && kaputteAusgaben) {
					const zaehler = kaputteAusgaben;
					return async () => {
						const pfad = await ziel.neueTempDatei();
						return zaehler.aufrufe++ === 0 ? pfad : join(wurzel, 'gibt-es-nicht', basename(pfad));
					};
				}
				return Reflect.get(ziel, name, empfaenger);
			},
		});
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				dateiSpeicher: weiche,
				fotoSchlange: schlange,
				bus,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
		await rm(wurzel, { recursive: true, force: true });
	});

	function barriere(n: number) {
		let ankommend = 0;
		let meldeAngekommen!: () => void;
		let gebeFrei!: () => void;
		const angekommen = new Promise<void>((ok) => (meldeAngekommen = ok));
		const frei = new Promise<void>((ok) => (gebeFrei = ok));
		anUebernimm = async () => {
			if (++ankommend === n) meldeAngekommen();
			await frei;
		};
		return { angekommen, gebeFrei };
	}

	async function tempInhalt(): Promise<string[]> {
		return readdir(join(wurzel, 'tmp')).catch(() => []);
	}

	/**
	 * Ein Verein mit einem Bearbeiter (Alle Threads bearbeiten) und einer Leserin: Mutter eines
	 * Kindes, das zur Zielgruppe jedes Threads mit "Alle Untergruppen" gehoert.
	 */
	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `module-${randomUUID().slice(0, 8)}` });
		const db = vereinDb(prisma, verein.id);
		const leiter = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Lena',
			nachname: 'Leiter',
			rechte: ['ALLE_THREADS'],
		});
		const leser = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', vorname: 'Maria', nachname: 'Mutter' });
		const kind = await db.person.create({
			data: { art: 'JUNGFISCHER', vorname: 'Max', nachname: 'Mutter', geburtsdatum: new Date('2015-05-05') },
		});
		await ordneZu(prisma, verein, leser.personId, kind.id);
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;

		const thread = (daten: Parameters<typeof legeThreadAn>[3] & { module: TestModul[] }) =>
			legeThreadAn(prisma, verein, new Date(), { erstelltVonId: leiter.personId, ...daten });
		const fotoThread = (hochladen: FotoHochladen = 'JUGENDLEITER', fotos: { vonId?: string }[] = []) =>
			thread({ module: [{ typ: 'FOTOS', hochladen, fotos }] });

		/** Ein Upload als Koerper, wie ihn die Oberflaeche schickt; ohne cookie als Leiter. */
		const lade = (pfad: string, o: { name?: string; body: Buffer; cookie?: string }) =>
			fetch(`${server.url}${api(pfad)}`, {
				method: 'POST',
				headers: {
					Origin: TEST_UMGEBUNG.basisUrl,
					'Content-Type': 'application/octet-stream',
					Cookie: o.cookie ?? leiter.cookie,
					...(o.name === undefined ? {} : { 'X-Dateiname': encodeURIComponent(o.name) }),
				},
				body: new Uint8Array(o.body),
			});
		const json = (pfad: string, o: { methode?: string; body?: unknown; cookie?: string } = {}) =>
			sende(server.url, api(pfad), { ...o, cookie: o.cookie ?? leiter.cookie });
		const stand = async () => (await prisma.verein.findUniqueOrThrow({ where: { id: verein.id } })).aenderungsstand;
		const meldungen = () => ereignisse.filter((e) => e.vereinId === verein.id);

		return { verein, db, leiter, leser, thread, fotoThread, lade, json, stand, meldungen };
	}

	describe('Dateien hochladen', () => {
		it('nimmt eine PDF ohne Endung an: Name mit .pdf, Aenderung MODUL ohne Systemeintrag, Meldung an den Bus', async () => {
			const s = await szenario();
			const { threadId, modulIds } = await s.thread({ module: [{ typ: 'DATEIEN' }] });
			const modulId = modulIds[0] as string;
			const standVorher = await s.stand();
			const verlaufVorher = await s.db.verlaufEintrag.count();
			const inhalt = PDF(300);

			const r = await s.lade(`/module/${modulId}/dateien`, { name: 'Packliste', body: inhalt });
			expect(r.status).toBe(201);
			const zeile = (await r.json()) as DateiZeile;
			expect(zeile).toMatchObject({ name: 'Packliste.pdf', typ: 'application/pdf', groesse: 300 });
			expect(Number.isNaN(Date.parse(zeile.hochgeladenAm))).toBe(false);

			const datei = await s.db.datei.findUniqueOrThrow({ where: { id: zeile.id } });
			expect(datei).toMatchObject({ art: 'DATEI', modulId, dokumentId: null, vonId: s.leiter.personId, breite: null });
			expect(datei.sha256).toBe(createHash('sha256').update(inhalt).digest('hex'));
			expect(await readFile(join(wurzel, dateiSchluessel(s.verein.id, zeile.id)))).toEqual(inhalt);

			expect(await s.stand()).toBe(standVorher + 1);
			const aenderungen = await s.db.aenderung.findMany({ where: { stand: standVorher + 1 } });
			expect(aenderungen.map((a) => ({ threadId: a.threadId, art: a.art, objektId: a.objektId }))).toEqual([
				{ threadId, art: 'MODUL', objektId: modulId },
			]);
			expect(await s.db.verlaufEintrag.count()).toBe(verlaufVorher);
			expect(s.meldungen()).toEqual([
				expect.objectContaining({
					typ: 'aenderung',
					stand: standVorher + 1,
					aenderungen: [expect.objectContaining({ threadId, art: 'MODUL', objektId: modulId })],
				}),
			]);
			expect(await tempInhalt()).toEqual([]);
		});

		it('weist ein volles Modul vor dem Koerper mit 409 VOLL ab', async () => {
			const s = await szenario();
			const dateien = Array.from({ length: 20 }, () => ({}));
			const { modulIds } = await s.thread({ module: [{ typ: 'DATEIEN', dateien }] });
			const r = await s.lade(`/module/${modulIds[0]}/dateien`, { name: 'x.pdf', body: PDF(5 * MB) });
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({ fehler: FEHLER_TEXT.VOLL.DATEI, code: 'VOLL' });
			expect(await tempInhalt()).toEqual([]);
		});

		it('nimmt bei 19 Dateien von zwei gleichzeitigen Uploads genau einen an, der andere ist 409 VOLL', async () => {
			const s = await szenario();
			const dateien = Array.from({ length: 19 }, () => ({}));
			const { modulIds } = await s.thread({ module: [{ typ: 'DATEIEN', dateien }] });
			const modulId = modulIds[0] as string;
			// Beide haben die Vorpruefung (19 < 20) bestanden, bevor einer in die Transaktion kommt.
			const tor = barriere(2);
			try {
				const alle = Promise.all(
					['a.pdf', 'b.pdf'].map((name) => s.lade(`/module/${modulId}/dateien`, { name, body: PDF() })),
				);
				await tor.angekommen;
				tor.gebeFrei();
				const antworten = await alle;
				expect(antworten.map((r) => r.status).sort()).toEqual([201, 409]);
				const abgelehnt = antworten.find((r) => r.status === 409)!;
				expect(await abgelehnt.json()).toEqual({ fehler: FEHLER_TEXT.VOLL.DATEI, code: 'VOLL' });
				expect(await s.db.datei.count({ where: { modulId } })).toBe(20);
			} finally {
				tor.gebeFrei();
				anUebernimm = undefined;
			}
		});

		it('laesst nur Bearbeiter hochladen; ein Leser bekommt 404', async () => {
			const s = await szenario();
			const { modulIds } = await s.thread({ module: [{ typ: 'DATEIEN' }] });
			const r = await s.lade(`/module/${modulIds[0]}/dateien`, { name: 'x.pdf', body: PDF(), cookie: s.leser.cookie });
			expect(r.status).toBe(404);
			expect(await s.db.datei.count()).toBe(0);
		});
	});

	describe('Fotos hochladen', () => {
		it('verkleinert ein JPEG mit GPS, speichert beide Fassungen ohne EXIF und zaehlt beide in groesse', async () => {
			const s = await szenario();
			const { threadId, modulIds } = await s.fotoThread();
			const modulId = modulIds[0] as string;
			const bild = await erzeugeBild({ breite: 4000, hoehe: 3000, format: 'jpeg', gps: true });
			const standVorher = await s.stand();

			const r = await s.lade(`/module/${modulId}/fotos`, { body: bild });
			expect(r.status).toBe(201);
			const zeile = (await r.json()) as FotoZeile;
			expect(zeile).toMatchObject({ breite: 2560, hoehe: 1920, darfLoeschen: true });
			expect(zeile.von).toContain('Lena');

			const haupt = join(wurzel, dateiSchluessel(s.verein.id, zeile.id));
			const vorschau = join(wurzel, dateiSchluessel(s.verein.id, zeile.id, true));
			const meta = await sharp(haupt).metadata();
			expect([meta.width, meta.height, meta.format]).toEqual([2560, 1920, 'jpeg']);
			// Spec 13.2: Kein EXIF, also auch kein GPS und keine Kamera in den gespeicherten Bytes.
			expect(meta.exif).toBeUndefined();
			expect((await readFile(haupt)).includes('Erfunden')).toBe(false);
			expect((await sharp(vorschau).metadata()).exif).toBeUndefined();

			const datei = await s.db.datei.findUniqueOrThrow({ where: { id: zeile.id } });
			expect(datei).toMatchObject({ art: 'FOTO', modulId, name: '', typ: 'image/jpeg', breite: 2560, hoehe: 1920 });
			expect(datei.groesse).toBe((await stat(haupt)).size + (await stat(vorschau)).size);
			expect(datei.sha256).toBe(
				createHash('sha256')
					.update(await readFile(haupt))
					.digest('hex'),
			);
			expect(s.meldungen()).toEqual([
				expect.objectContaining({
					stand: standVorher + 1,
					aenderungen: [expect.objectContaining({ threadId, art: 'MODUL', objektId: modulId })],
				}),
			]);
			expect(await s.db.verlaufEintrag.count({ where: { threadId } })).toBe(0);
			expect(await tempInhalt()).toEqual([]);
		});

		it('antwortet einem Leser bei "Nur Jugendleiter" mit 404, bevor der Koerper gelesen ist', async () => {
			const s = await szenario();
			const { modulIds } = await s.fotoThread('JUGENDLEITER');
			const r = await s.lade(`/module/${modulIds[0]}/fotos`, { body: Buffer.alloc(5 * MB, 1), cookie: s.leser.cookie });
			expect(r.status).toBe(404);
			expect(await tempInhalt()).toEqual([]);
			expect(await s.db.datei.count()).toBe(0);
		});

		it('laesst einen Leser bei "Alle Leser laden hoch" hochladen, im Archiv nicht', async () => {
			const s = await szenario();
			const bild = await erzeugeBild({ breite: 300, hoehe: 200, format: 'png' });
			const offen = await s.fotoThread('ALLE');
			const r = await s.lade(`/module/${offen.modulIds[0]}/fotos`, { body: bild, cookie: s.leser.cookie });
			expect(r.status).toBe(201);
			expect(((await r.json()) as FotoZeile).darfLoeschen).toBe(true);

			const archiv = await s.thread({ archivModus: 'ARCHIVIERT', module: [{ typ: 'FOTOS', hochladen: 'ALLE' }] });
			const imArchiv = await s.lade(`/module/${archiv.modulIds[0]}/fotos`, { body: bild, cookie: s.leser.cookie });
			expect(imArchiv.status).toBe(404);
			expect(await tempInhalt()).toEqual([]);
		});

		it('antwortet mit 404 fuer einen Thread, den die Person nicht sieht, und fuer Module eines anderen Typs', async () => {
			const s = await szenario();
			const bild = await erzeugeBild({ breite: 300, hoehe: 200, format: 'jpeg' });
			// Spec 13.2: "Alle Leser laden hoch" hilft nicht, wenn der Thread fuer die Person nicht da ist.
			const verborgen = await s.thread({
				rollenfilter: 'NUR_JUGENDLEITER',
				module: [{ typ: 'FOTOS', hochladen: 'ALLE' }],
			});
			const r = await s.lade(`/module/${verborgen.modulIds[0]}/fotos`, { body: bild, cookie: s.leser.cookie });
			expect(r.status).toBe(404);

			const gemischt = await s.thread({
				module: [{ typ: 'DATEIEN' }, { typ: 'FOTOS' }, { typ: 'INFO', text: 'Hallo' }],
			});
			const [dateien, fotos, info] = gemischt.modulIds as [string, string, string];
			expect((await s.lade(`/module/${dateien}/fotos`, { body: bild })).status).toBe(404);
			expect((await s.lade(`/module/${fotos}/dateien`, { name: 'x.pdf', body: PDF() })).status).toBe(404);
			expect((await s.lade(`/module/${info}/fotos`, { body: bild })).status).toBe(404);
			expect((await s.lade('/module/gibt-es-nicht/fotos', { body: bild })).status).toBe(404);
			expect(await s.db.datei.count()).toBe(0);
			expect(await tempInhalt()).toEqual([]);
		});

		it('weist ein Foto ueber 20 MB mit 413 GROESSE und dem Foto-Text ab', async () => {
			const s = await szenario();
			const { modulIds } = await s.fotoThread();
			const r = await s.lade(`/module/${modulIds[0]}/fotos`, { body: Buffer.alloc(21 * MB, 1) });
			expect(r.status).toBe(413);
			expect(await r.json()).toEqual({ fehler: FEHLER_TEXT.GROESSE.FOTO, code: 'GROESSE' });
			expect(await tempInhalt()).toEqual([]);
		});

		it('weist ein Bild ueber 50 Megapixel mit 413 GROESSE und dem PIXEL-Text ab', async () => {
			const s = await szenario();
			const { modulIds } = await s.fotoThread();
			const bild = await sharp({ create: { width: 7100, height: 7100, channels: 3, background: '#336699' } })
				.png()
				.toBuffer();
			const r = await s.lade(`/module/${modulIds[0]}/fotos`, { body: bild });
			expect(r.status).toBe(413);
			expect(await r.json()).toEqual({ fehler: FEHLER_TEXT.PIXEL, code: 'GROESSE' });
			expect(await s.db.datei.count()).toBe(0);
			expect(await tempInhalt()).toEqual([]);
		});

		it('weist eine PDF als Foto mit 415 TYP und HEIC mit 415 HEIC ab', async () => {
			const s = await szenario();
			const { modulIds } = await s.fotoThread();
			const pdf = await s.lade(`/module/${modulIds[0]}/fotos`, { body: PDF(200) });
			expect(pdf.status).toBe(415);
			expect(await pdf.json()).toEqual({ fehler: FEHLER_TEXT.TYP.FOTO, code: 'TYP' });
			const heic = await s.lade(`/module/${modulIds[0]}/fotos`, { body: HEIC });
			expect(heic.status).toBe(415);
			expect(await heic.json()).toEqual({ fehler: FEHLER_TEXT.HEIC, code: 'HEIC' });
			expect(await tempInhalt()).toEqual([]);
		});

		it('antwortet bei voller Schlange mit 503 BESCHAEFTIGT und Retry-After 2', async () => {
			const s = await szenario();
			const { modulIds } = await s.fotoThread();
			let frei!: () => void;
			const tor = new Promise<void>((ok) => (frei = ok));
			const laufend = schlange.reihe(() => tor);
			expect(laufend).not.toBeNull();
			try {
				const bild = await erzeugeBild({ breite: 300, hoehe: 200, format: 'jpeg' });
				const r = await s.lade(`/module/${modulIds[0]}/fotos`, { body: bild });
				expect(r.status).toBe(503);
				expect(r.headers.get('retry-after')).toBe('2');
				expect(await r.json()).toEqual({ fehler: FEHLER_TEXT.BESCHAEFTIGT, code: 'BESCHAEFTIGT' });
				expect(await tempInhalt()).toEqual([]);
			} finally {
				frei();
				await laufend;
			}
		});

		it('meldet einen Fehler des Dateisystems bei der Verarbeitung als 500, nicht als TYP, und raeumt auf', async () => {
			const s = await szenario();
			const { modulIds } = await s.fotoThread();
			const bild = await erzeugeBild({ breite: 300, hoehe: 200, format: 'jpeg' });
			kaputteAusgaben = { aufrufe: 0 };
			try {
				const r = await s.lade(`/module/${modulIds[0]}/fotos`, { body: bild });
				expect(r.status).toBe(500);
			} finally {
				kaputteAusgaben = undefined;
			}
			expect(await s.db.datei.count()).toBe(0);
			expect(await tempInhalt()).toEqual([]);
		});
	});

	describe('PUT /dateien/:id', () => {
		it('benennt um und haengt die passende Endung an; derselbe Name noch einmal aendert nichts', async () => {
			const s = await szenario();
			const { threadId, modulIds, dateiIds } = await s.thread({
				module: [{ typ: 'DATEIEN', dateien: [{ name: 'alt.pdf' }] }],
			});
			const standVorher = await s.stand();
			const r = await s.json(`/dateien/${dateiIds[0]}`, { methode: 'PUT', body: { name: 'Neu' } });
			expect(r.status).toBe(200);
			expect(await r.json()).toMatchObject({ id: dateiIds[0], name: 'Neu.pdf', typ: 'application/pdf' });
			expect((await s.db.datei.findUniqueOrThrow({ where: { id: dateiIds[0] } })).name).toBe('Neu.pdf');
			expect(await s.stand()).toBe(standVorher + 1);
			expect(s.meldungen()).toEqual([
				expect.objectContaining({
					aenderungen: [expect.objectContaining({ threadId, art: 'MODUL', objektId: modulIds[0] })],
				}),
			]);

			// Ohne Wirkung keine Aenderung: Der Stand bleibt, und niemand bekommt ein Signal.
			const gleich = await s.json(`/dateien/${dateiIds[0]}`, { methode: 'PUT', body: { name: 'Neu.pdf' } });
			expect(gleich.status).toBe(200);
			expect(await s.stand()).toBe(standVorher + 1);
			expect(s.meldungen()).toHaveLength(1);
		});

		it('lehnt einen leeren Namen mit 400 und feld name ab', async () => {
			const s = await szenario();
			const { dateiIds } = await s.thread({ module: [{ typ: 'DATEIEN', dateien: [{ name: 'alt.pdf' }] }] });
			for (const body of [{ name: '   ' }, { name: 3 }, {}]) {
				const r = await s.json(`/dateien/${dateiIds[0]}`, { methode: 'PUT', body });
				expect(r.status).toBe(400);
				expect(((await r.json()) as { feld: string }).feld).toBe('name');
			}
			expect((await s.db.datei.findUniqueOrThrow({ where: { id: dateiIds[0] } })).name).toBe('alt.pdf');
		});

		it('antwortet fuer Fotos, Dokument-Dateien, Leser und Unbekanntes mit 404', async () => {
			const s = await szenario();
			const fotos = await s.fotoThread('JUGENDLEITER', [{}]);
			const dateien = await s.thread({ module: [{ typ: 'DATEIEN', dateien: [{ name: 'alt.pdf' }] }] });
			const kategorie = await s.db.dokumentKategorie.findFirstOrThrow();
			const dokument = await s.db.dokument.create({
				data: { kategorieId: kategorie.id, titel: 'Satzung', angelegtAm: new Date() },
			});
			const dokumentDatei = await s.db.datei.create({
				data: {
					art: 'DATEI',
					dokumentId: dokument.id,
					name: 'satzung.pdf',
					typ: 'application/pdf',
					groesse: 7,
					sha256: 'x',
					vonId: s.leiter.personId,
					hochgeladenAm: new Date(),
				},
			});
			const faelle: [string, string | undefined][] = [
				[fotos.dateiIds[0] as string, undefined],
				[dokumentDatei.id, undefined],
				[dateien.dateiIds[0] as string, s.leser.cookie],
				['gibt-es-nicht', undefined],
			];
			for (const [id, cookie] of faelle) {
				const r = await s.json(`/dateien/${id}`, { methode: 'PUT', body: { name: 'Neu' }, cookie });
				expect(r.status, id).toBe(404);
			}
			expect((await s.db.datei.findUniqueOrThrow({ where: { id: dokumentDatei.id } })).name).toBe('satzung.pdf');
			expect(s.meldungen()).toEqual([]);
		});
	});

	describe('DELETE /dateien/:id', () => {
		it('laesst einen Leser das eigene Foto loeschen, das fremde nicht; ein Bearbeiter loescht jedes', async () => {
			const s = await szenario();
			const { threadId, modulIds, dateiIds } = await s.fotoThread('ALLE', [
				{ vonId: s.leser.personId },
				{ vonId: s.leiter.personId },
				{ vonId: s.leser.personId },
			]);
			const [eigenes, fremdes, nochEins] = dateiIds as [string, string, string];

			const r = await s.json(`/dateien/${eigenes}`, { methode: 'DELETE', cookie: s.leser.cookie });
			expect(r.status).toBe(204);
			expect(await s.db.datei.findUnique({ where: { id: eigenes } })).toBeNull();
			expect((await s.db.dateiLoeschung.findMany()).map((l) => l.schluessel).sort()).toEqual(
				[dateiSchluessel(s.verein.id, eigenes), dateiSchluessel(s.verein.id, eigenes, true)].sort(),
			);
			expect(s.meldungen()).toEqual([
				expect.objectContaining({
					aenderungen: [expect.objectContaining({ threadId, art: 'MODUL', objektId: modulIds[0] })],
				}),
			]);

			const fremd = await s.json(`/dateien/${fremdes}`, { methode: 'DELETE', cookie: s.leser.cookie });
			expect(fremd.status).toBe(404);
			expect(await s.db.datei.findUnique({ where: { id: fremdes } })).not.toBeNull();

			const bearbeiter = await s.json(`/dateien/${nochEins}`, { methode: 'DELETE' });
			expect(bearbeiter.status).toBe(204);
			expect(await s.db.datei.findUnique({ where: { id: nochEins } })).toBeNull();
			expect(await s.db.dateiLoeschung.count()).toBe(4);
		});

		it('laesst Dateien nur Bearbeiter loeschen', async () => {
			const s = await szenario();
			const { dateiIds } = await s.thread({ module: [{ typ: 'DATEIEN', dateien: [{ name: 'plan.pdf' }] }] });
			const datei = dateiIds[0] as string;
			expect((await s.json(`/dateien/${datei}`, { methode: 'DELETE', cookie: s.leser.cookie })).status).toBe(404);
			expect(await s.db.datei.findUnique({ where: { id: datei } })).not.toBeNull();
			expect((await s.json(`/dateien/${datei}`, { methode: 'DELETE' })).status).toBe(204);
			expect((await s.db.dateiLoeschung.findMany()).map((l) => l.schluessel)).toEqual([
				dateiSchluessel(s.verein.id, datei),
			]);
		});

		it('laesst eine entfernte Person nichts loeschen, auch nicht das eigene Foto', async () => {
			const s = await szenario();
			const { dateiIds } = await s.fotoThread('ALLE', [{ vonId: s.leser.personId }]);
			await s.db.person.update({ where: { id: s.leser.personId }, data: { entferntAm: new Date() } });
			const r = await s.json(`/dateien/${dateiIds[0]}`, { methode: 'DELETE', cookie: s.leser.cookie });
			expect(r.status).toBe(401);
			expect(await s.db.datei.findUnique({ where: { id: dateiIds[0] } })).not.toBeNull();
		});

		it('loescht keine Dokument-Datei ueber diese Route', async () => {
			const s = await szenario();
			const kategorie = await s.db.dokumentKategorie.findFirstOrThrow();
			const dokument = await s.db.dokument.create({
				data: { kategorieId: kategorie.id, titel: 'Satzung', angelegtAm: new Date() },
			});
			const datei = await s.db.datei.create({
				data: {
					art: 'DATEI',
					dokumentId: dokument.id,
					name: 'satzung.pdf',
					typ: 'application/pdf',
					groesse: 7,
					sha256: 'x',
					vonId: s.leiter.personId,
					hochgeladenAm: new Date(),
				},
			});
			expect((await s.json(`/dateien/${datei.id}`, { methode: 'DELETE' })).status).toBe(404);
			expect(await s.db.datei.findUnique({ where: { id: datei.id } })).not.toBeNull();
		});
	});
});
