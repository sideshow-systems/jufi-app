import { hashToken } from '@jufi/auth';
import { createPrismaClientFromEnv, sperreVereinszeile, type Recht } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

describe('Entfernen und Zugang entziehen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test: Leitung, Zuordnungen und Folgeangebot zaehlen, also darf kein anderer Test hineinreichen. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `entfernen-${randomUUID().slice(0, 8)}` });
		const verwalter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['MITGLIEDER'] });
		const leitung = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE'],
		});
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const entferne = (id: string, cookie = verwalter.cookie) =>
			sende(server.url, api(`/personen/${id}`), { methode: 'DELETE', cookie });
		const person = (id: string) => prisma.person.findUniqueOrThrow({ where: { id } });
		const verknuepfe = (erwachsenerId: string, jungfischerId: string, erziehungsberechtigt = true) =>
			prisma.bezugsperson.create({
				data: {
					vereinId: verein.id,
					erwachsenerId,
					jungfischerId,
					beziehung: 'ANDERE',
					beziehungFreitext: 'x',
					erziehungsberechtigt,
				},
			});
		const willigtEin = (jungfischerId: string, erteiltVon: string) =>
			prisma.einwilligung.create({
				data: { vereinId: verein.id, jungfischerId, erteiltVon, art: 'DSGVO_ART8', textVersion: '1' },
			});
		return { verein, verwalter, leitung, api, entferne, person, verknuepfe, willigtEin };
	}

	it('Entfernen eines Jungfischers leert die Zeile, loescht Zugang, Passkeys, Sitzungen, Einladungen, Zuordnungen und Mitgliedschaften und laesst Einwilligungen stehen', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER', vorname: 'Kai', nachname: 'Kind' });
		await prisma.person.update({
			where: { id: kind.personId },
			data: { email: 'kai@example.test', jugendsprecher: true },
		});
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(mutter.personId, kind.personId);
		const einwilligung = await v.willigtEin(kind.personId, mutter.personId);
		const gruppe = await prisma.untergruppe.create({ data: { vereinId: v.verein.id, name: 'Hechte' } });
		await prisma.untergruppeMitglied.create({
			data: { vereinId: v.verein.id, untergruppeId: gruppe.id, personId: kind.personId },
		});
		await prisma.passkey.create({
			data: {
				vereinId: v.verein.id,
				zugangId: kind.zugangId,
				credentialId: `c-${randomUUID()}`,
				publicKey: 'k',
				label: 'Handy',
			},
		});
		await prisma.recoveryCode.create({ data: { vereinId: v.verein.id, zugangId: kind.zugangId, codeHash: 'h' } });
		await prisma.einladung.create({
			data: {
				vereinId: v.verein.id,
				personId: kind.personId,
				art: 'EINLADUNG',
				tokenHash: randomUUID(),
				ablauf: new Date(Date.now() + 86_400_000),
			},
		});
		const nachbar = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		await v.verknuepfe(mutter.personId, nachbar.personId);

		const r = await v.entferne(kind.personId);
		expect(r.status).toBe(200);

		const zeile = await v.person(kind.personId);
		expect(zeile).toMatchObject({
			vorname: '',
			nachname: '',
			geburtsdatum: null,
			email: null,
			rechte: [],
			jugendsprecher: false,
		});
		expect(zeile.entferntAm).toBeInstanceOf(Date);
		expect(await prisma.zugang.count({ where: { personId: kind.personId } })).toBe(0);
		expect(await prisma.passkey.count({ where: { zugangId: kind.zugangId } })).toBe(0);
		expect(await prisma.recoveryCode.count({ where: { zugangId: kind.zugangId } })).toBe(0);
		expect(await prisma.session.count({ where: { zugangId: kind.zugangId } })).toBe(0);
		expect(await prisma.einladung.count({ where: { personId: kind.personId } })).toBe(0);
		expect(await prisma.bezugsperson.count({ where: { jungfischerId: kind.personId } })).toBe(0);
		expect(await prisma.untergruppeMitglied.count({ where: { personId: kind.personId } })).toBe(0);
		expect(await prisma.einwilligung.findUnique({ where: { id: einwilligung.id } })).toEqual(einwilligung);
		// Was nicht zur Person gehoert, bleibt: die Mutter, ihr anderes Kind und dessen Zuordnung.
		expect((await v.person(mutter.personId)).entferntAm).toBeNull();
		expect(await prisma.bezugsperson.count({ where: { jungfischerId: nachbar.personId } })).toBe(1);
		expect(await prisma.untergruppe.count({ where: { id: gruppe.id } })).toBe(1);
	});

	it('Folgeangebot nennt Opa Hans, der sonst niemanden hat, aber nicht die Mutter mit weiterem Kind und nicht einen Erwachsenen mit Rechten', async () => {
		const v = await neuerVerein();
		const kai = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const lea = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const hans = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', vorname: 'Hans', nachname: 'Opa' });
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		const helfer = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', rechte: ['ANTWORTEN_DETAIL'] });
		await v.verknuepfe(hans.personId, kai.personId, false);
		await v.verknuepfe(mutter.personId, kai.personId);
		await v.verknuepfe(mutter.personId, lea.personId);
		await v.verknuepfe(helfer.personId, kai.personId);

		const r = await v.entferne(kai.personId, v.leitung.cookie);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ folgeangebot: [{ id: hans.personId, vorname: 'Hans', nachname: 'Opa' }] });
	});

	it('ein weiteres, aber selbst entferntes Kind zaehlt nicht: der Erwachsene steht im Folgeangebot', async () => {
		const v = await neuerVerein();
		const kai = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const alt = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const hans = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', vorname: 'Hans', nachname: 'Opa' });
		await v.verknuepfe(hans.personId, kai.personId);
		await v.verknuepfe(hans.personId, alt.personId);
		await prisma.person.update({ where: { id: alt.personId }, data: { entferntAm: new Date() } });

		const r = await v.entferne(kai.personId);
		expect(((await r.json()) as { folgeangebot: { id: string }[] }).folgeangebot.map((p) => p.id)).toEqual([
			hans.personId,
		]);
	});

	it('E-Mail des Grabsteins ist frei: derselbe Erwachsene kann mit der Adresse neu angelegt werden', async () => {
		const v = await neuerVerein();
		const erw = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', email: 'wieder@example.test' });
		const r = await v.entferne(erw.personId);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ folgeangebot: [] });
		const grabstein = await v.person(erw.personId);
		expect(grabstein).toMatchObject({ vorname: '', nachname: '', email: null });
		expect(grabstein.entferntAm).toBeInstanceOf(Date);
		const neu = await sende(server.url, v.api('/personen'), {
			methode: 'POST',
			body: { art: 'ERWACHSENER', vorname: 'Wieder', nachname: 'Da', email: 'wieder@example.test' },
			cookie: v.verwalter.cookie,
		});
		expect(neu.status).toBe(201);
	});

	it('Sitzung der entfernten Person gilt nicht mehr (401)', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const erw = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		for (const p of [kind, erw]) {
			expect((await sende(server.url, v.api('/ich'), { cookie: p.cookie })).status).toBe(200);
		}
		expect((await v.entferne(kind.personId)).status).toBe(200);
		expect((await v.entferne(erw.personId)).status).toBe(200);
		for (const p of [kind, erw]) {
			expect((await sende(server.url, v.api('/ich'), { cookie: p.cookie })).status).toBe(401);
		}
	});

	it('Entfernen eines Erwachsenen loest seine Zuordnungen und entzieht dem Kind den Zugang, wenn dessen Einwilligung nur von ihm kam', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(mutter.personId, kind.personId);
		await v.willigtEin(kind.personId, mutter.personId);

		expect((await v.entferne(mutter.personId)).status).toBe(200);
		expect(await prisma.bezugsperson.count({ where: { erwachsenerId: mutter.personId } })).toBe(0);
		expect((await v.person(kind.personId)).zugangErlaubt).toBe(false);
		expect(await prisma.zugang.count({ where: { personId: kind.personId } })).toBe(0);
		// Die Einwilligung bleibt als Nachweis stehen, gilt aber nicht mehr.
		expect(await prisma.einwilligung.count({ where: { jungfischerId: kind.personId } })).toBe(1);
	});

	it('Entfernen eines Erwachsenen laesst dem Kind den Zugang, wenn ein anderer Erziehungsberechtigter eingewilligt hat', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		const vater = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		for (const e of [mutter, vater]) {
			await v.verknuepfe(e.personId, kind.personId);
			await v.willigtEin(kind.personId, e.personId);
		}

		expect((await v.entferne(mutter.personId)).status).toBe(200);
		expect((await v.person(kind.personId)).zugangErlaubt).toBe(true);
		expect(await prisma.zugang.count({ where: { personId: kind.personId } })).toBe(1);
	});

	it('Entfernen eines Erwachsenen laesst volljaehrigen Kindern den Zugang', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		await prisma.person.update({ where: { id: kind.personId }, data: { geburtsdatum: new Date('2000-01-01') } });
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(mutter.personId, kind.personId);
		await v.willigtEin(kind.personId, mutter.personId);
		expect((await v.entferne(mutter.personId)).status).toBe(200);
		expect((await v.person(kind.personId)).zugangErlaubt).toBe(true);
		expect(await prisma.zugang.count({ where: { personId: kind.personId } })).toBe(1);
	});

	it('Verein ohne Leitung: ein Jungfischer laesst sich trotzdem entfernen (kein 409)', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		await prisma.person.update({ where: { id: v.leitung.personId }, data: { rechte: [] } });
		expect((await v.entferne(kind.personId)).status).toBe(200);
	});

	it('offene Mails zu den geloeschten Einladungen fallen mit weg, gesendete und fremde bleiben', async () => {
		const v = await neuerVerein();
		const erw = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		const andere = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		const einladung = (personId: string) =>
			prisma.einladung.create({
				data: {
					vereinId: v.verein.id,
					personId,
					art: 'EINLADUNG',
					tokenHash: randomUUID(),
					ablauf: new Date(Date.now() + 86_400_000),
				},
			});
		const mail = (bezug: string, gesendetAm: Date | null = null) =>
			prisma.mailWarteschlange.create({
				data: { vereinId: v.verein.id, empfaenger: 'x@example.test', betreff: 'b', text: 't', bezug, gesendetAm },
			});
		const e1 = await einladung(erw.personId);
		const e2 = await einladung(erw.personId);
		const fremde = await einladung(andere.personId);
		await mail(`einladung:${e1.id}`);
		await mail(`reset:${e2.id}`);
		const gesendet = await mail(`einladung:${e1.id}`, new Date());
		const fremdeMail = await mail(`einladung:${fremde.id}`);
		expect((await v.entferne(erw.personId)).status).toBe(200);
		const rest = await prisma.mailWarteschlange.findMany({ where: { vereinId: v.verein.id } });
		expect(rest.map((m) => m.id).sort()).toEqual([gesendet.id, fremdeMail.id].sort());
	});

	it('Leitung entfernt einen Jugendleiter: Rechte geleert, Grabstein', async () => {
		const v = await neuerVerein();
		const leiter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', rechte: ['MITGLIEDER', 'DOKUMENTE'] });
		const r = await v.entferne(leiter.personId, v.leitung.cookie);
		expect(r.status).toBe(200);
		const zeile = await v.person(leiter.personId);
		expect(zeile.rechte).toEqual([]);
		expect(zeile.entferntAm).toBeInstanceOf(Date);
	});

	it('sich selbst entfernen: 409 SELBST, nichts geschieht', async () => {
		const v = await neuerVerein();
		for (const ich of [v.verwalter, v.leitung]) {
			const r = await v.entferne(ich.personId, ich.cookie);
			expect(r.status).toBe(409);
			expect(((await r.json()) as { code: string }).code).toBe('SELBST');
			expect((await v.person(ich.personId)).entferntAm).toBeNull();
			expect(await prisma.zugang.count({ where: { personId: ich.personId } })).toBe(1);
		}
	});

	it('Verwalter ohne JUGENDLEITER_RECHTE entfernt Jugendleiter: 404, Person unveraendert', async () => {
		const v = await neuerVerein();
		const vorher = await v.person(v.leitung.personId);
		expect((await v.entferne(v.leitung.personId)).status).toBe(404);
		expect(await v.person(v.leitung.personId)).toEqual(vorher);
		expect(await prisma.zugang.count({ where: { personId: v.leitung.personId } })).toBe(1);
	});

	it('ohne MITGLIEDER: 404, nichts geschehen', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		const betreuer = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', rechte: ['ANTWORTEN_DETAIL'] });
		expect((await v.entferne(kind.personId, betreuer.cookie)).status).toBe(404);
		expect((await v.person(kind.personId)).entferntAm).toBeNull();
	});

	it('zwei Leitungen entfernen sich gleichzeitig: einmal 200, einmal 404, eine behaelt das Recht', async () => {
		// Die Leitung kann keine letzte Leitung entfernen, ohne sich selbst zu entfernen (SELBST): wer
		// entfernt, ist selbst Inhaber. Der Wettlauf zeigt, dass der Handelnde unter der Sperre neu
		// bewertet wird -- ohne das kaemen beide durch und der Verein stuende ohne Leitung da.
		for (let i = 0; i < 6; i++) {
			const v = await neuerVerein();
			const a = await legeMitgliedAn(prisma, v.verein, {
				art: 'ERWACHSENER',
				rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE'],
			});
			await prisma.person.update({ where: { id: v.leitung.personId }, data: { rechte: [] } });
			const b = await legeMitgliedAn(prisma, v.verein, {
				art: 'ERWACHSENER',
				rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE'],
			});
			const [x, y] = await Promise.all([v.entferne(b.personId, a.cookie), v.entferne(a.personId, b.cookie)]);
			expect([x.status, y.status].sort()).toEqual([200, 404]);
			const mitRecht = await prisma.person.count({
				where: { vereinId: v.verein.id, entferntAm: null, rechte: { has: 'JUGENDLEITER_RECHTE' } },
			});
			expect(mitRecht).toBe(1);
		}
	});

	it('Handelnder verliert MITGLIEDER, waehrend sein DELETE an der Sperre wartet: 404, Ziel unveraendert', async () => {
		const v = await neuerVerein();
		const ziel = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		let anfrage!: Promise<Response>;
		await prisma.$transaction(async (tx) => {
			await sperreVereinszeile(tx, v.verein.id);
			anfrage = v.entferne(ziel.personId);
			// Der Request ist an der Vorpruefung vorbei und haengt an der Sperre.
			await new Promise((r) => setTimeout(r, 300));
			await tx.person.update({ where: { id: v.verwalter.personId }, data: { rechte: [] } });
		});
		expect((await anfrage).status).toBe(404);
		expect((await v.person(ziel.personId)).entferntAm).toBeNull();
	});

	it('zweites DELETE auf denselben Grabstein: 404; unbekannte ID: 404', async () => {
		const v = await neuerVerein();
		const kind = await legeMitgliedAn(prisma, v.verein, { art: 'JUNGFISCHER' });
		expect((await v.entferne(kind.personId)).status).toBe(200);
		expect((await v.entferne(kind.personId)).status).toBe(404);
		expect((await v.entferne('gibt-es-nicht')).status).toBe(404);
	});

	it('ohne Anmeldung: 401', async () => {
		const v = await neuerVerein();
		const r = await sende(server.url, v.api(`/personen/${v.verwalter.personId}`), { methode: 'DELETE' });
		expect(r.status).toBe(401);
	});
});

