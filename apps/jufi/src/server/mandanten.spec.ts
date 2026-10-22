import { encryptSecret, generateTotpSecret } from '@jufi/auth';
import { createPrismaClientFromEnv, vereinDb, type PrismaClient } from '@jufi/db';
import type { DokumenteAntwort, EchtzeitSignal, SpeicherAntwort } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from './app.js';
import { mitStandardwerten } from './abhaengigkeiten.js';
import { dateiSchluessel, VerzeichnisSpeicher } from './dateien/speicher.js';
import { erzeugeBild } from './dateien/test-bilder.js';
import { Bus } from './echtzeit/bus.js';
import { Hub } from './echtzeit/hub.js';
import { erzeugeEinladung } from './einladung.js';
import { legeMitgliedAn } from './mitglieder/test-mitglieder.js';
import { Nachlauf } from './nachlauf.js';
import { legeThreadAn } from './threads/test-threads.js';
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
	/**
	 * Cookie einer Person aus eigen mit Verwaltungs-, Rechte-, Einstellungs-, Thread-erstellen-,
	 * Antworten-im-Detail- und Dokumente-Recht: sieht in eigen alles, in fremd nichts.
	 */
	eigenerLeiter: string;
	/** Die Person hinter eigenerLeiter, damit ein Fall einen Thread anlegen kann, den sie bearbeiten darf. */
	eigenerLeiterId: string;
	/** Eine Person im Verein fremd. */
	fremdePersonId: string;
	/** Ein volljaehriges Kind im Verein fremd. */
	fremdesKindId: string;
	/** Eine Untergruppe im Verein fremd, mit dem fremden Kind als Mitglied. */
	fremdeGruppeId: string;
	/**
	 * Ein veroeffentlichter Thread im Verein fremd mit einem Umfrage-Modul samt Option, einer
	 * Antwort und einer Nachricht; die Routen der Threads pruefen mit ihm, dass nichts von
	 * dort nach eigen durchdringt.
	 */
	fremderThread: { threadId: string; modulId: string; optionId: string; nachrichtId: string };
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

/** Alles, was ein Lesen oder Gelesen-Setzen im Verein fremd veraendern koennte: Zahl der Gelesen-Staende und Vereinsstand. */
async function fremdeThreadZeilen(k: Kontext) {
	return {
		gelesen: await k.prisma.gelesenStand.count({ where: { vereinId: k.fremd.id } }),
		stand: (await k.prisma.verein.findUniqueOrThrow({ where: { id: k.fremd.id } })).aenderungsstand,
	};
}

/** Alles, was ein Schreiben oder Loeschen im Verlauf von fremd veraendern koennte. */
async function fremderVerlauf(k: Kontext) {
	return {
		zeilen: await k.prisma.verlaufEintrag.count({ where: { vereinId: k.fremd.id } }),
		nachricht: await k.prisma.verlaufEintrag.findUnique({ where: { id: k.fremderThread.nachrichtId } }),
		stand: (await k.prisma.verein.findUniqueOrThrow({ where: { id: k.fremd.id } })).aenderungsstand,
	};
}

/** Alles, was ein Antworten in fremd veraendern koennte: Antwortzeilen samt Optionen und Vereinsstand. */
async function fremdeAntworten(k: Kontext) {
	return {
		antworten: await k.prisma.umfrageAntwort.findMany({ where: { vereinId: k.fremd.id }, orderBy: { id: 'asc' } }),
		optionen: await k.prisma.umfrageAntwortOption.findMany({
			where: { vereinId: k.fremd.id },
			orderBy: [{ antwortId: 'asc' }, { optionId: 'asc' }],
		}),
		stand: (await k.prisma.verein.findUniqueOrThrow({ where: { id: k.fremd.id } })).aenderungsstand,
	};
}

/** Ein frischer Thread in eigen, den die Verwaltung von eigen sieht und in dem sie schreiben darf. */
async function eigenerThread(k: Kontext): Promise<string> {
	return (await legeThreadAn(k.prisma, k.eigen, new Date(), { titel: 'Eigener Thread' })).threadId;
}

/** Ein gueltiger Thread-Entwurf mit einer Info, fuer die Untergruppen-IDs, die ein Fall pruefen will. */
function mandantEntwurf(untergruppenIds: string[]) {
	return {
		titel: 'Mandant',
		modus: 'KOMMENTARE',
		rollenfilter: 'JUNGFISCHER_FAMILIE',
		alleUntergruppen: untergruppenIds.length === 0,
		untergruppenIds,
		module: [{ typ: 'INFO', id: null, titel: null, text: 'Hallo' }],
	};
}

/** Alles, was Anlegen oder Ersetzen eines Threads in fremd veraendern koennte. */
async function fremdeThreads(k: Kontext) {
	return {
		threads: await k.prisma.thread.findMany({ where: { vereinId: k.fremd.id }, orderBy: { id: 'asc' } }),
		module: await k.prisma.threadModul.count({ where: { vereinId: k.fremd.id } }),
		zuordnungen: await k.prisma.threadUntergruppe.count({ where: { vereinId: k.fremd.id } }),
		stand: (await k.prisma.verein.findUniqueOrThrow({ where: { id: k.fremd.id } })).aenderungsstand,
	};
}

/** Ein Dokument mit Datei in dem Verein; die Bytes fehlen, die Zeilen genuegen den Routen. */
async function legeDokumentAn(k: Kontext, verein: { id: string }, vonId: string, titel: string) {
	const db = vereinDb(k.prisma, verein.id);
	const kategorie = await db.dokumentKategorie.findFirstOrThrow({ orderBy: { position: 'asc' } });
	const dokument = await db.dokument.create({
		data: { kategorieId: kategorie.id, titel, angelegtAm: new Date() },
	});
	const datei = await db.datei.create({
		data: {
			art: 'DATEI',
			dokumentId: dokument.id,
			name: 'mandant.pdf',
			typ: 'application/pdf',
			groesse: 7,
			sha256: 'x',
			vonId,
			hochgeladenAm: new Date(),
		},
	});
	return { kategorie, dokument, datei };
}

/** Alles, was eine Dokumente-Route in fremd veraendern koennte: Kategorien, Dokumente, Dateien und die Loeschliste. */
async function fremdeDokumente(k: Kontext) {
	const where = { vereinId: k.fremd.id };
	return {
		kategorien: await k.prisma.dokumentKategorie.findMany({ where, orderBy: { id: 'asc' } }),
		dokumente: await k.prisma.dokument.findMany({ where, orderBy: { id: 'asc' } }),
		dateien: await k.prisma.datei.findMany({ where, orderBy: { id: 'asc' } }),
		loeschliste: await k.prisma.dateiLoeschung.count({ where }),
	};
}

