import { AttemptTracker, decryptSecret, hashRecoveryCode, MITGLIEDER_COOKIE, verifyPassword } from '@jufi/auth';
import { createPrismaClientFromEnv, sperreVereinszeile, vereinDb } from '@jufi/db';
import { randomInt, randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebauthnPruefer } from '../abhaengigkeiten.js';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeSitzungAn } from './sitzung.js';
import { legeMitgliedAn } from './test-mitglieder.js';

// Spion um das Original: ein Test kann so genau vor der Sperre die Sitzung
// loeschen, wie es ein gleichzeitiges Einloesen eines Reset-Links taete.
// Verworfen: Einloesen und Profil parallel starten -- ob die Sitzung vor oder
// nach der Pruefung verschwindet, hinge vom Zufall ab, der Test bewiese wenig.
vi.mock('@jufi/db', async (importOriginal) => {
	const original = await importOriginal<typeof import('@jufi/db')>();
	return { ...original, sperreVereinszeile: vi.fn(original.sperreVereinszeile) };
});

const PASSWORT = 'gruene-forelle-am-see';
const NEU = 'blauer-hecht-im-weiher';
const FEHLGESCHLAGEN = { fehler: 'Anmeldung fehlgeschlagen' };
const LETZTER_WEG = { fehler: 'Das ist dein letzter Anmeldeweg' };
const KEINE_RECHTE = { fehler: 'Dafür fehlen die Rechte' };
const NICHT_GEFUNDEN = { fehler: 'nicht gefunden' };

type V = { id: string; slug: string };

