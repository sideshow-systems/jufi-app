import { encryptSecret, generateTotpSecret } from '@jufi/auth';
import { createPrismaClientFromEnv, type PrismaClient } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { mitStandardwerten } from './abhaengigkeiten.js';
import { erzeugeEinladung } from './einladung.js';
import { legeMitgliedAn } from './mitglieder/test-mitglieder.js';
import { Nachlauf } from './nachlauf.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from './test-setup.js';
import { legeVereinAn } from './test-vereine.js';
import { vereinsApi, vereinsRouten } from './verein.js';

type Passkey = Awaited<ReturnType<PrismaClient['passkey']['findUniqueOrThrow']>>;

interface Kontext {
	url: string;
	eigen: { slug: string };
	fremd: { id: string; slug: string };
	gesperrt: { slug: string };
	/** Cookie einer Person aus dem Verein eigen. */
	eigenesCookie: string;
	/** Cookie einer Person aus eigen mit Verwaltungs- und Rechterecht: sieht in eigen alles, in fremd nichts. */
	eigenerLeiter: string;
	/** Eine Person im Verein fremd. */
	fremdePersonId: string;
	/** Ein volljaehriges Kind im Verein fremd. */
	fremdesKindId: string;
	/** Token einer offenen Einladung im Verein eigen. */
	einladungsToken: string;
	/** Kennung und Passwort einer Person mit TOTP im Verein eigen. */
	totpPerson: { kennung: string; passwort: string };
	prisma: PrismaClient;
	/** Der Nachlauf der App, damit ein Fall auf die Arbeit nach der Antwort warten kann. */
	nachlauf: Nachlauf;
	/** Ein Passkey eines Zugangs im Verein fremd, wie er vor den Faellen war. */
	fremderPasskey: Passkey;
}

/**
 * Profil-Routen ohne Objekt-Id: im gesperrten Verein 404, und das Cookie aus
 * eigen gilt in fremd nicht. Eine Id gibt es dort nicht, die Person ist immer
 * die der Sitzung.
 */
