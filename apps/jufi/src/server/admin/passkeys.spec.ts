import { AttemptTracker, WEBAUTHN_CHALLENGE_TTL_MS } from '@jufi/auth';
import { createPrismaClientFromEnv } from '@jufi/db';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { WebauthnPruefer } from '../abhaengigkeiten.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { meldeAdminAn } from './test-admin.js';

const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };
const EINRICHTUNG_GESCHEITERT = { fehler: 'Passkey konnte nicht eingerichtet werden' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

describe('Admin-Passkeys', () => {
	const prisma = createPrismaClientFromEnv();
	const t0 = new Date('2026-10-13T08:00:00Z');
	let uhr = t0;
	let server: TestServer;
	let ip = '';

	// Attrappen statt echter Kryptografie: ein Test hat keinen Authenticator, und
	// die Pruefung selbst liegt in libs/auth bei @simplewebauthn. Hier geht es um
	// alles drumherum: welche Challenge, welcher Passkey, welche Tabelle.
	const verifyAuthentication = vi.fn<WebauthnPruefer['verifyAuthentication']>();
	const verifyRegistration = vi.fn<WebauthnPruefer['verifyRegistration']>();

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr,
				anmeldeVersuche: new AttemptTracker(() => uhr.getTime()),
				webauthn: { verifyAuthentication, verifyRegistration },
			}),
		);
	});

	beforeEach(() => {
		uhr = t0;
		// Eigene IP je Test, damit sich die Fehlversuche im gemeinsamen Backoff nicht addieren.
		ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
		verifyAuthentication.mockReset();
		verifyRegistration.mockReset();
		verifyAuthentication.mockResolvedValue({ counter: 7 });
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	function post(pfad: string, body: unknown = {}, optionen: { cookie?: string; userAgent?: string } = {}) {
		return sende(server.url, `/admin/api/v1${pfad}`, {
			methode: 'POST',
			body,
			cookie: optionen.cookie,
			kopf: { 'X-Forwarded-For': ip, ...(optionen.userAgent ? { 'User-Agent': optionen.userAgent } : {}) },
		});
	}

	/** Eine Antwort des Geraets, soweit der Server sie liest: id und die Challenge in clientDataJSON. */
	function antwort(challenge: string, id: string) {
		return {
			id,
			rawId: id,
			type: 'public-key',
			response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url') },
		};
	}

	async function holeAnmeldeChallenge(): Promise<string> {
		const r = await post('/anmelden/passkey/optionen');
		expect(r.status).toBe(200);
		return ((await r.json()) as { challenge: string }).challenge;
	}

	async function legeAdminPasskeyAn(adminId: string, credentialId = `cred-${randomUUID()}`) {
		return prisma.adminPasskey.create({
			data: { adminId, credentialId, publicKey: 'cHVibGljLWtleQ', counter: 3, transports: ['internal'], label: 'Mac' },
		});
	}

	async function sitzungen(adminId: string): Promise<number> {
		return prisma.adminSession.count({ where: { adminId } });
	}

	describe('Anmelden', () => {
		it('Anmeldeoptionen legen eine Admin-Challenge an', async () => {
			const r = await post('/anmelden/passkey/optionen');
			expect(r.status).toBe(200);
			const optionen = (await r.json()) as { challenge: string; userVerification?: string; allowCredentials?: unknown };
			// Ohne allowCredentials: die Liste verriete jedem Aufrufer, welche Geraete bekannt sind.
			expect(optionen.allowCredentials ?? []).toEqual([]);

			const zeile = await prisma.webauthnChallenge.findUniqueOrThrow({ where: { challenge: optionen.challenge } });
			expect(zeile).toMatchObject({ vereinId: null, personId: null, adminId: null, purpose: 'authenticate' });
			expect(zeile.expiresAt).toEqual(new Date(t0.getTime() + WEBAUTHN_CHALLENGE_TTL_MS));
		});

		it('raeumt beim Anlegen abgelaufene Challenges weg', async () => {
			const alt = await holeAnmeldeChallenge();
			uhr = new Date(t0.getTime() + WEBAUTHN_CHALLENGE_TTL_MS + 1);
			const neu = await holeAnmeldeChallenge();
			expect(await prisma.webauthnChallenge.findUnique({ where: { challenge: alt } })).toBeNull();
			expect(await prisma.webauthnChallenge.findUnique({ where: { challenge: neu } })).not.toBeNull();
		});

		it('Passkey-Anmeldung mit bekanntem Admin-Passkey meldet an und zaehlt den Zaehler hoch', async () => {
			const { admin } = await meldeAdminAn(prisma, t0);
			const passkey = await legeAdminPasskeyAn(admin.id);
			const challenge = await holeAnmeldeChallenge();
			uhr = new Date(t0.getTime() + 30_000);

			const r = await post('/anmelden/passkey', { antwort: antwort(challenge, passkey.credentialId) });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig' });
			const cookie = /jufi_admin=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[0];
			expect(cookie).toBeDefined();

			expect(verifyAuthentication).toHaveBeenCalledTimes(1);
			const aufruf = verifyAuthentication.mock.calls[0]?.[0];
			expect(aufruf?.expectedChallenge).toBe(challenge);
			expect(aufruf?.passkey).toMatchObject({ credentialId: passkey.credentialId, counter: 3 });

			const danach = await prisma.adminPasskey.findUniqueOrThrow({ where: { id: passkey.id } });
			expect(danach.counter).toBe(7);
			expect(danach.lastUsedAt).toEqual(uhr);
			// Eine Sitzung aus meldeAdminAn, eine aus der Anmeldung.
			expect(await sitzungen(admin.id)).toBe(2);

			// Das Cookie gehoert zu diesem Admin.
			const ich = await sende(server.url, '/admin/api/v1/ich', { cookie });
			expect(ich.status).toBe(200);
			expect(((await ich.json()) as { benutzername: string }).benutzername).toBe(admin.benutzername);
		});

		it('Vereins-Passkey wird nicht erkannt', async () => {
			const verein = await legeVereinAn(prisma, { slug: `passkey-${randomUUID().slice(0, 8)}` });
			const person = await prisma.person.create({
				data: { vereinId: verein.id, art: 'ERWACHSENER', vorname: 'Erika', nachname: 'Muster' },
			});
			const zugang = await prisma.zugang.create({ data: { vereinId: verein.id, personId: person.id } });
			const credentialId = `cred-${randomUUID()}`;
			await prisma.passkey.create({
				data: {
					vereinId: verein.id,
					zugangId: zugang.id,
					credentialId,
					publicKey: 'cHVibGljLWtleQ',
					label: 'iPhone',
				},
			});
			const challenge = await holeAnmeldeChallenge();

			const r = await post('/anmelden/passkey', { antwort: antwort(challenge, credentialId) });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			expect(verifyAuthentication).not.toHaveBeenCalled();
			expect(r.headers.get('set-cookie')).toBeNull();
		});

		it('Challenge eines Vereins gilt nicht fuer den Admin', async () => {
			const verein = await legeVereinAn(prisma, { slug: `passkey-${randomUUID().slice(0, 8)}` });
			const { admin } = await meldeAdminAn(prisma, t0);
			const passkey = await legeAdminPasskeyAn(admin.id);
			const challenge = `vereins-challenge-${randomUUID()}`;
			await prisma.webauthnChallenge.create({
				data: {
					challenge,
					vereinId: verein.id,
					purpose: 'authenticate',
					expiresAt: new Date(t0.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
				},
			});

			const r = await post('/anmelden/passkey', { antwort: antwort(challenge, passkey.credentialId) });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			expect(verifyAuthentication).not.toHaveBeenCalled();
			// Eingeloest wird sie trotzdem: eine fremde Challenge soll nicht liegen bleiben.
			expect(await prisma.webauthnChallenge.findUnique({ where: { challenge } })).toBeNull();
		});

		it('Challenge gilt nur einmal', async () => {
			const { admin } = await meldeAdminAn(prisma, t0);
			const passkey = await legeAdminPasskeyAn(admin.id);
			const challenge = await holeAnmeldeChallenge();
			const body = { antwort: antwort(challenge, passkey.credentialId) };

			expect((await post('/anmelden/passkey', body)).status).toBe(200);
			const zweiter = await post('/anmelden/passkey', body);
			expect(zweiter.status).toBe(401);
			expect(await zweiter.json()).toEqual(FEHLGESCHLAGEN);
			expect(verifyAuthentication).toHaveBeenCalledTimes(1);
		});

		it('zwei gleichzeitige Versuche mit derselben Challenge melden hoechstens einmal an', async () => {
			const { admin } = await meldeAdminAn(prisma, t0);
			const passkey = await legeAdminPasskeyAn(admin.id);
			const challenge = await holeAnmeldeChallenge();
			const body = { antwort: antwort(challenge, passkey.credentialId) };

			const status = (await Promise.all([post('/anmelden/passkey', body), post('/anmelden/passkey', body)]))
				.map((r) => r.status)
				.sort();
			expect(status).toEqual([200, 401]);
			expect(verifyAuthentication).toHaveBeenCalledTimes(1);
		});

		it('abgelaufene Challenge und Challenge mit falschem Zweck sind 401', async () => {
			const { admin } = await meldeAdminAn(prisma, t0);
			const passkey = await legeAdminPasskeyAn(admin.id);

			const abgelaufen = await holeAnmeldeChallenge();
			uhr = new Date(t0.getTime() + WEBAUTHN_CHALLENGE_TTL_MS);
			expect((await post('/anmelden/passkey', { antwort: antwort(abgelaufen, passkey.credentialId) })).status).toBe(
				401,
			);

			const einrichtung = `register-${randomUUID()}`;
			await prisma.webauthnChallenge.create({
				data: { challenge: einrichtung, purpose: 'register', expiresAt: new Date(uhr.getTime() + 60_000) },
			});
			expect((await post('/anmelden/passkey', { antwort: antwort(einrichtung, passkey.credentialId) })).status).toBe(
				401,
			);
			expect(verifyAuthentication).not.toHaveBeenCalled();
		});

		it('gescheiterte Pruefung ist 401, ohne Zaehler und ohne Sitzung', async () => {
			const { admin } = await meldeAdminAn(prisma, t0);
			const passkey = await legeAdminPasskeyAn(admin.id);
			const challenge = await holeAnmeldeChallenge();
			verifyAuthentication.mockResolvedValue(null);

			const r = await post('/anmelden/passkey', { antwort: antwort(challenge, passkey.credentialId) });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			expect((await prisma.adminPasskey.findUniqueOrThrow({ where: { id: passkey.id } })).counter).toBe(3);
			expect(await sitzungen(admin.id)).toBe(1);

			// Wirft die Pruefung (kaputte Signatur), ist es dasselbe.
			const challenge2 = await holeAnmeldeChallenge();
			verifyAuthentication.mockRejectedValue(new Error('Signatur ungueltig'));
			const r2 = await post('/anmelden/passkey', { antwort: antwort(challenge2, passkey.credentialId) });
			expect(r2.status).toBe(401);
			expect(await r2.json()).toEqual(FEHLGESCHLAGEN);
		});

		it('kaputte Antworten sind 401 (drei, mehr loeste die Sperre aus)', async () => {
			for (const body of [{}, { antwort: 'text' }, { antwort: { id: 5, response: {} } }]) {
				const r = await post('/anmelden/passkey', body);
				expect(r.status).toBe(401);
				expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			}
			expect(verifyAuthentication).not.toHaveBeenCalled();
		});

		it('vierter Fehlversuch von derselben IP ist 429, danach auch eine gueltige Antwort', async () => {
			const { admin } = await meldeAdminAn(prisma, t0);
			const passkey = await legeAdminPasskeyAn(admin.id);
			const status: number[] = [];
			for (let i = 0; i < 4; i++) {
				status.push((await post('/anmelden/passkey', { antwort: antwort('unbekannt', 'unbekannt') })).status);
			}
			expect(status).toEqual([401, 401, 401, 429]);

			const challenge = await holeAnmeldeChallenge();
			const gesperrt = await post('/anmelden/passkey', { antwort: antwort(challenge, passkey.credentialId) });
			expect(gesperrt.status).toBe(429);
			expect(((await gesperrt.json()) as { wartenSekunden: number }).wartenSekunden).toBeGreaterThan(0);
			expect(verifyAuthentication).not.toHaveBeenCalled();
			// Eine gesperrte Anfrage verbraucht die Challenge nicht.
			expect(await prisma.webauthnChallenge.findUnique({ where: { challenge } })).not.toBeNull();
		});
	});

	describe('Passkey hinzufuegen', () => {
		function registrierung(credentialId: string) {
			return {
				credentialId,
				publicKey: 'cHVibGljLWtleQ',
				counter: 0,
				transports: ['internal', 'hybrid'],
				backedUp: true,
			};
		}

		it('Optionen nennen den Admin mit Anzeigename und schliessen eigene Passkeys aus', async () => {
			const { admin, cookie } = await meldeAdminAn(prisma, t0);
			const vorhanden = await legeAdminPasskeyAn(admin.id);

			const r = await post('/konto/passkey/optionen', {}, { cookie });
			expect(r.status).toBe(200);
			const optionen = (await r.json()) as {
				challenge: string;
				user: { name: string; displayName: string };
				excludeCredentials: { id: string }[];
			};
			expect(optionen.user).toMatchObject({
				name: admin.benutzername,
				displayName: `${admin.benutzername} · JuFi-Admin`,
			});
			expect(optionen.excludeCredentials.map((c) => c.id)).toEqual([vorhanden.credentialId]);

			const zeile = await prisma.webauthnChallenge.findUniqueOrThrow({ where: { challenge: optionen.challenge } });
			expect(zeile).toMatchObject({ adminId: admin.id, vereinId: null, personId: null, purpose: 'register' });
		});

		it('Passkey hinzufuegen speichert ihn mit Geraetenamen', async () => {
			const { admin, cookie } = await meldeAdminAn(prisma, t0);
			const optionen = (await (await post('/konto/passkey/optionen', {}, { cookie })).json()) as { challenge: string };
			const credentialId = `cred-${randomUUID()}`;
			verifyRegistration.mockResolvedValue(registrierung(credentialId));

			const r = await post(
				'/konto/passkey',
				{ antwort: antwort(optionen.challenge, credentialId) },
				{ cookie, userAgent: IPHONE },
			);
			expect(r.status).toBe(201);
			expect(await r.json()).toEqual({ label: 'iPhone' });

			expect(verifyRegistration.mock.calls[0]?.[0].expectedChallenge).toBe(optionen.challenge);
			const gespeichert = await prisma.adminPasskey.findUniqueOrThrow({ where: { credentialId } });
			expect(gespeichert).toMatchObject({
				adminId: admin.id,
				publicKey: 'cHVibGljLWtleQ',
				counter: 0,
				transports: ['internal', 'hybrid'],
				backedUp: true,
				label: 'iPhone',
				lastUsedAt: null,
			});
			// Die Challenge ist verbraucht.
			expect(await prisma.webauthnChallenge.findUnique({ where: { challenge: optionen.challenge } })).toBeNull();
		});

		it('Registrierung mit der Challenge eines anderen Admins scheitert', async () => {
			const eigener = await meldeAdminAn(prisma, t0);
			const fremder = await meldeAdminAn(prisma, t0);
			const optionen = (await (await post('/konto/passkey/optionen', {}, { cookie: fremder.cookie })).json()) as {
				challenge: string;
			};
			const credentialId = `cred-${randomUUID()}`;
			verifyRegistration.mockResolvedValue(registrierung(credentialId));

			const r = await post(
				'/konto/passkey',
				{ antwort: antwort(optionen.challenge, credentialId) },
				{ cookie: eigener.cookie },
			);
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual(EINRICHTUNG_GESCHEITERT);
			expect(verifyRegistration).not.toHaveBeenCalled();
			expect(await prisma.adminPasskey.count({ where: { credentialId } })).toBe(0);
		});

		it('Registrierung ohne Challenge, mit Anmelde-Challenge oder abgelaufener Challenge scheitert', async () => {
			const { cookie } = await meldeAdminAn(prisma, t0);
			const credentialId = `cred-${randomUUID()}`;
			verifyRegistration.mockResolvedValue(registrierung(credentialId));

			const unbekannt = await post('/konto/passkey', { antwort: antwort('gibt-es-nicht', credentialId) }, { cookie });
			expect(unbekannt.status).toBe(400);
			expect(await unbekannt.json()).toEqual(EINRICHTUNG_GESCHEITERT);

			// Eine anonyme Anmelde-Challenge (adminId null) taugt nicht zum Einrichten.
			const anmeldung = await holeAnmeldeChallenge();
			expect((await post('/konto/passkey', { antwort: antwort(anmeldung, credentialId) }, { cookie })).status).toBe(
				400,
			);

			const optionen = (await (await post('/konto/passkey/optionen', {}, { cookie })).json()) as { challenge: string };
			uhr = new Date(t0.getTime() + WEBAUTHN_CHALLENGE_TTL_MS);
			expect(
				(await post('/konto/passkey', { antwort: antwort(optionen.challenge, credentialId) }, { cookie })).status,
			).toBe(400);
			expect(verifyRegistration).not.toHaveBeenCalled();
		});

		it('scheiternde Pruefung und schon vergebene Credential-ID sind 400 und speichern nichts', async () => {
			const { admin, cookie } = await meldeAdminAn(prisma, t0);
			const fremd = await meldeAdminAn(prisma, t0);
			const belegt = await legeAdminPasskeyAn(fremd.admin.id);

			const optionen1 = (await (await post('/konto/passkey/optionen', {}, { cookie })).json()) as { challenge: string };
			verifyRegistration.mockResolvedValue(null);
			const r1 = await post('/konto/passkey', { antwort: antwort(optionen1.challenge, 'x') }, { cookie });
			expect(r1.status).toBe(400);
			expect(await r1.json()).toEqual(EINRICHTUNG_GESCHEITERT);

			// Dieselbe Credential-ID wie ein Passkey eines anderen Admins: nie uebernehmen.
			const optionen2 = (await (await post('/konto/passkey/optionen', {}, { cookie })).json()) as { challenge: string };
			verifyRegistration.mockResolvedValue(registrierung(belegt.credentialId));
			const r2 = await post(
				'/konto/passkey',
				{ antwort: antwort(optionen2.challenge, belegt.credentialId) },
				{ cookie },
			);
			expect(r2.status).toBe(400);
			expect(await r2.json()).toEqual(EINRICHTUNG_GESCHEITERT);
			expect(
				(await prisma.adminPasskey.findUniqueOrThrow({ where: { credentialId: belegt.credentialId } })).adminId,
			).toBe(fremd.admin.id);
			expect(await prisma.adminPasskey.count({ where: { adminId: admin.id } })).toBe(0);
		});
	});
});