describe('Profil', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	let verein: V;
	let versuche: AttemptTracker;
	const verifyRegistration = vi.fn<WebauthnPruefer['verifyRegistration']>();
	const verifyAuthentication = vi.fn<WebauthnPruefer['verifyAuthentication']>();

	beforeAll(async () => {
		verein = await legeVereinAn(prisma, { slug: 'profil-eigen' });
	});

	beforeEach(async () => {
		verifyRegistration.mockReset();
		// Fester Zaehler je Test: Fehlversuche eines anderen Tests zaehlen hier nicht.
		versuche = new AttemptTracker();
		await server?.schliessen();
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				anmeldeVersuche: versuche,
				webauthn: { verifyRegistration, verifyAuthentication },
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	const api = (pfad: string, o: { methode?: string; body?: unknown; cookie?: string } = {}) =>
		sende(server.url, `/${verein.slug}/api/v1${pfad}`, o);
	const ich = async (cookie: string) => {
		const r = await api('/ich', { cookie });
		expect(r.status).toBe(200);
		return (await r.json()) as {
			passkeys: Record<string, unknown>[];
			hatPasswort: boolean;
			totp: { moeglich: boolean; aktiv: boolean; wiederherstellungscodesUebrig: number };
		};
	};

	async function erwachsener(e: { passwort?: string | null; rechte?: ('MITGLIEDER' | 'DOKUMENTE')[] } = {}) {
		const email = `profil-${randomUUID().slice(0, 8)}@example.test`;
		const m = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			email,
			passwort: e.passwort === null ? undefined : (e.passwort ?? PASSWORT),
			rechte: e.rechte,
		});
		return { ...m, email };
	}

	async function passkey(zugangId: string, label = 'iPhone', v: V = verein) {
		return prisma.passkey.create({
			data: {
				vereinId: v.id,
				zugangId,
				credentialId: `cred-${randomUUID()}`,
				publicKey: 'cHVibGljLWtleQ',
				label,
				transports: ['internal'],
			},
		});
	}

	/** Antwort des Geraets, soweit der Server sie liest: die Challenge in clientDataJSON. */
	function antwort(challenge: string, id = `cred-${randomUUID()}`) {
		return {
			id,
			rawId: id,
			type: 'public-key',
			response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url') },
		};
	}

	describe('GET /ich', () => {
		it('listet Passkeys ohne publicKey und credentialId, dazu Passwort und TOTP', async () => {
			const m = await erwachsener({ rechte: ['MITGLIEDER'] });
			const pk = await passkey(m.zugangId, 'Mac');
			const body = await ich(m.cookie);
			expect(body.passkeys).toEqual([
				{ id: pk.id, label: 'Mac', erstelltAm: pk.createdAt.toISOString(), zuletztGenutztAm: null },
			]);
			expect(body.hatPasswort).toBe(true);
			expect(body.totp).toEqual({ moeglich: true, aktiv: false, wiederherstellungscodesUebrig: 0 });
			// Nichts davon darf irgendwo in der Antwort stehen, auch nicht verschachtelt.
			const roh = JSON.stringify(body);
			for (const geheim of [pk.credentialId, pk.publicKey, 'passwortHash', 'totpGeheimnis', 'argon2']) {
				expect(roh).not.toContain(geheim);
			}
		});

		it('TOTP ist nur fuer Erwachsene mit Recht moeglich', async () => {
			const ohne = await erwachsener();
			expect((await ich(ohne.cookie)).totp.moeglich).toBe(false);
			const kind = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', passwort: PASSWORT });
			const body = await ich(kind.cookie);
			expect(body.totp.moeglich).toBe(false);
			expect(body.hatPasswort).toBe(true);
		});
	});

	describe('Passwort', () => {
		it('setzen ohne vorhandenes', async () => {
			const m = await erwachsener({ passwort: null });
			await passkey(m.zugangId);
			const r = await api('/profil/passwort', { methode: 'POST', cookie: m.cookie, body: { neu: NEU } });
			expect(r.status).toBe(200);
			const zugang = await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } });
			expect(await verifyPassword(zugang.passwortHash ?? '', NEU)).toBe(true);
			expect((await ich(m.cookie)).hatPasswort).toBe(true);
		});

		it('ein zu kurzes neues Passwort ist 400 mit Hinweis', async () => {
			const m = await erwachsener({ passwort: null });
			const r = await api('/profil/passwort', { methode: 'POST', cookie: m.cookie, body: { neu: 'kurz' } });
			expect(r.status).toBe(400);
			expect(((await r.json()) as { fehler: string }).fehler).toBeTruthy();
		});

		it('fehlender oder kaputter Body ist kein 500', async () => {
			const m = await erwachsener();
			for (const body of [undefined, {}, { neu: 5, alt: ['x'] }, 'text']) {
				const r = await api('/profil/passwort', { methode: 'POST', cookie: m.cookie, body });
				expect(r.status, JSON.stringify(body)).toBeLessThan(500);
			}
		});

		it('aendern verlangt das alte, falsch ist 401 und der vierte Fehlversuch 429', async () => {
			const m = await erwachsener();
			const ohne = await api('/profil/passwort', { methode: 'POST', cookie: m.cookie, body: { neu: NEU } });
			expect([400, 401]).toContain(ohne.status);
			// Neuer Zaehler, damit der Fall ohne alt nicht mitzaehlt.
			versuche.reset(`m-passwort:${m.zugangId}`);
			for (let i = 0; i < 3; i++) {
				const r = await api('/profil/passwort', {
					methode: 'POST',
					cookie: m.cookie,
					body: { neu: NEU, alt: 'falsches-passwort-123' },
				});
				expect(r.status).toBe(401);
				expect(await r.json()).toEqual(FEHLGESCHLAGEN);
			}
			const vierter = await api('/profil/passwort', {
				methode: 'POST',
				cookie: m.cookie,
				body: { neu: NEU, alt: 'falsches-passwort-123' },
			});
			expect(vierter.status).toBe(429);
			// Gesperrt auch mit dem richtigen: sonst liesse sich weiter raten.
			const richtig = await api('/profil/passwort', {
				methode: 'POST',
				cookie: m.cookie,
				body: { neu: NEU, alt: PASSWORT },
			});
			expect(richtig.status).toBe(429);
			const zugang = await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } });
			expect(await verifyPassword(zugang.passwortHash ?? '', PASSWORT)).toBe(true);
		});

		it('gleichzeitige Fehlversuche umgehen den Backoff nicht', async () => {
			const m = await erwachsener();
			const antworten = await Promise.all(
				Array.from({ length: 8 }, () =>
					api('/profil/passwort', {
						methode: 'POST',
						cookie: m.cookie,
						body: { neu: NEU, alt: 'falsch-falsch-falsch' },
					}),
				),
			);
			const status = antworten.map((r) => r.status);
			expect(status.filter((s) => s === 401)).toHaveLength(3);
			expect(status.filter((s) => s === 429)).toHaveLength(5);
		});

		it('andere Sitzungen enden, die laufende bleibt', async () => {
			const m = await erwachsener();
			const token = await legeSitzungAn(vereinDb(prisma, verein.id), { zugangId: m.zugangId, jetzt: new Date() });
			const zweitesGeraet = `${MITGLIEDER_COOKIE}=${token}`;
			expect((await api('/ich', { cookie: zweitesGeraet })).status).toBe(200);
			// Eine Sitzung einer anderen Person bleibt unberuehrt.
			const andere = await erwachsener();

			const r = await api('/profil/passwort', {
				methode: 'POST',
				cookie: m.cookie,
				body: { neu: NEU, alt: PASSWORT },
			});
			expect(r.status).toBe(200);
			expect((await api('/ich', { cookie: zweitesGeraet })).status).toBe(401);
			expect((await api('/ich', { cookie: m.cookie })).status).toBe(200);
			expect((await api('/ich', { cookie: andere.cookie })).status).toBe(200);
			expect(await prisma.session.count({ where: { zugangId: m.zugangId } })).toBe(1);

			// Mit dem neuen Passwort anmelden geht, mit dem alten nicht mehr.
			const alt = await api('/anmelden', { methode: 'POST', body: { kennung: m.email, passwort: PASSWORT } });
			expect(alt.status).toBe(401);
			const neu = await api('/anmelden', { methode: 'POST', body: { kennung: m.email, passwort: NEU } });
			expect(neu.status).toBe(200);
		});
	});

	describe('Passkeys', () => {
		async function optionen(cookie: string): Promise<string> {
			const r = await api('/profil/passkeys/optionen', { methode: 'POST', cookie });
			expect(r.status).toBe(200);
			return ((await r.json()) as { optionen: { challenge: string } }).optionen.challenge;
		}

		it('hinzufuegen erscheint in /ich', async () => {
			const m = await erwachsener();
			const vorhanden = await passkey(m.zugangId);
			const r0 = await api('/profil/passkeys/optionen', { methode: 'POST', cookie: m.cookie });
			const { optionen: o } = (await r0.json()) as {
				optionen: { challenge: string; excludeCredentials?: { id: string }[] };
			};
			// Der vorhandene steht in excludeCredentials, damit das Geraet ihn nicht doppelt anlegt.
			expect(o.excludeCredentials?.map((c) => c.id)).toContain(vorhanden.credentialId);
			const credentialId = `cred-${randomUUID()}`;
			verifyRegistration.mockResolvedValue({
				credentialId,
				publicKey: 'cHVibGljLWtleQ',
				counter: 0,
				transports: ['internal'],
				backedUp: true,
			});
			const r = await api('/profil/passkeys', {
				methode: 'POST',
				cookie: m.cookie,
				body: { antwort: antwort(o.challenge, credentialId), name: '  Tablet  ' },
			});
			expect(r.status).toBe(201);
			const body = (await r.json()) as { id: string; label: string };
			expect(body.label).toBe('Tablet');
			expect(verifyRegistration.mock.calls[0]?.[0].expectedChallenge).toBe(o.challenge);
			const liste = (await ich(m.cookie)).passkeys;
			expect(liste.map((p) => p['id'])).toContain(body.id);
			const gespeichert = await prisma.passkey.findUniqueOrThrow({ where: { credentialId } });
			expect(gespeichert).toMatchObject({ zugangId: m.zugangId, vereinId: verein.id, label: 'Tablet' });
			expect(await prisma.webauthnChallenge.count({ where: { challenge: o.challenge } })).toBe(0);
		});

		it('die Challenge einer anderen Person taugt nicht', async () => {
			const a = await erwachsener();
			const b = await erwachsener();
			const c = await optionen(a.cookie);
			verifyRegistration.mockResolvedValue({
				credentialId: `cred-${randomUUID()}`,
				publicKey: 'cHVibGljLWtleQ',
				counter: 0,
				transports: [],
				backedUp: false,
			});
			const r = await api('/profil/passkeys', { methode: 'POST', cookie: b.cookie, body: { antwort: antwort(c) } });
			expect(r.status).toBe(400);
			expect(verifyRegistration).not.toHaveBeenCalled();
			expect(await prisma.passkey.count({ where: { zugangId: b.zugangId } })).toBe(0);
		});

		it('kaputte Antwort und fehlender Body sind 400, kein 500', async () => {
			const m = await erwachsener();
			for (const body of [undefined, {}, { antwort: 'x' }, { antwort: { response: {} } }]) {
				const r = await api('/profil/passkeys', { methode: 'POST', cookie: m.cookie, body });
				expect(r.status, JSON.stringify(body)).toBe(400);
			}
			const c = await optionen(m.cookie);
			verifyRegistration.mockRejectedValueOnce(new Error('kaputte Signatur'));
			const r = await api('/profil/passkeys', { methode: 'POST', cookie: m.cookie, body: { antwort: antwort(c) } });
			expect(r.status).toBe(400);
		});

		it('umbenennen', async () => {
			const m = await erwachsener();
			const pk = await passkey(m.zugangId);
			const r = await api(`/profil/passkeys/${pk.id}`, {
				methode: 'PATCH',
				cookie: m.cookie,
				body: { label: '  Handy von Erika ' },
			});
			expect(r.status).toBe(200);
			expect((await prisma.passkey.findUniqueOrThrow({ where: { id: pk.id } })).label).toBe('Handy von Erika');
			for (const label of ['', '   ', 'x'.repeat(41), undefined, 5]) {
				const falsch = await api(`/profil/passkeys/${pk.id}`, { methode: 'PATCH', cookie: m.cookie, body: { label } });
				expect(falsch.status, String(label)).toBe(400);
			}
			expect((await prisma.passkey.findUniqueOrThrow({ where: { id: pk.id } })).label).toBe('Handy von Erika');
		});

		it('letzten Anmeldeweg nicht loeschen', async () => {
			const nurPasskey = await erwachsener({ passwort: null });
			const einziger = await passkey(nurPasskey.zugangId);
			const r = await api(`/profil/passkeys/${einziger.id}`, { methode: 'DELETE', cookie: nurPasskey.cookie });
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual(LETZTER_WEG);
			expect(await prisma.passkey.count({ where: { id: einziger.id } })).toBe(1);

			const mitPasswort = await erwachsener();
			const pk = await passkey(mitPasswort.zugangId);
			expect((await api(`/profil/passkeys/${pk.id}`, { methode: 'DELETE', cookie: mitPasswort.cookie })).status).toBe(
				200,
			);
			expect(await prisma.passkey.count({ where: { id: pk.id } })).toBe(0);

			const zwei = await erwachsener({ passwort: null });
			const [eins] = [await passkey(zwei.zugangId), await passkey(zwei.zugangId)];
			expect((await api(`/profil/passkeys/${eins?.id}`, { methode: 'DELETE', cookie: zwei.cookie })).status).toBe(200);
			expect(await prisma.passkey.count({ where: { zugangId: zwei.zugangId } })).toBe(1);
		});

		it('zwei gleichzeitige Loeschungen lassen den letzten Passkey stehen', async () => {
			// Mehrere Runden: eine Wettlaufsituation zeigt sich nicht bei jedem Lauf.
			for (let runde = 0; runde < 5; runde++) {
				const m = await erwachsener({ passwort: null });
				const a = await passkey(m.zugangId);
				const b = await passkey(m.zugangId);
				const antworten = await Promise.all(
					[a, b].map((pk) => api(`/profil/passkeys/${pk.id}`, { methode: 'DELETE', cookie: m.cookie })),
				);
				expect(antworten.map((r) => r.status).sort()).toEqual([200, 409]);
				expect(await prisma.passkey.count({ where: { zugangId: m.zugangId } })).toBe(1);
			}
		});

		it('Passkey eines anderen Zugangs im selben Verein ist 404 und bleibt unveraendert', async () => {
			const ich = await erwachsener();
			const andere = await erwachsener();
			const fremd = await passkey(andere.zugangId, 'Fremdes Telefon');
			const umbenennen = await api(`/profil/passkeys/${fremd.id}`, {
				methode: 'PATCH',
				cookie: ich.cookie,
				body: { label: 'Meins' },
			});
			expect(umbenennen.status).toBe(404);
			expect(await umbenennen.json()).toEqual(NICHT_GEFUNDEN);
			const loeschen = await api(`/profil/passkeys/${fremd.id}`, { methode: 'DELETE', cookie: ich.cookie });
			expect(loeschen.status).toBe(404);
			expect(await prisma.passkey.findUniqueOrThrow({ where: { id: fremd.id } })).toEqual(fremd);
			// Eine erfundene Id ebenso.
			expect((await api('/profil/passkeys/gibt-es-nicht', { methode: 'DELETE', cookie: ich.cookie })).status).toBe(404);
		});
	});

	describe('TOTP', () => {
		async function starte(cookie: string) {
			const r = await api('/profil/totp/start', { methode: 'POST', cookie });
			return r;
		}

		it('einrichten als Erwachsener mit Recht, danach verlangt die Anmeldung den Code', async () => {
			const m = await erwachsener({ rechte: ['DOKUMENTE'] });
			const r = await starte(m.cookie);
			expect(r.status).toBe(200);
			const start = (await r.json()) as {
				uri: string;
				geheimnis: string;
				wiederherstellungscodes: string[];
				marke: string;
			};
			expect(start.wiederherstellungscodes).toHaveLength(10);
			expect(start.uri).toMatch(/^otpauth:\/\/totp\//);
			// Vor der Bestaetigung liegt nichts in der Datenbank.
			expect((await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } })).totpGeheimnis).toBeNull();

			const falsch = await api('/profil/totp/bestaetigen', {
				methode: 'POST',
				cookie: m.cookie,
				body: { marke: start.marke, code: '000000' },
			});
			expect(falsch.status).toBe(401);
			expect((await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } })).totpAktivAm).toBeNull();

			const ok = await api('/profil/totp/bestaetigen', {
				methode: 'POST',
				cookie: m.cookie,
				body: { marke: start.marke, code: await generate({ secret: start.geheimnis }) },
			});
			expect(ok.status).toBe(200);
			const zugang = await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } });
			expect(zugang.totpAktivAm).not.toBeNull();
			// Verschluesselt gespeichert, nicht im Klartext.
			expect(zugang.totpGeheimnis).not.toBe(start.geheimnis);
			expect(decryptSecret(zugang.totpGeheimnis ?? '')).toBe(start.geheimnis);
			const codes = await prisma.recoveryCode.findMany({ where: { zugangId: m.zugangId } });
			expect(codes.map((c) => c.codeHash).sort()).toEqual(start.wiederherstellungscodes.map(hashRecoveryCode).sort());
			expect(codes.some((c) => start.wiederherstellungscodes.includes(c.codeHash))).toBe(false);
			expect((await ich(m.cookie)).totp).toEqual({ moeglich: true, aktiv: true, wiederherstellungscodesUebrig: 10 });

			// Bereits aktiv: kein zweites Einrichten, auch nicht mit der alten Marke.
			expect((await starte(m.cookie)).status).toBe(409);
			const nochmal = await api('/profil/totp/bestaetigen', {
				methode: 'POST',
				cookie: m.cookie,
				body: { marke: start.marke, code: await generate({ secret: start.geheimnis }) },
			});
			expect(nochmal.status).toBe(409);

			// Querverweis Task 7: das Passwort allein meldet nicht mehr an.
			const anmelden = await api('/anmelden', { methode: 'POST', body: { kennung: m.email, passwort: PASSWORT } });
			expect(anmelden.status).toBe(200);
			expect(((await anmelden.json()) as { schritt: string }).schritt).toBe('totp');
		});

		it('als Jungfischer und als Erwachsener ohne Rechte 403', async () => {
			const kind = await legeMitgliedAn(prisma, verein, { art: 'JUNGFISCHER', passwort: PASSWORT });
			const ohne = await erwachsener();
			for (const cookie of [kind.cookie, ohne.cookie]) {
				const r = await starte(cookie);
				expect(r.status).toBe(403);
				expect(await r.json()).toEqual(KEINE_RECHTE);
				const b = await api('/profil/totp/bestaetigen', { methode: 'POST', cookie, body: { marke: 'x', code: '1' } });
				expect(b.status).toBe(403);
			}
		});

		it('die Marke einer anderen Person taugt nicht', async () => {
			const a = await erwachsener({ rechte: ['MITGLIEDER'] });
			const b = await erwachsener({ rechte: ['MITGLIEDER'] });
			const start = (await (await starte(a.cookie)).json()) as { marke: string; geheimnis: string };
			const r = await api('/profil/totp/bestaetigen', {
				methode: 'POST',
				cookie: b.cookie,
				body: { marke: start.marke, code: await generate({ secret: start.geheimnis }) },
			});
			expect(r.status).toBe(400);
			expect((await prisma.zugang.findUniqueOrThrow({ where: { id: b.zugangId } })).totpAktivAm).toBeNull();
		});

		it('falsche Codes laufen in den Backoff', async () => {
			const m = await erwachsener({ rechte: ['MITGLIEDER'] });
			const { marke } = (await (await starte(m.cookie)).json()) as { marke: string };
			const status: number[] = [];
			for (let i = 0; i < 4; i++) {
				const r = await api('/profil/totp/bestaetigen', {
					methode: 'POST',
					cookie: m.cookie,
					body: { marke, code: String(randomInt(100000, 999999)) },
				});
				status.push(r.status);
			}
			expect(status).toEqual([401, 401, 401, 429]);
		});

		it('fehlender Body ist kein 500', async () => {
			const m = await erwachsener({ rechte: ['MITGLIEDER'] });
			for (const body of [undefined, {}, { marke: 5, code: {} }]) {
				const r = await api('/profil/totp/bestaetigen', { methode: 'POST', cookie: m.cookie, body });
				expect(r.status, JSON.stringify(body)).toBe(400);
			}
		});
	});

	describe('Sitzung endet waehrend der Anfrage (Reset-Link eingeloest, Spec 4.4)', () => {
		/**
		 * Loescht beim naechsten sperreVereinszeile alle Sitzungen des Zugangs, bevor
		 * die Sperre greift -- so wie es ein Einloesen tut, das die Sperre knapp
		 * vor der Profil-Anfrage bekommt.
		 */
		function sitzungEndetVorDerSperre(zugangId: string) {
			const original = vi.mocked(sperreVereinszeile).getMockImplementation();
			vi.mocked(sperreVereinszeile).mockImplementationOnce(async (tx, vereinId) => {
				await prisma.session.deleteMany({ where: { zugangId } });
				return original?.(tx, vereinId);
			});
		}
		const NICHT_ANGEMELDET = { fehler: 'nicht angemeldet' };

		it('Passwort setzen ohne vorhandenes schreibt nichts', async () => {
			const m = await erwachsener({ passwort: null });
			await passkey(m.zugangId);
			sitzungEndetVorDerSperre(m.zugangId);
			const r = await api('/profil/passwort', { methode: 'POST', cookie: m.cookie, body: { neu: NEU } });
			expect(r.status).toBe(401);
			expect(await r.json()).toEqual(NICHT_ANGEMELDET);
			expect((await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } })).passwortHash).toBeNull();
		});

		it('Passwort aendern schreibt nichts', async () => {
			const m = await erwachsener();
			sitzungEndetVorDerSperre(m.zugangId);
			const r = await api('/profil/passwort', {
				methode: 'POST',
				cookie: m.cookie,
				body: { neu: NEU, alt: PASSWORT },
			});
			expect(r.status).toBe(401);
			const zugang = await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } });
			expect(await verifyPassword(zugang.passwortHash ?? '', PASSWORT)).toBe(true);
		});

		it('Passkey hinzufuegen legt keinen an', async () => {
			const m = await erwachsener();
			const r0 = await api('/profil/passkeys/optionen', { methode: 'POST', cookie: m.cookie });
			const { optionen } = (await r0.json()) as { optionen: { challenge: string } };
			verifyRegistration.mockResolvedValue({
				credentialId: `cred-${randomUUID()}`,
				publicKey: 'cHVibGljLWtleQ',
				counter: 0,
				transports: [],
				backedUp: false,
			});
			sitzungEndetVorDerSperre(m.zugangId);
			const r = await api('/profil/passkeys', {
				methode: 'POST',
				cookie: m.cookie,
				body: { antwort: antwort(optionen.challenge) },
			});
			expect(r.status).toBe(401);
			expect(await prisma.passkey.count({ where: { zugangId: m.zugangId } })).toBe(0);
		});

		it('Passkey umbenennen und loeschen aendern nichts', async () => {
			const m = await erwachsener();
			const pk = await passkey(m.zugangId, 'Alt');
			sitzungEndetVorDerSperre(m.zugangId);
			const umbenennen = await api(`/profil/passkeys/${pk.id}`, {
				methode: 'PATCH',
				cookie: m.cookie,
				body: { label: 'Neu' },
			});
			expect(umbenennen.status).toBe(401);
			expect((await prisma.passkey.findUniqueOrThrow({ where: { id: pk.id } })).label).toBe('Alt');

			// Neue Sitzung, damit die zweite Anfrage die Anmeldung passiert.
			const token = await legeSitzungAn(vereinDb(prisma, verein.id), { zugangId: m.zugangId, jetzt: new Date() });
			sitzungEndetVorDerSperre(m.zugangId);
			const loeschen = await api(`/profil/passkeys/${pk.id}`, {
				methode: 'DELETE',
				cookie: `${MITGLIEDER_COOKIE}=${token}`,
			});
			expect(loeschen.status).toBe(401);
			expect(await prisma.passkey.count({ where: { id: pk.id } })).toBe(1);
		});

		it('TOTP bestaetigen aktiviert nichts', async () => {
			const m = await erwachsener({ rechte: ['MITGLIEDER'] });
			const start = (await (await api('/profil/totp/start', { methode: 'POST', cookie: m.cookie })).json()) as {
				marke: string;
				geheimnis: string;
			};
			sitzungEndetVorDerSperre(m.zugangId);
			const r = await api('/profil/totp/bestaetigen', {
				methode: 'POST',
				cookie: m.cookie,
				body: { marke: start.marke, code: await generate({ secret: start.geheimnis }) },
			});
			expect(r.status).toBe(401);
			const zugang = await prisma.zugang.findUniqueOrThrow({ where: { id: m.zugangId } });
			expect(zugang.totpAktivAm).toBeNull();
			expect(zugang.totpGeheimnis).toBeNull();
			expect(await prisma.recoveryCode.count({ where: { zugangId: m.zugangId } })).toBe(0);
		});
	});

	it('ohne Anmeldung sind alle Profil-Routen 401', async () => {
		for (const [methode, pfad] of [
			['POST', '/profil/passwort'],
			['POST', '/profil/passkeys/optionen'],
			['POST', '/profil/passkeys'],
			['PATCH', '/profil/passkeys/x'],
			['DELETE', '/profil/passkeys/x'],
			['POST', '/profil/totp/start'],
			['POST', '/profil/totp/bestaetigen'],
		] as const) {
			expect((await api(pfad, { methode, body: {} })).status, `${methode} ${pfad}`).toBe(401);
		}
	});
});
