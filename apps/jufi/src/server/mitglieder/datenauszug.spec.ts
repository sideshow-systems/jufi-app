import { createPrismaClientFromEnv } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeThreadAn, ordneZu } from '../threads/test-threads.js';
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
		// Drei Codes, einer davon verbraucht: "unbenutzt" zaehlt nur die offenen.
		const codeHashes = [`code-${randomUUID()}`, `code-${randomUUID()}`, `code-${randomUUID()}`, `code-${randomUUID()}`];
		await prisma.recoveryCode.createMany({
			data: codeHashes.map((codeHash, i) => ({
				vereinId: verein.id,
				zugangId: mutter.zugangId,
				codeHash,
				verwendetAm: i === 0 ? new Date('2026-10-05T10:00:00.000Z') : null,
			})),
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
		return { verein, api, mutter, kind, zweiteSitzung, codeHashes, hole };
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
			// Wie jugendsprecher: Die Angaben zum Zugang und zur Volljaehrigkeit gibt es nur bei Jungfischern.
			zugangErlaubt: null,
			volljaehrigGeprueftAm: null,
			rechte: ['MITGLIEDER'],
			angelegtAm: expect.any(String),
		});
		expect(auszug.zugang).toEqual({
			anmeldename: null,
			passwortGesetzt: true,
			totpAktiv: true,
			totpAktivAm: '2026-09-01T10:00:00.000Z',
			angelegtAm: expect.any(String),
			letzteAnmeldungAm: '2026-10-18T22:30:00.000Z',
		});
		// Nur ob und wie viele, nie die Codes selbst.
		expect(auszug.wiederherstellungscodes).toEqual({ eingerichtet: true, unbenutzt: 3 });
		expect(auszug.offeneEinladungen).toEqual([]);
		expect(auszug.passkeys).toEqual([
			{ name: 'iPhone', angelegtAm: '2026-08-01T08:00:00.000Z', zuletztGenutztAm: '2026-10-01T08:00:00.000Z' },
		]);
		expect(auszug.sitzungen).toHaveLength(2);
		expect(auszug.sitzungen).toContainEqual({
			angelegtAm: expect.any(String),
			zuletztGesehen: '2026-10-10T00:00:00.000Z',
			ablauf: '2027-01-01T00:00:00.000Z',
			geraet: 'iPhone',
		});
		expect(auszug.sitzungen).toContainEqual({
			angelegtAm: '2026-10-18T22:30:00.000Z',
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
				angelegtAm: expect.any(String),
				zugangErlaubt: true,
				volljaehrigGeprueftAm: null,
				offeneEinladungen: [],
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
			zugangErlaubt: true,
			volljaehrigGeprueftAm: null,
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
				angelegtAm: expect.any(String),
				// Zugang und Einladungen der Mutter gehen das Kind nichts an.
				zugangErlaubt: null,
				volljaehrigGeprueftAm: null,
				offeneEinladungen: null,
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

	it('eine Foto-Einwilligung steht mit ihrer Art neben der DSGVO-Einwilligung, bei Mutter und Kind', async () => {
		const f = await neueFamilie();
		await prisma.einwilligung.create({
			data: {
				vereinId: f.verein.id,
				jungfischerId: f.kind.personId,
				erteiltVon: f.mutter.personId,
				art: 'FOTOS',
				textVersion: '1',
				erteiltAm: new Date('2026-09-20T09:00:00.000Z'),
				widerrufenAm: new Date('2026-10-03T09:00:00.000Z'),
			},
		});
		const alsMutter = await (await f.hole(f.mutter.cookie)).json();
		expect(alsMutter.einwilligungen).toEqual([
			{
				kind: 'Kai Muster',
				art: 'DSGVO_ART8',
				textVersion: 'v1',
				erteiltAm: '2026-09-15T09:00:00.000Z',
				widerrufenAm: null,
				erteiltVon: 'ich',
			},
			{
				kind: 'Kai Muster',
				art: 'FOTOS',
				textVersion: '1',
				erteiltAm: '2026-09-20T09:00:00.000Z',
				widerrufenAm: '2026-10-03T09:00:00.000Z',
				erteiltVon: 'ich',
			},
		]);
		const alsKind = await (await f.hole(f.kind.cookie)).json();
		expect(alsKind.einwilligungen.map((e: { art: string; erteiltVon: string }) => [e.art, e.erteiltVon])).toEqual([
			['DSGVO_ART8', 'Mara Muster'],
			['FOTOS', 'Mara Muster'],
		]);
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

	it('Wiederherstellungscodes: nur ob und wie viele, weder Code noch Hash', async () => {
		const f = await neueFamilie();
		const text = await (await f.hole(f.mutter.cookie)).text();
		expect(JSON.parse(text).wiederherstellungscodes).toEqual({ eingerichtet: true, unbenutzt: 3 });
		for (const hash of f.codeHashes) expect(text).not.toContain(hash);
		expect(text).not.toContain('codeHash');
		// Ohne Codes (Zugang ohne TOTP): eingerichtet false, nicht fehlend.
		const kind = JSON.parse(await (await f.hole(f.kind.cookie)).text());
		expect(kind.wiederherstellungscodes).toEqual({ eingerichtet: false, unbenutzt: 0 });
	});

	it('offene Einladungen: eigene und die der Kinder mit Erzeugung und Ablauf, nie Token oder Hash', async () => {
		const f = await neueFamilie();
		const mara = await prisma.einladung.create({
			data: {
				vereinId: f.verein.id,
				personId: f.mutter.personId,
				art: 'RESET',
				tokenHash: `token-hash-${randomUUID()}`,
				ablauf: new Date('2026-10-20T12:00:00.000Z'),
				angelegtAm: new Date('2026-10-18T12:00:00.000Z'),
			},
		});
		const kai = await prisma.einladung.create({
			data: {
				vereinId: f.verein.id,
				personId: f.kind.personId,
				art: 'EINLADUNG',
				tokenHash: `token-hash-${randomUUID()}`,
				ablauf: new Date('2026-10-25T12:00:00.000Z'),
				angelegtAm: new Date('2026-10-17T12:00:00.000Z'),
			},
		});
		// Nicht offen: eingeloest, abgelaufen. Beides gehoert nicht in "offen".
		const unwichtig = await prisma.einladung.createManyAndReturn({
			data: [
				{
					vereinId: f.verein.id,
					personId: f.kind.personId,
					art: 'RESET',
					tokenHash: `token-hash-${randomUUID()}`,
					ablauf: new Date('2026-10-30T12:00:00.000Z'),
					eingeloestAm: new Date('2026-10-16T12:00:00.000Z'),
				},
				{
					vereinId: f.verein.id,
					personId: f.mutter.personId,
					art: 'EINLADUNG',
					tokenHash: `token-hash-${randomUUID()}`,
					ablauf: new Date('2026-10-18T22:29:59.000Z'),
				},
			],
		});
		// Einladung einer fremden Person im selben Verein: gehoert nicht in diesen Auszug.
		const fremd = await legeMitgliedAn(prisma, f.verein, { art: 'ERWACHSENER' });
		const fremdEinladung = await prisma.einladung.create({
			data: {
				vereinId: f.verein.id,
				personId: fremd.personId,
				art: 'EINLADUNG',
				tokenHash: `token-hash-${randomUUID()}`,
				ablauf: new Date('2026-11-01T12:00:00.000Z'),
				angelegtAm: new Date('2026-10-01T01:02:03.000Z'),
			},
		});

		const text = await (await f.hole(f.mutter.cookie)).text();
		const auszug = JSON.parse(text);
		expect(auszug.offeneEinladungen).toEqual([
			{ art: 'RESET', angelegtAm: '2026-10-18T12:00:00.000Z', ablauf: '2026-10-20T12:00:00.000Z' },
		]);
		expect(auszug.familie[0].offeneEinladungen).toEqual([
			{ art: 'EINLADUNG', angelegtAm: '2026-10-17T12:00:00.000Z', ablauf: '2026-10-25T12:00:00.000Z' },
		]);
		for (const e of [mara, kai, fremdEinladung, ...unwichtig]) {
			expect(text).not.toContain(e.tokenHash);
			expect(text).not.toContain(e.id);
		}
		expect(text).not.toContain('tokenHash');
		expect(text).not.toContain('2026-10-01T01:02:03');
	});

	it('Zugang gesperrt und Volljaehrigkeit geprueft: beim Kind und in der Familie der Mutter', async () => {
		const f = await neueFamilie();
		await prisma.person.update({
			where: { id: f.kind.personId },
			data: { zugangErlaubt: false, volljaehrigGeprueftAm: new Date('2026-10-12T08:00:00.000Z') },
		});
		// Die Sitzung des Kindes zaehlt bei gesperrtem Zugang nicht mehr; die Mutter sieht den Stand trotzdem.
		const mutter = await (await f.hole(f.mutter.cookie)).json();
		expect(mutter.familie[0]).toMatchObject({
			rolle: 'kind',
			zugangErlaubt: false,
			volljaehrigGeprueftAm: '2026-10-12T08:00:00.000Z',
		});
		await prisma.person.update({ where: { id: f.kind.personId }, data: { zugangErlaubt: true } });
		const kind = await (await f.hole(f.kind.cookie)).json();
		expect(kind.person).toMatchObject({ zugangErlaubt: true, volljaehrigGeprueftAm: '2026-10-12T08:00:00.000Z' });
	});

	describe('Linkstand und Volljaehrigkeitspruefung des Kindes nur fuer Erziehungsberechtigte eines Minderjaehrigen', () => {
		async function mitOffenerEinladungDesKindes(f: Awaited<ReturnType<typeof neueFamilie>>) {
			await prisma.person.update({
				where: { id: f.kind.personId },
				data: { volljaehrigGeprueftAm: new Date('2026-10-12T08:00:00.000Z') },
			});
			await prisma.einladung.create({
				data: {
					vereinId: f.verein.id,
					personId: f.kind.personId,
					art: 'RESET',
					tokenHash: `token-hash-${randomUUID()}`,
					ablauf: new Date('2026-10-25T12:00:00.000Z'),
					angelegtAm: new Date('2026-10-17T12:00:00.000Z'),
				},
			});
		}

		it('Grossmutter ohne Erziehungsberechtigung: beim Enkel null, der Zugangsstand bleibt', async () => {
			const f = await neueFamilie();
			await mitOffenerEinladungDesKindes(f);
			const oma = await legeMitgliedAn(prisma, f.verein, { art: 'ERWACHSENER', vorname: 'Olga', nachname: 'Muster' });
			await prisma.bezugsperson.create({
				data: {
					vereinId: f.verein.id,
					erwachsenerId: oma.personId,
					jungfischerId: f.kind.personId,
					beziehung: 'GROSSMUTTER',
					erziehungsberechtigt: false,
				},
			});
			const text = await (await f.hole(oma.cookie)).text();
			const auszug = JSON.parse(text);
			expect(auszug.familie).toEqual([
				expect.objectContaining({
					rolle: 'kind',
					zugangErlaubt: true,
					volljaehrigGeprueftAm: null,
					offeneEinladungen: null,
				}),
			]);
			expect(text).not.toContain('2026-10-17T12:00:00');
			expect(text).not.toContain('2026-10-12T08:00:00');
		});

		it('Mutter eines volljaehrigen Kindes: ebenfalls null', async () => {
			const f = await neueFamilie();
			await mitOffenerEinladungDesKindes(f);
			// Am Berliner Abend des 18.10.2026 ist ein Kind mit Geburtstag 2008-10-18 gerade volljaehrig geworden.
			await prisma.person.update({ where: { id: f.kind.personId }, data: { geburtsdatum: new Date('2008-10-18') } });
			const auszug = await (await f.hole(f.mutter.cookie)).json();
			expect(auszug.familie).toEqual([
				expect.objectContaining({
					rolle: 'kind',
					zugangErlaubt: true,
					volljaehrigGeprueftAm: null,
					offeneEinladungen: null,
				}),
			]);
		});

		it('erziehungsberechtigte Mutter eines Minderjaehrigen sieht beides weiterhin', async () => {
			const f = await neueFamilie();
			await mitOffenerEinladungDesKindes(f);
			const auszug = await (await f.hole(f.mutter.cookie)).json();
			expect(auszug.familie).toEqual([
				expect.objectContaining({
					rolle: 'kind',
					volljaehrigGeprueftAm: '2026-10-12T08:00:00.000Z',
					offeneEinladungen: [
						{ art: 'RESET', angelegtAm: '2026-10-17T12:00:00.000Z', ablauf: '2026-10-25T12:00:00.000Z' },
					],
				}),
			]);
		});
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

	describe('Antworten, Nachrichten und Gelesen in Threads', () => {
		/** Antwort direkt in der Datenbank; die Routen und ihre Regeln pruefen die Tests unter threads/. */
		const antworte = async (
			verein: { id: string },
			umfrageId: string,
			fuerId: string,
			vonId: string,
			optionIds: string[],
			abgegebenAm: string,
		) => {
			const antwort = await prisma.umfrageAntwort.create({
				data: {
					vereinId: verein.id,
					umfrageId,
					fuerId,
					vonId,
					abgegebenAm: new Date(abgegebenAm),
					clientId: randomUUID(),
				},
			});
			// Zweiter Schritt statt verschachteltem create: Die zusammengesetzten Fremdschluessel verlangen die vereinId.
			await prisma.umfrageAntwortOption.createMany({
				data: optionIds.map((optionId) => ({ vereinId: verein.id, umfrageId, antwortId: antwort.id, optionId })),
			});
			return antwort;
		};

		/** Mutter Mara mit Kai (aus neueFamilie) und Lea, dazu ein fremdes Kind Finn, eine Leitung und ein Thread mit zwei Umfragen. */
		async function mitThread() {
			const f = await neueFamilie();
			const lea = await legeMitgliedAn(prisma, f.verein, { art: 'JUNGFISCHER', vorname: 'Lea', nachname: 'Muster' });
			const finn = await legeMitgliedAn(prisma, f.verein, { art: 'JUNGFISCHER', vorname: 'Finn', nachname: 'Fremd' });
			await ordneZu(prisma, f.verein, f.mutter.personId, lea.personId);
			const leitung = await legeMitgliedAn(prisma, f.verein, {
				art: 'ERWACHSENER',
				vorname: 'Lena',
				nachname: 'Leitung',
				rechte: ['JUGENDLEITER_RECHTE'],
			});
			const t = await legeThreadAn(prisma, f.verein, jetzt, {
				titel: 'Zeltlager',
				module: [
					{
						typ: 'UMFRAGE',
						frage: 'Wer kocht?',
						einheit: 'ERWACHSENER',
						mehrfach: true,
						optionen: ['Frueh', 'Mittag', 'Abend'],
					},
					{ typ: 'UMFRAGE', frage: 'Kommt ihr mit?', teilnahme: true },
				],
			});
			return { ...f, lea, finn, leitung, t, kocht: t.modulIds[0] as string, mit: t.modulIds[1] as string };
		}

		type Auszug = {
			antworten: {
				thread: string;
				frage: string;
				optionen: string[];
				fuer: string;
				von: string;
				abgegebenAm: string;
			}[];
			nachrichten: { thread: string; zeit: string; text: string | null }[];
			gelesen: { thread: string; zeit: string }[];
		};
		const lade = async (f: { hole: (c?: string) => Promise<Response> }, cookie: string) =>
			(await (await f.hole(cookie)).json()) as Auszug;

		it('Antworten: eigene, fuer Kinder von der Mutter und vom Kind selbst; Positionsreihenfolge; nicht die eines fremden Kinds', async () => {
			const f = await mitThread();
			const o = f.t.optionIds;
			// Mehrfachauswahl absichtlich gegen die Positionsreihenfolge angelegt.
			await antworte(
				f.verein,
				f.kocht,
				f.mutter.personId,
				f.mutter.personId,
				[o['abend']!, o['frueh']!],
				'2026-10-10T10:00:00.000Z',
			);
			await antworte(f.verein, f.mit, f.kind.personId, f.mutter.personId, [o['dabei']!], '2026-10-11T10:00:00.000Z');
			await antworte(f.verein, f.mit, f.lea.personId, f.lea.personId, [o['abgesagt']!], '2026-10-09T10:00:00.000Z');
			await antworte(f.verein, f.mit, f.finn.personId, f.finn.personId, [o['dabei']!], '2026-10-12T10:00:00.000Z');

			const auszug = await lade(f, f.mutter.cookie);
			expect(auszug.antworten).toEqual([
				{
					thread: 'Zeltlager',
					frage: 'Kommt ihr mit?',
					optionen: ['Abgesagt'],
					fuer: 'Lea Muster',
					von: 'Lea Muster',
					abgegebenAm: '2026-10-09T10:00:00.000Z',
				},
				{
					thread: 'Zeltlager',
					frage: 'Wer kocht?',
					optionen: ['Frueh', 'Abend'],
					fuer: 'ich',
					von: 'ich',
					abgegebenAm: '2026-10-10T10:00:00.000Z',
				},
				{
					thread: 'Zeltlager',
					frage: 'Kommt ihr mit?',
					optionen: ['Dabei'],
					fuer: 'Kai Muster',
					von: 'ich',
					abgegebenAm: '2026-10-11T10:00:00.000Z',
				},
			]);
		});

		it('Leitung, die fuer ein fremdes Kind nachgetragen hat: die Antwort fehlt', async () => {
			const f = await mitThread();
			await antworte(
				f.verein,
				f.mit,
				f.finn.personId,
				f.leitung.personId,
				[f.t.optionIds['dabei']!],
				'2026-10-12T10:00:00.000Z',
			);
			expect((await lade(f, f.leitung.cookie)).antworten).toEqual([]);
			// Das Kind selbst bekommt sie in seinem Auszug, auch wenn ein anderer sie eingetragen hat.
			const kind = await legeMitgliedAn(prisma, f.verein, { art: 'JUNGFISCHER' });
			await antworte(
				f.verein,
				f.mit,
				kind.personId,
				f.leitung.personId,
				[f.t.optionIds['dabei']!],
				'2026-10-13T10:00:00.000Z',
			);
			const eigene = (await lade(f, kind.cookie)).antworten;
			expect(eigene).toHaveLength(1);
			expect(eigene[0]).toMatchObject({ fuer: 'ich', von: 'Lena Leitung' });
		});

		it('Antwort, die eine inzwischen entfernte Leitung fuer das Kind eingetragen hat: von heisst "(entfernte Person)"', async () => {
			const f = await mitThread();
			await antworte(
				f.verein,
				f.mit,
				f.kind.personId,
				f.leitung.personId,
				[f.t.optionIds['dabei']!],
				'2026-10-11T10:00:00.000Z',
			);
			// Grabstein wie oben: Namen geleert, entferntAm gesetzt (Spec 5.8); die Antwort bleibt stehen.
			await prisma.person.update({
				where: { id: f.leitung.personId },
				data: { vorname: '', nachname: '', email: null, rechte: [], entferntAm: jetzt },
			});
			const antworten = (await lade(f, f.mutter.cookie)).antworten;
			expect(antworten).toHaveLength(1);
			expect(antworten[0]).toMatchObject({ fuer: 'Kai Muster', von: '(entfernte Person)' });
		});

		it('Nachrichten: eigene mit Text, eigene geloeschte als null; fremde und Systemeintraege fehlen', async () => {
			const f = await mitThread();
			const eintrag = (data: object) =>
				prisma.verlaufEintrag.create({
					data: { vereinId: f.verein.id, threadId: f.t.threadId, stand: 1, ...data } as never,
				});
			await eintrag({
				art: 'NACHRICHT',
				autorId: f.mutter.personId,
				text: 'Wir bringen Kuchen mit',
				angelegtAm: new Date('2026-10-15T10:00:00.000Z'),
				clientId: randomUUID(),
			});
			await eintrag({
				art: 'NACHRICHT',
				autorId: f.mutter.personId,
				text: null,
				geloeschtAm: new Date('2026-10-14T12:00:00.000Z'),
				geloeschtVonId: f.leitung.personId,
				angelegtAm: new Date('2026-10-14T10:00:00.000Z'),
				clientId: randomUUID(),
			});
			await eintrag({
				art: 'NACHRICHT',
				autorId: f.leitung.personId,
				text: 'Fremder Text',
				angelegtAm: new Date('2026-10-16T10:00:00.000Z'),
				clientId: randomUUID(),
			});
			await eintrag({
				art: 'SYSTEM',
				autorId: f.mutter.personId,
				systemArt: 'VEROEFFENTLICHT',
				angelegtAm: new Date('2026-10-17T10:00:00.000Z'),
			});

			const text = await (await f.hole(f.mutter.cookie)).text();
			const auszug = JSON.parse(text) as Auszug;
			expect(auszug.nachrichten).toEqual([
				{ thread: 'Zeltlager', zeit: '2026-10-14T10:00:00.000Z', text: null },
				{ thread: 'Zeltlager', zeit: '2026-10-15T10:00:00.000Z', text: 'Wir bringen Kuchen mit' },
			]);
			expect(text).not.toContain('Fremder Text');
		});

		it('Gelesen: Thread-Titel und gelesenAm als ISO, nur die eigenen Staende', async () => {
			const f = await mitThread();
			await prisma.gelesenStand.createMany({
				data: [
					{
						vereinId: f.verein.id,
						personId: f.mutter.personId,
						threadId: f.t.threadId,
						gelesenBis: 3,
						verlaufGelesenBis: 2,
						gelesenAm: new Date('2026-10-16T08:00:00.000Z'),
					},
					{
						vereinId: f.verein.id,
						personId: f.leitung.personId,
						threadId: f.t.threadId,
						gelesenBis: 3,
						verlaufGelesenBis: 2,
						gelesenAm: new Date('2026-10-17T08:00:00.000Z'),
					},
				],
			});
			expect((await lade(f, f.mutter.cookie)).gelesen).toEqual([
				{ thread: 'Zeltlager', zeit: '2026-10-16T08:00:00.000Z' },
			]);
		});

		it('ohne Threads sind alle drei Listen leer; weder Antwort-id noch clientId stehen im Auszug', async () => {
			const leer = await neueFamilie();
			expect(await lade(leer, leer.mutter.cookie)).toMatchObject({ antworten: [], nachrichten: [], gelesen: [] });

			const f = await mitThread();
			const a = await antworte(
				f.verein,
				f.mit,
				f.mutter.personId,
				f.mutter.personId,
				[f.t.optionIds['dabei']!],
				'2026-10-10T10:00:00.000Z',
			);
			const text = await (await f.hole(f.mutter.cookie)).text();
			expect(text).toContain('Kommt ihr mit?');
			expect(text).not.toContain(a.id);
			expect(text).not.toContain(a.clientId);
		});
	});
});
