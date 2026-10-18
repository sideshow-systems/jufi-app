import { createPrismaClientFromEnv } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

describe('Meine Daten herunterladen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	// 22:30 UTC ist in Berlin (Sommerzeit) schon der 19.: Der Dateiname soll den Berliner Tag tragen.
	const jetzt = new Date('2026-10-18T22:30:00.000Z');

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => jetzt,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eine Familie in einem eigenen Verein: Mutter Mara mit Passkey, Passwort, TOTP, zwei Sitzungen; Kind Kai in einer Untergruppe. */
	async function neueFamilie() {
		const verein = await legeVereinAn(prisma, { slug: `daten-${randomUUID().slice(0, 8)}` });
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const mutter = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			vorname: 'Mara',
			nachname: 'Muster',
			email: `mara-${randomUUID().slice(0, 6)}@example.test`,
			passwort: 'ein-erfundenes-passwort-123',
			rechte: ['MITGLIEDER'],
			jetzt,
		});
		const kind = await legeMitgliedAn(prisma, verein, {
			art: 'JUNGFISCHER',
			vorname: 'Kai',
			nachname: 'Muster',
			jetzt,
		});
		await prisma.zugang.update({
			where: { id: mutter.zugangId },
			data: { totpAktivAm: new Date('2026-09-01T10:00:00.000Z'), totpGeheimnis: 'geheim-verschluesselt-xyz' },
		});
		await prisma.passkey.create({
			data: {
				vereinId: verein.id,
				zugangId: mutter.zugangId,
				credentialId: `cred-${randomUUID()}`,
				publicKey: `pk-${randomUUID()}`,
				counter: 7,
				label: 'iPhone',
				createdAt: new Date('2026-08-01T08:00:00.000Z'),
				lastUsedAt: new Date('2026-10-01T08:00:00.000Z'),
			},
		});
		// Zweite Sitzung mit User-Agent, die erste (aus legeMitgliedAn) ohne.
		const zweiteSitzung = await prisma.session.create({
			data: {
				vereinId: verein.id,
				zugangId: mutter.zugangId,
				tokenHash: `hash-${randomUUID()}`,
				ablauf: new Date('2027-01-01T00:00:00.000Z'),
				zuletztGesehen: new Date('2026-10-10T00:00:00.000Z'),
				userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
			},
		});
		await prisma.bezugsperson.create({
			data: {
				vereinId: verein.id,
				erwachsenerId: mutter.personId,
				jungfischerId: kind.personId,
				beziehung: 'MUTTER',
				erziehungsberechtigt: true,
			},
		});
		const gruppe = await prisma.untergruppe.create({ data: { vereinId: verein.id, name: 'Forellen' } });
		await prisma.untergruppeMitglied.create({
			data: { vereinId: verein.id, untergruppeId: gruppe.id, personId: kind.personId },
		});
		await prisma.einwilligung.create({
			data: {
				vereinId: verein.id,
				jungfischerId: kind.personId,
				erteiltVon: mutter.personId,
				art: 'DSGVO_ART8',
				textVersion: 'v1',
				erteiltAm: new Date('2026-09-15T09:00:00.000Z'),
			},
		});
		const hole = (cookie?: string, slug = verein.slug) => sende(server.url, `/${slug}/api/v1/ich/daten`, { cookie });
		return { verein, api, mutter, kind, zweiteSitzung, hole };
	}

	it('Mutter: alle Felder sind befuellt und der Antwortkopf passt', async () => {
		const f = await neueFamilie();
		const r = await f.hole(f.mutter.cookie);
		expect(r.status).toBe(200);
		expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(r.headers.get('content-disposition')).toBe(
			`attachment; filename="jufi-meine-daten-${f.verein.slug}-2026-10-19.json"`,
		);
		expect(r.headers.get('cache-control')).toBe('no-store');
		const auszug = JSON.parse(await r.text());
		expect(auszug.erstelltAm).toBe('2026-10-18T22:30:00.000Z');
		expect(auszug.verein).toEqual({ name: expect.any(String), anzeigename: expect.any(String) });
		expect(auszug.person).toEqual({
			vorname: 'Mara',
			nachname: 'Muster',
			art: 'ERWACHSENER',
			geburtsdatum: null,
			email: expect.stringMatching(/^mara-.*@example\.test$/),
			// Nur bei Jungfischern gibt es die Angabe; bei Erwachsenen ist sie keine Antwort "nein".
			jugendsprecher: null,
			rechte: ['MITGLIEDER'],
			angelegtAm: expect.any(String),
		});
		expect(auszug.zugang).toEqual({
			anmeldename: null,
			passwortGesetzt: true,
			totpAktiv: true,
			angelegtAm: expect.any(String),
			letzteAnmeldungAm: '2026-10-18T22:30:00.000Z',
		});
		expect(auszug.passkeys).toEqual([
			{ name: 'iPhone', angelegtAm: '2026-08-01T08:00:00.000Z', zuletztGenutztAm: '2026-10-01T08:00:00.000Z' },
		]);
		expect(auszug.sitzungen).toHaveLength(2);
		expect(auszug.sitzungen).toContainEqual({
			zuletztGesehen: '2026-10-10T00:00:00.000Z',
			ablauf: '2027-01-01T00:00:00.000Z',
			geraet: 'iPhone',
		});
		expect(auszug.sitzungen).toContainEqual({
			zuletztGesehen: '2026-10-18T22:30:00.000Z',
			ablauf: expect.any(String),
			geraet: null,
		});
		expect(auszug.familie).toEqual([
			{
				vorname: 'Kai',
				nachname: 'Muster',
				beziehung: 'MUTTER',
				beziehungFreitext: null,
				erziehungsberechtigt: true,
				rolle: 'kind',
			},
		]);
		expect(auszug.untergruppen).toEqual([]);
		expect(auszug.einwilligungen).toEqual([
			{
				kind: 'Kai Muster',
				art: 'DSGVO_ART8',
				textVersion: 'v1',
				erteiltAm: '2026-09-15T09:00:00.000Z',
				widerrufenAm: null,
				erteiltVon: 'ich',
			},
		]);
	});

	it('Kind: Untergruppe, Geburtsdatum, Bezugsperson und die Einwilligung der Mutter mit ihrem Namen', async () => {
		const f = await neueFamilie();
		const auszug = await (await f.hole(f.kind.cookie)).json();
		expect(auszug.person).toMatchObject({
			art: 'JUNGFISCHER',
			geburtsdatum: '2015-05-05',
			jugendsprecher: false,
			rechte: [],
		});
		expect(auszug.untergruppen).toEqual(['Forellen']);
		expect(auszug.familie).toEqual([
			{
				vorname: 'Mara',
				nachname: 'Muster',
				beziehung: 'MUTTER',
				beziehungFreitext: null,
				erziehungsberechtigt: true,
				rolle: 'bezugsperson',
			},
		]);
		expect(auszug.einwilligungen).toEqual([
			expect.objectContaining({ kind: 'Kai Muster', erteiltVon: 'Mara Muster', widerrufenAm: null }),
		]);
		// Kind ohne Passwort und ohne Passkey: die Felder sagen es, statt zu fehlen.
		expect(auszug.zugang.passwortGesetzt).toBe(false);
		expect(auszug.zugang.totpAktiv).toBe(false);
		expect(auszug.zugang.anmeldename).toEqual(expect.stringMatching(/^kind-/));
		expect(auszug.passkeys).toEqual([]);
	});

	it('widerrufene Einwilligungen tragen den Zeitpunkt des Widerrufs', async () => {
		const f = await neueFamilie();
		await prisma.einwilligung.updateMany({
			where: { jungfischerId: f.kind.personId },
			data: { widerrufenAm: new Date('2026-10-02T12:00:00.000Z') },
		});
		const auszug = await (await f.hole(f.mutter.cookie)).json();
		expect(auszug.einwilligungen[0].widerrufenAm).toBe('2026-10-02T12:00:00.000Z');
	});

	it('enthaelt keine Geheimnisse und keinen Hash aus der Datenbank', async () => {
		const f = await neueFamilie();
		const zeile = await prisma.zugang.findUniqueOrThrow({
			where: { id: f.mutter.zugangId },
			include: { passkeys: true, sessions: true },
		});
		const text = await (await f.hole(f.mutter.cookie)).text();
		for (const schluessel of ['passwortHash', 'totpGeheimnis', 'tokenHash', 'publicKey', 'credentialId', 'counter']) {
			expect(text).not.toContain(schluessel);
		}
		// Stichprobe auf die Werte: ein umbenannter Schluessel liesse die Namenspruefung oben ins Leere laufen.
		expect(zeile.sessions.length).toBe(2);
		for (const s of zeile.sessions) expect(text).not.toContain(s.tokenHash);
		expect(text).not.toContain(zeile.passwortHash as string);
		expect(text).not.toContain(zeile.totpGeheimnis as string);
		expect(text).not.toContain(zeile.passkeys[0]?.publicKey as string);
		expect(text).not.toContain(zeile.passkeys[0]?.credentialId as string);
		// Das Cookie-Token ist der Klartext zum Hash der eigenen Sitzung und darf ebenso wenig auftauchen.
		expect(text).not.toContain(f.mutter.cookie.split('=')[1] as string);
	});

	it('ein entferntes Familienmitglied fehlt', async () => {
		const f = await neueFamilie();
		const zweites = await legeMitgliedAn(prisma, f.verein, { art: 'JUNGFISCHER', vorname: 'Lea', nachname: 'Muster' });
		await prisma.bezugsperson.create({
			data: {
				vereinId: f.verein.id,
				erwachsenerId: f.mutter.personId,
				jungfischerId: zweites.personId,
				beziehung: 'MUTTER',
				erziehungsberechtigt: true,
			},
		});
		expect(((await (await f.hole(f.mutter.cookie)).json()) as { familie: unknown[] }).familie).toHaveLength(2);
		// Grabstein: Namen geleert, entferntAm gesetzt (Spec 5.8).
		await prisma.person.update({
			where: { id: zweites.personId },
			data: { vorname: '', nachname: '', geburtsdatum: null, entferntAm: jetzt },
		});
		const auszug = await (await f.hole(f.mutter.cookie)).json();
		expect(auszug.familie.map((m: { vorname: string }) => m.vorname)).toEqual(['Kai']);
	});

	it('die Einwilligung einer entfernten Person erscheint mit Platzhalter statt leerem Namen', async () => {
		const f = await neueFamilie();
		await prisma.person.update({
			where: { id: f.mutter.personId },
			data: { vorname: '', nachname: '', email: null, rechte: [], entferntAm: jetzt },
		});
		const auszug = await (await f.hole(f.kind.cookie)).json();
		expect(auszug.einwilligungen).toEqual([
			expect.objectContaining({ kind: 'Kai Muster', erteiltVon: '(entfernte Person)' }),
		]);
	});

	it('Familie anderer Personen zeigt nur Name und Beziehung, keine Adresse und keine Rechte', async () => {
		const f = await neueFamilie();
		const text = await (await f.hole(f.kind.cookie)).text();
		const mutter = await prisma.person.findUniqueOrThrow({ where: { id: f.mutter.personId } });
		expect(text).not.toContain(mutter.email as string);
		expect(text).not.toContain('MITGLIEDER');
	});

	it('ohne Sitzung kommt 401', async () => {
		const f = await neueFamilie();
		const r = await f.hole();
		expect(r.status).toBe(401);
		expect(r.headers.get('content-disposition')).toBeNull();
	});

	it('mit dem Slug eines fremden Vereins kommt 401, die Sitzung gilt nur im eigenen', async () => {
		const f = await neueFamilie();
		const fremd = await legeVereinAn(prisma, { slug: `daten-${randomUUID().slice(0, 8)}` });
		expect((await f.hole(f.mutter.cookie, fremd.slug)).status).toBe(401);
	});
});