/**
 * Eine Dokumente-Route mit der Id aus fremd: im gesperrten Verein 404, das Cookie aus eigen gilt in
 * fremd nicht (401), in eigen ist die Id unbekannt (404), und in fremd ist danach nichts anders.
 * Die Koerper sind leer oder JSON, weil jede dieser Antworten vor dem Lesen eines Upload-Koerpers kommt.
 */
async function dokumenteMitFremderId(
	k: Kontext,
	e: { methode: string; pfad: (id: string) => string; id: string; body?: object },
): Promise<void> {
	const vorher = await fremdeDokumente(k);
	const sendeAn = (slug: string, cookie?: string) =>
		sende(k.url, `/${slug}/api/v1${e.pfad(e.id)}`, {
			methode: e.methode,
			body: e.body,
			cookie,
			kopf: { 'Content-Type': e.body ? 'application/json' : 'application/octet-stream' },
		});
	expect((await sendeAn(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
	expect((await sendeAn(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
	expect((await sendeAn(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
	expect(await fremdeDokumente(k)).toEqual(vorher);
}

/** Ein Thread in fremd mit je einem Datei- und Foto-Modul, darin eine Datei und ein Foto (Zeilen ohne Bytes). */
async function fremdeMedien(k: Kontext) {
	const { modulIds, dateiIds } = await legeThreadAn(k.prisma, k.fremd, new Date(), {
		titel: 'Fremde Medien',
		erstelltVonId: k.fremdePersonId,
		module: [
			{ typ: 'DATEIEN', dateien: [{ name: 'fremd.pdf' }] },
			{ typ: 'FOTOS', hochladen: 'ALLE', fotos: [{}] },
		],
	});
	return {
		dateienModul: modulIds[0] as string,
		fotosModul: modulIds[1] as string,
		datei: dateiIds[0] as string,
		foto: dateiIds[1] as string,
	};
}

/** Alles, was eine Route der Datei- und Foto-Module in fremd veraendern koennte. */
async function fremdeModulDateien(k: Kontext) {
	const where = { vereinId: k.fremd.id };
	return {
		dateien: await k.prisma.datei.findMany({ where, orderBy: { id: 'asc' } }),
		loeschliste: await k.prisma.dateiLoeschung.count({ where }),
		stand: (await k.prisma.verein.findUniqueOrThrow({ where: { id: k.fremd.id } })).aenderungsstand,
	};
}

/**
 * Eine Route der Datei- und Foto-Module mit der Id aus fremd: gesperrt 404, das Cookie aus eigen gilt
 * in fremd nicht (401), in eigen ist die Id unbekannt (404), und in fremd ist danach nichts anders.
 * Uploads gehen als Koerper mit X-Dateiname wie aus der Oberflaeche.
 */
async function modulDateiMitFremderId(
	k: Kontext,
	e: { methode: 'POST' | 'PUT' | 'DELETE'; pfad: string; body?: object },
): Promise<void> {
	const vorher = await fremdeModulDateien(k);
	const sendeAn = (slug: string, cookie: string) =>
		e.methode === 'POST'
			? fetch(`${k.url}/${slug}/api/v1${e.pfad}`, {
					method: 'POST',
					headers: {
						Origin: TEST_UMGEBUNG.basisUrl,
						'Content-Type': 'application/octet-stream',
						'X-Dateiname': 'mandant.pdf',
						Cookie: cookie,
					},
					body: new Uint8Array(Buffer.from('%PDF-1.7\n mandant')),
				})
			: sende(k.url, `/${slug}/api/v1${e.pfad}`, { methode: e.methode, body: e.body, cookie });
	expect((await sendeAn(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
	expect((await sendeAn(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
	expect((await sendeAn(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
	expect(await fremdeModulDateien(k)).toEqual(vorher);
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
		// Auch die Foto-Einwilligung eines fremden Kindes ist in eigen unbekannt.
		await meineJungfischerSchreibfall(k, 'einwilligung', { erteilen: true, art: 'FOTOS' });
		expect(await k.prisma.einwilligung.count({ where: { jungfischerId: k.fremdesKindId } })).toBe(0);
	},
	'POST /ich/einwilligung': async (k) => {
		await profilOhneId(k, 'POST', '/ich/einwilligung');
		// In eigen ist die Person der Sitzung kein volljaehriger Jungfischer: 404, und in fremd entsteht nichts.
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/ich/einwilligung`, {
			methode: 'POST',
			body: { erteilen: true },
			cookie: k.eigenesCookie,
		});
		expect(r.status).toBe(404);
		expect(await k.prisma.einwilligung.count({ where: { art: 'FOTOS', vereinId: k.fremd.id } })).toBe(0);
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
	'GET /threads': async (k) => {
		const pfad = '/api/v1/threads';
		expect((await sende(k.url, `/${k.gesperrt.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(401);
		const r = await sende(k.url, `/${k.eigen.slug}${pfad}?archiv=1`, { cookie: k.eigenerLeiter });
		expect(r.status).toBe(200);
		const liste = (await r.json()) as { threads: { id: string; titel: string }[] };
		// Der Thread aus fremd erscheint in der Liste von eigen nicht, auch nicht ueber die Suche.
		expect(liste.threads.map((t) => t.id)).not.toContain(k.fremderThread.threadId);
		expect(liste.threads.map((t) => t.titel)).not.toContain('Fremder Thread');
		// Positiv: Der eigene Austausch steht in der Liste, sie ist also nicht nur leer.
		expect(liste.threads.map((t) => t.titel)).toContain('Jugendsprecher-Austausch');
		const suche = await sende(k.url, `/${k.eigen.slug}${pfad}?archiv=1&suche=Fremder`, { cookie: k.eigenerLeiter });
		expect(((await suche.json()) as { threads: unknown[] }).threads).toEqual([]);
	},
	'GET /start': async (k) => {
		const pfad = '/api/v1/start';
		const tag = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
		await legeThreadAn(k.prisma, k.eigen, new Date(), {
			titel: 'Eigener Ausflug',
			module: [
				{ typ: 'UMFRAGE', teilnahme: true, einheit: 'PERSON' },
				{
					typ: 'TERMIN',
					termin: { startDatum: tag, endDatum: null, beginn: '16:00', ende: null, ort: null, treffpunkt: null },
				},
			],
		});
		expect((await sende(k.url, `/${k.gesperrt.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(401);
		const r = await sende(k.url, `/${k.eigen.slug}${pfad}`, { cookie: k.eigenerLeiter });
		expect(r.status).toBe(200);
		const start = (await r.json()) as { brauchtAntwort: { titel: string }[]; alsNaechstes: { titel: string }[] };
		// Die offene Umfrage aus fremd taucht in keinem Block von eigen auf.
		expect(JSON.stringify(start)).not.toContain(k.fremderThread.threadId);
		expect(JSON.stringify(start)).not.toContain('Fremder Thread');
		// Positiv: Der eigene Thread steht in den Bloecken, die Antwort ist also nicht nur leer.
		expect(start.alsNaechstes.map((t) => t.titel)).toContain('Eigener Ausflug');
		expect(start.brauchtAntwort.map((t) => t.titel)).toContain('Eigener Ausflug');
	},
	'GET /termine': async (k) => {
		const tag = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
		const monat = tag.slice(0, 7);
		const mitTermin = (titel: string) => ({
			titel,
			module: [
				{
					typ: 'TERMIN' as const,
					termin: { startDatum: tag, endDatum: null, beginn: '16:00', ende: null, ort: null, treffpunkt: null },
				},
			],
		});
		await legeThreadAn(k.prisma, k.fremd, new Date(), {
			...mitTermin('Fremder Termin'),
			erstelltVonId: k.fremdePersonId,
		});
		await legeThreadAn(k.prisma, k.eigen, new Date(), {
			...mitTermin('Eigener Termin'),
			erstelltVonId: k.eigenerLeiterId,
		});
		const pfad = `/api/v1/termine?monat=${monat}`;
		expect((await sende(k.url, `/${k.gesperrt.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(401);
		const r = await sende(k.url, `/${k.eigen.slug}${pfad}`, { cookie: k.eigenerLeiter });
		expect(r.status).toBe(200);
		const titel = ((await r.json()) as { termine: { titel: string }[] }).termine.map((t) => t.titel);
		// Der Termin aus fremd steht nicht im Kalender von eigen; der eigene schon, er ist also nicht nur leer.
		expect(titel).not.toContain('Fremder Termin');
		expect(titel).toContain('Eigener Termin');
	},
	'GET /sync': async (k) => {
		// Der Stand vor dem Schreiben: seit=0 koennte vor einem aufgeraeumten Verlauf liegen und "vollstaendig" ohne Listen liefern.
		const vorher = (await k.prisma.verein.findUniqueOrThrow({ where: { id: k.eigen.id } })).aenderungsstand;
		const eigener = await eigenerThread(k);
		const pfad = `/api/v1/sync?seit=${vorher}`;
		expect((await sende(k.url, `/${k.gesperrt.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(401);
		const r = await sende(k.url, `/${k.eigen.slug}${pfad}`, { cookie: k.eigenerLeiter });
		expect(r.status).toBe(200);
		const antwort = (await r.json()) as { geaendert: string[]; unsichtbar: string[] };
		// Die Aenderungen aus fremd tauchen in eigen weder als sichtbar noch als unsichtbar auf; der eigene Thread schon.
		expect([...antwort.geaendert, ...antwort.unsichtbar]).not.toContain(k.fremderThread.threadId);
		expect(antwort.geaendert).toContain(eigener);
	},
	'GET /threads/:id': async (k) => {
		const vorher = await fremdeThreadZeilen(k);
		const hole = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${k.fremderThread.threadId}`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await hole(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Auch die Verwaltung von eigen, die dort alles sieht, kennt den Thread aus fremd nicht.
		const r = await hole(k.eigen.slug, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		expect(await fremdeThreadZeilen(k)).toEqual(vorher);
	},
	'PUT /threads/:id/gelesen': async (k) => {
		const vorher = await fremdeThreadZeilen(k);
		const lies = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${k.fremderThread.threadId}/gelesen`, {
				methode: 'PUT',
				body: { bereich: 'verlauf', bis: 1 },
				cookie,
			});
		expect((await lies(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await lies(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect((await lies(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		expect(await fremdeThreadZeilen(k)).toEqual(vorher);
	},
	'GET /threads/:id/verlauf': async (k) => {
		const vorher = await fremderVerlauf(k);
		const lies = (slug: string, threadId: string, cookie?: string, vor?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}/verlauf${vor ? `?vor=${vor}` : ''}`, { cookie });
		expect((await lies(k.gesperrt.slug, k.fremderThread.threadId, k.eigenerLeiter)).status).toBe(404);
		expect((await lies(k.fremd.slug, k.fremderThread.threadId, k.eigenerLeiter)).status).toBe(401);
		const r = await lies(k.eigen.slug, k.fremderThread.threadId, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Die Nachricht aus fremd taugt auch an einem eigenen Thread nicht als Seitenanker.
		const anker = await lies(k.eigen.slug, await eigenerThread(k), k.eigenerLeiter, k.fremderThread.nachrichtId);
		expect(anker.status).toBe(404);
		expect(await anker.json()).toEqual({ fehler: 'nicht gefunden' });
		expect(await fremderVerlauf(k)).toEqual(vorher);
	},
	'POST /threads/:id/verlauf': async (k) => {
		const vorher = await fremderVerlauf(k);
		const schreibe = (slug: string, threadId: string, clientId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}/verlauf`, {
				methode: 'POST',
				body: { text: 'Uebernommen', clientId },
				cookie,
			});
		const fremderThread = k.fremderThread.threadId;
		expect((await schreibe(k.gesperrt.slug, fremderThread, 'mandant-neu', k.eigenerLeiter)).status).toBe(404);
		expect((await schreibe(k.fremd.slug, fremderThread, 'mandant-neu', k.eigenerLeiter)).status).toBe(401);
		const r = await schreibe(k.eigen.slug, fremderThread, 'mandant-neu', k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Die clientId der Nachricht in fremd ist in eigen frei: ein 409 verriete, dass es sie dort gibt.
		expect((await schreibe(k.eigen.slug, await eigenerThread(k), 'mandant-nachricht', k.eigenerLeiter)).status).toBe(
			201,
		);
		expect(await fremderVerlauf(k)).toEqual(vorher);
	},
	'GET /verwaltung/threads': async (k) => {
		const pfad = '/api/v1/verwaltung/threads';
		expect((await sende(k.url, `/${k.gesperrt.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}${pfad}`, { cookie: k.eigenerLeiter })).status).toBe(401);
		const r = await sende(k.url, `/${k.eigen.slug}${pfad}`, { cookie: k.eigenerLeiter });
		expect(r.status).toBe(200);
		const liste = (await r.json()) as { threads: { id: string; titel: string }[]; untergruppen: { id: string }[] };
		// Weder der Thread noch die Untergruppe aus fremd erscheinen in der Liste von eigen.
		expect(liste.threads.map((t) => t.id)).not.toContain(k.fremderThread.threadId);
		expect(liste.threads.map((t) => t.titel)).not.toContain('Fremder Thread');
		// Positiv: Der eigene Austausch steht in der Liste, sie ist also nicht nur leer.
		expect(liste.threads.map((t) => t.titel)).toContain('Jugendsprecher-Austausch');
		expect(liste.untergruppen.map((g) => g.id)).not.toContain(k.fremdeGruppeId);
	},
	'GET /threads/:id/bearbeitung': async (k) => {
		const hole = (slug: string, threadId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}/bearbeitung`, { cookie });
		const fremder = k.fremderThread.threadId;
		expect((await hole(k.gesperrt.slug, fremder, k.eigenerLeiter)).status).toBe(404);
		expect((await hole(k.fremd.slug, fremder, k.eigenerLeiter)).status).toBe(401);
		const r = await hole(k.eigen.slug, fremder, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Gegenprobe: Ein eigener Thread des Leiters ist bearbeitbar, das Recht fehlt also nicht.
		const eigener = await legeThreadAn(k.prisma, k.eigen, new Date(), { erstelltVonId: k.eigenerLeiterId });
		expect((await hole(k.eigen.slug, eigener.threadId, k.eigenerLeiter)).status).toBe(200);
	},
	'GET /threads/:id/antworten': async (k) => {
		const hole = (slug: string, threadId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}/antworten`, { cookie });
		const fremder = k.fremderThread.threadId;
		expect((await hole(k.gesperrt.slug, fremder, k.eigenerLeiter)).status).toBe(404);
		expect((await hole(k.fremd.slug, fremder, k.eigenerLeiter)).status).toBe(401);
		const r = await hole(k.eigen.slug, fremder, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Gegenprobe: "Antworten im Detail" genuegt an einem eigenen Thread, das Recht fehlt also nicht.
		expect((await hole(k.eigen.slug, await eigenerThread(k), k.eigenerLeiter)).status).toBe(200);
	},
	'POST /threads': async (k) => {
		const vorher = await fremdeThreads(k);
		const lege = (slug: string, untergruppenIds: string[], cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads`, {
				methode: 'POST',
				body: { entwurf: mandantEntwurf(untergruppenIds) },
				cookie,
			});
		expect((await lege(k.gesperrt.slug, [], k.eigenerLeiter)).status).toBe(404);
		expect((await lege(k.fremd.slug, [], k.eigenerLeiter)).status).toBe(401);
		// Die Untergruppe aus fremd gibt es in eigen nicht: 400 am Feld, nicht 404 aus einem P2003.
		const r = await lege(k.eigen.slug, [k.fremdeGruppeId], k.eigenerLeiter);
		expect(r.status).toBe(400);
		expect(await r.json()).toEqual({ fehler: 'Diese Untergruppe gibt es nicht mehr.', feld: 'zielgruppe' });
		// Gegenprobe: Mit dem Recht entsteht in eigen ein Thread, das Recht fehlt also nicht.
		expect((await lege(k.eigen.slug, [], k.eigenerLeiter)).status).toBe(201);
		expect(await fremdeThreads(k)).toEqual(vorher);
	},
	'PUT /threads/:id': async (k) => {
		const vorher = await fremdeThreads(k);
		const ersetze = (slug: string, threadId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}`, {
				methode: 'PUT',
				body: { version: 0, entwurf: mandantEntwurf([]) },
				cookie,
			});
		const fremder = k.fremderThread.threadId;
		expect((await ersetze(k.gesperrt.slug, fremder, k.eigenerLeiter)).status).toBe(404);
		expect((await ersetze(k.fremd.slug, fremder, k.eigenerLeiter)).status).toBe(401);
		const r = await ersetze(k.eigen.slug, fremder, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Gegenprobe: Ein eigener Thread des Leiters laesst sich ersetzen, das Recht fehlt also nicht.
		const eigener = await legeThreadAn(k.prisma, k.eigen, new Date(), { erstelltVonId: k.eigenerLeiterId });
		expect((await ersetze(k.eigen.slug, eigener.threadId, k.eigenerLeiter)).status).toBe(200);
		expect(await fremdeThreads(k)).toEqual(vorher);
	},
	'POST /threads/:id/veroeffentlichen': async (k) => {
		const vorher = await fremdeThreads(k);
		const veroeffentliche = (slug: string, threadId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}/veroeffentlichen`, { methode: 'POST', cookie });
		const fremder = k.fremderThread.threadId;
		expect((await veroeffentliche(k.gesperrt.slug, fremder, k.eigenerLeiter)).status).toBe(404);
		expect((await veroeffentliche(k.fremd.slug, fremder, k.eigenerLeiter)).status).toBe(401);
		const r = await veroeffentliche(k.eigen.slug, fremder, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Gegenprobe: Ein eigener Entwurf des Leiters laesst sich veroeffentlichen, das Recht fehlt also nicht.
		const entwurf = await legeThreadAn(k.prisma, k.eigen, new Date(), {
			erstelltVonId: k.eigenerLeiterId,
			veroeffentlicht: false,
		});
		expect((await veroeffentliche(k.eigen.slug, entwurf.threadId, k.eigenerLeiter)).status).toBe(200);
		expect(await fremdeThreads(k)).toEqual(vorher);
	},
	'PUT /threads/:id/archiv': async (k) => {
		const vorher = await fremdeThreads(k);
		const archiviere = (slug: string, threadId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}/archiv`, {
				methode: 'PUT',
				body: { archiviert: true },
				cookie,
			});
		const fremder = k.fremderThread.threadId;
		expect((await archiviere(k.gesperrt.slug, fremder, k.eigenerLeiter)).status).toBe(404);
		expect((await archiviere(k.fremd.slug, fremder, k.eigenerLeiter)).status).toBe(401);
		const r = await archiviere(k.eigen.slug, fremder, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Gegenprobe: Ein eigener Thread des Leiters laesst sich archivieren, das Recht fehlt also nicht.
		const eigener = await legeThreadAn(k.prisma, k.eigen, new Date(), { erstelltVonId: k.eigenerLeiterId });
		expect((await archiviere(k.eigen.slug, eigener.threadId, k.eigenerLeiter)).status).toBe(200);
		expect(await fremdeThreads(k)).toEqual(vorher);
	},
	'PUT /threads/:id/angepinnt': async (k) => {
		const vorher = await fremdeThreads(k);
		const pinne = (slug: string, threadId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}/angepinnt`, {
				methode: 'PUT',
				body: { angepinnt: true },
				cookie,
			});
		const fremder = k.fremderThread.threadId;
		expect((await pinne(k.gesperrt.slug, fremder, k.eigenerLeiter)).status).toBe(404);
		expect((await pinne(k.fremd.slug, fremder, k.eigenerLeiter)).status).toBe(401);
		const r = await pinne(k.eigen.slug, fremder, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Gegenprobe: Ein eigener Thread des Leiters laesst sich anpinnen, das Recht fehlt also nicht.
		const eigener = await legeThreadAn(k.prisma, k.eigen, new Date(), { erstelltVonId: k.eigenerLeiterId });
		expect((await pinne(k.eigen.slug, eigener.threadId, k.eigenerLeiter)).status).toBe(200);
		expect(await fremdeThreads(k)).toEqual(vorher);
	},
	'DELETE /threads/:id': async (k) => {
		const vorher = await fremdeThreads(k);
		const loesche = (slug: string, threadId: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/threads/${threadId}`, { methode: 'DELETE', cookie });
		const fremder = k.fremderThread.threadId;
		expect((await loesche(k.gesperrt.slug, fremder, k.eigenerLeiter)).status).toBe(404);
		expect((await loesche(k.fremd.slug, fremder, k.eigenerLeiter)).status).toBe(401);
		const r = await loesche(k.eigen.slug, fremder, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		// Gegenprobe: Ein eigener leerer Thread des Leiters laesst sich loeschen, das Recht fehlt also nicht.
		const eigener = await legeThreadAn(k.prisma, k.eigen, new Date(), { erstelltVonId: k.eigenerLeiterId });
		expect((await loesche(k.eigen.slug, eigener.threadId, k.eigenerLeiter)).status).toBe(204);
		expect(await fremdeThreads(k)).toEqual(vorher);
	},
	'DELETE /verlauf/:eintragId': async (k) => {
		const vorher = await fremderVerlauf(k);
		const loesche = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/verlauf/${k.fremderThread.nachrichtId}`, { methode: 'DELETE', cookie });
		expect((await loesche(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await loesche(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		const r = await loesche(k.eigen.slug, k.eigenerLeiter);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });
		expect(await fremderVerlauf(k)).toEqual(vorher);
	},
	'PUT /umfragen/:modulId/antworten/:fuerId': async (k) => {
		const vorher = await fremdeAntworten(k);
		const antworte = (
			slug: string,
			modulId: string,
			fuerId: string,
			optionId: string,
			clientId: string,
			cookie?: string,
		) =>
			sende(k.url, `/${slug}/api/v1/umfragen/${modulId}/antworten/${fuerId}`, {
				methode: 'PUT',
				body: { optionIds: [optionId], clientId },
				cookie,
			});
		const { modulId, optionId } = k.fremderThread;
		const fremd = (slug: string) => antworte(slug, modulId, k.fremdePersonId, optionId, 'mandant-neu', k.eigenerLeiter);
		expect((await fremd(k.gesperrt.slug)).status).toBe(404);
		expect((await fremd(k.fremd.slug)).status).toBe(401);
		const r = await fremd(k.eigen.slug);
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual({ fehler: 'nicht gefunden' });

		// Eine eigene Umfrage, in der eine neue Person aus eigen fuer sich selbst antworten darf.
		const ich = await legeMitgliedAn(k.prisma, k.eigen, { art: 'ERWACHSENER', rechte: ['THREADS_ERSTELLEN'] });
		const eigene = await legeThreadAn(k.prisma, k.eigen, new Date(), {
			erstelltVonId: ich.personId,
			module: [{ typ: 'UMFRAGE', einheit: 'PERSON' }],
		});
		const eigenesModul = eigene.modulIds[0] as string;
		const eigeneOption = eigene.optionIds['ja'] as string;
		// Die Person aus fremd ist in der eigenen Umfrage unbekannt, die Option aus fremd ungueltig.
		const fremdePerson = await antworte(
			k.eigen.slug,
			eigenesModul,
			k.fremdePersonId,
			eigeneOption,
			'mandant-1',
			ich.cookie,
		);
		expect(fremdePerson.status).toBe(404);
		expect(await fremdePerson.json()).toEqual({ fehler: 'nicht gefunden' });
		expect((await antworte(k.eigen.slug, eigenesModul, ich.personId, optionId, 'mandant-2', ich.cookie)).status).toBe(
			400,
		);
		// Die clientId der Antwort in fremd ist in eigen frei: ein 409 verriete, dass es sie dort gibt.
		expect(
			(await antworte(k.eigen.slug, eigenesModul, ich.personId, eigeneOption, 'mandant-antwort', ich.cookie)).status,
		).toBe(200);
		expect(await fremdeAntworten(k)).toEqual(vorher);
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
		// Eine eigene Person im Nachbarverein, damit der Fall keinen Stand der anderen Faelle veraendert:
		// offene Einladung und Wiederherstellungscodes, die der Auszug aus eigen nicht kennen darf.
		const nachbar = await legeMitgliedAn(k.prisma, k.fremd, { art: 'ERWACHSENER' });
		const einladung = await k.prisma.einladung.create({
			data: {
				vereinId: k.fremd.id,
				personId: nachbar.personId,
				art: 'RESET',
				tokenHash: `einladung-${randomUUID()}`,
				ablauf: new Date('2031-03-04T05:06:07.000Z'),
				angelegtAm: new Date('2030-02-03T04:05:06.000Z'),
			},
		});
		const codeHashes = [`code-${randomUUID()}`, `code-${randomUUID()}`];
		await k.prisma.recoveryCode.createMany({
			data: codeHashes.map((codeHash) => ({ vereinId: k.fremd.id, zugangId: nachbar.zugangId, codeHash })),
		});
		expect((await hole(k.gesperrt.slug, k.eigenesCookie)).status).toBe(404);
		// Die Sitzung gilt nur im eigenen Verein: mit dem Slug von fremd kein Auszug, auch nicht der eigene.
		const fremd = await hole(k.fremd.slug, k.eigenesCookie);
		expect(fremd.status).toBe(401);
		expect(fremd.headers.get('content-disposition')).toBeNull();
		// Gegenprobe: In eigen geht es, und der Auszug gehoert der Person der Sitzung.
		const r = await hole(k.eigen.slug, k.eigenesCookie);
		expect(r.status).toBe(200);
		const auszug = (await r.json()) as { verein: unknown; zugang: unknown; offeneEinladungen: unknown };
		expect(auszug.zugang).not.toBeNull();
		const fremdePerson = await k.prisma.person.findUniqueOrThrow({ where: { id: k.fremdePersonId } });
		expect(JSON.stringify(auszug)).not.toContain(fremdePerson.email ?? 'keine-adresse');
		// Von der fremden Einladung und den fremden Codes steht keine Spur im Auszug: weder Hash noch
		// Id noch die Zeitstempel; die Codes zaehlen auch nicht in die eigene Zahl.
		const text = JSON.stringify(auszug);
		for (const spur of [
			einladung.tokenHash,
			einladung.id,
			'2030-02-03T04:05:06',
			'2031-03-04T05:06:07',
			...codeHashes,
		]) {
			expect(text).not.toContain(spur);
		}
		expect(auszug).toMatchObject({
			wiederherstellungscodes: { eingerichtet: false, unbenutzt: 0 },
			offeneEinladungen: [],
		});
	},
	'GET /ansprechpartner': async (k) => {
		const hole = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/ansprechpartner`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenesCookie)).status).toBe(404);
		// Die Sitzung gilt nur im eigenen Verein.
		expect((await hole(k.fremd.slug, k.eigenesCookie)).status).toBe(401);
		// Gegenprobe: In eigen geht es, und die Liste enthaelt dort niemanden aus fremd.
		const r = await hole(k.eigen.slug, k.eigenesCookie);
		expect(r.status).toBe(200);
		const text = await r.text();
		const { ansprechpartner, kontakt } = JSON.parse(text) as { ansprechpartner: { id: string }[]; kontakt: string };
		expect(ansprechpartner.length).toBeGreaterThan(0);
		expect(ansprechpartner.map((a) => a.id)).not.toContain(k.fremdePersonId);
		// Der Kontakt gehoert dem eigenen Verein; der des Nachbarn steht nirgends in der Antwort.
		expect(kontakt).toBe('Kontakt von eigen');
		expect(text).not.toContain('Kontakt von fremd');
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
	'GET /dateien/:id': async (k) => {
		// Die Bytes liegen wirklich im Speicher der App: Das 404 aus eigen kommt von der Vereinsgrenze
		// und nicht davon, dass es nichts auszuliefern gaebe.
		const db = vereinDb(k.prisma, k.fremd.id);
		const kategorie = await db.dokumentKategorie.findFirstOrThrow();
		const dokument = await db.dokument.create({
			data: { kategorieId: kategorie.id, titel: 'Fremdes Dokument', angelegtAm: new Date() },
		});
		const datei = await db.datei.create({
			data: {
				art: 'DATEI',
				dokumentId: dokument.id,
				name: 'fremd.pdf',
				typ: 'application/pdf',
				groesse: 5,
				sha256: 'x',
				vonId: k.fremdePersonId,
				hochgeladenAm: new Date(),
			},
		});
		const speicher = new VerzeichnisSpeicher(TEST_UMGEBUNG.dateienPfad);
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, '%PDF-');
		await speicher.uebernimm(temp, dateiSchluessel(k.fremd.id, datei.id));

		const hole = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/dateien/${datei.id}`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenesCookie)).status).toBe(404);
		expect((await hole(k.fremd.slug, k.eigenesCookie)).status).toBe(401);
		expect((await hole(k.eigen.slug, k.eigenesCookie)).status).toBe(404);
		expect((await hole(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		// Gegenprobe: In fremd selbst kommt dieselbe Datei an.
		const fremdesMitglied = await legeMitgliedAn(k.prisma, k.fremd, { art: 'ERWACHSENER' });
		expect((await hole(k.fremd.slug, fremdesMitglied.cookie)).status).toBe(200);
	},
	'GET /dateien/:id/vorschau': async (k) => {
		// Wie bei GET /dateien/:id: Die Bytes der Vorschau liegen wirklich im Speicher von fremd.
		const { foto } = await fremdeMedien(k);
		const speicher = new VerzeichnisSpeicher(TEST_UMGEBUNG.dateienPfad);
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, await erzeugeBild({ breite: 64, hoehe: 48, format: 'jpeg' }));
		await speicher.uebernimm(temp, dateiSchluessel(k.fremd.id, foto, true));

		const hole = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/dateien/${foto}/vorschau`, { cookie });
		expect((await hole(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await hole(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		expect((await hole(k.eigen.slug, k.eigenerLeiter)).status).toBe(404);
		// Gegenprobe: Ein Jugendleiter von fremd bekommt dasselbe Foto.
		const fremderLeiter = await legeMitgliedAn(k.prisma, k.fremd, { art: 'ERWACHSENER', rechte: ['ALLE_THREADS'] });
		expect((await hole(k.fremd.slug, fremderLeiter.cookie)).status).toBe(200);
	},
	'POST /module/:modulId/dateien': async (k) => {
		const { dateienModul } = await fremdeMedien(k);
		await modulDateiMitFremderId(k, { methode: 'POST', pfad: `/module/${dateienModul}/dateien` });
		// Gegenprobe: In ein eigenes Datei-Modul laedt dieselbe Person hoch, das 404 oben kommt also
		// von der Vereinsgrenze und nicht von fehlenden Rechten.
		const eigen = await legeThreadAn(k.prisma, k.eigen, new Date(), {
			erstelltVonId: k.eigenerLeiterId,
			module: [{ typ: 'DATEIEN' }],
		});
		const r = await fetch(`${k.url}/${k.eigen.slug}/api/v1/module/${eigen.modulIds[0]}/dateien`, {
			method: 'POST',
			headers: {
				Origin: TEST_UMGEBUNG.basisUrl,
				'Content-Type': 'application/octet-stream',
				'X-Dateiname': 'eigen.pdf',
				Cookie: k.eigenerLeiter,
			},
			body: new Uint8Array(Buffer.from('%PDF-1.7\n eigen')),
		});
		expect(r.status).toBe(201);
	},
	'POST /module/:modulId/fotos': async (k) => {
		const { fotosModul } = await fremdeMedien(k);
		await modulDateiMitFremderId(k, { methode: 'POST', pfad: `/module/${fotosModul}/fotos` });
	},
	'PUT /dateien/:id': async (k) => {
		const { datei } = await fremdeMedien(k);
		await modulDateiMitFremderId(k, { methode: 'PUT', pfad: `/dateien/${datei}`, body: { name: 'Uebernommen' } });
	},
	'DELETE /dateien/:id': async (k) => {
		const { datei, foto } = await fremdeMedien(k);
		await modulDateiMitFremderId(k, { methode: 'DELETE', pfad: `/dateien/${datei}` });
		await modulDateiMitFremderId(k, { methode: 'DELETE', pfad: `/dateien/${foto}` });
	},
	'GET /dokumente': async (k) => {
		const fremd = await legeDokumentAn(k, k.fremd, k.fremdePersonId, 'Fremdes Dokument');
		expect((await sende(k.url, `/${k.gesperrt.slug}/api/v1/dokumente`, { cookie: k.eigenerLeiter })).status).toBe(404);
		expect((await sende(k.url, `/${k.fremd.slug}/api/v1/dokumente`, { cookie: k.eigenerLeiter })).status).toBe(401);
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/dokumente`, { cookie: k.eigenerLeiter });
		expect(r.status).toBe(200);
		const eigen = (await r.json()) as DokumenteAntwort;
		const titel = eigen.kategorien.flatMap((kat) => kat.dokumente.map((d) => d.titel));
		expect(titel).not.toContain('Fremdes Dokument');
		expect(eigen.kategorien.flatMap((kat) => [kat.id, ...kat.dokumente.map((d) => d.id)])).not.toContain(
			fremd.dokument.id,
		);
		// Gegenprobe: In fremd selbst steht das Dokument in der Liste.
		const nachbar = await legeMitgliedAn(k.prisma, k.fremd, { art: 'ERWACHSENER' });
		const dort = (await (
			await sende(k.url, `/${k.fremd.slug}/api/v1/dokumente`, { cookie: nachbar.cookie })
		).json()) as DokumenteAntwort;
		expect(dort.kategorien.flatMap((kat) => kat.dokumente.map((d) => d.id))).toContain(fremd.dokument.id);
	},
	'POST /dokumente': async (k) => {
		const { kategorie } = await legeDokumentAn(k, k.fremd, k.fremdePersonId, 'Fremdes Dokument');
		await dokumenteMitFremderId(k, { methode: 'POST', pfad: (id) => `/dokumente?kategorie=${id}`, id: kategorie.id });
	},
	'PUT /dokumente/:id': async (k) => {
		const { dokument } = await legeDokumentAn(k, k.fremd, k.fremdePersonId, 'Fremdes Dokument');
		await dokumenteMitFremderId(k, {
			methode: 'PUT',
			pfad: (id) => `/dokumente/${id}`,
			id: dokument.id,
			body: { titel: 'Uebernommen' },
		});
		// Auch ein eigenes Dokument laesst sich nicht in eine Kategorie aus fremd verschieben.
		const eigenes = await legeDokumentAn(k, k.eigen, k.eigenerLeiterId, 'Eigenes Dokument');
		const fremdeKategorie = await vereinDb(k.prisma, k.fremd.id).dokumentKategorie.findFirstOrThrow();
		const r = await sende(k.url, `/${k.eigen.slug}/api/v1/dokumente/${eigenes.dokument.id}`, {
			methode: 'PUT',
			body: { kategorieId: fremdeKategorie.id },
			cookie: k.eigenerLeiter,
		});
		expect(r.status).toBe(404);
		expect(
			(await vereinDb(k.prisma, k.eigen.id).dokument.findUniqueOrThrow({ where: { id: eigenes.dokument.id } }))
				.kategorieId,
		).toBe(eigenes.kategorie.id);
	},
	'PUT /dokumente/:id/datei': async (k) => {
		const { dokument } = await legeDokumentAn(k, k.fremd, k.fremdePersonId, 'Fremdes Dokument');
		await dokumenteMitFremderId(k, { methode: 'PUT', pfad: (id) => `/dokumente/${id}/datei`, id: dokument.id });
	},
	'DELETE /dokumente/:id': async (k) => {
		const { dokument } = await legeDokumentAn(k, k.fremd, k.fremdePersonId, 'Fremdes Dokument');
		await dokumenteMitFremderId(k, { methode: 'DELETE', pfad: (id) => `/dokumente/${id}`, id: dokument.id });
	},
	'POST /dokument-kategorien': async (k) => {
		const vorher = await fremdeDokumente(k);
		const anlegen = (slug: string, cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/dokument-kategorien`, { methode: 'POST', body: { name: 'Mandant-Neu' }, cookie });
		expect((await anlegen(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await anlegen(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		// Gegenprobe: In eigen entsteht sie, in fremd nicht.
		const r = await anlegen(k.eigen.slug, k.eigenerLeiter);
		expect(r.status).toBe(201);
		expect(await fremdeDokumente(k)).toEqual(vorher);
		// Aufgeraeumt, damit spaetere Faelle dieselben drei Kategorien in eigen vorfinden.
		await vereinDb(k.prisma, k.eigen.id).dokumentKategorie.deleteMany({ where: { name: 'Mandant-Neu' } });
	},
	'PUT /dokument-kategorien/:id': async (k) => {
		const kategorie = await vereinDb(k.prisma, k.fremd.id).dokumentKategorie.findFirstOrThrow();
		await dokumenteMitFremderId(k, {
			methode: 'PUT',
			pfad: (id) => `/dokument-kategorien/${id}`,
			id: kategorie.id,
			body: { name: 'Uebernommen' },
		});
	},
	'PUT /dokument-kategorien/reihenfolge': async (k) => {
		const vorher = await fremdeDokumente(k);
		const eigene = (await vereinDb(k.prisma, k.eigen.id).dokumentKategorie.findMany()).map((kat) => kat.id);
		const fremde = vorher.kategorien.map((kat) => kat.id);
		const ordne = (slug: string, ids: string[], cookie?: string) =>
			sende(k.url, `/${slug}/api/v1/dokument-kategorien/reihenfolge`, { methode: 'PUT', body: { ids }, cookie });
		expect((await ordne(k.gesperrt.slug, fremde, k.eigenerLeiter)).status).toBe(404);
		expect((await ordne(k.fremd.slug, fremde, k.eigenerLeiter)).status).toBe(401);
		// Die Ids aus fremd sind in eigen keine Kategorien, ob allein oder zwischen eigenen.
		expect((await ordne(k.eigen.slug, fremde, k.eigenerLeiter)).status).toBe(400);
		expect((await ordne(k.eigen.slug, [...eigene.slice(1), fremde[0] as string], k.eigenerLeiter)).status).toBe(400);
		expect(await fremdeDokumente(k)).toEqual(vorher);
	},
	'DELETE /dokument-kategorien/:id': async (k) => {
		const leer = await vereinDb(k.prisma, k.fremd.id).dokumentKategorie.create({
			data: { name: `Leer ${randomUUID().slice(0, 8)}`, position: 99 },
		});
		await dokumenteMitFremderId(k, { methode: 'DELETE', pfad: (id) => `/dokument-kategorien/${id}`, id: leer.id });
	},
	'GET /speicher': async (k) => {
		// In fremd liegt mindestens eine Datei: Der Verbrauch von eigen darf sie nicht mitzaehlen.
		await legeDokumentAn(k, k.fremd, k.fremdePersonId, 'Fremdes Dokument');
		const holeSpeicher = (slug: string, cookie?: string) => sende(k.url, `/${slug}/api/v1/speicher`, { cookie });
		expect((await holeSpeicher(k.gesperrt.slug, k.eigenerLeiter)).status).toBe(404);
		expect((await holeSpeicher(k.fremd.slug, k.eigenerLeiter)).status).toBe(401);
		const r = await holeSpeicher(k.eigen.slug, k.eigenerLeiter);
		expect(r.status).toBe(200);
		const eigeneSumme = await k.prisma.datei.aggregate({ where: { vereinId: k.eigen.id }, _sum: { groesse: true } });
		const fremdeSumme = await k.prisma.datei.aggregate({ where: { vereinId: k.fremd.id }, _sum: { groesse: true } });
		const antwort = (await r.json()) as SpeicherAntwort;
		expect(antwort.verbrauchBytes).toBe(eigeneSumme._sum.groesse ?? 0);
		expect(fremdeSumme._sum.groesse ?? 0).toBeGreaterThan(0);
		expect(antwort.verbrauchBytes).not.toBe((eigeneSumme._sum.groesse ?? 0) + (fremdeSumme._sum.groesse ?? 0));
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
			legeVereinAn(prisma, { slug: 'mandant-eigen', kontakt: 'Kontakt von eigen' }),
			legeVereinAn(prisma, { slug: 'mandant-fremd', kontakt: 'Kontakt von fremd' }),
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
			rechte: [
				'MITGLIEDER',
				'JUGENDLEITER_RECHTE',
				'EINSTELLUNGEN',
				'THREADS_ERSTELLEN',
				'ANTWORTEN_DETAIL',
				'DOKUMENTE',
			],
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
		const { threadId, modulIds, optionIds } = await legeThreadAn(prisma, fremd, new Date(), {
			titel: 'Fremder Thread',
			erstelltVonId: nachbar.personId,
			module: [{ typ: 'UMFRAGE', einheit: 'PERSON', optionen: ['Ja', 'Nein'] }],
		});
		await vereinDb(prisma, fremd.id).umfrageAntwort.create({
			data: {
				umfrageId: modulIds[0] as string,
				fuerId: nachbar.personId,
				vonId: nachbar.personId,
				abgegebenAm: new Date(),
				clientId: 'mandant-antwort',
				optionen: { create: [{ optionId: optionIds['ja'] as string }] },
			},
		});
		const { aenderungsstand } = await prisma.verein.update({
			where: { id: fremd.id },
			data: { aenderungsstand: { increment: 1 } },
			select: { aenderungsstand: true },
		});
		const nachricht = await prisma.verlaufEintrag.create({
			data: {
				vereinId: fremd.id,
				threadId,
				art: 'NACHRICHT',
				autorId: nachbar.personId,
				text: 'Nachricht in fremd',
				stand: aenderungsstand,
				clientId: 'mandant-nachricht',
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
			eigenerLeiterId: leiter.personId,
			fremdePersonId: nachbar.personId,
			fremdesKindId: fremdesKind.id,
			fremdeGruppeId: fremdeGruppe.id,
			fremderThread: {
				threadId,
				modulId: modulIds[0] as string,
				optionId: optionIds['ja'] as string,
				nachrichtId: nachricht.id,
			},
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

/**
 * Die Sockets sind keine Vereins-Route und stehen darum nicht in FAELLE: Der Hub haelt die
 * Sockets je Verein, und ein Ereignis aus Verein A darf keinen Socket aus Verein B erreichen.
 */
describe('Mandanten-Test Echtzeit', () => {
	const prisma = createPrismaClientFromEnv();
	const bus = new Bus();
	const jetzt = new Date();
	let server: Server;
	let hub: Hub;
	let url = '';
	const sockets: WebSocket[] = [];

	beforeAll(async () => {
		const app = createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, bus });
		server = createServer(app);
		hub = new Hub({ prisma, umgebung: TEST_UMGEBUNG, jetzt: () => new Date(), bus });
		hub.haengeAn(server);
		await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		for (const ws of sockets) ws.terminate();
		await hub.schliesseAlle();
		server.closeAllConnections();
		await new Promise<void>((fertig, fehler) => server.close((err) => (err ? fehler(err) : fertig())));
		await prisma.$disconnect();
	});

	/** Ein offener Socket, der alles mitschreibt, was der Hub ihm schickt. */
	async function oeffne(slug: string, cookie: string): Promise<EchtzeitSignal[]> {
		const ws = new WebSocket(`${url.replace('http', 'ws')}/${slug}/ws`, {
			headers: { Cookie: cookie, Origin: TEST_UMGEBUNG.basisUrl },
		});
		sockets.push(ws);
		const signale: EchtzeitSignal[] = [];
		ws.on('message', (daten) => signale.push(JSON.parse(String(daten)) as EchtzeitSignal));
		await new Promise<void>((fertig, fehler) => {
			ws.once('open', () => fertig());
			ws.once('error', fehler);
		});
		return signale;
	}

	it('ein Socket aus Verein B bekommt bei einer Nachricht in Verein A nichts', async () => {
		const kuerzel = randomUUID().slice(0, 8);
		const a = await legeVereinAn(prisma, { slug: `mandant-ws-a-${kuerzel}` });
		const b = await legeVereinAn(prisma, { slug: `mandant-ws-b-${kuerzel}` });
		// In beiden Vereinen ein Jugendleiter: Er saehe jeden Thread seines Vereins, eine
		// Stille in B liegt also an der Vereinsgrenze und nicht an der Zielgruppe.
		const leiterA = await legeMitgliedAn(prisma, a, { art: 'ERWACHSENER', rechte: ['THREADS_ERSTELLEN'], jetzt });
		const leiterB = await legeMitgliedAn(prisma, b, { art: 'ERWACHSENER', rechte: ['THREADS_ERSTELLEN'], jetzt });
		const { threadId } = await legeThreadAn(prisma, a, jetzt, { erstelltVonId: leiterA.personId });
		const inA = await oeffne(a.slug, leiterA.cookie);
		const inB = await oeffne(b.slug, leiterB.cookie);

		const r = await sende(url, `/${a.slug}/api/v1/threads/${threadId}/verlauf`, {
			methode: 'POST',
			body: { text: 'Nur fuer Verein A', clientId: randomUUID() },
			cookie: leiterA.cookie,
		});
		expect(r.status).toBe(201);
		// Erst die Zustellung in A, dann die Stille in B: Bis A sein Signal hat, hat der Hub
		// ueber alle Sockets entschieden.
		await expect.poll(() => inA.map((s) => s.threadId)).toEqual([threadId]);
		await new Promise((fertig) => setTimeout(fertig, 300));
		expect(inB).toEqual([]);
	});
});
