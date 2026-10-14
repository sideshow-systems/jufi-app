import {
	AttemptTracker,
	encryptSecret,
	generateRecoveryCodes,
	generateTotpSecret,
	hashRecoveryCode,
	MITGLIEDER_COOKIE,
	verifyPassword,
} from '@jufi/auth';
import { createPrismaClientFromEnv } from '@jufi/db';
import { randomInt, randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebauthnPruefer } from '../abhaengigkeiten.js';
import { PLATZHALTER_HASH } from '../admin/anmeldung.js';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

// Spion um das Original: so laesst sich zeigen, dass auch eine unbekannte
// Kennung durch Argon2 laeuft. Verworfen: die Antwortzeit messen -- auf einem
// belasteten Testrechner schwankt sie mehr als der Unterschied, der zaehlt.
vi.mock('@jufi/auth', async (importOriginal) => {
	const original = await importOriginal<typeof import('@jufi/auth')>();
	return { ...original, verifyPassword: vi.fn(original.verifyPassword) };
});

const PASSWORT = 'gruene-forelle-am-see';
const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };
const FREMDER_PASSKEY = { fehler: 'Dieser Passkey gehört nicht zu diesem Verein' };
const MINUTE_MS = 60 * 1000;

type V = { id: string; slug: string };