async function profilOhneId(k: Kontext, methode: string, pfad: string): Promise<void> {
	expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1${pfad}`, { methode, body: {} })).status).toBe(404);
	expect(
		(await sende(k.url, `/${k.fremd.slug}/api/v1${pfad}`, { methode, body: {}, cookie: k.eigenesCookie })).status,
	).toBe(401);
}

/** Mitglied aus eigen greift mit der Id eines Passkeys aus fremd zu: 404, der Datensatz bleibt. */
async function fremderPasskeyBleibt(k: Kontext, methode: string): Promise<void> {
	const r = await sende(k.url, `/${k.eigen.slug}/api/v1/profil/passkeys/${k.fremderPasskey.id}`, {
		methode,
		body: { label: 'Uebernommen' },
		cookie: k.eigenesCookie,
	});
	expect(r.status).toBe(404);
	expect(await k.prisma.passkey.findUnique({ where: { id: k.fremderPasskey.id } })).toEqual(k.fremderPasskey);
}

/**
 * Jede Vereins-Route braucht hier einen Fall (Spec 9). Kommt eine Route
 * hinzu, scheitert der erste Test, bis der Fall eingetragen ist.
 */
const FAELLE: Record<string, (k: Kontext) => Promise<void>> = {
	'GET /verein': async (k) => {
		// Ohne Objekt-ID: der Verein kommt allein aus dem Slug. Geprueft wird,
		// dass ein gesperrter fremder Verein nichts preisgibt.
		expect((await fetch(`${k.url}/${k.gesperrt.slug}/api/v1/verein`)).status).toBe(404);
	},
	'POST /einladung/pruefen': async (k) => {
		for (const verein of [k.fremd, k.gesperrt]) {
			const r = await sende(k.url, `/${verein.slug}/api/v1/einladung/pruefen`, {
				methode: 'POST',
				body: { token: k.einladungsToken },
			});
			expect(r.status).toBe(404);
		}
		// Weder Fremde noch die Anfragen eben haben die Einladung angetastet.
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/einladung/pruefen`, {
			methode: 'POST',
			body: { token: k.einladungsToken },
		});
		expect(r.status).toBe(200);
	},
	'POST /einladung/passkey-optionen': async (k) => {
		for (const verein of [k.fremd, k.gesperrt]) {
			const r = await sende(k.url, `/${verein.slug}/api/v1/einladung/passkey-optionen`, {
				methode: 'POST',
				body: { token: k.einladungsToken },
			});
			expect(r.status).toBe(404);
		}
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/einladung/passkey-optionen`, {
			methode: 'POST',
			body: { token: k.einladungsToken },
		});
		expect(r.status).toBe(200);
	},
	'POST /einladung/einloesen': async (k) => {
		for (const verein of [k.fremd, k.gesperrt]) {
			const r = await sende(k.url, `/${verein.slug}/api/v1/einladung/einloesen`, {
				methode: 'POST',
				body: { token: k.einladungsToken, kennung: 'einla@example.test', passwort: 'gruene-forelle-am-see' },
			});
			expect(r.status).toBe(404);
		}
		// Nicht im eigenen Verein einloesen: die anderen Faelle brauchen die Einladung
		// noch offen. Dass sie unangetastet ist, zeigt pruefen.
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/einladung/pruefen`, {
			methode: 'POST',
			body: { token: k.einladungsToken },
		});
		expect(r.status).toBe(200);
	},
	'POST /anmelden': async (k) => {
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/anmelden`, { methode: 'POST', body: {} })).status).toBe(404);
		// Die Kennung aus eigen gibt es in fremd nicht.
		const r = await sende(k.url, `/${k.fremd.slug}/api/v1/anmelden`, { methode: 'POST', body: k.totpPerson });
		expect(r.status).toBe(401);
	},
	'POST /anmelden/totp': async (k) => {
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/anmelden/totp`, { methode: 'POST', body: {} })).status).toBe(
			404,
		);
		const passwort = await sende(k.url, `/${k.eigen.slug}/api/v1/anmelden`, { methode: 'POST', body: k.totpPerson });
		const { zwischenmarke } = (await passwort.json()) as { zwischenmarke: string };
		expect(zwischenmarke).toBeTruthy();
		// Die Marke aus eigen fuehrt in fremd nicht weiter, auch mit einem Wiederherstellungscode nicht.
		const r = await sende(k.url, `/${k.fremd.slug}/api/v1/anmelden/totp`, {
			methode: 'POST',
			body: { zwischenmarke, wiederherstellungscode: 'egal' },
		});
		expect(r.status).toBe(401);
	},
	'POST /anmelden/passkey-optionen': async (k) => {
		expect(
			(await sende(k.url, `/${k.gesperrt.slug}/api/v1/anmelden/passkey-optionen`, { methode: 'POST' })).status,
		).toBe(404);
	},
	'POST /anmelden/passkey': async (k) => {
		expect(
			(await sende(k.url, `/${k.gesperrt.slug}/api/v1/anmelden/passkey`, { methode: 'POST', body: {} })).status,
		).toBe(404);
		// Eine Challenge aus eigen ist in fremd unbekannt.
		const o = await sende(k.url, `/${k.eigen.slug}/api/v1/anmelden/passkey-optionen`, { methode: 'POST' });
		const { optionen } = (await o.json()) as { optionen: { challenge: string } };
		const clientDataJSON = Buffer.from(JSON.stringify({ challenge: optionen.challenge })).toString('base64url');
		const r = await sende(k.url, `/${k.fremd.slug}/api/v1/anmelden/passkey`, {
			methode: 'POST',
			body: {
				antwort: { id: 'cred-mandant', rawId: 'cred-mandant', type: 'public-key', response: { clientDataJSON } },
			},
		});
		expect(r.status).toBe(401);
		// Die Challenge bleibt in eigen liegen: fremd hat sie weder gesehen noch verbraucht.
		expect(await k.prisma.webauthnChallenge.count({ where: { challenge: optionen.challenge } })).toBe(1);
	},
	'POST /zugang-verloren': async (k) => {
		const r = await sende(k.url, `/${k.gesperrt.slug}/api/v1/zugang-verloren`, {
			methode: 'POST',
			body: { email: k.totpPerson.kennung },
		});
		expect(r.status).toBe(404);
		// Die Adresse aus eigen bei fremd: dieselbe Antwort wie immer, aber in eigen entsteht nichts.
		const fremd = await sende(k.url, `/${k.fremd.slug}/api/v1/zugang-verloren`, {
			methode: 'POST',
			body: { email: k.totpPerson.kennung },
		});
		expect(fremd.status).toBe(200);
		expect(await fremd.json()).toEqual({ ok: true });
		await k.nachlauf.warteAufAlle();
		expect(await k.prisma.einladung.count({ where: { art: 'RESET', person: { email: k.totpPerson.kennung } } })).toBe(
			0,
		);
		expect(await k.prisma.mailWarteschlange.count({ where: { empfaenger: k.totpPerson.kennung } })).toBe(0);
	},
	'GET /ich': async (k) => {
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/ich`)).status).toBe(404);
		// Das Cookie aus eigen gilt in fremd nicht: angemeldet ist nur, wer dort eine Sitzung hat.
		expect((await sende(k.url, `/${k.fremd.slug}/api/v1/ich`, { cookie: k.eigenesCookie })).status).toBe(401);
	},
	'GET /personen': async (k) => {
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/personen`)).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}/api/v1/personen`, { cookie: k.eigenerLeiter })).status).toBe(401);
		// In eigen taucht die Person aus fremd auch fuer die Verwaltung nicht auf.
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/personen`, { cookie: k.eigenerLeiter });
		const { personen } = (await r.json()) as { personen: { id: string }[] };
		expect(personen.map((p) => p.id)).not.toContain(k.fremdePersonId);
	},
	'GET /personen/:id': async (k) => {
		const pfad = `/api/v1/personen/${k.fremdePersonId}`;
		expect((await sende(k.url, `/${k.gesperrt.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(401);
		// Die ID aus fremd ist in eigen unbekannt, auch fuer die Verwaltung: 404, nie 403.
		expect((await sende(k.url, `/${k.eigen.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(404);
	},
	'POST /personen': async (k) => {
		const koerper = { art: 'ERWACHSENER', vorname: 'Neu', nachname: 'Mandant' };
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/personen`, { methode: 'POST', body: koerper })).status).toBe(
			404,
		);
		// Das Cookie aus eigen gilt in fremd nicht, und angelegt wird nichts.
		expect(
			(
				await sende(k.url, `/${k.fremd.slug}/api/v1/personen`, {
					methode: 'POST',
					body: koerper,
					cookie: k.eigenerLeiter,
				})
			).status,
		).toBe(401);
		expect(await k.prisma.person.count({ where: { nachname: 'Mandant' } })).toBe(0);
	},
	'PATCH /personen/:id': async (k) => {
		const pfad = `/api/v1/personen/${k.fremdePersonId}`;
		const vorher = await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdePersonId } });
		const patch = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}${pfad}`, { methode: 'PATCH', body: { vorname: 'Uebernommen' }, cookie });
		expect((await patch(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await patch(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Die ID aus fremd ist in eigen unbekannt, auch fuer die Verwaltung: 404, nie 403.
		expect((await patch(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdePersonId } })).toEqual(vorher);
	},
	'POST /personen/:id/volljaehrig-belassen': async (k) => {
		const pfad = `/api/v1/personen/${k.fremdesKindId}/volljaehrig-belassen`;
		const belassen = (slug: string, cookie?: string) => sende(k.url, `/${slug}${pfad}`, { methode: 'POST', cookie });
		expect((await belassen(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await belassen(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect((await belassen(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(
			(await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdesKindId } })).volljaehrigGeprueftAm,
		).toBeNull();
	},
	'PUT /personen/:jungfischerId/familie/:erwachsenerId': async (k) => {
		const pfad = `/api/v1/personen/${k.fremdesKindId}/familie/${k.fremdePersonId}`;
		const vorher = await k.prisma.bezugsperson.findMany({ where: { vereinId: k.fremd.id } });
		const verknuepfe = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}${pfad}`, { methode: 'PUT', body: { beziehung: 'MUTTER' }, cookie });
		expect((await verknuepfe(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await verknuepfe(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Beide IDs gehoeren zu fremd: in eigen unbekannt, auch fuer die Verwaltung.
		expect((await verknuepfe(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.bezugsperson.findMany({ where: { vereinId: k.fremd.id } })).toEqual(vorher);
	},
	'DELETE /personen/:jungfischerId/familie/:erwachsenerId': async (k) => {
		const pfad = `/api/v1/personen/${k.fremdesKindId}/familie/${k.fremdePersonId}`;
		// Die Zuordnung in fremd gibt es wirklich; sie darf von eigen aus nicht fallen.
		await k.prisma.bezugsperson.upsert({
			where: { erwachsenerId_jungfischerId: { erwachsenerId: k.fremdePersonId, jungfischerId: k.fremdesKindId } },
			create: {
				vereinId: k.fremd.id,
				erwachsenerId: k.fremdePersonId,
				jungfischerId: k.fremdesKindId,
				beziehung: 'MUTTER',
				erziehungsberechtigt: true,
			},
			update: {},
		});
		const vorher = await k.prisma.bezugsperson.findMany({ where: { vereinId: k.fremd.id } });
		const loese = (slug: string, cookie?: string) => sende(k.url, `/${slug}${pfad}`, { methode: 'DELETE', cookie });
		expect((await loese(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await loese(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect((await loese(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.bezugsperson.findMany({ where: { vereinId: k.fremd.id } })).toEqual(vorher);
	},
	'POST /abmelden': async (k) => {
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/abmelden`, { methode: 'POST' })).status).toBe(404);
		expect(
			(await sende(k.url, `/${k.fremd.slug}/api/v1/abmelden`, { methode: 'POST', cookie: k.eigenesCookie })).status,
		).toBe(401);
	},
	'POST /profil/passwort': (k) => profilOhneId(k, 'POST', '/profil/passwort'),
	'POST /profil/passkeys/optionen': (k) => profilOhneId(k, 'POST', '/profil/passkeys/optionen'),
	'POST /profil/passkeys': (k) => profilOhneId(k, 'POST', '/profil/passkeys'),
	'PATCH /profil/passkeys/:id': (k) => fremderPasskeyBleibt(k, 'PATCH'),
	'DELETE /profil/passkeys/:id': (k) => fremderPasskeyBleibt(k, 'DELETE'),
	'POST /profil/totp/start': (k) => profilOhneId(k, 'POST', '/profil/totp/start'),
	'POST /profil/totp/bestaetigen': (k) => profilOhneId(k, 'POST', '/profil/totp/bestaetigen'),
	'POST /abmelden/alle': async (k) => {
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/abmelden/alle`, { methode: 'POST' })).status).toBe(404);
		expect(
			(await sende(k.url, `/${k.fremd.slug}/api/v1/abmelden/alle`, { methode: 'POST', cookie: k.eigenesCookie }))
				.status,
		).toBe(401);
	},
};

/** Eine offene Einladung im Verein eigen; der Test schickt ihr Token an fremde Vereine. */
async function einladungsToken(prisma: PrismaClient, eigen: { id: string }): Promise<string> {
	const person = await prisma.person.create({
		data: { vereinId: eigen.id, art: 'ERWACHSENER', vorname: 'Einla', nachname: 'Dung', email: 'einla@example.test' },
	});
	return prisma.$transaction((tx) =>
		erzeugeEinladung(tx, {
			vereinId: eigen.id,
			personId: person.id,
			art: 'EINLADUNG',
			erstelltVonPersonId: null,
			jetzt: new Date(),
		}),
	);
}

describe('Mandanten-Test', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	let kontext: Kontext;
	const nachlauf = new Nachlauf();
	const app = createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, nachlauf });

	beforeAll(async () => {
		const [eigen, fremd, gesperrt] = await Promise.all([
			legeVereinAn(prisma, { slug: 'mandant-eigen' }),
			legeVereinAn(prisma, { slug: 'mandant-fremd' }),
			legeVereinAn(prisma, { slug: 'mandant-gesperrt', status: 'GESPERRT' }),
		]);
		server = await starteTestServer(app);
		// Mit Recht, damit TOTP fuer sie moeglich waere: der Fall soll an der
		// Vereinsgrenze scheitern, nicht an fehlenden Rechten.
		const { cookie } = await legeMitgliedAn(prisma, eigen, { art: 'ERWACHSENER', rechte: ['MITGLIEDER'] });
		// Mit Passwort, damit ein Loeschen nicht schon am letzten Anmeldeweg scheiterte.
		const nachbar = await legeMitgliedAn(prisma, fremd, { art: 'ERWACHSENER', passwort: 'gruene-forelle-am-see' });
		const leiter = await legeMitgliedAn(prisma, eigen, {
			art: 'ERWACHSENER',
			rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE'],
		});
		const fremderPasskey = await prisma.passkey.create({
			data: {
				vereinId: fremd.id,
				zugangId: nachbar.zugangId,
				credentialId: `cred-mandant-${nachbar.zugangId}`,
				publicKey: 'cHVibGljLWtleQ',
				label: 'Telefon in fremd',
			},
		});
		// Volljaehrig, damit volljaehrig-belassen nur an der Vereinsgrenze scheitern kann.
		const fremdesKind = await prisma.person.create({
			data: {
				vereinId: fremd.id,
				art: 'JUNGFISCHER',
				vorname: 'Fremdes',
				nachname: 'Kind',
				geburtsdatum: new Date('2000-01-01'),
			},
		});
		const totpPerson = { kennung: 'mandant-totp@example.test', passwort: 'gruene-forelle-am-see' };
		const { zugangId } = await legeMitgliedAn(prisma, eigen, {
			art: 'ERWACHSENER',
			email: totpPerson.kennung,
			passwort: totpPerson.passwort,
		});
		await prisma.zugang.update({
			where: { id: zugangId },
			data: { totpGeheimnis: encryptSecret(generateTotpSecret()), totpAktivAm: new Date() },
		});
		kontext = {
			url: server.url,
			eigen,
			fremd,
			gesperrt,
			eigenesCookie: cookie,
			eigenerLeiter: leiter.cookie,
			fremdePersonId: nachbar.personId,
			fremdesKindId: fremdesKind.id,
			einladungsToken: await einladungsToken(prisma, eigen),
			totpPerson,
			prisma,
			nachlauf,
			fremderPasskey,
		};
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	it('jede Vereins-Route hat einen Fall', () => {
		expect(
			// Dieselben Abhaengigkeiten wie die App: vereinsApi baut den Router aus ihnen.
			vereinsRouten(
				vereinsApi(mitStandardwerten({ prisma, version: { version: '1', commit: 'x' }, umgebung: TEST_UMGEBUNG })),
			)
				.map((r) => `${r.methode} ${r.pfad}`)
				.sort(),
		).toEqual(Object.keys(FAELLE).sort());
	});

	it.each(Object.entries(FAELLE))('%s gibt nichts aus fremden Vereinen preis', async (_name, fall) => fall(kontext));
});
