import {
	AttemptTracker,
	decryptSecret,
	encryptSecret,
	generateLinkToken,
	generateRecoveryCodes,
	generateTotpSecret,
	hashPassword,
	hashRecoveryCode,
	hashToken,
	verifyPassword,
	verifyTotp,
} from '@jufi/auth';
import { createPrismaClientFromEnv, type PlattformAdmin } from '@jufi/db';
import { randomInt, randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';

// Spione um die Originale: so laesst sich zaehlen, wie viele Versuche wirklich
// bis zur Pruefung kamen. Am Status allein sieht man das nicht -- auch ohne
// Schutz gegen gleichzeitige Versuche antworten die spaeten mit 429, nur eben
// erst nachdem ihr Code geprueft wurde. Verworfen: vi.spyOn auf den
// Namensraum -- ESM-Exporte sind nicht ueberschreibbar.
vi.mock('@jufi/auth', async (importOriginal) => {
	const original = await importOriginal<typeof import('@jufi/auth')>();
	return {
		...original,
		hashPassword: vi.fn(original.hashPassword),
		verifyPassword: vi.fn(original.verifyPassword),
		verifyTotp: vi.fn(original.verifyTotp),
	};
});

const MINUTE_MS = 60 * 1000;
const PASSWORT = 'forelle-am-morgen-im-nebel';
const LINK_UNGUELTIG = { fehler: 'Dieser Link gilt nicht mehr' };
const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };

