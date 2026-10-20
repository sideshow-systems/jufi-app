import { generateLinkToken, hashToken } from '@jufi/auth';
import { createPrismaClientFromEnv, Recht } from '@jufi/db';
import { EINLADUNG_GUELTIG_MS } from '@jufi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { leitungsEinladungsText } from '../einladung.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { meldeAdminAn } from './test-admin.js';

const ALLE_RECHTE = Object.values(Recht);
const TAG_MS = 24 * 60 * 60 * 1000;

/** Ein gueltiger Body; die Tests aendern je ein Feld. Slug je Test eigen, die Datenbank ist geteilt. */
function neuerVerein(slug: string, aenderung: Record<string, unknown> = {}) {
	return {
		name: 'Fischereiverein Glonntal e.V.',
		anzeigename: 'Jungfischer Glonntal',
		slug,
		farbe: '#0f766e',
		leitung: { vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas.beispiel@example.org' },
		...aenderung,
	};
}

describe('Admin: Vereine anlegen und ansehen', () => {
	const prisma = createPrismaClientFromEnv();
	const uhr = new Date('2026-10-13T08:00:00Z');
	let server: TestServer;
	let cookie = '';
	let adminId = '';
	let benutzername = '';

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, jetzt: () => uhr }),
		);
		const angemeldet = await meldeAdminAn(prisma, uhr);
		cookie = angemeldet.cookie;
		adminId = angemeldet.admin.id;
		benutzername = angemeldet.admin.benutzername;
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	function lege(body: unknown) {
		return sende(server.url, '/admin/api/v1/vereine', { methode: 'POST', body, cookie });
	}

	function hole(pfad: string) {
		return sende(server.url, `/admin/api/v1${pfad}`, { cookie });
	}

	it('Verein anlegen legt Verein, erste Leitung mit allen Rechten, Einladung und Protokoll an', async () => {
		// Nicht glonntal-test: den Slug nimmt schon verein.spec.ts in derselben Datenbank.
		const r = await lege(neuerVerein('glonntal-anlegen'));
		expect(r.status).toBe(201);
		const body = (await r.json()) as { id: string; slug: string; einladung: { link: string; text: string } };
		expect(body.slug).toBe('glonntal-anlegen');
		expect(body.einladung.link.startsWith('http://jufi.test/glonntal-anlegen/einladung#')).toBe(true);
		expect(body.einladung.text).toBe(
			leitungsEinladungsText({ vorname: 'Thomas', anzeigename: 'Jungfischer Glonntal', link: body.einladung.link }),
		);
		const token = body.einladung.link.split('#')[1] ?? '';

		const verein = await prisma.verein.findUniqueOrThrow({ where: { id: body.id } });
		expect(verein).toMatchObject({
			slug: 'glonntal-anlegen',
			name: 'Fischereiverein Glonntal e.V.',
			anzeigename: 'Jungfischer Glonntal',
			farbe: '#0f766e',
			status: 'AKTIV',
		});

		const personen = await prisma.person.findMany({ where: { vereinId: verein.id } });
		expect(personen).toHaveLength(1);
		const leitung = personen[0];
		expect(leitung).toMatchObject({
			art: 'ERWACHSENER',
			vorname: 'Thomas',
			nachname: 'Beispiel',
			email: 'thomas.beispiel@example.org',
		});
		expect([...(leitung?.rechte ?? [])].sort()).toEqual([...ALLE_RECHTE].sort());

		const einladungen = await prisma.einladung.findMany({ where: { vereinId: verein.id } });
		expect(einladungen).toHaveLength(1);
		expect(einladungen[0]).toMatchObject({
			personId: leitung?.id,
			art: 'EINLADUNG',
			tokenHash: hashToken(token),
			ablauf: new Date(uhr.getTime() + EINLADUNG_GUELTIG_MS),
			eingeloestAm: null,
			erstelltVonPersonId: null,
		});

		// Jeder Verein bekommt seinen Austausch gleich beim Anlegen, nicht erst bei Bedarf.
		const threads = await prisma.thread.findMany({ where: { vereinId: verein.id } });
		expect(threads).toHaveLength(1);
		expect(threads[0]).toMatchObject({
			art: 'JUGENDSPRECHER_AUSTAUSCH',
			veroeffentlichtAm: uhr,
			erstelltVonId: null,
		});

		const protokoll = await prisma.adminProtokoll.findMany({ where: { vereinId: verein.id } });
		expect(protokoll).toHaveLength(1);
		expect(protokoll[0]).toMatchObject({
			adminId,
			aktion: 'VEREIN_ANGELEGT',
			vereinSlug: 'glonntal-anlegen',
			betroffenePersonId: leitung?.id,
			zeitpunkt: uhr,
		});
	});

	it('E-Mail wird normalisiert gespeichert', async () => {
		const r = await lege(
			neuerVerein('email-normal-test', {
				name: '  Fischereiverein Email e.V. ',
				anzeigename: ' Jungfischer Email ',
				farbe: ' #0F766E ',
				leitung: { vorname: ' Thomas ', nachname: ' Beispiel ', email: '  Thomas@Example.ORG ' },
			}),
		);
		expect(r.status).toBe(201);
		const { id } = (await r.json()) as { id: string };
		const verein = await prisma.verein.findUniqueOrThrow({ where: { id } });
		expect(verein).toMatchObject({
			name: 'Fischereiverein Email e.V.',
			anzeigename: 'Jungfischer Email',
			farbe: '#0f766e',
		});
		const leitung = await prisma.person.findFirstOrThrow({ where: { vereinId: id } });
		expect(leitung).toMatchObject({ vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas@example.org' });
	});

	it.each([
		['demo', 'Dieser Slug ist reserviert'],
		['admin', 'Dieser Slug ist reserviert'],
		['Kaputt_Slug', 'Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche'],
		['ab', '3 bis 30 Zeichen'],
	])('Slug demo, reservierter und kaputter Slug werden mit feld slug abgelehnt (%s)', async (slug, fehler) => {
		const r = await lege(neuerVerein(slug));
		expect(r.status).toBe(400);
		expect(await r.json()).toEqual({ fehler, feld: 'slug' });
		expect(await prisma.verein.count({ where: { slug } })).toBe(0);
	});

	it.each([
		[
			'zu langer Anzeigename',
			{ anzeigename: 'Jungfischer vom Glonntal!' },
			'anzeigename',
			'Höchstens 24 Zeichen, nicht leer',
		],
		['leerer Anzeigename', { anzeigename: '   ' }, 'anzeigename', 'Höchstens 24 Zeichen, nicht leer'],
		['leerer Name', { name: '' }, 'name', 'Bitte den offiziellen Namen angeben'],
		['Farbe #FFF', { farbe: '#FFF' }, 'farbe', 'Farbe als #rrggbb'],
		[
			'leerer Vorname',
			{ leitung: { vorname: ' ', nachname: 'Beispiel', email: 'thomas@example.org' } },
			'vorname',
			'Bitte ausfüllen',
		],
		[
			'fehlender Nachname',
			{ leitung: { vorname: 'Thomas', email: 'thomas@example.org' } },
			'nachname',
			'Bitte ausfüllen',
		],
		[
			'E-Mail ohne @',
			{ leitung: { vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas.example.org' } },
			'email',
			'Keine gültige E-Mail-Adresse',
		],
		['ohne Leitung', { leitung: 'Thomas' }, 'vorname', 'Bitte ausfüllen'],
		[
			'zu langer Vorname',
			{ leitung: { vorname: 'T'.repeat(101), nachname: 'Beispiel', email: 'thomas@example.org' } },
			'vorname',
			'Höchstens 100 Zeichen',
		],
		[
			'zu langer Nachname',
			{ leitung: { vorname: 'Thomas', nachname: 'B'.repeat(101), email: 'thomas@example.org' } },
			'nachname',
			'Höchstens 100 Zeichen',
		],
	])('%s ist 400 mit passendem feld', async (_fall, aenderung, feld, fehler) => {
		const r = await lege(neuerVerein('abgelehnt-test', aenderung));
		expect(r.status).toBe(400);
		expect(await r.json()).toEqual({ fehler, feld });
		expect(await prisma.verein.count({ where: { slug: 'abgelehnt-test' } })).toBe(0);
	});

	it('mehrere Fehler: gemeldet wird das erste Feld in fester Reihenfolge', async () => {
		const r = await lege(neuerVerein('demo', { farbe: 'rot', leitung: { vorname: '', nachname: '', email: 'x' } }));
		expect(await r.json()).toEqual({ fehler: 'Dieser Slug ist reserviert', feld: 'slug' });
	});

	it('gleichzeitig zweimal derselbe Slug: einmal 201, einmal 409', async () => {
		const antworten = await Promise.all([
			lege(neuerVerein('gleichzeitig-test')),
			lege(neuerVerein('gleichzeitig-test')),
		]);
		const ergebnisse = await Promise.all(antworten.map(async (r) => ({ status: r.status, body: await r.json() })));
		expect(ergebnisse.map((e) => e.status).sort()).toEqual([201, 409]);
		expect(ergebnisse.find((e) => e.status === 409)?.body).toEqual({
			fehler: 'Dieser Slug ist vergeben',
			feld: 'slug',
		});
		// Der Verlierer hinterlaesst nichts: keine zweite Leitung, kein zweites Protokoll.
		const verein = await prisma.verein.findUniqueOrThrow({ where: { slug: 'gleichzeitig-test' } });
		expect(await prisma.person.count({ where: { vereinId: verein.id } })).toBe(1);
		expect(await prisma.adminProtokoll.count({ where: { vereinSlug: 'gleichzeitig-test' } })).toBe(1);
	});

	it('Vereinsliste mit Kennzahlen', async () => {
		const verein = await legeVereinAn(prisma, { slug: 'kennzahlen-test', anzeigename: 'Kennzahlen' });
		const vereinId = verein.id;
		const jungfischer = (vorname: string) =>
			prisma.person.create({
				data: { vereinId, art: 'JUNGFISCHER', vorname, nachname: 'Erfunden', geburtsdatum: new Date('2013-04-01') },
			});
		await jungfischer('Anton');
		await jungfischer('Berta');
		// Grabstein (Spec 5.8): zaehlt nicht mehr mit.
		await prisma.person.create({
			data: { vereinId, art: 'JUNGFISCHER', vorname: '', nachname: '', entferntAm: new Date('2026-09-01') },
		});
		const erwachsener = await prisma.person.create({
			data: { vereinId, art: 'ERWACHSENER', vorname: 'Clara', nachname: 'Erfunden', rechte: ALLE_RECHTE },
		});
		await prisma.person.create({ data: { vereinId, art: 'ERWACHSENER', vorname: 'Dieter', nachname: 'Erfunden' } });
		// Die Kennzahl kommt vom Zugang, nicht von den Sitzungen: Sie bleibt, wenn
		// Sitzungen ablaufen oder beim Abmelden geloescht werden.
		const zugang = await prisma.zugang.create({
			data: { vereinId, personId: erwachsener.id, letzteAnmeldungAm: new Date('2026-10-01T10:00:00Z') },
		});
		// Juenger als die Anmeldung am Zugang, damit der Test eine Ableitung aus Sitzungen erwischt.
		// 23:30 UTC ist in Berlin (Sommerzeit) schon der naechste Tag.
		await prisma.session.create({
			data: {
				vereinId,
				zugangId: zugang.id,
				tokenHash: hashToken(generateLinkToken()),
				ablauf: new Date(uhr.getTime() + 90 * TAG_MS),
				angelegtAm: new Date('2026-10-12T23:30:00Z'),
			},
		});
		await prisma.session.create({
			data: {
				vereinId,
				zugangId: zugang.id,
				tokenHash: hashToken(generateLinkToken()),
				ablauf: new Date(uhr.getTime() + 90 * TAG_MS),
				angelegtAm: new Date('2026-10-01T10:00:00Z'),
			},
		});
		const einladung = (ablauf: Date) =>
			prisma.einladung.create({
				data: { vereinId, personId: erwachsener.id, art: 'RESET', tokenHash: hashToken(generateLinkToken()), ablauf },
			});
		await einladung(new Date(uhr.getTime() + TAG_MS));
		await einladung(new Date(uhr.getTime() - 1));

		const r = await hole('/vereine');
		expect(r.status).toBe(200);
		const { vereine } = (await r.json()) as {
			vereine: { id: string; slug: string; anzeigename: string; status: string; kennzahlen: unknown }[];
		};
		expect(vereine.find((v) => v.id === vereinId)).toEqual({
			id: vereinId,
			slug: 'kennzahlen-test',
			anzeigename: 'Kennzahlen',
			status: 'AKTIV',
			kennzahlen: { jungfischer: 2, erwachsene: 2, zugaenge: 1, offeneEinladungen: 1, letzteAnmeldung: '2026-10-01' },
		});
		const namen = vereine.map((v) => v.anzeigename);
		expect(namen).toEqual([...namen].sort((a, b) => a.localeCompare(b, 'de')));
	});

	it('Kennzahl letzte Anmeldung nimmt den juengsten Zugang und ist null ohne Anmeldung', async () => {
		const verein = await legeVereinAn(prisma, { slug: 'kennzahl-anmeldung', anzeigename: 'Anmeldung' });
		const vereinId = verein.id;
		const person = (vorname: string) =>
			prisma.person.create({ data: { vereinId, art: 'ERWACHSENER', vorname, nachname: 'Erfunden' } });
		const a = await person('Anna');
		const b = await person('Bert');
		const ohne = await prisma.zugang.create({ data: { vereinId, personId: a.id } });
		const abfrage = async () => {
			const { vereine } = (await (await hole('/vereine')).json()) as {
				vereine: { id: string; kennzahlen: { letzteAnmeldung: string | null } }[];
			};
			return vereine.find((v) => v.id === vereinId)?.kennzahlen.letzteAnmeldung;
		};

		// Nur eine Sitzung, keine Anmeldung am Zugang: noch nichts.
		await prisma.session.create({
			data: {
				vereinId,
				zugangId: ohne.id,
				tokenHash: hashToken(generateLinkToken()),
				ablauf: new Date(uhr.getTime() + 90 * TAG_MS),
				angelegtAm: new Date('2026-10-12T10:00:00Z'),
			},
		});
		expect(await abfrage()).toBeNull();

		await prisma.zugang.update({
			where: { id: ohne.id },
			data: { letzteAnmeldungAm: new Date('2026-09-01T10:00:00Z') },
		});
		await prisma.zugang.create({
			data: { vereinId, personId: b.id, letzteAnmeldungAm: new Date('2026-10-05T10:00:00Z') },
		});
		expect(await abfrage()).toBe('2026-10-05');
	});

	it('Vor- und Nachname mit genau 100 Zeichen werden angenommen', async () => {
		const r = await lege(
			neuerVerein('grenze-name-test', {
				leitung: { vorname: 'T'.repeat(100), nachname: 'B'.repeat(100), email: 'thomas@example.org' },
			}),
		);
		expect(r.status).toBe(201);
	});

	it('ein Verein ohne Admin-Einladung (Demo-artig) bietet keine Slug-Korrektur an', async () => {
		// Wie der Demo-Verein aus dem Seed: Verein und Leitung ohne Einladung, ohne Zugang.
		const verein = await legeVereinAn(prisma, { slug: 'ohne-einladung-test' });
		await prisma.person.create({
			data: {
				vereinId: verein.id,
				art: 'ERWACHSENER',
				vorname: 'Petra',
				nachname: 'Probe',
				rechte: ['JUGENDLEITER_RECHTE'],
			},
		});

		const details = (await (await hole(`/vereine/${verein.id}`)).json()) as Record<string, unknown>;
		expect(details['ersteLeitung']).toBeNull();
		// Die Korrektur antwortet hier 404; die Oberflaeche darf das Feld also nicht anbieten.
		expect(details['slugAenderbar']).toBe(false);
	});

	it('Vereinsdetails nennen nur Ansprechpartner', async () => {
		const angelegt = await lege(neuerVerein('details-test'));
		const { id } = (await angelegt.json()) as { id: string };
		const thomas = await prisma.person.findFirstOrThrow({ where: { vereinId: id } });
		const vereinId = id;
		await prisma.person.create({
			data: {
				vereinId,
				art: 'ERWACHSENER',
				vorname: 'Petra',
				nachname: 'Probe',
				email: 'petra.probe@example.org',
				rechte: ['JUGENDLEITER_RECHTE'],
			},
		});
		// Rechte ohne JUGENDLEITER_RECHTE: kein Ansprechpartner.
		await prisma.person.create({
			data: {
				vereinId,
				art: 'ERWACHSENER',
				vorname: 'Katrin',
				nachname: 'Muster',
				email: 'katrin.muster@example.org',
				rechte: ALLE_RECHTE.filter((r) => r !== 'JUGENDLEITER_RECHTE'),
			},
		});
		// Entfernt, aber mit Rechten (falls ein Grabstein sie behielte): kein Ansprechpartner.
		await prisma.person.create({
			data: {
				vereinId,
				art: 'ERWACHSENER',
				vorname: 'Otto',
				nachname: 'Fort',
				rechte: ['JUGENDLEITER_RECHTE'],
				entferntAm: new Date('2026-09-01'),
			},
		});

		const r = await hole(`/vereine/${id}`);
		expect(r.status).toBe(200);
		const details = (await r.json()) as Record<string, unknown> & {
			ansprechpartner: { vorname: string }[];
			protokoll: unknown[];
		};
		expect(details).toMatchObject({
			id,
			slug: 'details-test',
			name: 'Fischereiverein Glonntal e.V.',
			anzeigename: 'Jungfischer Glonntal',
			farbe: '#0f766e',
			status: 'AKTIV',
			kennzahlen: { jungfischer: 0, erwachsene: 3, zugaenge: 0, offeneEinladungen: 1, letzteAnmeldung: null },
			ersteLeitung: { personId: thomas.id, vorname: 'Thomas', nachname: 'Beispiel' },
			slugAenderbar: true,
		});
		expect(typeof details['angelegtAm']).toBe('string');
		expect([...details.ansprechpartner].sort((a, b) => a.vorname.localeCompare(b.vorname))).toEqual([
			{ personId: expect.any(String), vorname: 'Petra', nachname: 'Probe', email: 'petra.probe@example.org' },
			{ personId: thomas.id, vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas.beispiel@example.org' },
		]);
		expect(details.protokoll).toEqual([
			{ zeitpunkt: uhr.toISOString(), aktion: 'VEREIN_ANGELEGT', admin: benutzername },
		]);

		// Mit dem ersten Zugang ist die erste Einladung angenommen: Slug fest, keine erste Leitung mehr.
		await prisma.zugang.create({ data: { vereinId, personId: thomas.id } });
		const danach = (await (await hole(`/vereine/${id}`)).json()) as Record<string, unknown>;
		expect(danach['slugAenderbar']).toBe(false);
		expect(danach['ersteLeitung']).toBeNull();
	});

	it('Protokoll zeigt die letzten 20, neueste zuerst', async () => {
		const verein = await legeVereinAn(prisma, { slug: 'protokoll-test' });
		await prisma.adminProtokoll.createMany({
			data: Array.from({ length: 22 }, (_, i) => ({
				adminId,
				aktion: i % 2 === 0 ? ('GESPERRT' as const) : ('ENTSPERRT' as const),
				vereinId: verein.id,
				vereinSlug: verein.slug,
				zeitpunkt: new Date(uhr.getTime() - (22 - i) * 60_000),
			})),
		});
		const details = (await (await hole(`/vereine/${verein.id}`)).json()) as {
			protokoll: { zeitpunkt: string; aktion: string }[];
		};
		expect(details.protokoll).toHaveLength(20);
		expect(details.protokoll[0]).toEqual({
			zeitpunkt: new Date(uhr.getTime() - 60_000).toISOString(),
			aktion: 'ENTSPERRT',
			admin: benutzername,
		});
		expect(details.protokoll[19]?.zeitpunkt).toBe(new Date(uhr.getTime() - 20 * 60_000).toISOString());
	});

	it('unbekannte ID ist 404', async () => {
		const r = await hole('/vereine/gibt-es-nicht');
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
	});
});