describe('Einladen aus der Verwaltung', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `einladen-${randomUUID().slice(0, 8)}` });
		const verwalter = await legeMitgliedAn(prisma, verein, { art: 'ERWACHSENER', rechte: ['MITGLIEDER'] });
		const leitung = await legeMitgliedAn(prisma, verein, {
			art: 'ERWACHSENER',
			rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE'],
		});
		const api = (pfad: string) => `/${verein.slug}/api/v1${pfad}`;
		const lade = (id: string, body: unknown = {}, cookie = verwalter.cookie) =>
			sende(server.url, api(`/personen/${id}/einladung`), { methode: 'POST', body, cookie });
		/** Person ohne Zugang, so wie die Verwaltung sie anlegt. */
		const legePersonAn = (e: {
			art: 'ERWACHSENER' | 'JUNGFISCHER';
			email?: string;
			geburtsdatum?: string;
			zugangErlaubt?: boolean;
			rechte?: Recht[];
		}) =>
			prisma.person.create({
				data: {
					vereinId: verein.id,
					art: e.art,
					vorname: 'Neu',
					nachname: 'Person',
					email: e.email ?? null,
					geburtsdatum: e.art === 'JUNGFISCHER' ? new Date(e.geburtsdatum ?? '2015-05-05') : null,
					zugangErlaubt: e.zugangErlaubt ?? true,
					rechte: e.rechte ?? [],
				},
			});
		const verknuepfe = (erwachsenerId: string, jungfischerId: string, erziehungsberechtigt = true) =>
			prisma.bezugsperson.create({
				data: {
					vereinId: verein.id,
					erwachsenerId,
					jungfischerId,
					beziehung: 'ANDERE',
					beziehungFreitext: 'x',
					erziehungsberechtigt,
				},
			});
		const willigtEin = (jungfischerId: string, erteiltVon: string) =>
			prisma.einwilligung.create({
				data: { vereinId: verein.id, jungfischerId, erteiltVon, art: 'DSGVO_ART8', textVersion: '1' },
			});
		const einladungen = (personId: string) => prisma.einladung.findMany({ where: { personId } });
		return { verein, verwalter, leitung, api, lade, legePersonAn, verknuepfe, willigtEin, einladungen };
	}

	type Antwort = { link: string; text: string; ablauf: string };

	it('Verwalter laedt Erwachsenen ein: Link mit Token hinter #, Einladung gespeichert', async () => {
		const v = await neuerVerein();
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER' });

		const r = await v.lade(ziel.id);
		expect(r.status).toBe(201);
		const antwort = (await r.json()) as Antwort;
		const [vorHash, token] = antwort.link.split('#');
		expect(vorHash).toBe(`${TEST_UMGEBUNG.basisUrl}/${v.verein.slug}/einladung`);
		expect(token).toBeTruthy();
		expect(antwort.text).toContain(antwort.link);
		const [zeile] = await v.einladungen(ziel.id);
		expect(zeile).toMatchObject({
			art: 'EINLADUNG',
			tokenHash: hashToken(token ?? ''),
			erstelltVonPersonId: v.verwalter.personId,
			eingeloestAm: null,
		});
		expect(antwort.ablauf).toBe(zeile?.ablauf.toISOString());
		// Ohne mail: true geht keine Mail hinaus.
		expect(await prisma.mailWarteschlange.count({ where: { vereinId: v.verein.id } })).toBe(0);
	});

	it('zweiter Aufruf entwertet den ersten Link und seine ungesendete Mail', async () => {
		const v = await neuerVerein();
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER', email: 'zwei@example.test' });

		const erste = (await (await v.lade(ziel.id, { mail: true })).json()) as Antwort;
		const zweite = (await (await v.lade(ziel.id, { mail: true })).json()) as Antwort;
		expect(zweite.link).not.toBe(erste.link);
		const zeilen = await v.einladungen(ziel.id);
		expect(zeilen).toHaveLength(1);
		expect(zeilen[0]?.tokenHash).toBe(hashToken(zweite.link.split('#')[1] ?? ''));
		// Die Mail mit dem toten Link darf nicht mehr hinausgehen.
		const mails = await prisma.mailWarteschlange.findMany({ where: { vereinId: v.verein.id } });
		expect(mails).toHaveLength(1);
		expect(mails[0]?.bezug).toBe(`einladung:${zeilen[0]?.id}`);
	});

	it('mail: true ohne E-Mail: 400, nichts angelegt', async () => {
		const v = await neuerVerein();
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER' });
		const r = await v.lade(ziel.id, { mail: true });
		expect(r.status).toBe(400);
		expect(await v.einladungen(ziel.id)).toHaveLength(0);
	});

	it('mail: kein Wahrheitswert: 400', async () => {
		const v = await neuerVerein();
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER', email: 'x@example.test' });
		expect((await v.lade(ziel.id, { mail: 'ja' })).status).toBe(400);
		expect(await v.einladungen(ziel.id)).toHaveLength(0);
	});

	it('mail: true legt eine Warteschlangenzeile mit bezug einladung:<id> an', async () => {
		const v = await neuerVerein();
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER', email: 'mail@example.test' });
		const r = await v.lade(ziel.id, { mail: true });
		expect(r.status).toBe(201);
		const antwort = (await r.json()) as Antwort;
		const [einladung] = await v.einladungen(ziel.id);
		const mails = await prisma.mailWarteschlange.findMany({ where: { vereinId: v.verein.id } });
		expect(mails).toHaveLength(1);
		expect(mails[0]).toMatchObject({
			empfaenger: 'mail@example.test',
			bezug: `einladung:${einladung?.id}`,
			gesendetAm: null,
		});
		expect(mails[0]?.text).toContain(antwort.link);
	});

	it('Jungfischer ohne Einwilligung: 409 EINWILLIGUNG_FEHLT, nichts angelegt', async () => {
		const v = await neuerVerein();
		const kind = await v.legePersonAn({ art: 'JUNGFISCHER' });
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(mutter.personId, kind.id);
		const r = await v.lade(kind.id);
		expect(r.status).toBe(409);
		expect(await r.json()).toMatchObject({ code: 'EINWILLIGUNG_FEHLT', fehler: expect.any(String) });
		expect(await v.einladungen(kind.id)).toHaveLength(0);
	});

	it('Einwilligung eines Nicht-Erziehungsberechtigten gilt nicht: 409 EINWILLIGUNG_FEHLT', async () => {
		const v = await neuerVerein();
		const kind = await v.legePersonAn({ art: 'JUNGFISCHER' });
		const oma = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(oma.personId, kind.id, false);
		await v.willigtEin(kind.id, oma.personId);
		expect((await v.lade(kind.id)).status).toBe(409);
	});

	it('Jungfischer mit gueltiger Einwilligung: 201', async () => {
		const v = await neuerVerein();
		const kind = await v.legePersonAn({ art: 'JUNGFISCHER' });
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(mutter.personId, kind.id);
		await v.willigtEin(kind.id, mutter.personId);
		expect((await v.lade(kind.id)).status).toBe(201);
	});

	it('volljaehriger Jungfischer braucht keine Einwilligung (Spec 5.6): 201', async () => {
		const v = await neuerVerein();
		const kind = await v.legePersonAn({ art: 'JUNGFISCHER', geburtsdatum: '2000-01-01' });
		expect((await v.lade(kind.id)).status).toBe(201);
	});

	it('Jungfischer mit zugangErlaubt=false: 409 ZUGANG_NICHT_ERLAUBT, auch mit Einwilligung', async () => {
		const v = await neuerVerein();
		const kind = await v.legePersonAn({ art: 'JUNGFISCHER', zugangErlaubt: false });
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(mutter.personId, kind.id);
		await v.willigtEin(kind.id, mutter.personId);
		const r = await v.lade(kind.id);
		expect(r.status).toBe(409);
		expect(await r.json()).toMatchObject({ code: 'ZUGANG_NICHT_ERLAUBT', fehler: expect.any(String) });
		expect(await v.einladungen(kind.id)).toHaveLength(0);
	});

	it('Erziehungsberechtigte laedt eigenes Kind ein, fremdes Kind: 404', async () => {
		const v = await neuerVerein();
		const mutter = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		const eigenes = await v.legePersonAn({ art: 'JUNGFISCHER' });
		const fremdes = await v.legePersonAn({ art: 'JUNGFISCHER' });
		await v.verknuepfe(mutter.personId, eigenes.id);
		await v.willigtEin(eigenes.id, mutter.personId);
		const fremde = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER' });
		await v.verknuepfe(fremde.personId, fremdes.id);
		await v.willigtEin(fremdes.id, fremde.personId);

		expect((await v.lade(eigenes.id, {}, mutter.cookie)).status).toBe(201);
		expect((await v.lade(fremdes.id, {}, mutter.cookie)).status).toBe(404);
		expect(await v.einladungen(fremdes.id)).toHaveLength(0);
	});

	it('Verwalter ohne JUGENDLEITER_RECHTE laedt Jugendleiter ein: 404; mit dem Recht: 201', async () => {
		const v = await neuerVerein();
		const leiter = await v.legePersonAn({ art: 'ERWACHSENER', rechte: ['DOKUMENTE'] });
		expect((await v.lade(leiter.id)).status).toBe(404);
		expect(await v.einladungen(leiter.id)).toHaveLength(0);
		expect((await v.lade(leiter.id, {}, v.leitung.cookie)).status).toBe(201);
	});

	it('Betreuer (nur Einsicht) darf nicht einladen: 404', async () => {
		const v = await neuerVerein();
		const betreuer = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', rechte: ['ANTWORTEN_DETAIL'] });
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER' });
		expect((await v.lade(ziel.id, {}, betreuer.cookie)).status).toBe(404);
		expect(await v.einladungen(ziel.id)).toHaveLength(0);
	});

	it('Grabstein und unbekannte ID: 404', async () => {
		const v = await neuerVerein();
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER' });
		await prisma.person.update({ where: { id: ziel.id }, data: { entferntAm: new Date() } });
		expect((await v.lade(ziel.id)).status).toBe(404);
		expect((await v.lade('gibt-es-nicht')).status).toBe(404);
		expect(await v.einladungen(ziel.id)).toHaveLength(0);
	});

	it('Person mit Zugang bekommt einen Reset-Link statt einer Einladung', async () => {
		const v = await neuerVerein();
		const ziel = await legeMitgliedAn(prisma, v.verein, { art: 'ERWACHSENER', email: 'reset@example.test' });
		const alteEinladung = await prisma.einladung.create({
			data: {
				vereinId: v.verein.id,
				personId: ziel.personId,
				art: 'EINLADUNG',
				tokenHash: randomUUID(),
				ablauf: new Date(Date.now() + 86_400_000),
			},
		});
		const r = await v.lade(ziel.personId, { mail: true });
		expect(r.status).toBe(201);
		const antwort = (await r.json()) as Antwort;
		const zeilen = await v.einladungen(ziel.personId);
		const reset = zeilen.find((z) => z.art === 'RESET');
		expect(reset?.tokenHash).toBe(hashToken(antwort.link.split('#')[1] ?? ''));
		// Ein Reset laesst eine offene Einladung der anderen Art stehen (erzeugeVereinsEinladung).
		expect(zeilen.some((z) => z.id === alteEinladung.id)).toBe(true);
		// Der Text sagt, was der Link bewirkt und wie lange er gilt.
		expect(antwort.text).toContain('1 Stunde');
		expect(antwort.text).toContain('gelöscht');
		expect(await prisma.mailWarteschlange.count({ where: { bezug: `einladung:${reset?.id}` } })).toBe(1);
	});

	it('Handelnder verliert MITGLIEDER, waehrend sein Einladen an der Sperre wartet: 404, nichts angelegt', async () => {
		const v = await neuerVerein();
		const ziel = await v.legePersonAn({ art: 'ERWACHSENER' });
		let anfrage!: Promise<Response>;
		await prisma.$transaction(async (tx) => {
			await sperreVereinszeile(tx, v.verein.id);
			anfrage = v.lade(ziel.id);
			await new Promise((r) => setTimeout(r, 300));
			await tx.person.update({ where: { id: v.verwalter.personId }, data: { rechte: [] } });
		});
		expect((await anfrage).status).toBe(404);
		expect(await v.einladungen(ziel.id)).toHaveLength(0);
	});

	it('ohne Anmeldung: 401', async () => {
		const v = await neuerVerein();
		const r = await sende(server.url, v.api(`/personen/${v.verwalter.personId}/einladung`), {
			methode: 'POST',
			body: {},
		});
		expect(r.status).toBe(401);
	});
});
