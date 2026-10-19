import { createPrismaClientFromEnv } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { legeMitgliedAn } from '../mitglieder/test-mitglieder.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';

interface Einstellungen {
	slug: string;
	name: string;
	anzeigename: string;
	kontakt: string | null;
	farbe: string;
	logoStand: string | null;
}

async function png(breite = 64, hoehe = 32, rot = 200): Promise<Buffer> {
	return sharp({ create: { width: breite, height: hoehe, channels: 3, background: { r: rot, g: 30, b: 30 } } })
		.png()
		.toBuffer();
}

describe('Vereinseinstellungen', () => {
	// DATABASE_URL zeigt hier auf jufi_test_server (test-umgebung.ts).
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test: Einstellungen und Logo gehoeren dem Verein, also darf kein Test in einen anderen hineinreichen. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `einst-${randomUUID().slice(0, 8)}` });
		const leitung = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['EINSTELLUNGEN'] });
		// Alle anderen Rechte, aber nicht EINSTELLUNGEN: sieht die Verwaltung, nicht die Einstellungen.
		const jugendleiter = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			rechte: [
				'MITGLIEDER',
				'THREADS_ERSTELLEN',
				'ALLE_THREADS',
				'DOKUMENTE',
				'ANTWORTEN_DETAIL',
				'JUGENDLEITER_RECHTE',
			],
		});
		const pfad = (rest: string) => `/${verein.slug}/api/v1${rest}`;
		const hole = (cookie = leitung.cookie) => sende(server.url, pfad('/einstellungen'), { cookie });
		const aendere = (body: unknown, cookie = leitung.cookie) =>
			sende(server.url, pfad('/einstellungen'), { methode: 'PATCH', body, cookie });
		/** Rohe Bytes mit Origin, wie der Browser sie fuer ein Bild schickt; kopf ueberschreibt, etwa um den Origin wegzulassen. */
		const lade = (
			bild: Buffer,
			e: { typ?: string; cookie?: string; kopf?: Record<string, string | undefined> } = {},
		) => {
			const kopf: Record<string, string> = {
				Origin: TEST_UMGEBUNG.basisUrl,
				'Content-Type': e.typ ?? 'image/png',
				Cookie: e.cookie ?? leitung.cookie,
			};
			for (const [name, wert] of Object.entries(e.kopf ?? {})) {
				if (wert === undefined) delete kopf[name];
				else kopf[name] = wert;
			}
			return fetch(`${server.url}${pfad('/einstellungen/logo')}`, {
				method: 'PUT',
				headers: kopf,
				body: new Uint8Array(bild),
			});
		};
		const nimmLogoWeg = (cookie = leitung.cookie) =>
			sende(server.url, pfad('/einstellungen/logo'), { methode: 'DELETE', cookie });
		const logo = () => prisma.vereinLogo.findUnique({ where: { vereinId: verein.id } });
		return { verein, leitung, jugendleiter, pfad, hole, aendere, lade, nimmLogoWeg, logo };
	}

	it('Leitung liest alle vier Felder und ein neuer Anzeigename erscheint in GET /verein', async () => {
		const v = await neuerVerein();
		const r = await v.hole();
		expect(r.status).toBe(200);
		expect((await r.json()) as Einstellungen).toEqual({
			slug: v.verein.slug,
			name: v.verein.name,
			anzeigename: 'Jungfischer Test',
			kontakt: null,
			farbe: '#0f766e',
			logoStand: null,
		});

		const neu = {
			name: 'Fischereiverein Neu e.V.',
			anzeigename: 'Neu',
			kontakt: 'Erika Muster, 0170 1234',
			farbe: '#1d4ed8',
		};
		const p = await v.aendere(neu);
		expect(p.status).toBe(200);
		const erwartet = { slug: v.verein.slug, ...neu, logoStand: null };
		expect(await p.json()).toEqual(erwartet);
		expect(await (await v.hole()).json()).toEqual(erwartet);

		const oeffentlich = await fetch(`${server.url}${v.pfad('/verein')}`);
		expect(((await oeffentlich.json()) as { anzeigename: string; farbe: string }).anzeigename).toBe('Neu');
	});

	it('speichert ohne Rand, normalisiert die Farbe und macht einen leeren Kontakt zu null', async () => {
		const v = await neuerVerein();
		await v.aendere({ kontakt: 'Jemand' });
		const r = await v.aendere({ name: '  Verein  ', anzeigename: ' Kurz ', kontakt: '   ', farbe: ' #1D4ED8 ' });
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ name: 'Verein', anzeigename: 'Kurz', kontakt: null, farbe: '#1d4ed8' });
		expect(await prisma.verein.findUniqueOrThrow({ where: { id: v.verein.id } })).toMatchObject({
			name: 'Verein',
			anzeigename: 'Kurz',
			kontakt: null,
			farbe: '#1d4ed8',
		});
	});

	it('ein Teil-PATCH laesst die uebrigen Felder stehen', async () => {
		const v = await neuerVerein();
		const r = await v.aendere({ anzeigename: 'Nur dieser' });
		expect(await r.json()).toMatchObject({ name: v.verein.name, anzeigename: 'Nur dieser', farbe: '#0f766e' });
	});

	it('Jugendleiter ohne EINSTELLUNGEN bekommt auf allen vier Routen 404', async () => {
		const v = await neuerVerein();
		const cookie = v.jugendleiter.cookie;
		expect((await v.hole(cookie)).status).toBe(404);
		expect((await v.aendere({ anzeigename: 'Gekapert' }, cookie)).status).toBe(404);
		expect((await v.lade(await png(), { cookie })).status).toBe(404);
		expect((await v.nimmLogoWeg(cookie)).status).toBe(404);
		expect((await prisma.verein.findUniqueOrThrow({ where: { id: v.verein.id } })).anzeigename).toBe(
			'Jungfischer Test',
		);
		expect(await v.logo()).toBeNull();
	});

	it('ohne Sitzung ist es auf allen vier Routen 401', async () => {
		const v = await neuerVerein();
		const ohne = (methode: string) => sende(server.url, v.pfad('/einstellungen'), { methode, body: {} });
		expect((await ohne('GET')).status).toBe(401);
		expect((await ohne('PATCH')).status).toBe(401);
		expect((await v.lade(await png(), { kopf: { Cookie: undefined } })).status).toBe(401);
		expect((await sende(server.url, v.pfad('/einstellungen/logo'), { methode: 'DELETE' })).status).toBe(401);
	});

	it('PATCH mit slug oder status ist 400, beide bleiben unveraendert', async () => {
		const v = await neuerVerein();
		for (const body of [{ slug: 'neu' }, { status: 'GESPERRT' }, { anzeigename: 'Gut', id: 'x' }, { foo: 1 }]) {
			const r = await v.aendere(body);
			expect(r.status, JSON.stringify(body)).toBe(400);
			const antwort = (await r.json()) as { fehler: string; feld: string };
			expect(antwort.feld).toBe(Object.keys(body).find((k) => k !== 'anzeigename'));
		}
		const verein = await prisma.verein.findUniqueOrThrow({ where: { id: v.verein.id } });
		expect([verein.slug, verein.status, verein.anzeigename]).toEqual([v.verein.slug, 'AKTIV', 'Jungfischer Test']);
	});

	it('PATCH mit einem Body, der kein Objekt ist, ist 400', async () => {
		const v = await neuerVerein();
		expect((await v.aendere([])).status).toBe(400);
	});

	it('ungueltige Werte sind 400 mit Text und feld, und es wird nichts geschrieben', async () => {
		const v = await neuerVerein();
		const faelle: { body: Record<string, unknown>; feld: string; fehler: string }[] = [
			{
				body: { anzeigename: 'x'.repeat(25) },
				feld: 'anzeigename',
				fehler: 'Der Anzeigename darf höchstens 24 Zeichen haben',
			},
			{ body: { anzeigename: '   ' }, feld: 'anzeigename', fehler: 'Bitte einen Anzeigenamen angeben' },
			{ body: { name: '' }, feld: 'name', fehler: 'Bitte den offiziellen Namen angeben' },
			{ body: { name: 7 }, feld: 'name', fehler: 'Bitte den offiziellen Namen angeben' },
			{ body: { name: 'x'.repeat(121) }, feld: 'name', fehler: 'Der offizielle Name darf höchstens 120 Zeichen haben' },
			{ body: { farbe: 'blau' }, feld: 'farbe', fehler: 'Bitte eine Farbe als #rrggbb angeben' },
			{ body: { farbe: '#fff' }, feld: 'farbe', fehler: 'Bitte eine Farbe als #rrggbb angeben' },
			{ body: { kontakt: 'x'.repeat(501) }, feld: 'kontakt', fehler: 'Der Kontakt darf höchstens 500 Zeichen haben' },
			{ body: { kontakt: 5 }, feld: 'kontakt', fehler: 'Der Kontakt darf höchstens 500 Zeichen haben' },
		];
		for (const f of faelle) {
			const r = await v.aendere({ ...f.body, farbe: f.feld === 'farbe' ? f.body['farbe'] : '#1d4ed8' });
			expect(r.status, JSON.stringify(f.body)).toBe(400);
			expect(await r.json()).toEqual({ fehler: f.fehler, feld: f.feld });
		}
		// Ein gueltiges Feld neben einem ungueltigen wird nicht allein uebernommen.
		const verein = await prisma.verein.findUniqueOrThrow({ where: { id: v.verein.id } });
		expect(verein.farbe).toBe('#0f766e');
		// 500 Zeichen sind erlaubt.
		expect((await v.aendere({ kontakt: 'x'.repeat(500) })).status).toBe(200);
	});

	it('Upload eines PNG legt das Logo an, ein zweiter ersetzt es und aendert logoStand', async () => {
		const v = await neuerVerein();
		const r = await v.lade(await png(64, 32, 200));
		expect(r.status).toBe(200);
		const { logoStand } = (await r.json()) as { logoStand: string };
		const erstes = await v.logo();
		expect(erstes).not.toBeNull();
		expect(logoStand).toBe(erstes?.geaendertAm.toISOString());
		expect(erstes?.mimeType).toBe('image/png');
		expect((await (await v.hole()).json()) as Einstellungen).toMatchObject({ logoStand });
		const oeffentlich = (await (await fetch(`${server.url}${v.pfad('/verein')}`)).json()) as { logoStand: string };
		expect(oeffentlich.logoStand).toBe(logoStand);

		// Die Uhr gehoert dem Test: den ersten Stand in die Vergangenheit legen, statt auf eine
		// neue Millisekunde zu warten. Der zweite Upload muss ihn dann sichtbar ueberholen.
		await prisma.vereinLogo.update({
			where: { vereinId: v.verein.id },
			data: { geaendertAm: new Date('2020-01-01T00:00:00Z') },
		});
		const zweites = await v.lade(await png(100, 50, 20));
		expect(zweites.status).toBe(200);
		const neuerStand = ((await zweites.json()) as { logoStand: string }).logoStand;
		expect(new Date(neuerStand).getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
		const ersetzt = await v.logo();
		expect(await prisma.vereinLogo.count({ where: { vereinId: v.verein.id } })).toBe(1);
		expect(neuerStand).toBe(ersetzt?.geaendertAm.toISOString());
		expect((await sharp(ersetzt?.bild).metadata()).width).toBe(100);
		expect(Buffer.compare(Buffer.from(ersetzt?.bild ?? []), Buffer.from(erstes?.bild ?? []))).not.toBe(0);
	});

	it('nimmt auch ein JPEG an und speichert es als JPEG', async () => {
		const v = await neuerVerein();
		const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
			.jpeg()
			.toBuffer();
		// Der Content-Type ist frei waehlbar; das Format bestimmt der Inhalt (verarbeiteLogo).
		expect((await v.lade(jpeg, { typ: 'image/jpeg' })).status).toBe(200);
		expect((await v.logo())?.mimeType).toBe('image/jpeg');
	});

	it('Text als image/png und Content-Type image/gif sind 415, das vorhandene Logo bleibt', async () => {
		const v = await neuerVerein();
		expect((await v.lade(await png())).status).toBe(200);
		const vorher = await v.logo();

		const text = await v.lade(Buffer.from('das ist kein Bild'));
		expect(text.status).toBe(415);
		expect(await text.json()).toEqual({ fehler: 'Bitte ein PNG- oder JPEG-Bild wählen' });

		const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
			.gif()
			.toBuffer();
		// Als GIF deklariert: der Parser liest den Body gar nicht erst.
		expect((await v.lade(gif, { typ: 'image/gif' })).status).toBe(415);
		// Als PNG getarnt: der Inhalt entscheidet.
		expect((await v.lade(gif)).status).toBe(415);
		// Ein leerer Body.
		expect((await v.lade(Buffer.alloc(0))).status).toBe(415);

		expect(await v.logo()).toEqual(vorher);
	});

	it('1,1 MB sind 413, das vorhandene Logo bleibt', async () => {
		const v = await neuerVerein();
		expect((await v.lade(await png())).status).toBe(200);
		const vorher = await v.logo();
		const r = await v.lade(Buffer.alloc(Math.round(1.1 * 1024 * 1024), 1));
		expect(r.status).toBe(413);
		expect(await r.json()).toEqual({ fehler: 'Das Bild ist zu groß (höchstens 1 MB)' });
		expect(await v.logo()).toEqual(vorher);
	});

	it('ein kleines Bild mit riesigen Massen ist 413', async () => {
		const v = await neuerVerein();
		const riesig = await sharp({ create: { width: 10_000, height: 10_000, channels: 3, background: '#fff' } })
			.png({ compressionLevel: 9, palette: true })
			.toBuffer();
		expect(riesig.length).toBeLessThan(1024 * 1024);
		expect((await v.lade(riesig)).status).toBe(413);
		expect(await v.logo()).toBeNull();
		// Das Bild mit 100 Megapixeln zu erzeugen und zu pruefen dauert unter der Last der parallelen Serverspecs
		// laenger als die fuenf Sekunden von Vitest; ohne eigenes Limit scheiterte das Deployment-Tor zufaellig.
	}, 30_000);

	it('DELETE entfernt das Logo, auch ohne vorhandenes', async () => {
		const v = await neuerVerein();
		const leer = await v.nimmLogoWeg();
		expect(leer.status).toBe(200);
		expect(await leer.json()).toEqual({ logoStand: null });

		await v.lade(await png());
		expect(await v.logo()).not.toBeNull();
		const r = await v.nimmLogoWeg();
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ logoStand: null });
		expect(await v.logo()).toBeNull();
		expect(((await (await v.hole()).json()) as Einstellungen).logoStand).toBeNull();
	});

	it('ein Upload ohne Origin ist 403 und aendert nichts', async () => {
		const v = await neuerVerein();
		const r = await v.lade(await png(), { kopf: { Origin: undefined } });
		expect(r.status).toBe(403);
		expect(await v.logo()).toBeNull();
	});

	it('ohne das Recht wird abgelehnt, bevor der Body gelesen wird: 1,1 MB ergibt 404 statt 413', async () => {
		const v = await neuerVerein();
		const r = await v.lade(Buffer.alloc(Math.round(1.1 * 1024 * 1024), 1), { cookie: v.jugendleiter.cookie });
		expect(r.status).toBe(404);
		expect(await v.logo()).toBeNull();
	});
});
