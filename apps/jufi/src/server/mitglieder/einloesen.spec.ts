import { generateLinkToken, hashToken, MITGLIEDER_COOKIE, WEBAUTHN_CHALLENGE_TTL_MS } from '@jufi/auth';
import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { PASSWORT_HINWEIS } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebauthnPruefer } from '../abhaengigkeiten.js';
import { createApp } from '../app.js';
import { erzeugeEinladung } from '../einladung.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeSitzungAn } from './sitzung.js';

const UNGUELTIG = { fehler: 'Dieser Link gilt nicht mehr' };
const PASSKEY_GESCHEITERT = { fehler: 'Der Passkey konnte nicht eingerichtet werden' };
const ADRESSE_VERGEBEN = { fehler: 'Diese Adresse ist hier schon vergeben', feld: 'kennung' };
const NAME_VERGEBEN = { fehler: 'Dieser Anmeldename ist schon vergeben', feld: 'kennung' };
const EINWILLIGUNG_FEHLT = { fehler: 'Die Einwilligung der Familie fehlt noch' };
const PASSWORT = 'gruene-forelle-am-see';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

describe('Einladung einloesen', () => {
	const prisma = createPrismaClientFromEnv();
	const t0 = new Date('2026-10-13T08:00:00Z');
	let uhr = t0;
	let server: TestServer;
	let verein: { id: string; slug: string };
	let fremd: { id: string; slug: string };

	// Attrappe statt echter Kryptografie: ein Test hat keinen Authenticator. Die
	// Pruefung selbst liegt in libs/auth; hier geht es um Challenge, Zeilen, Ablauf.
	const verifyRegistration = vi.fn<WebauthnPruefer['verifyRegistration']>();
	const verifyAuthentication = vi.fn<WebauthnPruefer['verifyAuthentication']>();

	beforeAll(async () => {
		[verein, fremd] = await Promise.all([
			legeVereinAn(prisma, { slug: 'einloesen-eigen' }),
			legeVereinAn(prisma, { slug: 'einloesen-fremd' }),
		]);
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr,
				webauthn: { verifyRegistration, verifyAuthentication },
			}),
		);
	});

	beforeEach(() => {
		uhr = t0;
		verifyRegistration.mockReset();
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	const einloesen = (v: { slug: string }, body?: unknown, userAgent?: string) =>
		sende(server.url, `/${v.slug}/api/v1/einladung/einloesen`, {
			methode: 'POST',
			body,
			kopf: userAgent ? { 'User-Agent': userAgent } : {},
		});

	function registrierung(credentialId: string) {
		return { credentialId, publicKey: 'cHVibGljLWtleQ', counter: 0, transports: ['internal'], backedUp: true };
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

	/** Holt Optionen ueber die Route, damit die Challenge so entsteht wie im echten Ablauf. */
	async function challenge(v: { slug: string }, token: string): Promise<string> {
		const r = await sende(server.url, `/${v.slug}/api/v1/einladung/passkey-optionen`, {
			methode: 'POST',
			body: { token },
		});
		expect(r.status).toBe(200);
		return ((await r.json()) as { optionen: { challenge: string } }).optionen.challenge;
	}

	async function lege(
		v: { id: string },
		p: {
			art: 'ERWACHSENER' | 'JUNGFISCHER';
			vorname?: string;
			email?: string;
			zugang?: { anmeldename?: string; passwortHash?: string };
			einwilligung?: boolean;
			einladung?: 'EINLADUNG' | 'RESET';
		},
	): Promise<{ personId: string; token: string; zugangId?: string }> {
		const person = await prisma.person.create({
			data: {
				vereinId: v.id,
				art: p.art,
				vorname: p.vorname ?? 'Erika',
				nachname: 'Huber',
				email: p.email,
				geburtsdatum: p.art === 'JUNGFISCHER' ? new Date('2015-05-05') : undefined,
			},
		});
		let zugangId: string | undefined;
		if (p.zugang) {
			zugangId = (await prisma.zugang.create({ data: { vereinId: v.id, personId: person.id, ...p.zugang } })).id;
		}
		if (p.einwilligung) {
			const eltern = await prisma.person.create({
				data: { vereinId: v.id, art: 'ERWACHSENER', vorname: 'Eltern', nachname: 'Huber' },
			});
			await prisma.einwilligung.create({
				data: { vereinId: v.id, jungfischerId: person.id, erteiltVon: eltern.id, art: 'DSGVO_ART8', textVersion: '1' },
			});
		}
		const token = await prisma.$transaction((tx) =>
			erzeugeEinladung(tx, {
				vereinId: v.id,
				personId: person.id,
				art: p.einladung ?? 'EINLADUNG',
				erstelltVonPersonId: null,
				jetzt: t0,
			}),
		);
		return { personId: person.id, token, zugangId };
	}

	const eingeloestAm = async (token: string) =>
		(await prisma.einladung.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } })).eingeloestAm;
	const zugangVon = (personId: string) => prisma.zugang.findUnique({ where: { personId } });
	const adresse = () => `a-${randomUUID().slice(0, 8)}@example.org`;

	function cookieAus(r: Response): string {
		const kopf = r.headers.get('set-cookie') ?? '';
		const wert = kopf.split(';')[0] ?? '';
		expect(wert.startsWith(`${MITGLIEDER_COOKIE}=`)).toBe(true);
		return wert;
	}

	it('Erwachsener loest mit Passwort ein', async () => {
		const email = adresse();
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Thomas' });
		const r = await einloesen(verein, { token, kennung: `  ${email.toUpperCase()} `, passwort: PASSWORT });
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ vorname: 'Thomas' });
		expect(r.headers.get('set-cookie')).toContain(`Path=/${verein.slug}/`);

		const zugang = await zugangVon(personId);
		expect(zugang?.passwortHash).toMatch(/^\$argon2id\$/);
		expect(zugang?.anmeldename).toBeNull();
		expect((await prisma.person.findUniqueOrThrow({ where: { id: personId } })).email).toBe(email);
		expect(await eingeloestAm(token)).toEqual(t0);

		const ich = await sende(server.url, `/${verein.slug}/api/v1/ich`, { cookie: cookieAus(r) });
		expect(ich.status).toBe(200);
		expect((await ich.json()).kennung).toBe(email);
	});

	it('Erwachsener loest mit Passkey ein', async () => {
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Paula' });
		const c = await challenge(verein, token);
		const credentialId = `cred-${randomUUID()}`;
		verifyRegistration.mockResolvedValue(registrierung(credentialId));

		const r = await einloesen(verein, { token, kennung: adresse(), passkey: antwort(c, credentialId) }, IPHONE);
		expect(r.status).toBe(200);
		expect(verifyRegistration.mock.calls[0]?.[0].expectedChallenge).toBe(c);

		const zugang = await zugangVon(personId);
		expect(zugang?.passwortHash).toBeNull();
		const passkey = await prisma.passkey.findUniqueOrThrow({ where: { credentialId } });
		expect(passkey).toMatchObject({ vereinId: verein.id, zugangId: zugang?.id, label: 'iPhone', backedUp: true });
		expect(await prisma.webauthnChallenge.count({ where: { challenge: c } })).toBe(0);
	});

	it('Erwachsener mit Passwort und Passkey zugleich', async () => {
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });
		const c = await challenge(verein, token);
		const credentialId = `cred-${randomUUID()}`;
		verifyRegistration.mockResolvedValue(registrierung(credentialId));
		const r = await einloesen(verein, {
			token,
			kennung: adresse(),
			passwort: PASSWORT,
			passkey: antwort(c, credentialId),
		});
		expect(r.status).toBe(200);
		const zugang = await zugangVon(personId);
		expect(zugang?.passwortHash).not.toBeNull();
		expect(await prisma.passkey.count({ where: { zugangId: zugang?.id } })).toBe(1);
	});

	describe('Jungfischer', () => {
		it('mit Einwilligung: Anmeldename normalisiert', async () => {
			// Eigener Verein, damit "lena" nicht mit anderen Tests kollidiert.
			const eigen = await legeVereinAn(prisma, { slug: 'einloesen-lena' });
			const { token, personId } = await lege(eigen, { art: 'JUNGFISCHER', vorname: 'Lena', einwilligung: true });
			const r = await einloesen(eigen, { token, kennung: '  Lena ', passwort: PASSWORT });
			expect(r.status).toBe(200);
			expect(await r.json()).toEqual({ vorname: 'Lena' });
			expect((await zugangVon(personId))?.anmeldename).toBe('lena');
			// Die Adresse am Jungfischer bleibt unberuehrt.
			expect((await prisma.person.findUniqueOrThrow({ where: { id: personId } })).email).toBeNull();
		});

		it('ohne Einwilligung: 409, kein Zugang, Einladung offen', async () => {
			const { token, personId } = await lege(verein, { art: 'JUNGFISCHER', vorname: 'Ohne' });
			const r = await einloesen(verein, { token, kennung: `ohne-${randomUUID().slice(0, 6)}`, passwort: PASSWORT });
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual(EINWILLIGUNG_FEHLT);
			expect(await zugangVon(personId)).toBeNull();
			expect(await eingeloestAm(token)).toBeNull();
		});

		it('widerrufene Einwilligung zaehlt nicht', async () => {
			const { token, personId } = await lege(verein, { art: 'JUNGFISCHER', vorname: 'Widerruf', einwilligung: true });
			await prisma.einwilligung.updateMany({ where: { jungfischerId: personId }, data: { widerrufenAm: t0 } });
			const r = await einloesen(verein, { token, kennung: `wid-${randomUUID().slice(0, 6)}`, passwort: PASSWORT });
			expect(r.status).toBe(409);
			expect(await eingeloestAm(token)).toBeNull();
		});

		it('Anmeldename vergeben: 409, Einladung offen', async () => {
			const name = `belegt-${randomUUID().slice(0, 6)}`;
			await lege(verein, { art: 'JUNGFISCHER', zugang: { anmeldename: name } });
			const { token, personId } = await lege(verein, { art: 'JUNGFISCHER', einwilligung: true });
			const r = await einloesen(verein, { token, kennung: name.toUpperCase(), passwort: PASSWORT });
			expect(r.status).toBe(409);
			expect(await r.json()).toEqual(NAME_VERGEBEN);
			expect(await zugangVon(personId)).toBeNull();
			expect(await eingeloestAm(token)).toBeNull();
		});

		it('Anmeldename mit @ ist ungueltig', async () => {
			const { token } = await lege(verein, { art: 'JUNGFISCHER', einwilligung: true });
			const r = await einloesen(verein, { token, kennung: 'lena@example.org', passwort: PASSWORT });
			expect(r.status).toBe(400);
			expect((await r.json()).feld).toBe('kennung');
		});
	});

	it('Doppelklick: genau ein 200, ein Zugang, eine Sitzung', async () => {
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });
		const kennung = adresse();
		const [a, b] = await Promise.all([
			einloesen(verein, { token, kennung, passwort: PASSWORT }),
			einloesen(verein, { token, kennung, passwort: PASSWORT }),
		]);
		expect([a.status, b.status].sort()).toEqual([200, 404]);
		const verloren = a.status === 404 ? a : b;
		expect(await verloren.json()).toEqual(UNGUELTIG);
		expect(await prisma.zugang.count({ where: { personId } })).toBe(1);
		expect(await prisma.session.count({ where: { zugang: { personId } } })).toBe(1);
	});

	it('E-Mail vergeben: 409, nichts angelegt, danach mit freier Adresse', async () => {
		const belegt = adresse();
		await lege(verein, { art: 'ERWACHSENER', email: belegt });
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });

		const r = await einloesen(verein, { token, kennung: `  ${belegt.toUpperCase()} `, passwort: PASSWORT });
		expect(r.status).toBe(409);
		expect(await r.json()).toEqual(ADRESSE_VERGEBEN);
		expect(await zugangVon(personId)).toBeNull();
		expect(await eingeloestAm(token)).toBeNull();
		expect((await prisma.person.findUniqueOrThrow({ where: { id: personId } })).email).toBeNull();

		const frei = adresse();
		const r2 = await einloesen(verein, { token, kennung: frei, passwort: PASSWORT });
		expect(r2.status).toBe(200);
		expect((await prisma.person.findUniqueOrThrow({ where: { id: personId } })).email).toBe(frei);

		// Dieselbe Adresse in einem anderen Verein ist eine andere Person (Spec 4.2).
		const anderswo = await lege(fremd, { art: 'ERWACHSENER' });
		const r3 = await einloesen(fremd, { token: anderswo.token, kennung: belegt, passwort: PASSWORT });
		expect(r3.status).toBe(200);
	});

	it('Kennung ungueltig oder fehlend: 400 mit feld kennung', async () => {
		const { token } = await lege(verein, { art: 'ERWACHSENER' });
		for (const kennung of ['kein-at', '', undefined, 42]) {
			const r = await einloesen(verein, { token, kennung, passwort: PASSWORT });
			expect(r.status, String(kennung)).toBe(400);
			expect((await r.json()).feld, String(kennung)).toBe('kennung');
		}
		expect(await eingeloestAm(token)).toBeNull();
	});

	it('Passwort zu kurz oder haeufig, oder gar kein Weg: 400', async () => {
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });
		const kennung = adresse();
		const kurz = await einloesen(verein, { token, kennung, passwort: 'kurz' });
		expect(kurz.status).toBe(400);
		expect(await kurz.json()).toEqual({ fehler: PASSWORT_HINWEIS['zu-kurz'] });
		const haeufig = await einloesen(verein, { token, kennung, passwort: 'aaaaaaaaaaaa' });
		expect(haeufig.status).toBe(400);
		expect(await haeufig.json()).toEqual({ fehler: PASSWORT_HINWEIS['zu-haeufig'] });
		for (const body of [
			{ token, kennung },
			{ token, kennung, passwort: '' },
			{ token, kennung, passkey: null },
		]) {
			const r = await einloesen(verein, body);
			expect(r.status).toBe(400);
			expect((await r.json()).fehler).toBeTypeOf('string');
		}
		expect(await zugangVon(personId)).toBeNull();
		expect(await eingeloestAm(token)).toBeNull();
	});

	it('kaputter Body ist nie 500', async () => {
		for (const body of [undefined, {}, { token: 42 }, { token: [] }, [1, 2]]) {
			const r = await einloesen(verein, body);
			expect(r.status).toBe(404);
		}
		// Kein Objekt als JSON lehnt schon der Body-Parser ab (strict), bevor die Route laeuft.
		expect((await einloesen(verein, 'text')).status).toBe(400);
		const { token } = await lege(verein, { art: 'ERWACHSENER' });
		for (const passkey of ['text', 42, {}, { response: null }, { response: { clientDataJSON: 7 } }]) {
			const r = await einloesen(verein, { token, kennung: adresse(), passkey });
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual(PASSKEY_GESCHEITERT);
		}
		expect(verifyRegistration).not.toHaveBeenCalled();
		expect(await eingeloestAm(token)).toBeNull();
	});

	describe('Passkey-Fehler: 400, Einladung offen, kein Zugang', () => {
		it('Pruefer wirft oder lehnt ab', async () => {
			const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });
			verifyRegistration.mockRejectedValueOnce(new Error('kaputte Signatur'));
			const r1 = await einloesen(verein, {
				token,
				kennung: adresse(),
				passkey: antwort(await challenge(verein, token)),
			});
			expect(r1.status).toBe(400);
			expect(await r1.json()).toEqual(PASSKEY_GESCHEITERT);
			verifyRegistration.mockResolvedValueOnce(null);
			const r2 = await einloesen(verein, {
				token,
				kennung: adresse(),
				passkey: antwort(await challenge(verein, token)),
			});
			expect(r2.status).toBe(400);
			expect(await zugangVon(personId)).toBeNull();
			expect(await eingeloestAm(token)).toBeNull();
		});

		it('Challenge einer anderen Person', async () => {
			const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });
			const andere = await lege(verein, { art: 'ERWACHSENER' });
			verifyRegistration.mockResolvedValue(registrierung(`cred-${randomUUID()}`));
			const r = await einloesen(verein, {
				token,
				kennung: adresse(),
				passkey: antwort(await challenge(verein, andere.token)),
			});
			expect(r.status).toBe(400);
			expect(await r.json()).toEqual(PASSKEY_GESCHEITERT);
			expect(verifyRegistration).not.toHaveBeenCalled();
			expect(await zugangVon(personId)).toBeNull();
			expect(await eingeloestAm(token)).toBeNull();
		});

		it('Challenge abgelaufen', async () => {
			const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });
			const c = await challenge(verein, token);
			verifyRegistration.mockResolvedValue(registrierung(`cred-${randomUUID()}`));
			uhr = new Date(t0.getTime() + WEBAUTHN_CHALLENGE_TTL_MS + 1000);
			const r = await einloesen(verein, { token, kennung: adresse(), passkey: antwort(c) });
			expect(r.status).toBe(400);
			expect(verifyRegistration).not.toHaveBeenCalled();
			expect(await zugangVon(personId)).toBeNull();
			expect(await eingeloestAm(token)).toBeNull();
		});

		it('unbekannte Challenge', async () => {
			const { token } = await lege(verein, { art: 'ERWACHSENER' });
			const r = await einloesen(verein, { token, kennung: adresse(), passkey: antwort('gibt-es-nicht') });
			expect(r.status).toBe(400);
			expect(await eingeloestAm(token)).toBeNull();
		});
	});

	async function mitAltenWegen(art: 'EINLADUNG' | 'RESET') {
		const email = adresse();
		const alt = await lege(verein, {
			art: 'ERWACHSENER',
			email,
			zugang: { passwortHash: 'alter-hash' },
			einladung: art,
		});
		const zugangId = alt.zugangId ?? '';
		const db = vereinDb(prisma, verein.id);
		await db.zugang.update({ where: { id: zugangId }, data: { totpGeheimnis: 'geheim', totpAktivAm: t0 } });
		for (const n of [1, 2]) {
			await db.passkey.create({
				data: { zugangId, credentialId: `alt-${randomUUID()}`, publicKey: 'cA', transports: [], label: `Alt ${n}` },
			});
			await db.recoveryCode.create({ data: { zugangId, codeHash: `code-${n}` } });
		}
		const alteSitzungen = [
			await legeSitzungAn(db, { zugangId, jetzt: t0 }),
			await legeSitzungAn(db, { zugangId, jetzt: t0 }),
		];
		return { ...alt, zugangId, email, alteSitzungen };
	}

	for (const art of ['RESET', 'EINLADUNG'] as const) {
		it(`${art} bei bestehendem Zugang loescht alle alten Wege`, async () => {
			const alt = await mitAltenWegen(art);
			// Eine mitgeschickte Kennung zaehlt nicht: die Kennung bleibt.
			const r = await einloesen(verein, { token: alt.token, kennung: 'ganz@anders.org', passwort: PASSWORT });
			expect(r.status).toBe(200);

			const zugang = await prisma.zugang.findUniqueOrThrow({ where: { id: alt.zugangId } });
			expect(zugang.passwortHash).toMatch(/^\$argon2id\$/);
			expect(zugang.totpGeheimnis).toBeNull();
			expect(zugang.totpAktivAm).toBeNull();
			expect(await prisma.passkey.count({ where: { zugangId: alt.zugangId } })).toBe(0);
			expect(await prisma.recoveryCode.count({ where: { zugangId: alt.zugangId } })).toBe(0);
			expect(await prisma.session.count({ where: { zugangId: alt.zugangId } })).toBe(1);
			expect((await prisma.person.findUniqueOrThrow({ where: { id: alt.personId } })).email).toBe(alt.email);
			expect(await prisma.zugang.count({ where: { personId: alt.personId } })).toBe(1);

			const vorher = await sende(server.url, `/${verein.slug}/api/v1/ich`, {
				cookie: `${MITGLIEDER_COOKIE}=${alt.alteSitzungen[0]}`,
			});
			expect(vorher.status).toBe(401);
			const neu = await sende(server.url, `/${verein.slug}/api/v1/ich`, { cookie: cookieAus(r) });
			expect(neu.status).toBe(200);
		});
	}

	it('Reset nur mit Passkey: altes Passwort ist weg', async () => {
		const alt = await mitAltenWegen('RESET');
		const credentialId = `cred-${randomUUID()}`;
		verifyRegistration.mockResolvedValue(registrierung(credentialId));
		const r = await einloesen(verein, { token: alt.token, passkey: antwort(await challenge(verein, alt.token)) });
		expect(r.status).toBe(200);
		const zugang = await prisma.zugang.findUniqueOrThrow({ where: { id: alt.zugangId } });
		expect(zugang.passwortHash).toBeNull();
		expect((await prisma.passkey.findMany({ where: { zugangId: alt.zugangId } })).map((p) => p.credentialId)).toEqual([
			credentialId,
		]);
	});

	it('Fremdes Token: 404, Einladung im eigenen Verein offen', async () => {
		const { token } = await lege(verein, { art: 'ERWACHSENER' });
		const r = await einloesen(fremd, { token, kennung: adresse(), passwort: PASSWORT });
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual(UNGUELTIG);
		expect(await eingeloestAm(token)).toBeNull();
	});

	it('Ungueltige Links sind alle dasselbe 404', async () => {
		const eingeloest = await lege(verein, { art: 'ERWACHSENER' });
		await prisma.einladung.updateMany({
			where: { tokenHash: hashToken(eingeloest.token) },
			data: { eingeloestAm: t0 },
		});
		const abgelaufen = await lege(verein, { art: 'ERWACHSENER' });
		for (const token of [generateLinkToken(), eingeloest.token]) {
			const r = await einloesen(verein, { token, kennung: adresse(), passwort: PASSWORT });
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(UNGUELTIG);
		}
		uhr = new Date(t0.getTime() + 400 * 24 * 60 * 60 * 1000);
		const r = await einloesen(verein, { token: abgelaufen.token, kennung: adresse(), passwort: PASSWORT });
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual(UNGUELTIG);
	});

	it('Gesperrter Verein: 404', async () => {
		const gesperrt = await legeVereinAn(prisma, { slug: 'einloesen-gesperrt' });
		const { token } = await lege(gesperrt, { art: 'ERWACHSENER' });
		await prisma.verein.update({ where: { id: gesperrt.id }, data: { status: 'GESPERRT' } });
		const r = await einloesen(gesperrt, { token, kennung: adresse(), passwort: PASSWORT });
		expect(r.status).toBe(404);
		expect(await eingeloestAm(token)).toBeNull();
	});

	it('Slug nach Korrektur: Token mit altem Slug ist 404', async () => {
		const v = await legeVereinAn(prisma, { slug: 'einloesen-alt' });
		const { token } = await lege(v, { art: 'ERWACHSENER' });
		await prisma.verein.update({ where: { id: v.id }, data: { slug: 'einloesen-neu' } });
		const r = await einloesen(v, { token, kennung: adresse(), passwort: PASSWORT });
		expect(r.status).toBe(404);
		expect(await eingeloestAm(token)).toBeNull();
	});

	it('Doppelter Passkey: 409, nichts angelegt', async () => {
		const besitzer = await mitAltenWegen('RESET');
		const belegt = await prisma.passkey.findFirstOrThrow({ where: { zugangId: besitzer.zugangId } });
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER' });
		verifyRegistration.mockResolvedValue(registrierung(belegt.credentialId));
		const r = await einloesen(verein, {
			token,
			kennung: adresse(),
			passwort: PASSWORT,
			passkey: antwort(await challenge(verein, token), belegt.credentialId),
		});
		expect(r.status).toBe(409);
		expect((await r.json()).fehler).toBeTypeOf('string');
		expect(await zugangVon(personId)).toBeNull();
		expect(await eingeloestAm(token)).toBeNull();
		expect((await prisma.passkey.findUniqueOrThrow({ where: { credentialId: belegt.credentialId } })).zugangId).toBe(
			besitzer.zugangId,
		);
	});
});
