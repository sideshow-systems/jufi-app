import { createPrismaClientFromEnv, vereinDb, type PrismaClient } from '@jufi/db';
import {
	FEHLER_TEXT,
	MB,
	speicherText,
	type DokumentAnsicht,
	type DokumenteAntwort,
	type SpeicherAntwort,
} from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { dateiSchluessel, VerzeichnisSpeicher, type DateiSpeicher } from './speicher.js';

const PDF = (laenge = 40) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, laenge - 9), 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 1)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30, 2)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(20)]);

describe('Dokumente-API', () => {
	const prisma: PrismaClient = createPrismaClientFromEnv();
	let wurzel: string;
	let server: TestServer;
	/**
	 * Haelt jeden Upload in uebernimm an, solange gesetzt: Zwischen Vorpruefung und Transaktion
	 * liegt genau dieser Aufruf, so laesst sich das Rennen herstellen statt darauf zu hoffen.
	 */
	let anUebernimm: (() => Promise<void>) | undefined;

	beforeAll(async () => {
		wurzel = await mkdtemp(join(tmpdir(), 'jufi-dokumente-'));
		const speicher = new VerzeichnisSpeicher(wurzel);
		const weiche = new Proxy<DateiSpeicher>(speicher, {
			get: (ziel, name, empfaenger) =>
				name === 'uebernimm' && anUebernimm
					? async (...args: Parameters<DateiSpeicher['uebernimm']>) => {
							await anUebernimm?.();
							return ziel.uebernimm(...args);
						}
					: Reflect.get(ziel, name, empfaenger),
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

	/** Eine Barriere fuer `n` Uploads: `angekommen` loest auf, wenn alle n in uebernimm warten. */
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

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
		await rm(wurzel, { recursive: true, force: true });
	});

	async function tempInhalt(): Promise<string[]> {
		return readdir(join(wurzel, 'tmp')).catch(() => []);
	}

	async function szenario() {
		const verein = await legeVereinAn(prisma, { slug: `dokumente-${randomUUID().slice(0, 8)}` });
		const leiter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['DOKUMENTE'] });
		const mitglied = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER' });
		const db = vereinDb(prisma, verein.id);
		const kategorien = await db.dokumentKategorie.findMany({ orderBy: { position: 'asc' } });
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;

		/** Ein JSON-Aufruf; ohne cookie als Leiter. */
		const json = (pfad: string, o: { methode?: string; body?: unknown; cookie?: string } = {}) =>
			sende(server.url, api(pfad), { cookie: leiter.cookie, ...o });

		/** Ein Upload als Koerper mit X-Dateiname, wie ihn die Oberflaeche schickt. */
		const lade = (
			pfad: string,
			o: { methode?: 'POST' | 'PUT'; name?: string; body: Buffer; cookie?: string; kopf?: Record<string, string> },
		) =>
			fetch(`${server.url}${api(pfad)}`, {
				method: o.methode ?? 'POST',
				headers: {
					Origin: TEST_UMGEBUNG.basisUrl,
					'Content-Type': 'application/octet-stream',
					Cookie: o.cookie ?? leiter.cookie,
					...(o.name === undefined ? {} : { 'X-Dateiname': encodeURIComponent(o.name) }),
					...o.kopf,
				},
				body: new Uint8Array(o.body),
			});

		const neu = async (name: string, body: Buffer, kategorieId = kategorien[0]!.id) => {
			const r = await lade(`/dokumente?kategorie=${kategorieId}`, { name, body });
			expect(r.status).toBe(201);
			return (await r.json()) as DokumentAnsicht;
		};
		const hole = (dateiId: string, cookie = leiter.cookie) => sende(server.url, api(`/dateien/${dateiId}`), { cookie });

		/** Lege Dateizeilen an, ohne Bytes: bringt den Verbrauch auf einen Wert, ohne ihn hochzuladen. */
		async function fuelle(bytes: number) {
			let rest = bytes;
			while (rest > 0) {
				const groesse = Math.min(rest, 25 * MB);
				const dokument = await db.dokument.create({
					data: { kategorieId: kategorien[0]!.id, titel: 'Fuellung', angelegtAm: new Date() },
				});
				await db.datei.create({
					data: {
						art: 'DATEI',
						dokumentId: dokument.id,
						name: 'fuellung.pdf',
						typ: 'application/pdf',
						groesse,
						sha256: 'x',
						vonId: leiter.personId,
						hochgeladenAm: new Date(),
					},
				});
				rest -= groesse;
			}
		}
		return { verein, leiter, mitglied, db, kategorien, json, lade, neu, hole, fuelle };
	}

	describe('Rechte', () => {
		it('zeigt einem Mitglied ohne Recht keine leeren Kategorien und darfPflegen: false', async () => {
			const s = await szenario();
			await s.neu('Ordnung.pdf', PDF());
			const r = await s.json('/dokumente', { cookie: s.mitglied.cookie });
			expect(r.status).toBe(200);
			const antwort = (await r.json()) as DokumenteAntwort;
			expect(antwort.darfPflegen).toBe(false);
			expect(antwort.kategorien.map((k) => k.name)).toEqual(['Ordnungen']);
			// Der Leiter sieht alle drei, auch die leeren.
			const leiter = (await (await s.json('/dokumente')).json()) as DokumenteAntwort;
			expect(leiter.darfPflegen).toBe(true);
			expect(leiter.kategorien.map((k) => k.name)).toEqual(['Ordnungen', 'Merkblätter', 'Formulare']);
		});

		it('antwortet einem Mitglied ohne Recht auf POST /dokumente mit 404, bevor der Koerper gelesen ist', async () => {
			const s = await szenario();
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, {
				name: 'x.pdf',
				body: Buffer.alloc(5 * MB, 0x20),
				cookie: s.mitglied.cookie,
			});
			expect(r.status).toBe(404);
			expect(await tempInhalt()).toEqual([]);
			expect(await s.db.dokument.count()).toBe(0);
		});

		it('sperrt alle Pflege-Routen fuer ein Mitglied ohne Recht mit 404', async () => {
			const s = await szenario();
			const d = await s.neu('Ordnung.pdf', PDF());
			const k = s.kategorien[0]!.id;
			const c = s.mitglied.cookie;
			const faelle: [string, string, unknown][] = [
				['PUT', `/dokumente/${d.id}`, { titel: 'Neu' }],
				['DELETE', `/dokumente/${d.id}`, undefined],
				['POST', '/dokument-kategorien', { name: 'Neu' }],
				['PUT', `/dokument-kategorien/${k}`, { name: 'Neu' }],
				['PUT', '/dokument-kategorien/reihenfolge', { ids: [k] }],
				['DELETE', `/dokument-kategorien/${k}`, undefined],
			];
			for (const [methode, pfad, body] of faelle) {
				expect((await s.json(pfad, { methode, body, cookie: c })).status, `${methode} ${pfad}`).toBe(404);
			}
			const ersetzen = await s.lade(`/dokumente/${d.id}/datei`, {
				methode: 'PUT',
				name: 'x.pdf',
				body: PDF(),
				cookie: c,
			});
			expect(ersetzen.status).toBe(404);
			expect(await s.db.dokument.count()).toBe(1);
		});

		it('antwortet ohne Sitzung mit 401', async () => {
			const s = await szenario();
			const r = await fetch(`${server.url}/${s.verein.slug}/api/v1/dokumente`);
			expect(r.status).toBe(401);
		});

		it('gibt GET /speicher nur jemandem mit irgendeinem Recht', async () => {
			const s = await szenario();
			expect((await s.json('/speicher', { cookie: s.mitglied.cookie })).status).toBe(404);
			const r = await s.json('/speicher');
			expect(r.status).toBe(200);
			expect((await r.json()) as SpeicherAntwort).toEqual({ verbrauchBytes: 0, grenzeMb: 5120 });
		});
	});

	describe('Hochladen', () => {
		it('legt aus einem PDF ein Dokument an: Titel ohne Endung, Bytes ueber /dateien', async () => {
			const s = await szenario();
			const inhalt = PDF(200);
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[1]!.id}`, {
				name: 'Haftpflicht Ordnung.pdf',
				body: inhalt,
			});
			expect(r.status).toBe(201);
			const d = (await r.json()) as DokumentAnsicht;
			expect(d).toMatchObject({
				titel: 'Haftpflicht Ordnung',
				typ: 'application/pdf',
				groesse: 200,
				name: 'Haftpflicht Ordnung.pdf',
			});
			expect(Number.isNaN(Date.parse(d.hochgeladenAm))).toBe(false);
			const datei = await s.hole(d.dateiId);
			expect(datei.status).toBe(200);
			expect(Buffer.from(await datei.arrayBuffer())).toEqual(inhalt);
			expect((await s.db.dokument.findUniqueOrThrow({ where: { id: d.id } })).kategorieId).toBe(s.kategorien[1]!.id);
			const zeile = await s.db.datei.findUniqueOrThrow({ where: { id: d.dateiId } });
			expect(zeile.vonId).toBe(s.leiter.personId);
			expect(zeile.sha256).toMatch(/^[0-9a-f]{64}$/u);
			expect(await tempInhalt()).toEqual([]);
		});

		it('nimmt ein ZIP als docx an, wenn die Signatur stimmt', async () => {
			const s = await szenario();
			const d = await s.neu('x.docx', ZIP);
			expect(d.typ).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		});

		it('glaubt dem Inhalt und nicht dem Namen: PNG-Bytes als x.pdf sind image/png', async () => {
			const s = await szenario();
			const d = await s.neu('x.pdf', PNG);
			expect(d.typ).toBe('image/png');
			// Plan-Entscheidung 9: Der Name folgt dem erkannten Typ, auch bei Dokumenten.
			expect(d.name).toBe('x.png');
		});

		it('weist Text als x.pdf mit 415 TYP ab und hinterlaesst nichts', async () => {
			const s = await szenario();
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, {
				name: 'x.pdf',
				body: Buffer.from('Das ist kein PDF, nur Text.'),
			});
			expect(r.status).toBe(415);
			expect(await r.json()).toEqual({ fehler: FEHLER_TEXT.TYP.DATEI, code: 'TYP' });
			expect(await tempInhalt()).toEqual([]);
			expect(await s.db.dokument.count()).toBe(0);
		});

		it('weist HEIC mit 415 HEIC ab', async () => {
			const s = await szenario();
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { name: 'x.jpg', body: HEIC });
			expect(r.status).toBe(415);
			expect(await r.json()).toEqual({ fehler: FEHLER_TEXT.HEIC, code: 'HEIC' });
		});

		it('weist einen leeren Koerper mit 415 ab statt mit einem Fehler der Datenbank', async () => {
			const s = await szenario();
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { name: 'x.pdf', body: Buffer.alloc(0) });
			expect(r.status).toBe(415);
		});

		it('weist 26 MB mit 413 GROESSE ab, bevor etwas auf der Platte liegt', async () => {
			const s = await szenario();
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, {
				name: 'gross.pdf',
				body: Buffer.alloc(26 * MB, 0x20),
			});
			expect(r.status).toBe(413);
			expect(await r.json()).toEqual({ fehler: FEHLER_TEXT.GROESSE.DATEI, code: 'GROESSE' });
			expect(await tempInhalt()).toEqual([]);
		});

		it('antwortet ohne Content-Length mit 411', async () => {
			const s = await szenario();
			const strom = new ReadableStream<Uint8Array>({
				start(c) {
					c.enqueue(new Uint8Array(PDF()));
					c.close();
				},
			});
			const r = await fetch(`${server.url}/${s.verein.slug}/api/v1/dokumente?kategorie=${s.kategorien[0]!.id}`, {
				method: 'POST',
				headers: {
					Origin: TEST_UMGEBUNG.basisUrl,
					'Content-Type': 'application/octet-stream',
					Cookie: s.leiter.cookie,
					'X-Dateiname': 'x.pdf',
				},
				body: strom,
				// Node verlangt die Angabe bei einem Strom als Koerper.
				duplex: 'half',
			} as RequestInit);
			expect(r.status).toBe(411);
		});

		it('verlangt X-Dateiname und eine bekannte Kategorie', async () => {
			const s = await szenario();
			const ohneName = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { body: PDF() });
			expect(ohneName.status).toBe(400);
			expect(await ohneName.json()).toEqual({ fehler: 'Dateiname fehlt' });
			const unbekannt = await s.lade('/dokumente?kategorie=gibt-es-nicht', { name: 'x.pdf', body: PDF() });
			expect(unbekannt.status).toBe(404);
			const ohneKategorie = await s.lade('/dokumente', { name: 'x.pdf', body: PDF() });
			expect(ohneKategorie.status).toBe(404);
			expect(await tempInhalt()).toEqual([]);
		});

		it('begrenzt auf 60 Uploads in 10 Minuten je Person: der 61. ist 429 mit Retry-After', async () => {
			const s = await szenario();
			// Ohne Namen scheitert jeder Aufruf schon nach dem Zaehlen mit 400: billig, aber gezaehlt.
			for (let i = 0; i < 60; i++) {
				const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { body: Buffer.alloc(1) });
				expect(r.status).toBe(400);
			}
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { name: 'x.pdf', body: PDF() });
			expect(r.status).toBe(429);
			expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
			// Eine andere Person ist davon nicht betroffen.
			const anderer = await legeMitgliedAn(prisma, s.verein, { art: 'ERWACHSENER', rechte: ['DOKUMENTE'] });
			const frei = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, {
				name: 'x.pdf',
				body: PDF(),
				cookie: anderer.cookie,
			});
			expect(frei.status).toBe(201);
		});
	});

	describe('Pflege eines Dokuments', () => {
		it('aendert Titel und Kategorie', async () => {
			const s = await szenario();
			const d = await s.neu('Ordnung.pdf', PDF());
			const r = await s.json(`/dokumente/${d.id}`, {
				methode: 'PUT',
				body: { titel: '  Neue Ordnung ', kategorieId: s.kategorien[2]!.id },
			});
			expect(r.status).toBe(200);
			expect((await r.json()) as DokumentAnsicht).toMatchObject({
				id: d.id,
				titel: 'Neue Ordnung',
				dateiId: d.dateiId,
			});
			const zeile = await s.db.dokument.findUniqueOrThrow({ where: { id: d.id } });
			expect(zeile).toMatchObject({ titel: 'Neue Ordnung', kategorieId: s.kategorien[2]!.id });
		});

		it('antwortet auf einen ungueltigen Titel mit 400 und feld titel, auch mit Zeilenumbruch', async () => {
			const s = await szenario();
			const d = await s.neu('Ordnung.pdf', PDF());
			for (const titel of ['   ', 'x'.repeat(121), 'Zwei\nZeilen', 'Nul\u0000l', 'Halb\ud800er', 5]) {
				const r = await s.json(`/dokumente/${d.id}`, { methode: 'PUT', body: { titel } });
				expect(r.status, JSON.stringify(titel)).toBe(400);
				expect(((await r.json()) as { feld: string }).feld).toBe('titel');
			}
			expect((await s.db.dokument.findUniqueOrThrow({ where: { id: d.id } })).titel).toBe('Ordnung');
		});

		it('kennt keine unbekannten Felder und keine unbekannte Kategorie oder ID', async () => {
			const s = await szenario();
			const d = await s.neu('Ordnung.pdf', PDF());
			const fremdesFeld = await s.json(`/dokumente/${d.id}`, { methode: 'PUT', body: { dateiId: 'x' } });
			expect(fremdesFeld.status).toBe(400);
			const unbekannteKategorie = await s.json(`/dokumente/${d.id}`, { methode: 'PUT', body: { kategorieId: 'nein' } });
			expect(unbekannteKategorie.status).toBe(404);
			const unbekannt = await s.json('/dokumente/gibt-es-nicht', { methode: 'PUT', body: { titel: 'x' } });
			expect(unbekannt.status).toBe(404);
		});

		it('ersetzt die Datei: alte ID 404, neue liefert den neuen Inhalt, Titel bleibt, alte Schluessel stehen auf der Loeschliste', async () => {
			const s = await szenario();
			const alt = await s.neu('Ordnung.pdf', PDF(100));
			await s.json(`/dokumente/${alt.id}`, { methode: 'PUT', body: { titel: 'Eigener Titel' } });
			const neuerInhalt = Buffer.concat([PNG, Buffer.from('anderer Inhalt')]);
			const r = await s.lade(`/dokumente/${alt.id}/datei`, { methode: 'PUT', name: 'Scan.png', body: neuerInhalt });
			expect(r.status).toBe(200);
			const neu = (await r.json()) as DokumentAnsicht;
			expect(neu).toMatchObject({
				id: alt.id,
				titel: 'Eigener Titel',
				name: 'Scan.png',
				typ: 'image/png',
				groesse: neuerInhalt.length,
			});
			expect(neu.dateiId).not.toBe(alt.dateiId);

			expect((await s.hole(alt.dateiId)).status).toBe(404);
			const abgerufen = await s.hole(neu.dateiId);
			expect(Buffer.from(await abgerufen.arrayBuffer())).toEqual(neuerInhalt);
			const liste = await prisma.dateiLoeschung.findMany({ where: { vereinId: s.verein.id } });
			expect(liste.map((z) => z.schluessel)).toEqual([dateiSchluessel(s.verein.id, alt.dateiId)]);
			// Die alten Bytes liegen bis zum Aufraeumer noch da.
			expect(await new VerzeichnisSpeicher(wurzel).lies(dateiSchluessel(s.verein.id, alt.dateiId))).not.toBeNull();
			expect(await s.db.datei.count({ where: { dokumentId: alt.id } })).toBe(1);
			expect(await tempInhalt()).toEqual([]);
		});

		it('weist beim Ersetzen eine unzulaessige Datei ab und laesst die alte unberuehrt', async () => {
			const s = await szenario();
			const alt = await s.neu('Ordnung.pdf', PDF(100));
			const r = await s.lade(`/dokumente/${alt.id}/datei`, {
				methode: 'PUT',
				name: 'x.pdf',
				body: Buffer.from('Text, kein PDF'),
			});
			expect(r.status).toBe(415);
			expect((await s.hole(alt.dateiId)).status).toBe(200);
			expect(await prisma.dateiLoeschung.count({ where: { vereinId: s.verein.id } })).toBe(0);
		});

		it('antwortet beim Ersetzen eines unbekannten Dokuments mit 404', async () => {
			const s = await szenario();
			const r = await s.lade('/dokumente/gibt-es-nicht/datei', { methode: 'PUT', name: 'x.pdf', body: PDF() });
			expect(r.status).toBe(404);
		});

		it('loescht Dokument und Datei und schreibt die Bytes auf die Loeschliste', async () => {
			const s = await szenario();
			const d = await s.neu('Ordnung.pdf', PDF());
			const r = await s.json(`/dokumente/${d.id}`, { methode: 'DELETE' });
			expect(r.status).toBe(204);
			expect(await s.db.dokument.count()).toBe(0);
			expect(await s.db.datei.count()).toBe(0);
			expect((await s.hole(d.dateiId)).status).toBe(404);
			const liste = await prisma.dateiLoeschung.findMany({ where: { vereinId: s.verein.id } });
			expect(liste.map((z) => z.schluessel)).toEqual([dateiSchluessel(s.verein.id, d.dateiId)]);
			expect((await s.json(`/dokumente/${d.id}`, { methode: 'DELETE' })).status).toBe(404);
		});

		it('sortiert Dokumente alphabetisch nach Titel', async () => {
			const s = await szenario();
			await s.neu('Zeltlager.pdf', PDF());
			await s.neu('Ärzte.pdf', PDF());
			await s.neu('Anmeldung.pdf', PDF());
			const antwort = (await (await s.json('/dokumente')).json()) as DokumenteAntwort;
			expect(antwort.kategorien[0]!.dokumente.map((d) => d.titel)).toEqual(['Anmeldung', 'Ärzte', 'Zeltlager']);
		});
	});

	describe('Kategorien', () => {
		it('legt an (am Ende), lehnt doppelte Namen ab, benennt um', async () => {
			const s = await szenario();
			const r = await s.json('/dokument-kategorien', { methode: 'POST', body: { name: ' Satzung ' } });
			expect(r.status).toBe(201);
			const kategorie = (await r.json()) as { id: string; name: string };
			expect(kategorie.name).toBe('Satzung');
			expect((await s.db.dokumentKategorie.findUniqueOrThrow({ where: { id: kategorie.id } })).position).toBe(3);

			const doppelt = await s.json('/dokument-kategorien', { methode: 'POST', body: { name: 'Satzung' } });
			expect(doppelt.status).toBe(409);
			expect(await doppelt.json()).toEqual({ fehler: 'Diese Kategorie gibt es schon' });

			const um = await s.json(`/dokument-kategorien/${kategorie.id}`, { methode: 'PUT', body: { name: 'Satzungen' } });
			expect(um.status).toBe(200);
			expect(((await um.json()) as { name: string }).name).toBe('Satzungen');
			const umDoppelt = await s.json(`/dokument-kategorien/${kategorie.id}`, {
				methode: 'PUT',
				body: { name: 'Formulare' },
			});
			expect(umDoppelt.status).toBe(409);
			// Der eigene Name ist kein Doppelter.
			const gleich = await s.json(`/dokument-kategorien/${kategorie.id}`, {
				methode: 'PUT',
				body: { name: 'Satzungen' },
			});
			expect(gleich.status).toBe(200);
		});

		it('prueft den Namen: leer, zu lang und Steuerzeichen sind 400 mit feld name', async () => {
			const s = await szenario();
			for (const name of ['  ', 'x'.repeat(41), 'Zwei\nZeilen', 'Nul\u0000l', 7]) {
				const r = await s.json('/dokument-kategorien', { methode: 'POST', body: { name } });
				expect(r.status, JSON.stringify(name)).toBe(400);
				expect(((await r.json()) as { feld: string }).feld).toBe('name');
			}
			const unbekannt = await s.json('/dokument-kategorien/gibt-es-nicht', { methode: 'PUT', body: { name: 'Neu' } });
			expect(unbekannt.status).toBe(404);
		});

		it('ordnet um und verlangt genau alle Kategorien', async () => {
			const s = await szenario();
			const ids = s.kategorien.map((k) => k.id);
			const umgekehrt = [...ids].reverse();
			const r = await s.json('/dokument-kategorien/reihenfolge', { methode: 'PUT', body: { ids: umgekehrt } });
			expect(r.status).toBe(204);
			const antwort = (await (await s.json('/dokumente')).json()) as DokumenteAntwort;
			expect(antwort.kategorien.map((k) => k.id)).toEqual(umgekehrt);

			for (const schlecht of [
				ids.slice(1),
				[...ids, 'fremd'],
				[ids[0], ids[0], ids[1]],
				[],
				'keine Liste',
				[1, 2, 3],
			]) {
				const f = await s.json('/dokument-kategorien/reihenfolge', { methode: 'PUT', body: { ids: schlecht } });
				expect(f.status, JSON.stringify(schlecht)).toBe(400);
			}
			const nachher = (await (await s.json('/dokumente')).json()) as DokumenteAntwort;
			expect(nachher.kategorien.map((k) => k.id)).toEqual(umgekehrt);
		});

		it('loescht nur leere Kategorien', async () => {
			const s = await szenario();
			const d = await s.neu('Ordnung.pdf', PDF());
			const voll = await s.json(`/dokument-kategorien/${s.kategorien[0]!.id}`, { methode: 'DELETE' });
			expect(voll.status).toBe(409);
			expect(await voll.json()).toEqual({ fehler: 'Die Kategorie ist nicht leer' });
			expect(await s.db.dokumentKategorie.count()).toBe(3);

			const leer = await s.json(`/dokument-kategorien/${s.kategorien[1]!.id}`, { methode: 'DELETE' });
			expect(leer.status).toBe(204);
			expect(await s.db.dokumentKategorie.count()).toBe(2);
			expect((await s.json(`/dokument-kategorien/${s.kategorien[1]!.id}`, { methode: 'DELETE' })).status).toBe(404);

			// Nach dem Loeschen des Dokuments geht auch die erste.
			await s.json(`/dokumente/${d.id}`, { methode: 'DELETE' });
			expect((await s.json(`/dokument-kategorien/${s.kategorien[0]!.id}`, { methode: 'DELETE' })).status).toBe(204);
		});
	});

	describe('Speicher und Kontingent', () => {
		it('weist einen Upload ab, der nicht mehr hineinpasst: 413 KONTINGENT mit dem Text aus FEHLER_TEXT', async () => {
			const s = await szenario();
			await prisma.verein.update({ where: { id: s.verein.id }, data: { speicherGrenzeMb: 100 } });
			const belegt = 100 * MB - 1000;
			await s.fuelle(belegt);
			const r = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { name: 'x.pdf', body: PDF(2000) });
			expect(r.status).toBe(413);
			expect(await r.json()).toEqual({
				fehler: FEHLER_TEXT.KONTINGENT(speicherText(belegt), speicherText(100 * MB)),
				code: 'KONTINGENT',
			});
			expect(await tempInhalt()).toEqual([]);
			// Was noch hineinpasst, geht durch.
			const passt = await s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { name: 'y.pdf', body: PDF(1000) });
			expect(passt.status).toBe(201);
		});

		it('nimmt von zwei Uploads, die beide die Vorpruefung bestanden haben, genau einen an', async () => {
			const s = await szenario();
			await prisma.verein.update({ where: { id: s.verein.id }, data: { speicherGrenzeMb: 100 } });
			await s.fuelle(100 * MB - 1000);
			// Ohne Barriere koennte der zweite Upload erst nach dem Commit des ersten die Vorpruefung
			// erreichen und schon dort scheitern; dann bewiese der Test die zweite Pruefung nicht.
			const tor = barriere(2);
			try {
				const alle = Promise.all(
					['a.pdf', 'b.pdf'].map((name) =>
						s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { name, body: PDF(600) }),
					),
				);
				await tor.angekommen;
				tor.gebeFrei();
				const antworten = await alle;
				expect(antworten.map((r) => r.status).sort()).toEqual([201, 413]);
				const abgelehnt = antworten.find((r) => r.status === 413)!;
				expect(((await abgelehnt.json()) as { code: string }).code).toBe('KONTINGENT');
				expect(await s.db.datei.count({ where: { name: { in: ['a.pdf', 'b.pdf'] } } })).toBe(1);
			} finally {
				tor.gebeFrei();
				anUebernimm = undefined;
			}
		});

		it('liest die Grenze in der Transaktion neu, wenn sie sinkt, waehrend der Upload wartet', async () => {
			const s = await szenario();
			// Die Mindestgrenze ist 100 MB (Check-Constraint), also von 200 auf 100 senken.
			await prisma.verein.update({ where: { id: s.verein.id }, data: { speicherGrenzeMb: 200 } });
			await s.fuelle(150 * MB);
			const tor = barriere(1);
			try {
				const antwort = s.lade(`/dokumente?kategorie=${s.kategorien[0]!.id}`, { name: 'x.pdf', body: PDF(600) });
				await tor.angekommen;
				// Die Vorpruefung hat mit 200 MB bestanden; mit 100 MB ist der Verein ueber der Grenze.
				await prisma.verein.update({ where: { id: s.verein.id }, data: { speicherGrenzeMb: 100 } });
				tor.gebeFrei();
				const r = await antwort;
				expect(r.status).toBe(413);
				expect(((await r.json()) as { code: string }).code).toBe('KONTINGENT');
				expect(await s.db.datei.count({ where: { name: 'x.pdf' } })).toBe(0);
			} finally {
				tor.gebeFrei();
				anUebernimm = undefined;
			}
		});

		it('rechnet beim Ersetzen die alte Datei nicht doppelt', async () => {
			const s = await szenario();
			await prisma.verein.update({ where: { id: s.verein.id }, data: { speicherGrenzeMb: 100 } });
			const alt = await s.neu('Ordnung.pdf', PDF(900));
			await s.fuelle(100 * MB - 900 - 100);
			// Frei sind 100 Bytes; die neue Datei ist 950 gross, ersetzt aber 900: Netto +50.
			const r = await s.lade(`/dokumente/${alt.id}/datei`, { methode: 'PUT', name: 'neu.pdf', body: PDF(950) });
			expect(r.status).toBe(200);
		});

		it('summiert den Verbrauch ueber 2^31 ohne Ueberlauf', async () => {
			const s = await szenario();
			const dokumente = Array.from({ length: 100 }, () => ({
				id: randomUUID(),
				kategorieId: s.kategorien[0]!.id,
				titel: 'Gross',
				angelegtAm: new Date(),
			}));
			await s.db.dokument.createMany({ data: dokumente });
			await s.db.datei.createMany({
				data: dokumente.map((d) => ({
					art: 'DATEI' as const,
					dokumentId: d.id,
					name: 'gross.pdf',
					typ: 'application/pdf',
					groesse: 26214400,
					sha256: 'x',
					vonId: s.leiter.personId,
					hochgeladenAm: new Date(),
				})),
			});
			const r = await s.json('/speicher');
			expect(r.status).toBe(200);
			expect((await r.json()) as SpeicherAntwort).toEqual({ verbrauchBytes: 2621440000, grenzeMb: 5120 });
		});
	});
});