describe('Anmelden', () => {
	const prisma = createPrismaClientFromEnv();
	const t0 = new Date('2026-10-13T08:00:00Z');
	/** Vor t0: legeMitgliedAn meldet einmal an, die Tests sehen danach den neuen Zeitpunkt. */
	const angelegt = new Date('2026-01-01T08:00:00Z');
	let uhr = t0;
	let server: TestServer;
	let verein: V;
	let fremd: V;
	let gesperrt: V;
	// Jeder Test eine eigene Adresse, damit sich Fehlversuche verschiedener Tests
	// im Backoff je IP nicht addieren (trust proxy 1 nimmt X-Forwarded-For).
	let ip = '';
	let versuche: AttemptTracker;

	const verifyRegistration = vi.fn<WebauthnPruefer['verifyRegistration']>();
	const verifyAuthentication = vi.fn<WebauthnPruefer['verifyAuthentication']>();

	beforeAll(async () => {
		[verein, fremd, gesperrt] = await Promise.all([
			legeVereinAn(prisma, { slug: 'anmelden-eigen' }),
			legeVereinAn(prisma, { slug: 'anmelden-fremd' }),
			legeVereinAn(prisma, { slug: 'anmelden-gesperrt', status: 'GESPERRT' }),
		]);
	});

	beforeEach(async () => {
		uhr = t0;
		ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
		verifyAuthentication.mockReset();
		vi.mocked(verifyPassword).mockClear();
		// Fester AttemptTracker je Test: kein Zaehler aus einem anderen Test.
		versuche = new AttemptTracker(() => uhr.getTime());
		await server?.schliessen();
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr,
				anmeldeVersuche: versuche,
				webauthn: { verifyRegistration, verifyAuthentication },
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	const post = (v: { slug: string }, pfad: string, body?: unknown, vonIp = ip) =>
		sende(server.url, `/${v.slug}/api/v1${pfad}`, { methode: 'POST', body, kopf: { 'X-Forwarded-For': vonIp } });

	function cookieAus(r: Response): string | undefined {
		const treffer = new RegExp(`${MITGLIEDER_COOKIE}=([^;]+)`).exec(r.headers.get('set-cookie') ?? '');
		return treffer ? `${MITGLIEDER_COOKIE}=${treffer[1]}` : undefined;
	}

	const kuerzel = () => randomUUID().slice(0, 8);

	async function erwachsener(v: V, e: { passwort?: string | null } = {}) {
		const email = `erw-${kuerzel()}@example.test`;
		const m = await legeMitgliedAn(prisma, v, {
			art: 'ERWACHSENER',
			email,
			passwort: e.passwort === null ? undefined : (e.passwort ?? PASSWORT),
			jetzt: angelegt,
		});
		return { ...m, email };
	}

	async function kind(v: V, anmeldename = `kind-${kuerzel()}`) {
		const m = await legeMitgliedAn(prisma, v, { art: 'JUNGFISCHER', anmeldename, passwort: PASSWORT, jetzt: angelegt });
		return { ...m, anmeldename };
	}

	async function mitTotp(zugangId: string) {
		const geheimnis = generateTotpSecret();
		const codes = generateRecoveryCodes();
		await prisma.zugang.update({
			where: { id: zugangId },
			data: { totpGeheimnis: encryptSecret(geheimnis), totpAktivAm: angelegt },
		});
		const { vereinId } = await prisma.zugang.findUniqueOrThrow({ where: { id: zugangId } });
		await prisma.recoveryCode.createMany({
			data: codes.map((c) => ({ vereinId, zugangId, codeHash: hashRecoveryCode(c) })),
		});
		return { geheimnis, codes };
	}

	const letzteAnmeldung = async (zugangId: string) =>
		(await prisma.zugang.findUniqueOrThrow({ where: { id: zugangId } })).letzteAnmeldungAm;

	describe('Passwort', () => {
		it('eine 90-kB-Kennung ist 401 wie jede falsche und landet nicht im Backoff-Schluessel', async () => {
			const fail = vi.spyOn(versuche, 'fail');
			// Knapp unter der Grenze von express.json (100 kB), sonst antwortete schon der Parser.
			for (const kennung of [`${'a'.repeat(90_000)}@example.test`, 'b'.repeat(90_000)]) {
				const r = await post(verein, '/anmelden', { kennung, passwort: PASSWORT });
				expect(r.status).toBe(401);
				expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			}
			const schluessel = fail.mock.calls.map(([k]) => k);
			expect(schluessel.length).toBeGreaterThan(0);
			expect(Math.max(...schluessel.map((k) => k.length))).toBeLessThan(400);
		});

		it('Erwachsener meldet sich mit E-Mail und Passwort an', async () => {
			const { email, zugangId } = await erwachsener(verein);
			const r = await post(verein, '/anmelden', { kennung: email, passwort: PASSWORT });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig' });
			const cookie = cookieAus(r);
			expect(cookie).toBeDefined();
			expect(r.headers.get('set-cookie')).toContain(`Path=/${verein.slug}/`);
			expect(await letzteAnmeldung(zugangId)).toEqual(t0);
			const ich = await sende(server.url, `/${verein.slug}/api/v1/ich`, { cookie });
			expect(ich.status).toBe(200);
		});

		it('Erwachsener tippt die Adresse gross und mit Rand', async () => {
			const { email } = await erwachsener(verein);
			const r = await post(verein, '/anmelden', { kennung: `  ${email.toUpperCase()} `, passwort: PASSWORT });
			expect(r.status).toBe(200);
		});

		it('Kind tippt Grossschreibung und Rand', async () => {
			// Eigener Verein: "lena" ist ein Name, den andere Tests auch vergeben koennten.
			const eigen = await legeVereinAn(prisma, { slug: `anm-lena-${randomInt(1000, 9999)}` });
			const { zugangId } = await kind(eigen, 'lena');
			const r = await post(eigen, '/anmelden', { kennung: '  Lena ', passwort: PASSWORT });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig' });
			expect(await letzteAnmeldung(zugangId)).toEqual(t0);
		});

		it('Falsches Passwort, unbekannte Kennung, Zugang ohne Passwort, entfernte Person, Jungfischer ohne Zugangserlaubnis', async () => {
			const richtig = await erwachsener(verein);
			const ohnePasswort = await erwachsener(verein, { passwort: null });
			const entfernt = await erwachsener(verein);
			await prisma.person.update({ where: { id: entfernt.personId }, data: { entferntAm: angelegt } });
			const gesperrtesKind = await kind(verein);
			await prisma.person.update({ where: { id: gesperrtesKind.personId }, data: { zugangErlaubt: false } });

			const faelle = [
				{ kennung: richtig.email, passwort: 'falsches-passwort-123' },
				{ kennung: `unbekannt-${kuerzel()}@example.test`, passwort: PASSWORT },
				{ kennung: `unbekannt-${kuerzel()}`, passwort: PASSWORT },
				{ kennung: ohnePasswort.email, passwort: PASSWORT },
				{ kennung: entfernt.email, passwort: PASSWORT },
				{ kennung: gesperrtesKind.anmeldename, passwort: PASSWORT },
			];
			for (const fall of faelle) {
				// Je Fall eine eigene IP: sonst sperrte der Zaehler je IP ab dem vierten.
				const r = await post(verein, '/anmelden', fall, `10.99.${randomInt(256)}.${randomInt(1, 255)}`);
				expect(r.status, fall.kennung).toBe(401);
				expect(await r.json()).toEqual(FEHLGESCHLAGEN);
				expect(cookieAus(r)).toBeUndefined();
			}
		});

		it('unbekannte Kennung prueft gegen den Platzhalter-Hash', async () => {
			await post(verein, '/anmelden', { kennung: `niemand-${kuerzel()}`, passwort: PASSWORT });
			expect(vi.mocked(verifyPassword)).toHaveBeenCalledWith(PLATZHALTER_HASH, PASSWORT);
		});

		it('fehlender oder kaputter Body ist 401, kein 500', async () => {
			for (const body of [undefined, {}, { kennung: 42, passwort: ['x'] }]) {
				const r = await post(verein, '/anmelden', body, `10.98.${randomInt(256)}.${randomInt(1, 255)}`);
				expect(r.status).toBe(401);
			}
		});
	});

	describe('Backoff', () => {
		it('vier Fehlversuche sperren Kennung und IP', async () => {
			const { email } = await erwachsener(verein);
			const falsch = { kennung: email, passwort: 'falsches-passwort-123' };
			for (let i = 0; i < 3; i++) expect((await post(verein, '/anmelden', falsch)).status).toBe(401);
			const vierter = await post(verein, '/anmelden', falsch);
			expect(vierter.status).toBe(429);
			expect((await vierter.json()).wartenSekunden).toBeGreaterThan(0);

			// Auch das richtige Passwort wartet.
			expect((await post(verein, '/anmelden', { kennung: email, passwort: PASSWORT })).status).toBe(429);

			// Eine andere Kennung von derselben IP: die IP ist gesperrt.
			const anderer = await erwachsener(verein);
			expect((await post(verein, '/anmelden', { kennung: anderer.email, passwort: PASSWORT })).status).toBe(429);
			// Dieselbe andere Kennung von einer anderen IP geht.
			const r = await post(verein, '/anmelden', { kennung: anderer.email, passwort: PASSWORT }, '10.250.0.1');
			expect(r.status).toBe(200);
		});

		it('die Kennung bleibt auch von einer anderen IP gesperrt', async () => {
			const { email } = await erwachsener(verein);
			const falsch = { kennung: email, passwort: 'falsches-passwort-123' };
			for (let i = 0; i < 4; i++) await post(verein, '/anmelden', falsch);
			const r = await post(verein, '/anmelden', { kennung: email, passwort: PASSWORT }, '10.251.0.1');
			expect(r.status).toBe(429);
		});

		it('Gross- und Kleinschreibung zaehlen auf dieselbe Kennung', async () => {
			const { email } = await erwachsener(verein);
			for (let i = 0; i < 4; i++) {
				// Je Versuch eine andere IP: gesperrt wird hier allein die Kennung.
				await post(
					verein,
					'/anmelden',
					{ kennung: ` ${email.toUpperCase()}`, passwort: 'falsch-falsch-1' },
					`10.252.0.${i + 1}`,
				);
			}
			expect((await post(verein, '/anmelden', { kennung: email, passwort: PASSWORT }, '10.252.1.1')).status).toBe(429);
		});

		it('Erfolg setzt zurueck', async () => {
			const { email } = await erwachsener(verein);
			const falsch = { kennung: email, passwort: 'falsches-passwort-123' };
			for (let i = 0; i < 3; i++) expect((await post(verein, '/anmelden', falsch)).status).toBe(401);
			expect((await post(verein, '/anmelden', { kennung: email, passwort: PASSWORT })).status).toBe(200);
			for (let i = 0; i < 3; i++) expect((await post(verein, '/anmelden', falsch)).status).toBe(401);
		});

		it('zwei Vereine mit gleicher Kennung teilen den Zaehler nicht', async () => {
			const name = `zwilling-${kuerzel()}`;
			await kind(verein, name);
			await kind(fremd, name);
			const falsch = { kennung: name, passwort: 'falsches-passwort-123' };
			for (let i = 0; i < 4; i++) await post(verein, '/anmelden', falsch);
			expect((await post(verein, '/anmelden', { kennung: name, passwort: PASSWORT }, '10.253.0.1')).status).toBe(429);
			expect((await post(fremd, '/anmelden', { kennung: name, passwort: PASSWORT }, '10.253.0.2')).status).toBe(200);
		});
	});

	describe('TOTP', () => {
		async function zwischenmarke(v: V, email: string): Promise<string> {
			const r = await post(v, '/anmelden', { kennung: email, passwort: PASSWORT });
			expect(r.status).toBe(200);
			expect(cookieAus(r)).toBeUndefined();
			const body = (await r.json()) as { schritt: string; zwischenmarke: string };
			expect(body.schritt).toBe('totp');
			return body.zwischenmarke;
		}

		it('Zugang mit TOTP: erst Marke, dann mit richtigem Code angemeldet', async () => {
			const m = await erwachsener(verein);
			const { geheimnis, codes } = await mitTotp(m.zugangId);
			const marke = await zwischenmarke(verein, m.email);
			// Das Passwort allein hat noch nicht angemeldet.
			expect(await letzteAnmeldung(m.zugangId)).toEqual(angelegt);

			const r = await post(verein, '/anmelden/totp', {
				zwischenmarke: marke,
				code: await generate({ secret: geheimnis }),
			});
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig', wiederherstellungscodesUebrig: codes.length });
			expect(cookieAus(r)).toBeDefined();
			expect(await letzteAnmeldung(m.zugangId)).toEqual(t0);
		});

		it('falscher Code ist 401', async () => {
			const m = await erwachsener(verein);
			await mitTotp(m.zugangId);
			const marke = await zwischenmarke(verein, m.email);
			const r = await post(verein, '/anmelden/totp', { zwischenmarke: marke, code: '000000' });
			expect(r.status).toBe(401);
			expect(cookieAus(r)).toBeUndefined();
		});

		it('Wiederherstellungscode gilt genau einmal, auch gleichzeitig', async () => {
			const m = await erwachsener(verein);
			const { codes } = await mitTotp(m.zugangId);
			const code = codes[0] ?? '';
			// Beide Marken vorher holen, damit die zwei Einloesungen wirklich gleichzeitig laufen.
			const marken = [await zwischenmarke(verein, m.email), await zwischenmarke(verein, m.email)];
			const [a, b] = await Promise.all(
				marken.map((marke) => post(verein, '/anmelden/totp', { zwischenmarke: marke, wiederherstellungscode: code })),
			);
			expect([a.status, b.status].sort()).toEqual([200, 401]);
			const ok = a.status === 200 ? a : b;
			expect(await ok.json()).toEqual({ schritt: 'fertig', wiederherstellungscodesUebrig: codes.length - 1 });
			const nochmal = await post(verein, '/anmelden/totp', {
				zwischenmarke: await zwischenmarke(verein, m.email),
				wiederherstellungscode: code,
			});
			expect(nochmal.status).toBe(401);
		});

		it('abgelaufene oder verfaelschte Zwischenmarke ist 401', async () => {
			const m = await erwachsener(verein);
			const { geheimnis } = await mitTotp(m.zugangId);
			const marke = await zwischenmarke(verein, m.email);
			const verfaelscht = `${marke.slice(0, -1)}${marke.endsWith('A') ? 'B' : 'A'}`;
			expect(
				(
					await post(verein, '/anmelden/totp', {
						zwischenmarke: verfaelscht,
						code: await generate({ secret: geheimnis }),
					})
				).status,
			).toBe(401);
			uhr = new Date(t0.getTime() + 5 * MINUTE_MS);
			expect(
				(await post(verein, '/anmelden/totp', { zwischenmarke: marke, code: await generate({ secret: geheimnis }) }))
					.status,
			).toBe(401);
		});

		it('die Marke aus einem Verein gilt im anderen nicht', async () => {
			const m = await erwachsener(verein);
			const { geheimnis } = await mitTotp(m.zugangId);
			const marke = await zwischenmarke(verein, m.email);
			const r = await post(fremd, '/anmelden/totp', {
				zwischenmarke: marke,
				code: await generate({ secret: geheimnis }),
			});
			expect(r.status).toBe(401);
			expect(cookieAus(r)).toBeUndefined();
		});

		it('fehlender Body ist 401, kein 500', async () => {
			expect((await post(verein, '/anmelden/totp')).status).toBe(401);
		});
	});

	describe('Passkey', () => {
		async function optionen(v: V): Promise<{ challenge: string; allowCredentials?: unknown }> {
			const r = await post(v, '/anmelden/passkey-optionen');
			expect(r.status).toBe(200);
			return ((await r.json()) as { optionen: { challenge: string; allowCredentials?: unknown } }).optionen;
		}

		function antwort(challenge: string, id: string) {
			return {
				id,
				rawId: id,
				type: 'public-key',
				response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url') },
			};
		}

		async function passkey(v: V, zugangId: string) {
			const credentialId = `cred-${randomUUID()}`;
			await prisma.passkey.create({
				data: { vereinId: v.id, zugangId, credentialId, publicKey: 'cHVibGljLWtleQ', counter: 0, label: 'iPhone' },
			});
			return credentialId;
		}

		it('Optionen ohne allowCredentials, Challenge am Verein', async () => {
			const o = await optionen(verein);
			expect(o.allowCredentials ?? []).toEqual([]);
			const zeile = await prisma.webauthnChallenge.findFirstOrThrow({ where: { challenge: o.challenge } });
			expect(zeile).toMatchObject({ vereinId: verein.id, purpose: 'authenticate', personId: null });
		});

		it('Anmeldung mit Passkey: Cookie, Zaehler und lastUsedAt, Challenge verbraucht', async () => {
			const m = await kind(verein);
			const credentialId = await passkey(verein, m.zugangId);
			const { challenge } = await optionen(verein);
			verifyAuthentication.mockResolvedValue({ counter: 7 });

			const r = await post(verein, '/anmelden/passkey', { antwort: antwort(challenge, credentialId) });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ schritt: 'fertig' });
			expect(cookieAus(r)).toBeDefined();
			expect(verifyAuthentication.mock.calls[0]?.[0]).toMatchObject({
				expectedChallenge: challenge,
				passkey: { credentialId, counter: 0 },
			});
			const zeile = await prisma.passkey.findUniqueOrThrow({ where: { credentialId } });
			expect(zeile.counter).toBe(7);
			expect(zeile.lastUsedAt).toEqual(t0);
			expect(await letzteAnmeldung(m.zugangId)).toEqual(t0);

			const nochmal = await post(verein, '/anmelden/passkey', { antwort: antwort(challenge, credentialId) });
			expect(nochmal.status).toBe(401);
			expect(await nochmal.json()).toEqual(FEHLGESCHLAGEN);
		});

		it('Zaehler 0 bleibt 0 (synchronisierter Schluessel)', async () => {
			const m = await erwachsener(verein);
			const credentialId = await passkey(verein, m.zugangId);
			const { challenge } = await optionen(verein);
			verifyAuthentication.mockResolvedValue({ counter: 0 });
			expect((await post(verein, '/anmelden/passkey', { antwort: antwort(challenge, credentialId) })).status).toBe(200);
		});

		it('Passkey mit TOTP-Zugang meldet ohne zweiten Schritt an', async () => {
			const m = await erwachsener(verein);
			await mitTotp(m.zugangId);
			const credentialId = await passkey(verein, m.zugangId);
			const { challenge } = await optionen(verein);
			verifyAuthentication.mockResolvedValue({ counter: 1 });
			const r = await post(verein, '/anmelden/passkey', { antwort: antwort(challenge, credentialId) });
			expect(await r.json()).toEqual({ schritt: 'fertig' });
		});

		it('Challenge aus einem Verein gilt im anderen nicht', async () => {
			const m = await kind(fremd);
			const credentialId = await passkey(fremd, m.zugangId);
			const { challenge } = await optionen(verein);
			verifyAuthentication.mockResolvedValue({ counter: 1 });
			const r = await post(fremd, '/anmelden/passkey', { antwort: antwort(challenge, credentialId) });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			expect(verifyAuthentication).not.toHaveBeenCalled();
		});

		it('Passkey eines anderen Vereins oder unbekannter Passkey', async () => {
			const m = await kind(fremd);
			const fremderPasskey = await passkey(fremd, m.zugangId);
			verifyAuthentication.mockResolvedValue({ counter: 1 });
			for (const credentialId of [fremderPasskey, `cred-${randomUUID()}`]) {
				const { challenge } = await optionen(verein);
				const r = await post(verein, '/anmelden/passkey', { antwort: antwort(challenge, credentialId) });
				expect(r.status).toBe(401);
				expect(await r.json()).toEqual(FREMDER_PASSKEY);
			}
			expect(verifyAuthentication).not.toHaveBeenCalled();
			// Der fremde Passkey ist unberuehrt.
			expect(
				(await prisma.passkey.findUniqueOrThrow({ where: { credentialId: fremderPasskey } })).lastUsedAt,
			).toBeNull();
		});

		it('gescheiterte Pruefung, entfernte Person und Kind ohne Zugangserlaubnis sind "Anmeldung fehlgeschlagen"', async () => {
			const pruefungFalsch = await kind(verein);
			const entfernt = await erwachsener(verein);
			await prisma.person.update({ where: { id: entfernt.personId }, data: { entferntAm: angelegt } });
			const ohneErlaubnis = await kind(verein);
			await prisma.person.update({ where: { id: ohneErlaubnis.personId }, data: { zugangErlaubt: false } });

			const faelle: [string, () => void][] = [
				[pruefungFalsch.zugangId, () => verifyAuthentication.mockRejectedValue(new Error('Signatur'))],
				[pruefungFalsch.zugangId, () => verifyAuthentication.mockResolvedValue(null)],
				[entfernt.zugangId, () => verifyAuthentication.mockResolvedValue({ counter: 1 })],
				[ohneErlaubnis.zugangId, () => verifyAuthentication.mockResolvedValue({ counter: 1 })],
			];
			for (const [zugangId, stelle] of faelle) {
				stelle();
				const credentialId = await passkey(verein, zugangId);
				const { challenge } = await optionen(verein);
				const r = await post(
					verein,
					'/anmelden/passkey',
					{ antwort: antwort(challenge, credentialId) },
					`10.97.0.${randomInt(1, 255)}`,
				);
				expect(r.status).toBe(401);
				expect(await r.json()).toEqual(FEHLGESCHLAGEN);
				expect(cookieAus(r)).toBeUndefined();
			}
		});

		it('fehlender oder kaputter Body ist 401, kein 500', async () => {
			for (const body of [undefined, {}, { antwort: 'x' }, { antwort: { id: 1, response: {} } }]) {
				const r = await post(verein, '/anmelden/passkey', body, `10.96.0.${randomInt(1, 255)}`);
				expect(r.status).toBe(401);
				expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			}
		});

		it('Backoff je IP', async () => {
			for (let i = 0; i < 3; i++) expect((await post(verein, '/anmelden/passkey', {})).status).toBe(401);
			expect((await post(verein, '/anmelden/passkey', {})).status).toBe(429);
			// Derselbe Zaehler wie beim Passwort.
			const { email } = await erwachsener(verein);
			expect((await post(verein, '/anmelden', { kennung: email, passwort: PASSWORT })).status).toBe(429);
		});
	});

	it('Gesperrter Verein ist auf allen vier Routen 404', async () => {
		for (const pfad of ['/anmelden', '/anmelden/totp', '/anmelden/passkey-optionen', '/anmelden/passkey']) {
			expect((await post(gesperrt, pfad, {})).status, pfad).toBe(404);
		}
	});
});