describe('Admin-Einrichtung und -Anmeldung', () => {
	const prisma = createPrismaClientFromEnv();
	const t0 = new Date('2026-10-13T08:00:00Z');
	// Die Uhr der App und des Backoffs; jeder Test beginnt bei t0.
	let uhr = t0;
	let server: TestServer;
	// Alle Anfragen kommen von 127.0.0.1. Damit sich die Fehlversuche der Tests im
	// gemeinsamen Backoff je IP nicht addieren, bekommt jeder Test eine eigene
	// Adresse ueber X-Forwarded-For (trust proxy 1 nimmt den letzten Eintrag).
	let ip = '';

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr,
				anmeldeVersuche: new AttemptTracker(() => uhr.getTime()),
			}),
		);
	});

	beforeEach(() => {
		uhr = t0;
		ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	function post(pfad: string, body: unknown = {}, cookie?: string): Promise<Response> {
		return sende(server.url, `/admin/api/v1${pfad}`, {
			methode: 'POST',
			body,
			cookie,
			kopf: { 'X-Forwarded-For': ip },
		});
	}

	function cookieAus(r: Response): string | undefined {
		const treffer = /jufi_admin=([^;]+)/.exec(r.headers.get('set-cookie') ?? '');
		return treffer ? `jufi_admin=${treffer[1]}` : undefined;
	}

	/** Ein erfundener Admin; Name eindeutig, weil die Testdateien dieselbe Datenbank teilen. */
	async function legeAdminAn(
		optionen: { passwort?: string; totp?: boolean } = {},
	): Promise<{ admin: PlattformAdmin; geheimnis: string; codes: string[] }> {
		const geheimnis = generateTotpSecret();
		const codes = generateRecoveryCodes();
		const admin = await prisma.plattformAdmin.create({
			data: {
				benutzername: `admin-${randomUUID().slice(0, 8)}`,
				passwortHash: optionen.passwort ? await hashPassword(optionen.passwort) : null,
				...(optionen.totp
					? {
							totpGeheimnis: encryptSecret(geheimnis),
							totpAktivAm: t0,
							recoveryCodes: { create: codes.map((c) => ({ codeHash: hashRecoveryCode(c) })) },
						}
					: {}),
			},
		});
		return { admin, geheimnis, codes };
	}

	async function legeEinrichtungAn(
		adminId: string,
		optionen: { ablauf?: Date; eingeloestAm?: Date } = {},
	): Promise<string> {
		const token = generateLinkToken();
		await prisma.adminEinrichtung.create({
			data: {
				adminId,
				tokenHash: hashToken(token),
				ablauf: optionen.ablauf ?? new Date(t0.getTime() + 60 * MINUTE_MS),
				eingeloestAm: optionen.eingeloestAm ?? null,
			},
		});
		return token;
	}

	describe('Einrichtung', () => {
		it('Einrichtungslink pruefen nennt den Benutzernamen und verbraucht nichts', async () => {
			const { admin } = await legeAdminAn();
			const token = await legeEinrichtungAn(admin.id);
			const r = await post('/einrichtung/pruefen', { token });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ benutzername: admin.benutzername });
			const zeile = await prisma.adminEinrichtung.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
			expect(zeile.eingeloestAm).toBeNull();
			// Ein zweites Pruefen geht ebenso: der Link ist erst mit dem Abschluss verbraucht.
			expect((await post('/einrichtung/pruefen', { token })).status).toBe(200);
		});

		it('abgelaufener, eingeloester und unbekannter Link sind 404 mit "Dieser Link gilt nicht mehr"', async () => {
			const { admin } = await legeAdminAn();
			const tokens = [
				// Zur Ablaufzeit gilt der Link schon nicht mehr.
				await legeEinrichtungAn(admin.id, { ablauf: t0 }),
				await legeEinrichtungAn(admin.id, { eingeloestAm: new Date(t0.getTime() - MINUTE_MS) }),
				generateLinkToken(),
			];
			for (const token of tokens) {
				const pruefen = await post('/einrichtung/pruefen', { token });
				expect(pruefen.status).toBe(404);
				expect(await pruefen.json()).toEqual(LINK_UNGUELTIG);
				const abschliessen = await post('/einrichtung/abschliessen', { token, passwort: PASSWORT });
				expect(abschliessen.status).toBe(404);
				expect(await abschliessen.json()).toEqual(LINK_UNGUELTIG);
				expect(cookieAus(abschliessen)).toBeUndefined();
			}
			const nachher = await prisma.plattformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
			expect(nachher.passwortHash).toBeNull();
			expect(await prisma.adminSession.count({ where: { adminId: admin.id } })).toBe(0);
		});

		it('Einrichtung abschliessen setzt das Passwort, meldet an und verbraucht den Link', async () => {
			const { admin } = await legeAdminAn();
			const token = await legeEinrichtungAn(admin.id);
			uhr = new Date(t0.getTime() + 10 * MINUTE_MS);
			const r = await post('/einrichtung/abschliessen', { token, passwort: PASSWORT });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ benutzername: admin.benutzername });
			const cookie = cookieAus(r);
			expect(cookie).toBeDefined();

			const ich = await sende(server.url, '/admin/api/v1/ich', { cookie });
			expect(ich.status).toBe(200);
			expect((await ich.json()).benutzername).toBe(admin.benutzername);

			const nachher = await prisma.plattformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
			expect(await verifyPassword(nachher.passwortHash ?? '', PASSWORT)).toBe(true);
			const zeile = await prisma.adminEinrichtung.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
			expect(zeile.eingeloestAm).toEqual(uhr);

			const nochmal = await post('/einrichtung/abschliessen', { token, passwort: PASSWORT });
			expect(nochmal.status).toBe(404);
			expect(await nochmal.json()).toEqual(LINK_UNGUELTIG);
		});

		it('zu kurzes und zu verbreitetes Passwort werden mit dem Hinweis abgelehnt, der Link bleibt gueltig', async () => {
			const { admin } = await legeAdminAn();
			const token = await legeEinrichtungAn(admin.id);
			for (const [passwort, hinweis] of [
				['kurz', 'Mindestens 10 Zeichen'],
				['1234567890', 'Dieses Passwort ist zu verbreitet'],
			]) {
				const r = await post('/einrichtung/abschliessen', { token, passwort });
				expect(r.status).toBe(400);
				expect(await r.json()).toEqual({ fehler: hinweis });
				expect(cookieAus(r)).toBeUndefined();
			}
			const zeile = await prisma.adminEinrichtung.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
			expect(zeile.eingeloestAm).toBeNull();
			expect((await post('/einrichtung/abschliessen', { token, passwort: PASSWORT })).status).toBe(200);
		});

		it('ungueltiger Link kommt nicht bis zum Passwort-Hash', async () => {
			const { admin } = await legeAdminAn();
			const tokens = [
				await legeEinrichtungAn(admin.id, { ablauf: t0 }),
				await legeEinrichtungAn(admin.id, { eingeloestAm: new Date(t0.getTime() - MINUTE_MS) }),
				generateLinkToken(),
			];
			vi.mocked(hashPassword).mockClear();
			for (const token of tokens) {
				const r = await post('/einrichtung/abschliessen', { token, passwort: PASSWORT });
				expect(r.status).toBe(404);
				expect(await r.json()).toEqual(LINK_UNGUELTIG);
			}
			expect(hashPassword).not.toHaveBeenCalled();
		});

		it('Doppelklick: zwei gleichzeitige Abschluesse, genau einer gelingt', async () => {
			const { admin } = await legeAdminAn();
			const token = await legeEinrichtungAn(admin.id);
			const antworten = await Promise.all([
				post('/einrichtung/abschliessen', { token, passwort: PASSWORT }),
				post('/einrichtung/abschliessen', { token, passwort: PASSWORT }),
			]);
			expect(antworten.map((r) => r.status).sort()).toEqual([200, 404]);
			const verloren = antworten.find((r) => r.status === 404);
			expect(await verloren?.json()).toEqual(LINK_UNGUELTIG);
			expect(await prisma.adminSession.count({ where: { adminId: admin.id } })).toBe(1);
		});
	});

	describe('Anmeldung mit Passwort', () => {
		it('Anmeldung ohne TOTP liefert schritt fertig und das Cookie', async () => {
			const { admin } = await legeAdminAn({ passwort: PASSWORT });
			const r = await post('/anmelden', { benutzername: admin.benutzername, passwort: PASSWORT });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig' });
			const ich = await sende(server.url, '/admin/api/v1/ich', { cookie: cookieAus(r) });
			expect(ich.status).toBe(200);
		});

		it('Benutzername in Grossbuchstaben und mit Leerzeichen wird gefunden', async () => {
			const { admin } = await legeAdminAn({ passwort: PASSWORT });
			const r = await post('/anmelden', {
				benutzername: `  ${admin.benutzername.toUpperCase()} `,
				passwort: PASSWORT,
			});
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig' });
			expect(cookieAus(r)).toBeDefined();
		});

		it('falsches Passwort und unbekannter Name antworten gleich', async () => {
			const { admin } = await legeAdminAn({ passwort: PASSWORT });
			// Ein Admin vor der Einrichtung hat kein Passwort; er darf sich nicht von
			// einem unbekannten Namen unterscheiden.
			const { admin: ohnePasswort } = await legeAdminAn();
			const antworten = [
				await post('/anmelden', { benutzername: admin.benutzername, passwort: 'falsch-aber-lang-genug' }),
				await post('/anmelden', { benutzername: 'gibt-es-nicht', passwort: PASSWORT }),
				await post('/anmelden', { benutzername: ohnePasswort.benutzername, passwort: '' }),
			];
			for (const r of antworten) {
				expect(r.status).toBe(401);
				expect(await r.json()).toEqual(FEHLGESCHLAGEN);
				expect(cookieAus(r)).toBeUndefined();
			}
		});

		it('vierter Fehlversuch in Folge ist 429 mit wartenSekunden', async () => {
			const { admin } = await legeAdminAn({ passwort: PASSWORT });
			for (let i = 0; i < 3; i++) {
				const r = await post('/anmelden', { benutzername: admin.benutzername, passwort: 'falsch-aber-lang' });
				expect(r.status).toBe(401);
			}
			const vierter = await post('/anmelden', { benutzername: admin.benutzername, passwort: 'falsch-aber-lang' });
			expect(vierter.status).toBe(429);
			expect(await vierter.json()).toEqual({ fehler: 'Zu viele Versuche', wartenSekunden: 1 });
			// Waehrend der Sperre hilft auch das richtige Passwort nicht.
			const richtig = await post('/anmelden', { benutzername: admin.benutzername, passwort: PASSWORT });
			expect(richtig.status).toBe(429);
			expect(cookieAus(richtig)).toBeUndefined();
			// Nach der Wartezeit geht es weiter.
			uhr = new Date(t0.getTime() + 1000);
			expect((await post('/anmelden', { benutzername: admin.benutzername, passwort: PASSWORT })).status).toBe(200);
		});

		it('gleichzeitige Fehlversuche umgehen den Backoff nicht', async () => {
			const { admin } = await legeAdminAn({ passwort: PASSWORT });
			vi.mocked(verifyPassword).mockClear();
			const antworten = await Promise.all(
				Array.from({ length: 6 }, () =>
					post('/anmelden', { benutzername: admin.benutzername, passwort: 'falsch-aber-lang' }),
				),
			);
			const status = antworten.map((r) => r.status).sort();
			// Drei frei, der vierte loest die Sperre aus, alles danach wartet --
			// ohne dass das Passwort ueberhaupt geprueft wird.
			expect(status).toEqual([401, 401, 401, 429, 429, 429]);
			expect(verifyPassword).toHaveBeenCalledTimes(4);
		});

		it('Backoff je IP laesst sich nicht mit X-Forwarded-For umgehen', async () => {
			const status: number[] = [];
			for (let i = 0; i < 4; i++) {
				// Wechselnde Namen, damit nur der Schluessel je IP zaehlt; der vordere
				// Eintrag ist frei erfunden, wie ihn ein Angreifer selbst setzen kann.
				const r = await sende(server.url, '/admin/api/v1/anmelden', {
					methode: 'POST',
					body: { benutzername: `niemand-${randomUUID().slice(0, 8)}`, passwort: PASSWORT },
					kopf: { 'X-Forwarded-For': `${randomInt(1, 224)}.${randomInt(256)}.${randomInt(256)}.1, 10.0.0.1` },
				});
				status.push(r.status);
			}
			expect(status).toEqual([401, 401, 401, 429]);
		});
	});

	describe('Anmeldung mit TOTP', () => {
		async function zwischenmarkeFuer(benutzername: string): Promise<string> {
			const r = await post('/anmelden', { benutzername, passwort: PASSWORT });
			expect(r.status).toBe(200);
			expect(cookieAus(r)).toBeUndefined();
			const body = (await r.json()) as { schritt: string; zwischenmarke: string };
			expect(body.schritt).toBe('totp');
			return body.zwischenmarke;
		}

		it('Anmeldung mit TOTP verlangt den Code', async () => {
			const { admin, geheimnis, codes } = await legeAdminAn({ passwort: PASSWORT, totp: true });
			const zwischenmarke = await zwischenmarkeFuer(admin.benutzername);

			const falsch = await post('/anmelden/totp', { zwischenmarke, code: '000000' });
			expect(falsch.status).toBe(401);
			expect(await falsch.json()).toEqual(FEHLGESCHLAGEN);
			expect(cookieAus(falsch)).toBeUndefined();

			// verifyTotp prueft gegen die Wanduhr, nicht gegen die Uhr der App; der
			// Code entsteht deshalb ebenfalls mit der Wanduhr.
			const r = await post('/anmelden/totp', { zwischenmarke, code: await generate({ secret: geheimnis }) });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig', wiederherstellungscodesUebrig: codes.length });
			const ich = await sende(server.url, '/admin/api/v1/ich', { cookie: cookieAus(r) });
			expect(ich.status).toBe(200);
		});

		it('abgelaufene Zwischenmarke verlangt einen neuen Anfang', async () => {
			const { admin, geheimnis } = await legeAdminAn({ passwort: PASSWORT, totp: true });
			const zwischenmarke = await zwischenmarkeFuer(admin.benutzername);
			uhr = new Date(t0.getTime() + 6 * MINUTE_MS);
			const r = await post('/anmelden/totp', { zwischenmarke, code: await generate({ secret: geheimnis }) });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual({ fehler: 'Anmeldung abgelaufen, bitte neu beginnen' });
			expect(cookieAus(r)).toBeUndefined();
		});

		it('TOTP aktiv ohne Geheimnis verlangt trotzdem den Code', async () => {
			const { admin } = await legeAdminAn({ passwort: PASSWORT });
			await prisma.plattformAdmin.update({ where: { id: admin.id }, data: { totpAktivAm: t0 } });
			const zwischenmarke = await zwischenmarkeFuer(admin.benutzername);
			const r = await post('/anmelden/totp', { zwischenmarke, code: '000000' });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			expect(cookieAus(r)).toBeUndefined();
		});

		it('gleichzeitige falsche Codes umgehen den Backoff nicht', async () => {
			const { admin } = await legeAdminAn({ passwort: PASSWORT, totp: true });
			const zwischenmarke = await zwischenmarkeFuer(admin.benutzername);
			vi.mocked(verifyTotp).mockClear();
			const antworten = await Promise.all(
				Array.from({ length: 6 }, () => post('/anmelden/totp', { zwischenmarke, code: '000000' })),
			);
			const status = antworten.map((r) => r.status).sort();
			expect(status).toEqual([401, 401, 401, 429, 429, 429]);
			expect(verifyTotp).toHaveBeenCalledTimes(4);
		});

		it('Wiederherstellungscode gilt genau einmal', async () => {
			const { admin, codes } = await legeAdminAn({ passwort: PASSWORT, totp: true });
			const code = codes[0] ?? '';
			const erste = await post('/anmelden/totp', {
				zwischenmarke: await zwischenmarkeFuer(admin.benutzername),
				// Kleingeschrieben und ohne Bindestriche: abgetippt vom Papier.
				wiederherstellungscode: code.toLowerCase().replace(/-/g, ' '),
			});
			expect(erste.status).toBe(200);
			expect(await erste.json()).toEqual({ schritt: 'fertig', wiederherstellungscodesUebrig: codes.length - 1 });
			const zeile = await prisma.adminRecoveryCode.findUniqueOrThrow({
				where: { adminId_codeHash: { adminId: admin.id, codeHash: hashRecoveryCode(code) } },
			});
			expect(zeile.verwendetAm).toEqual(t0);

			const zweite = await post('/anmelden/totp', {
				zwischenmarke: await zwischenmarkeFuer(admin.benutzername),
				wiederherstellungscode: code,
			});
			expect(zweite.status).toBe(401);
			expect(await zweite.json()).toEqual(FEHLGESCHLAGEN);
			expect(cookieAus(zweite)).toBeUndefined();
		});
	});

	describe('TOTP einrichten', () => {
		async function meldeOhneTotpAn(): Promise<{ admin: PlattformAdmin; cookie: string }> {
			const { admin } = await legeAdminAn({ passwort: PASSWORT });
			const r = await post('/anmelden', { benutzername: admin.benutzername, passwort: PASSWORT });
			const cookie = cookieAus(r);
			if (!cookie) throw new Error('Anmeldung ohne Cookie');
			return { admin, cookie };
		}

		it('TOTP einrichten: start, falscher Code 401, richtiger Code aktiviert und ersetzt die Codes', async () => {
			const { admin, cookie } = await meldeOhneTotpAn();
			// Ein Code aus einer frueheren Einrichtung, der danach nicht mehr gelten darf.
			await prisma.adminRecoveryCode.create({ data: { adminId: admin.id, codeHash: hashRecoveryCode('ALT') } });

			const start = await post('/konto/totp/start', {}, cookie);
			expect(start.status).toBe(200);
			const { zwischenmarke, geheimnis, uri, wiederherstellungscodes } = (await start.json()) as {
				zwischenmarke: string;
				geheimnis: string;
				uri: string;
				wiederherstellungscodes: string[];
			};
			expect(geheimnis).toMatch(/^[A-Z2-7]+$/);
			expect(decodeURIComponent(uri)).toContain(`${admin.benutzername} (Admin)`);
			expect(uri).toContain(`secret=${geheimnis}`);
			expect(wiederherstellungscodes).toHaveLength(10);
			// Vor der Bestaetigung ist nichts gespeichert.
			const vorher = await prisma.plattformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
			expect(vorher.totpAktivAm).toBeNull();
			expect(vorher.totpGeheimnis).toBeNull();

			const falsch = await post('/konto/totp/bestaetigen', { zwischenmarke, code: '000000' }, cookie);
			expect(falsch.status).toBe(401);
			expect(await falsch.json()).toEqual({ fehler: 'Code stimmt nicht' });

			const r = await post(
				'/konto/totp/bestaetigen',
				{ zwischenmarke, code: await generate({ secret: geheimnis }) },
				cookie,
			);
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ ok: true });

			const nachher = await prisma.plattformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
			expect(nachher.totpAktivAm).toEqual(t0);
			expect(decryptSecret(nachher.totpGeheimnis ?? '')).toBe(geheimnis);
			const gespeichert = await prisma.adminRecoveryCode.findMany({ where: { adminId: admin.id } });
			expect(gespeichert.map((c) => c.codeHash).sort()).toEqual(wiederherstellungscodes.map(hashRecoveryCode).sort());
		});

		it('start bei aktivem TOTP ist 409', async () => {
			const { admin, cookie } = await meldeOhneTotpAn();
			await prisma.plattformAdmin.update({
				where: { id: admin.id },
				data: { totpGeheimnis: encryptSecret(generateTotpSecret()), totpAktivAm: t0 },
			});
			const r = await post('/konto/totp/start', {}, cookie);
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual({ fehler: 'TOTP ist schon eingerichtet' });
		});

		it('Marke eines anderen Admins wird abgelehnt', async () => {
			const anna = await meldeOhneTotpAn();
			const bernd = await meldeOhneTotpAn();
			const start = await post('/konto/totp/start', {}, anna.cookie);
			const { zwischenmarke, geheimnis } = (await start.json()) as { zwischenmarke: string; geheimnis: string };
			const r = await post(
				'/konto/totp/bestaetigen',
				{ zwischenmarke, code: await generate({ secret: geheimnis }) },
				bernd.cookie,
			);
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Einrichtung abgelaufen, bitte neu beginnen' });
			for (const id of [anna.admin.id, bernd.admin.id]) {
				const admin = await prisma.plattformAdmin.findUniqueOrThrow({ where: { id } });
				expect(admin.totpAktivAm).toBeNull();
			}
		});

		it('abgelaufene und kaputte Einrichtungsmarke werden abgelehnt', async () => {
			const { cookie } = await meldeOhneTotpAn();
			const start = await post('/konto/totp/start', {}, cookie);
			const { zwischenmarke, geheimnis } = (await start.json()) as { zwischenmarke: string; geheimnis: string };
			// Ein verfaelschtes Zeichen im Chiffretext: GCM merkt es am Auth-Tag.
			const [iv, daten = '', tag] = zwischenmarke.split('.');
			const verfaelscht = [iv, (daten.startsWith('A') ? 'B' : 'A') + daten.slice(1), tag].join('.');
			for (const marke of ['kaputt', verfaelscht]) {
				const r = await post('/konto/totp/bestaetigen', { zwischenmarke: marke, code: '000000' }, cookie);
				expect(r.status).toBe(400);
			}
			uhr = new Date(t0.getTime() + 11 * MINUTE_MS);
			const r = await post(
				'/konto/totp/bestaetigen',
				{ zwischenmarke, code: await generate({ secret: geheimnis }) },
				cookie,
			);
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual({ fehler: 'Einrichtung abgelaufen, bitte neu beginnen' });
		});
	});
});
