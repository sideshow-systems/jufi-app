import { encryptSecret, generateTotpSecret } from '@jufi/auth';
import { createPrismaClientFromEnv, vereinDb, type PrismaClient } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
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
	eigen: { id: string; slug: string };
	fremd: { id: string; slug: string };
	gesperrt: { slug: string };
	/** Cookie einer Person aus dem Verein eigen. */
	eigenesCookie: string;
	/** Cookie einer Person aus eigen mit Verwaltungs-, Rechte- und Einstellungsrecht: sieht in eigen alles, in fremd nichts. */
	eigenerLeiter: string;
	/** Eine Person im Verein fremd. */
	fremdePersonId: string;
	/** Ein volljaehriges Kind im Verein fremd. */
	fremdesKindId: string;
	/** Eine Untergruppe im Verein fremd, mit dem fremden Kind als Mitglied. */
	fremdeGruppeId: string;
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

/** Schreib-Route unter /meine-jungfischer mit der Id eines Kindes aus fremd: gesperrt 404, fremd 401, eigen 404. */
async function meineJungfischerSchreibfall(k: Kontext, was: string, body: object): Promise<void> {
	const vorher = await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdesKindId } });
	const sendeAn = (slug: string, cookie?: string) =>
		sende(k.url, `/${slug}/api/v1/meine-jungfischer/${k.fremdesKindId}/${was}`, { methode: 'POST', body, cookie });
	expect((await sendeAn(k.gesperrt.slug, k.eigenesCookie)).status).toBe(404);
	expect((await sendeAn(k.fremd.slug, k.eigenesCookie)).status).toBe(401);
	expect((await sendeAn(k.eigen.slug, k.eigenesCookie)).status).toBe(404);
	expect(await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdesKindId } })).toEqual(vorher);
}

