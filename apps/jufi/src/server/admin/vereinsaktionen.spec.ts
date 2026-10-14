import { generateLinkToken, hashToken } from '@jufi/auth';
import { createPrismaClientFromEnv, Recht, sperreVereinszeile } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { leitungsEinladungsText, notfallLinkText } from '../einladung.js';
import { einladungsMail } from '../mail/texte.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { adminDaten } from './daten.js';
import { meldeAdminAn } from './test-admin.js';

const ALLE_RECHTE = Object.values(Recht);
const TAG_MS = 24 * 60 * 60 * 1000;

interface Einladung {
	link: string;
	text: string;
}

describe('Admin: sperren, Slug korrigieren, Einladung erneuern, Notfall-Link', () => {
	const prisma = createPrismaClientFromEnv();
	const uhr = new Date('2026-10-13T08:00:00Z');
	let server: TestServer;
	let cookie = '';
	let adminId = '';

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, jetzt: () => uhr }),
		);
		const angemeldet = await meldeAdminAn(prisma, uhr);
		cookie = angemeldet.cookie;
		adminId = angemeldet.admin.id;
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	function post(pfad: string, body: unknown = {}) {
		return sende(server.url, `/admin/api/v1${pfad}`, { methode: 'POST', body, cookie });
	}

	/** Ueber die Route angelegt, damit erste Leitung, Einladung und Protokoll wie im Betrieb entstehen. */
	async function legeAn(slug: string): Promise<{ id: string; leitungId: string; token: string }> {
		const r = await post('/vereine', {
			name: 'Fischereiverein Aktionen e.V.',
			anzeigename: 'Jungfischer Aktionen',
			slug,
			farbe: '#0f766e',
			leitung: { vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas.beispiel@example.org' },
		});
		expect(r.status).toBe(201);
		const body = (await r.json()) as { id: string; einladung: Einladung };
		const leitung = await prisma.person.findFirstOrThrow({ where: { vereinId: body.id } });
		return { id: body.id, leitungId: leitung.id, token: body.einladung.link.split('#')[1] ?? '' };
	}

	/** Ein Zugang heisst: Die erste Einladung ist angenommen (er entsteht erst beim Einloesen). */
	function nimmAn(vereinId: string, personId: string) {
		return prisma.zugang.create({ data: { vereinId, personId } });
	}

	function protokoll(vereinId: string) {
		return prisma.adminProtokoll.findMany({
			where: { vereinId },
			orderBy: [{ zeitpunkt: 'asc' }, { id: 'asc' }],
		});
	}

	function offeneEinladungen(vereinId: string) {
		return prisma.einladung.findMany({ where: { vereinId, eingeloestAm: null } });
	}

	describe('sperren und entsperren', () => {
		it('sperren macht die Vereins-API 404 und entsperren wieder 200', async () => {
			const { id } = await legeAn('aktion-sperren');
			expect((await fetch(`${server.url}/aktion-sperren/api/v1/verein`)).status).toBe(200);

			const gesperrt = await post(`/vereine/${id}/sperren`);
			expect(gesperrt.status).toBe(200);
			expect(await gesperrt.json()).toEqual({ status: 'GESPERRT' });
			const r = await fetch(`${server.url}/aktion-sperren/api/v1/verein`);
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });

			const entsperrt = await post(`/vereine/${id}/entsperren`);
			expect(entsperrt.status).toBe(200);
			expect(await entsperrt.json()).toEqual({ status: 'AKTIV' });
			expect((await fetch(`${server.url}/aktion-sperren/api/v1/verein`)).status).toBe(200);

			const eintraege = (await protokoll(id)).filter((p) => p.aktion !== 'VEREIN_ANGELEGT');
			expect(eintraege.map((p) => p.aktion)).toEqual(['GESPERRT', 'ENTSPERRT']);
			expect(eintraege[0]).toMatchObject({
				adminId,
				vereinSlug: 'aktion-sperren',
				zeitpunkt: uhr,
				betroffenePersonId: null,
			});
		});

		it('zweimal sperren schreibt einen Protokolleintrag', async () => {
			const { id } = await legeAn('aktion-zweimal');
			// Gleichzeitig und danach noch einmal: Nur der Wechsel wird protokolliert.
			const gleichzeitig = await Promise.all([post(`/vereine/${id}/sperren`), post(`/vereine/${id}/sperren`)]);
			expect(gleichzeitig.map((r) => r.status)).toEqual([200, 200]);
			const nochmal = await post(`/vereine/${id}/sperren`);
			expect(await nochmal.json()).toEqual({ status: 'GESPERRT' });
			expect((await protokoll(id)).filter((p) => p.aktion === 'GESPERRT')).toHaveLength(1);

			// Entsperren eines aktiven Vereins: ebenso ohne Eintrag.
			await post(`/vereine/${id}/entsperren`);
			await post(`/vereine/${id}/entsperren`);
			expect((await protokoll(id)).filter((p) => p.aktion === 'ENTSPERRT')).toHaveLength(1);
		});

		it('Sitzungen bleiben beim Sperren', async () => {
			const { id, leitungId } = await legeAn('aktion-sitzungen');
			const zugang = await nimmAn(id, leitungId);
			await prisma.session.create({
				data: {
					vereinId: id,
					zugangId: zugang.id,
					tokenHash: hashToken(generateLinkToken()),
					ablauf: new Date(uhr.getTime() + 90 * TAG_MS),
				},
			});
			expect((await post(`/vereine/${id}/sperren`)).status).toBe(200);
			expect(await prisma.session.count({ where: { vereinId: id } })).toBe(1);
			expect(await prisma.zugang.count({ where: { vereinId: id } })).toBe(1);
		});

		it('unbekannter Verein ist 404', async () => {
			for (const aktion of ['sperren', 'entsperren']) {
				const r = await post(`/vereine/gibt-es-nicht/${aktion}`);
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
			}
		});
	});

	describe('Slug korrigieren', () => {
		beforeAll(async () => {
			await legeAn('aktion-belegt');
		});

		it('Slug korrigieren vor der Annahme: neuer Slug, neue Einladung mit neuem Slug, alte ungueltig, zwei Protokolleintraege', async () => {
			const { id, leitungId, token: altesToken } = await legeAn('aktion-slug-alt');

			const r = await post(`/vereine/${id}/slug`, { slug: 'aktion-slug-neu' });
			expect(r.status).toBe(200);
			const body = (await r.json()) as { slug: string; einladung: Einladung };
			expect(body.slug).toBe('aktion-slug-neu');
			expect(body.einladung.link.startsWith('http://jufi.test/aktion-slug-neu/einladung#')).toBe(true);
			expect(body.einladung.text).toBe(
				leitungsEinladungsText({ vorname: 'Thomas', anzeigename: 'Jungfischer Aktionen', link: body.einladung.link }),
			);
			const neuesToken = body.einladung.link.split('#')[1] ?? '';

			expect((await prisma.verein.findUniqueOrThrow({ where: { id } })).slug).toBe('aktion-slug-neu');
			// Die alte Einladung zeigte auf den alten Slug: Sie ist weg, die neue gilt.
			const einladungen = await prisma.einladung.findMany({ where: { vereinId: id } });
			expect(einladungen).toHaveLength(1);
			expect(einladungen[0]).toMatchObject({
				personId: leitungId,
				art: 'EINLADUNG',
				tokenHash: hashToken(neuesToken),
				erstelltVonPersonId: null,
			});
			expect(await prisma.einladung.count({ where: { tokenHash: hashToken(altesToken) } })).toBe(0);

			const eintraege = (await protokoll(id)).filter((p) => p.aktion !== 'VEREIN_ANGELEGT');
			expect(eintraege).toHaveLength(2);
			expect(eintraege).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						adminId,
						aktion: 'SLUG_KORRIGIERT',
						vereinSlug: 'aktion-slug-neu',
						zeitpunkt: uhr,
					}),
					expect.objectContaining({
						adminId,
						aktion: 'ERSTE_EINLADUNG_ERNEUERT',
						vereinSlug: 'aktion-slug-neu',
						betroffenePersonId: leitungId,
						zeitpunkt: uhr,
					}),
				]),
			);
		});

		it('Slug korrigieren nach der Annahme ist 409, nichts geaendert, kein Protokoll', async () => {
			const { id, leitungId, token } = await legeAn('aktion-fest');
			await nimmAn(id, leitungId);

			const r = await post(`/vereine/${id}/slug`, { slug: 'aktion-fest-neu' });
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({ fehler: 'Der Slug ist fest, seit die erste Einladung angenommen wurde' });
			expect((await prisma.verein.findUniqueOrThrow({ where: { id } })).slug).toBe('aktion-fest');
			const einladungen = await prisma.einladung.findMany({ where: { vereinId: id } });
			expect(einladungen.map((e) => e.tokenHash)).toEqual([hashToken(token)]);
			expect((await protokoll(id)).map((p) => p.aktion)).toEqual(['VEREIN_ANGELEGT']);
		});

		it.each([
			['demo', 400, { fehler: 'Dieser Slug ist reserviert', feld: 'slug' }],
			['admin', 400, { fehler: 'Dieser Slug ist reserviert', feld: 'slug' }],
			['Kaputt_Slug', 400, { fehler: 'Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche', feld: 'slug' }],
			['aktion-belegt', 409, { fehler: 'Dieser Slug ist vergeben', feld: 'slug' }],
		])('Slug demo und vergebener Slug werden abgelehnt (%s)', async (slug, status, fehler) => {
			// Je Fall ein eigener Verein, damit kein Fall den naechsten vorbelastet.
			const quelle = `aktion-ab-${slug.toLowerCase().replace(/_/g, '-')}`;
			const { id, token } = await legeAn(quelle);

			const r = await post(`/vereine/${id}/slug`, { slug });
			expect(r.status).toBe(status);
			expect(await r.json()).toEqual(fehler);
			expect((await prisma.verein.findUniqueOrThrow({ where: { id } })).slug).toBe(quelle);
			const einladungen = await prisma.einladung.findMany({ where: { vereinId: id } });
			expect(einladungen.map((e) => e.tokenHash)).toEqual([hashToken(token)]);
			expect((await protokoll(id)).map((p) => p.aktion)).toEqual(['VEREIN_ANGELEGT']);
		});

		it('unbekannter Verein ist 404, auch mit unmoeglichem Slug', async () => {
			for (const slug of ['aktion-gibt-es-nicht', 'Kaputt_Slug']) {
				const r = await post('/vereine/gibt-es-nicht/slug', { slug });
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
			}
		});
	});

	describe('erste Einladung erneuern', () => {
		it('Einladung erneuern ersetzt die offene; nach der Annahme 409', async () => {
			const { id, leitungId, token: altesToken } = await legeAn('aktion-erneuern');

			const r = await post(`/vereine/${id}/einladung-erneuern`);
			expect(r.status).toBe(200);
			const body = (await r.json()) as { einladung: Einladung };
			expect(body.einladung.link.startsWith('http://jufi.test/aktion-erneuern/einladung#')).toBe(true);
			expect(body.einladung.text).toBe(
				leitungsEinladungsText({ vorname: 'Thomas', anzeigename: 'Jungfischer Aktionen', link: body.einladung.link }),
			);
			const neuesToken = body.einladung.link.split('#')[1] ?? '';
			expect(neuesToken).not.toBe(altesToken);
			const offen = await offeneEinladungen(id);
			expect(offen.map((e) => e.tokenHash)).toEqual([hashToken(neuesToken)]);
			expect(offen[0]).toMatchObject({ personId: leitungId, art: 'EINLADUNG', erstelltVonPersonId: null });

			const eintraege = (await protokoll(id)).filter((p) => p.aktion !== 'VEREIN_ANGELEGT');
			expect(eintraege).toEqual([
				expect.objectContaining({
					adminId,
					aktion: 'ERSTE_EINLADUNG_ERNEUERT',
					vereinSlug: 'aktion-erneuern',
					betroffenePersonId: leitungId,
					zeitpunkt: uhr,
				}),
			]);

			await nimmAn(id, leitungId);
			const danach = await post(`/vereine/${id}/einladung-erneuern`);
			expect(danach.status).toBe(409);
			expect(await danach.json()).toEqual({ fehler: 'Die erste Einladung ist schon angenommen' });
			expect((await offeneEinladungen(id)).map((e) => e.tokenHash)).toEqual([hashToken(neuesToken)]);
			expect((await protokoll(id)).filter((p) => p.aktion === 'ERSTE_EINLADUNG_ERNEUERT')).toHaveLength(1);
		});

		it('unbekannter Verein ist 404', async () => {
			const r = await post('/vereine/gibt-es-nicht/einladung-erneuern');
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		});
	});

	describe('Rennen mit einer laufenden Einloesung', () => {
		/**
		 * Spielt eine Einloesung nach: sperrt die Vereinszeile, nimmt die Einladung an
		 * und legt den Zugang an, aber committet erst auf Zuruf. So ist die Admin-Aktion
		 * nachweislich gleichzeitig gestartet statt nur danach.
		 */
		async function halteEinloesung(vereinId: string, personId: string) {
			let freigabe!: () => void;
			const warten = new Promise<void>((r) => (freigabe = r));
			let gesperrt!: () => void;
			const istGesperrt = new Promise<void>((r) => (gesperrt = r));
			const transaktion = prisma.$transaction(async (tx) => {
				await sperreVereinszeile(tx, vereinId);
				await tx.einladung.updateMany({ where: { vereinId, personId }, data: { eingeloestAm: uhr } });
				await tx.zugang.create({ data: { vereinId, personId } });
				gesperrt();
				await warten;
			});
			await istGesperrt;
			return { transaktion, freigabe };
		}

		async function nachWarteZeit<T>(p: Promise<T>): Promise<boolean> {
			const fertig = Symbol('fertig');
			const ergebnis = await Promise.race([
				p.then(() => fertig),
				new Promise((r) => setTimeout(() => r('wartet'), 200)),
			]);
			return ergebnis === fertig;
		}

		it('Slug-Korrektur wartet auf eine laufende Einloesung', async () => {
			const { id, leitungId } = await legeAn('aktion-rennen-slug');
			const { transaktion, freigabe } = await halteEinloesung(id, leitungId);

			const korrektur = adminDaten(prisma).korrigiereSlug(id, 'aktion-rennen-slug-neu', adminId, uhr);
			expect(await nachWarteZeit(korrektur)).toBe(false);

			freigabe();
			await transaktion;
			expect(await korrektur).toBe('fest');
			expect((await prisma.verein.findUniqueOrThrow({ where: { id } })).slug).toBe('aktion-rennen-slug');
		});

		it('Erneuern wartet auf eine laufende Einloesung', async () => {
			const { id, leitungId } = await legeAn('aktion-rennen-erneuern');
			const { transaktion, freigabe } = await halteEinloesung(id, leitungId);
			const vorher = await prisma.einladung.count({ where: { vereinId: id } });

			const erneuert = adminDaten(prisma).erneuereErsteEinladung(id, adminId, uhr);
			expect(await nachWarteZeit(erneuert)).toBe(false);

			freigabe();
			await transaktion;
			expect(await erneuert).toBe('angenommen');
			expect(await prisma.einladung.count({ where: { vereinId: id } })).toBe(vorher);
			expect((await protokoll(id)).map((p) => p.aktion)).toEqual(['VEREIN_ANGELEGT']);
		});
	});

	describe('Notfall-Link', () => {
		it('Notfall-Link fuer einen Ansprechpartner', async () => {
			const { id, leitungId } = await legeAn('aktion-notfall');
			await nimmAn(id, leitungId);
			const petra = await prisma.person.create({
				data: {
					vereinId: id,
					art: 'ERWACHSENER',
					vorname: 'Petra',
					nachname: 'Probe',
					email: 'petra.probe@example.org',
					rechte: ['JUGENDLEITER_RECHTE'],
				},
			});

			const r = await post(`/vereine/${id}/notfall-link`, { personId: petra.id });
			expect(r.status).toBe(200);
			const body = (await r.json()) as { einladung: Einladung };
			expect(body.einladung.link.startsWith('http://jufi.test/aktion-notfall/einladung#')).toBe(true);
			expect(body.einladung.text).toBe(
				notfallLinkText({ vorname: 'Petra', anzeigename: 'Jungfischer Aktionen', link: body.einladung.link }),
			);
			const token = body.einladung.link.split('#')[1] ?? '';

			const einladungen = await prisma.einladung.findMany({ where: { vereinId: id, personId: petra.id } });
			expect(einladungen).toHaveLength(1);
			expect(einladungen[0]).toMatchObject({
				art: 'EINLADUNG',
				tokenHash: hashToken(token),
				erstelltVonPersonId: null,
				eingeloestAm: null,
			});
			const eintraege = (await protokoll(id)).filter((p) => p.aktion !== 'VEREIN_ANGELEGT');
			expect(eintraege).toEqual([
				expect.objectContaining({
					adminId,
					aktion: 'NOTFALL_LINK',
					vereinSlug: 'aktion-notfall',
					betroffenePersonId: petra.id,
					zeitpunkt: uhr,
				}),
			]);

			// Ein zweiter Notfall-Link ersetzt den ersten statt ihn weiter gelten zu lassen.
			await post(`/vereine/${id}/notfall-link`, { personId: petra.id });
			expect(await prisma.einladung.count({ where: { vereinId: id, personId: petra.id } })).toBe(1);
		});

		it('Notfall-Link fuer Kind, Elternteil ohne Rechte, entfernte Leitung und Leitung eines fremden Vereins ist 404, keine Einladung, kein Protokoll', async () => {
			const { id, leitungId } = await legeAn('aktion-notfall-nein');
			await nimmAn(id, leitungId);
			const fremd = await legeAn('aktion-notfall-fremd');
			const vereinId = id;
			const kind = await prisma.person.create({
				data: {
					vereinId,
					art: 'JUNGFISCHER',
					vorname: 'Lena',
					nachname: 'Erfunden',
					geburtsdatum: new Date('2013-04-01'),
				},
			});
			const elternteil = await prisma.person.create({
				data: { vereinId, art: 'ERWACHSENER', vorname: 'Sandra', nachname: 'Erfunden', email: 'sandra@example.org' },
			});
			// Alle Rechte ausser dem einen, das den Ansprechpartner ausmacht.
			const verwaltung = await prisma.person.create({
				data: {
					vereinId,
					art: 'ERWACHSENER',
					vorname: 'Katrin',
					nachname: 'Erfunden',
					rechte: ALLE_RECHTE.filter((r) => r !== 'JUGENDLEITER_RECHTE'),
				},
			});
			const entfernt = await prisma.person.create({
				data: {
					vereinId,
					art: 'ERWACHSENER',
					vorname: 'Otto',
					nachname: 'Fort',
					rechte: ['JUGENDLEITER_RECHTE'],
					entferntAm: new Date('2026-09-01'),
				},
			});
			const vorher = await prisma.einladung.findMany({ where: { vereinId: { in: [id, fremd.id] } } });

			for (const personId of [
				kind.id,
				elternteil.id,
				verwaltung.id,
				entfernt.id,
				fremd.leitungId,
				'gibt-es-nicht',
				'',
			]) {
				const r = await post(`/vereine/${id}/notfall-link`, { personId });
				expect(r.status, personId).toBe(404);
				expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
			}
			// Ohne personId ebenso.
			const ohneBody = await post(`/vereine/${id}/notfall-link`);
			expect(ohneBody.status).toBe(404);

			expect(await prisma.einladung.findMany({ where: { vereinId: { in: [id, fremd.id] } } })).toEqual(vorher);
			expect(await prisma.adminProtokoll.count({ where: { aktion: 'NOTFALL_LINK', vereinId: id } })).toBe(0);
			expect(await prisma.adminProtokoll.count({ where: { aktion: 'NOTFALL_LINK', vereinId: fremd.id } })).toBe(0);
		});

		it('Notfall-Link und Erneuern bei gesperrtem Verein sind 409, keine Einladung, kein Protokoll', async () => {
			const { id, leitungId } = await legeAn('aktion-notfall-gesperrt');
			expect((await post(`/vereine/${id}/sperren`)).status).toBe(200);
			const einladungenVorher = await prisma.einladung.findMany({ where: { vereinId: id } });
			const protokollVorher = await protokoll(id);

			const notfall = await post(`/vereine/${id}/notfall-link`, { personId: leitungId });
			expect(notfall.status).toBe(409);
			expect(await notfall.json()).toEqual({ fehler: 'Der Verein ist gesperrt – erst entsperren' });
			const erneuern = await post(`/vereine/${id}/einladung-erneuern`);
			expect(erneuern.status).toBe(409);
			expect(await erneuern.json()).toEqual({ fehler: 'Der Verein ist gesperrt – erst entsperren' });

			expect(await prisma.einladung.findMany({ where: { vereinId: id } })).toEqual(einladungenVorher);
			expect(await protokoll(id)).toEqual(protokollVorher);
		});

		it('Notfall-Link trägt den eigenen Text', async () => {
			const { id, leitungId } = await legeAn('aktion-notfall-text');

			// Vor der Annahme, sonst waere Erneuern 409.
			const erneuert = (await (await post(`/vereine/${id}/einladung-erneuern`)).json()) as { einladung: Einladung };
			expect(erneuert.einladung.text).not.toContain('angemeldeten Geräte');

			const notfall = (await (await post(`/vereine/${id}/notfall-link`, { personId: leitungId })).json()) as {
				einladung: Einladung;
			};
			expect(notfall.einladung.text).toContain('angemeldeten Geräte');
			expect(notfall.einladung.text).toContain(notfall.einladung.link);
			expect(notfall.einladung.text).toBe(
				notfallLinkText({ vorname: 'Thomas', anzeigename: 'Jungfischer Aktionen', link: notfall.einladung.link }),
			);
		});

		it('Notfall-Link fuer eine Nicht-Ansprechpartnerin im gesperrten Verein bleibt 404', async () => {
			const { id } = await legeAn('aktion-notfall-gesperrt-404');
			const elternteil = await prisma.person.create({
				data: {
					vereinId: id,
					art: 'ERWACHSENER',
					vorname: 'Sandra',
					nachname: 'Erfunden',
					email: 'sandra@example.org',
				},
			});
			expect((await post(`/vereine/${id}/sperren`)).status).toBe(200);

			const r = await post(`/vereine/${id}/notfall-link`, { personId: elternteil.id });
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		});

		it('Notfall-Link fuer einen unbekannten Verein ist 404', async () => {
			const r = await post('/vereine/gibt-es-nicht/notfall-link', { personId: 'egal' });
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		});
	});

	describe('per Mail', () => {
		const KEINE_ADRESSE = { fehler: 'Für diese Person ist keine E-Mail hinterlegt' };
		const NEUER_VEREIN = {
			name: 'Fischereiverein Mail e.V.',
			anzeigename: 'Jungfischer Mail',
			farbe: '#0f766e',
			leitung: { vorname: 'Thomas', nachname: 'Beispiel', email: '  Thomas.Mail@Example.ORG ' },
		};

		function mails(vereinId: string) {
			return prisma.mailWarteschlange.findMany({
				where: { vereinId },
				orderBy: [{ angelegtAm: 'asc' }, { id: 'asc' }],
			});
		}

		/** Die eine offene Einladung zu diesem Link, fuer den bezug der Mail. */
		function einladungZu(link: string) {
			return prisma.einladung.findFirstOrThrow({ where: { tokenHash: hashToken(link.split('#')[1] ?? '') } });
		}

		it('Verein anlegen mit perMail: Mail an die Leitung mit dem Link aus der Antwort', async () => {
			const r = await post('/vereine', { ...NEUER_VEREIN, slug: 'mail-anlegen', perMail: true });
			expect(r.status).toBe(201);
			const body = (await r.json()) as { id: string; einladung: Einladung; mailEingereiht: boolean };
			expect(body.mailEingereiht).toBe(true);

			const zeilen = await mails(body.id);
			expect(zeilen).toHaveLength(1);
			const erwartet = einladungsMail({
				vorname: 'Thomas',
				anzeigename: 'Jungfischer Mail',
				link: body.einladung.link,
				art: 'einladung',
			});
			expect(zeilen[0]).toMatchObject({
				empfaenger: 'thomas.mail@example.org',
				betreff: erwartet.betreff,
				text: erwartet.text,
				bezug: `einladung:${(await einladungZu(body.einladung.link)).id}`,
			});
			// Ohne gesendetAm und naechsterVersuch: der Arbeiter aus mail/arbeiter.spec.ts
			// laeuft mit derselben Uhr parallel und kann die Zeile schon beansprucht haben.
			expect(zeilen[0]?.text).toContain(body.einladung.link);
		});

		it('Verein anlegen mit perMail: false oder ohne Feld reiht nichts ein', async () => {
			for (const [slug, extra] of [
				['mail-ohne', {}],
				['mail-falsch', { perMail: false }],
				['mail-text', { perMail: 'true' }],
			] as const) {
				const r = await post('/vereine', { ...NEUER_VEREIN, slug, ...extra });
				expect(r.status, slug).toBe(201);
				const body = (await r.json()) as { id: string; mailEingereiht: boolean };
				expect(body.mailEingereiht, slug).toBe(false);
				expect(await mails(body.id), slug).toEqual([]);
			}
		});

		it('Verein anlegen mit perMail ohne Adresse ist 400 und legt nichts an', async () => {
			const r = await post('/vereine', {
				...NEUER_VEREIN,
				slug: 'mail-keine-adresse',
				leitung: { ...NEUER_VEREIN.leitung, email: '' },
				perMail: true,
			});
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Keine gültige E-Mail-Adresse', feld: 'email' });
			expect(await prisma.verein.count({ where: { slug: 'mail-keine-adresse' } })).toBe(0);
		});

		it('Einladung erneuern per Mail; ohne Adresse 400 ohne Wirkung', async () => {
			const { id, leitungId } = await legeAn('mail-erneuern');
			const r = await post(`/vereine/${id}/einladung-erneuern`, { perMail: true });
			expect(r.status).toBe(200);
			const body = (await r.json()) as { einladung: Einladung; mailEingereiht: boolean };
			expect(body.mailEingereiht).toBe(true);
			const zeilen = await mails(id);
			expect(zeilen).toHaveLength(1);
			expect(zeilen[0]).toMatchObject({
				empfaenger: 'thomas.beispiel@example.org',
				text: einladungsMail({
					vorname: 'Thomas',
					anzeigename: 'Jungfischer Aktionen',
					link: body.einladung.link,
					art: 'einladung',
				}).text,
				bezug: `einladung:${(await einladungZu(body.einladung.link)).id}`,
			});

			// Ohne perMail wie bisher, mit mailEingereiht: false.
			const ohne = await post(`/vereine/${id}/einladung-erneuern`);
			expect(((await ohne.json()) as { mailEingereiht: boolean }).mailEingereiht).toBe(false);
			expect(await mails(id)).toHaveLength(1);

			await prisma.person.update({ where: { id: leitungId }, data: { email: null } });
			const einladungenVorher = await prisma.einladung.findMany({ where: { vereinId: id } });
			const protokollVorher = await protokoll(id);
			const keine = await post(`/vereine/${id}/einladung-erneuern`, { perMail: true });
			expect(keine.status).toBe(400);
			expect(await keine.json()).toEqual(KEINE_ADRESSE);
			expect(await prisma.einladung.findMany({ where: { vereinId: id } })).toEqual(einladungenVorher);
			expect(await protokoll(id)).toEqual(protokollVorher);
			expect(await mails(id)).toHaveLength(1);
		});

		it('Notfall-Link per Mail enthaelt den Notfall-Text; ohne Adresse 400 ohne Wirkung', async () => {
			const { id, leitungId } = await legeAn('mail-notfall');
			await nimmAn(id, leitungId);

			const r = await post(`/vereine/${id}/notfall-link`, { personId: leitungId, perMail: true });
			expect(r.status).toBe(200);
			const body = (await r.json()) as { einladung: Einladung; mailEingereiht: boolean };
			expect(body.mailEingereiht).toBe(true);
			const [zeile] = await mails(id);
			const erwartet = einladungsMail({
				vorname: 'Thomas',
				anzeigename: 'Jungfischer Aktionen',
				link: body.einladung.link,
				art: 'notfall',
			});
			expect(zeile).toMatchObject({
				empfaenger: 'thomas.beispiel@example.org',
				betreff: erwartet.betreff,
				text: erwartet.text,
				bezug: `einladung:${(await einladungZu(body.einladung.link)).id}`,
			});
			expect(zeile?.text).toContain('angemeldeten Geräte');

			const ohneAdresse = await prisma.person.create({
				data: {
					vereinId: id,
					art: 'ERWACHSENER',
					vorname: 'Petra',
					nachname: 'Probe',
					rechte: ['JUGENDLEITER_RECHTE'],
				},
			});
			const protokollVorher = await protokoll(id);
			const keine = await post(`/vereine/${id}/notfall-link`, { personId: ohneAdresse.id, perMail: true });
			expect(keine.status).toBe(400);
			expect(await keine.json()).toEqual(KEINE_ADRESSE);
			expect(await prisma.einladung.count({ where: { personId: ohneAdresse.id } })).toBe(0);
			expect(await protokoll(id)).toEqual(protokollVorher);
			expect(await mails(id)).toHaveLength(1);

			// Ohne perMail bekommt dieselbe Person ihren Link zum Kopieren.
			const kopieren = await post(`/vereine/${id}/notfall-link`, { personId: ohneAdresse.id });
			expect(kopieren.status).toBe(200);
			expect(((await kopieren.json()) as { mailEingereiht: boolean }).mailEingereiht).toBe(false);
		});

		it('gesperrter Verein: 409 auch mit perMail, keine Mail', async () => {
			const { id, leitungId } = await legeAn('mail-gesperrt');
			expect((await post(`/vereine/${id}/sperren`)).status).toBe(200);
			expect((await post(`/vereine/${id}/einladung-erneuern`, { perMail: true })).status).toBe(409);
			expect((await post(`/vereine/${id}/notfall-link`, { personId: leitungId, perMail: true })).status).toBe(409);
			expect(await mails(id)).toEqual([]);
		});
	});
});