/** Das Logo des Vereins fremd; legt eines an, falls noch keins da ist, damit Loeschen und Ersetzen etwas zu verlieren haben. */
async function fremdesLogo(k: Kontext) {
	const daten = {
		bild: Buffer.from([1, 2, 3]),
		mimeType: 'image/png',
		icon192: Buffer.from([1]),
		icon512: Buffer.from([1]),
	};
	await k.prisma.vereinLogo.upsert({
		where: { vereinId: k.fremd.id },
		create: { vereinId: k.fremd.id, ...daten },
		update: {},
	});
	return k.prisma.vereinLogo.findUnique({ where: { vereinId: k.fremd.id } });
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
	'GET /verein/logo': async (k) => {
		// Beide fremden Vereine haben ein Logo: der gesperrte gibt es nicht heraus (404), und der
		// eigene Verein, der selbst keins hat, bekommt das fremde nicht unter seinem Slug.
		const gesperrt = await k.prisma.verein.findUniqueOrThrow({ where: { slug: k.gesperrt.slug } });
		for (const vereinId of [gesperrt.id, k.fremd.id]) {
			await vereinDb(k.prisma, vereinId).vereinLogo.create({
				data: { bild: Buffer.from([1]), mimeType: 'image/png', icon192: Buffer.from([1]), icon512: Buffer.from([1]) },
			});
		}
		expect((await fetch(`${k.url}/${k.gesperrt.slug}/api/v1/verein/logo`)).status).toBe(404);
		expect((await fetch(`${k.url}/${k.eigen.slug}/api/v1/verein/logo`)).status).toBe(404);
		// Gegenprobe: das Logo des fremden Vereins ist unter dessen eigenem Slug erreichbar, das 404
		// oben kommt also von der Trennung und nicht davon, dass die Route nichts ausliefert.
		expect((await fetch(`${k.url}/${k.fremd.slug}/api/v1/verein/logo`)).status).toBe(200);
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
	'DELETE /personen/:id': async (k) => {
		const vorher = await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdesKindId } });
		const entferne = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/personen/${k.fremdesKindId}`, { methode: 'DELETE', cookie });
		expect((await entferne(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await entferne(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Das Kind gehoert zu fremd: in eigen unbekannt, auch fuer die Verwaltung.
		expect((await entferne(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdesKindId } })).toEqual(vorher);
		expect(await k.prisma.untergruppeMitglied.count({ where: { personId: k.fremdesKindId } })).toBe(1);
	},
	'POST /personen/:id/einladung': async (k) => {
		const pfad = `/api/v1/personen/${k.fremdePersonId}/einladung`;
		const vorher = await k.prisma.einladung.count({ where: { personId: k.fremdePersonId } });
		const lade = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}${pfad}`, { methode: 'POST', body: { mail: true }, cookie });
		expect((await lade(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await lade(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Die Person gehoert zu fremd: in eigen unbekannt, auch fuer die Leitung.
		expect((await lade(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.einladung.count({ where: { personId: k.fremdePersonId } })).toBe(vorher);
	},
	// Die vier Routen unter /meine-jungfischer: das Kind gehoert zu fremd, die Id ist in eigen unbekannt.
	'GET /meine-jungfischer': async (k) => {
		const liste = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/meine-jungfischer`, { cookie });
		expect((await liste(k.gesperrt.slug, k.eigenesCookie)).status).toBe(404);
		expect((await liste(k.fremd.slug, k.eigenesCookie)).status).toBe(401);
		const r = await liste(k.eigen.slug, k.eigenesCookie);
		expect(r.status).toBe(200);
		expect(JSON.stringify(await r.json())).not.toContain(k.fremdesKindId);
	},
	'POST /meine-jungfischer/:kindId/zugang': async (k) => {
		await meineJungfischerSchreibfall(k, 'zugang', { erlaubt: false });
	},
	'POST /meine-jungfischer/:kindId/einladung': async (k) => {
		await meineJungfischerSchreibfall(k, 'einladung', {});
		expect(await k.prisma.einladung.count({ where: { personId: k.fremdesKindId } })).toBe(0);
	},
	'POST /meine-jungfischer/:kindId/einwilligung': async (k) => {
		await meineJungfischerSchreibfall(k, 'einwilligung', { erteilen: true });
		expect(await k.prisma.einwilligung.count({ where: { jungfischerId: k.fremdesKindId } })).toBe(0);
	},
	'POST /personen/:id/zugang': async (k) => {
		const vorher = await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdesKindId } });
		const setze = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/personen/${k.fremdesKindId}/zugang`, {
				methode: 'POST',
				body: { erlaubt: false },
				cookie,
			});
		expect((await setze(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await setze(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect((await setze(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdesKindId } })).toEqual(vorher);
	},
	'GET /untergruppen': async (k) => {
		const liste = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/untergruppen`, { cookie });
		expect((await liste(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await liste(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Die eigene Liste kennt die Gruppe aus fremd nicht.
		const r = await liste(k.eigen.slug, k.eigenerLeiter);
		expect(r.status).toBe(200);
		expect(JSON.stringify(await r.json())).not.toContain(k.fremdeGruppeId);
	},
	'POST /untergruppen': async (k) => {
		const anzahl = () => k.prisma.untergruppe.count({ where: { vereinId: k.fremd.id } });
		const vorher = await anzahl();
		const lege = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/untergruppen`, { methode: 'POST', body: { name: 'Mandant-Neu' }, cookie });
		expect((await lege(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await lege(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect(await anzahl()).toBe(vorher);
	},
	'PATCH /untergruppen/:id': async (k) => {
		const vorher = await k.prisma.untergruppe.findUniqueOrThrow({ where: { id: k.fremdeGruppeId } });
		const benenne = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/untergruppen/${k.fremdeGruppeId}`, {
				methode: 'PATCH',
				body: { name: 'Uebernommen' },
				cookie,
			});
		expect((await benenne(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await benenne(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect((await benenne(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.untergruppe.findUniqueOrThrow({ where: { id: k.fremdeGruppeId } })).toEqual(vorher);
	},
	'DELETE /untergruppen/:id': async (k) => {
		const loesche = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/untergruppen/${k.fremdeGruppeId}`, { methode: 'DELETE', cookie });
		expect((await loesche(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await loesche(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect((await loesche(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await k.prisma.untergruppe.count({ where: { id: k.fremdeGruppeId } })).toBe(1);
		expect(await k.prisma.untergruppeMitglied.count({ where: { untergruppeId: k.fremdeGruppeId } })).toBe(1);
	},
	'PUT /personen/:id/untergruppen': async (k) => {
		const vorher = await k.prisma.untergruppeMitglied.findMany({ where: { vereinId: k.fremd.id } });
		const ordne = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/personen/${k.fremdesKindId}/untergruppen`, {
				methode: 'PUT',
				body: { untergruppenIds: [] },
				cookie,
			});
		expect((await ordne(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await ordne(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Das Kind gehoert zu fremd: in eigen unbekannt, auch fuer die Verwaltung.
		expect((await ordne(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		// Umgekehrt: ein eigenes Kind mit der Gruppe aus fremd.
		const eigenerVerein = await k.prisma.verein.findUniqueOrThrow({ where: { slug: k.eigen.slug } });
		const eigenesKind = await k.prisma.person.create({
			data: {
				vereinId: eigenerVerein.id,
				art: 'JUNGFISCHER',
				vorname: 'Eigenes',
				nachname: 'Kind',
				geburtsdatum: new Date('2015-05-05'),
			},
		});
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/personen/${eigenesKind.id}/untergruppen`, {
			methode: 'PUT',
			body: { untergruppenIds: [k.fremdeGruppeId] },
			cookie: k.eigenerLeiter,
		});
		expect(r.status).toBe(404);
		expect(await k.prisma.untergruppeMitglied.count({ where: { personId: eigenesKind.id } })).toBe(0);
		expect(await k.prisma.untergruppeMitglied.findMany({ where: { vereinId: k.fremd.id } })).toEqual(vorher);
	},
	'PUT /personen/:id/rechte': async (k) => {
		const pfad = `/api/v1/personen/${k.fremdePersonId}/rechte`;
		const vorher = (await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdePersonId } })).rechte;
		const setze = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}${pfad}`, { methode: 'PUT', body: { rechte: ['DOKUMENTE'] }, cookie });
		expect((await setze(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await setze(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Die Person gehoert zu fremd: in eigen unbekannt, auch fuer die Leitung.
		expect((await setze(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdePersonId } })).rechte).toEqual(vorher);
	},
	// Die vier Einstellungs-Routen: Die Leitung aus eigen hat das Recht, aber nur dort. In fremd hat
	// sie keine Sitzung (401), im gesperrten Verein ist alles 404, und fremd bleibt wie es war.
	'GET /einstellungen': async (k) => {
		const hole = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/einstellungen`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await hole(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Gegenprobe: In eigen geht es, die 401 oben kommt also von der Trennung und nicht vom Recht.
		const r = await hole(k.eigen.slug, k.eigenerLeiter);
		expect(r.status).toBe(200);
		expect(((await r.json()) as { slug: string }).slug).toBe(k.eigen.slug);
	},
	'PATCH /einstellungen': async (k) => {
		const vorher = await k.prisma.verein.findUniqueOrThrow({ where: { id: k.fremd.id } });
		const aendere = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/einstellungen`, {
				methode: 'PATCH',
				body: { anzeigename: 'Uebernommen', kontakt: 'Uebernommen', farbe: '#000000' },
				cookie,
			});
		expect((await aendere(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await aendere(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect(await k.prisma.verein.findUniqueOrThrow({ where: { id: k.fremd.id } })).toEqual(vorher);
	},
	'PUT /einstellungen/logo': async (k) => {
		const vorher = await fremdesLogo(k);
		const lade = async (slug: string) =>
			fetch(`${k.url}/${slug}/api/v1/einstellungen/logo`, {
				method: 'PUT',
				headers: { Origin: TEST_UMGEBUNG.basisUrl, 'Content-Type': 'image/png', Cookie: k.eigenerLeiter },
				body: new Uint8Array(
					await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
						.png()
						.toBuffer(),
				),
			});
		expect((await lade(k.gesperrt.slug)).status).toBe(404);
		expect((await lade(k.fremd.slug)).status).toBe(401);
		expect(await fremdesLogo(k)).toEqual(vorher);
	},
	'DELETE /einstellungen/logo': async (k) => {
		const vorher = await fremdesLogo(k);
		expect(vorher).not.toBeNull();
		const loesche = (slug: string) =>
			sende(k.url, `/${slug}/api/v1/einstellungen/logo`, { methode: 'DELETE', cookie: k.eigenerLeiter });
		expect((await loesche(k.gesperrt.slug)).status).toBe(404);
		expect((await loesche(k.fremd.slug)).status).toBe(401);
		expect(await fremdesLogo(k)).toEqual(vorher);
		// Gegenprobe: Im eigenen Verein geht das Loeschen, und es trifft nur dessen Logo. Ein
		// Fehler in der Begrenzung auf den Verein liesse hier das fremde Logo mitfallen.
		const eigenerVerein = await k.prisma.verein.findUniqueOrThrow({ where: { slug: k.eigen.slug } });
		await k.prisma.vereinLogo.create({
			data: {
				vereinId: eigenerVerein.id,
				bild: Buffer.from([9]),
				mimeType: 'image/png',
				icon192: Buffer.from([9]),
				icon512: Buffer.from([9]),
			},
		});
		expect((await loesche(k.eigen.slug)).status).toBe(200);
		expect(await k.prisma.vereinLogo.count({ where: { vereinId: eigenerVerein.id } })).toBe(0);
		expect(await k.prisma.vereinLogo.findUnique({ where: { vereinId: k.fremd.id } })).toEqual(vorher);
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
	'GET /ich/daten': async (k) => {
		const hole = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/ich/daten`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenesCookie)).status).toBe(404);
		// Die Sitzung gilt nur im eigenen Verein: mit dem Slug von fremd kein Auszug, auch nicht der eigene.
		const fremd = await hole(k.fremd.slug, k.eigenesCookie);
		expect(fremd.status).toBe(401);
		expect(fremd.headers.get('content-disposition')).toBeNull();
		// Gegenprobe: In eigen geht es, und der Auszug gehoert der Person der Sitzung.
		const r = await hole(k.eigen.slug, k.eigenesCookie);
		expect(r.status).toBe(200);
		const auszug = (await r.json()) as { verein: unknown; zugang: unknown };
		expect(auszug.zugang).not.toBeNull();
		const fremdePerson = await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdePersonId } });
		expect(JSON.stringify(auszug)).not.toContain(fremdePerson.email ?? 'keine-adresse');
	},
	'GET /ansprechpartner': async (k) => {
		const hole = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/ansprechpartner`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenesCookie)).status).toBe(404);
		// Die Sitzung gilt nur im eigenen Verein.
		expect((await hole(k.fremd.slug, k.eigenesCookie)).status).toBe(401);
		// Gegenprobe: In eigen geht es, und die Liste enthaelt dort niemanden aus fremd.
		const r = await hole(k.eigen.slug, k.eigenesCookie);
		expect(r.status).toBe(200);
		const { ansprechpartner } = (await r.json()) as { ansprechpartner: { id: string }[] };
		expect(ansprechpartner.length).toBeGreaterThan(0);
		expect(ansprechpartner.map((a) => a.id)).not.toContain(k.fremdePersonId);
	},
	// Der Hinweis liest AdminProtokoll mit dem schlichten PrismaClient (Plan-Entscheidung 2); gerade
	// deshalb darf der Eintrag eines anderen Vereins nie durchkommen, auch nicht mit Namen.
	'GET /verwaltung/hinweise': async (k) => {
		const admin = await k.prisma.plattformAdmin.create({
			data: { benutzername: `mandant-${randomUUID().slice(0, 8)}` },
		});
		const protokolliere = (vereinId: string, vereinSlug: string, betroffenePersonId: string | null) =>
			k.prisma.adminProtokoll.create({
				data: { adminId: admin.id, aktion: 'NOTFALL_LINK', vereinId, vereinSlug, betroffenePersonId },
			});
		await protokolliere(k.fremd.id, k.fremd.slug, k.fremdePersonId);
		await protokolliere(k.eigen.id, k.eigen.slug, null);
		const hole = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/verwaltung/hinweise`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await hole(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Gegenprobe: In eigen geht es und zeigt genau den eigenen Eintrag, ohne den Namen der fremden Person.
		const r = await hole(k.eigen.slug, k.eigenerLeiter);
		expect(r.status).toBe(200);
		expect(((await r.json()) as { notfallLinks: unknown[] }).notfallLinks).toEqual([
			{ am: expect.any(String), vorname: null, nachname: null },
		]);
	},
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
			rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE', 'EINSTELLUNGEN'],
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
		const fremdeGruppe = await prisma.untergruppe.create({ data: { vereinId: fremd.id, name: 'Fremde Hechte' } });
		await prisma.untergruppeMitglied.create({
			data: { vereinId: fremd.id, untergruppeId: fremdeGruppe.id, personId: fremdesKind.id },
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
			fremdeGruppeId: fremdeGruppe.id,
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
