import { createPrismaClientFromEnv, type Recht } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { erwarteNichts, erwarteUmfeldAenderung, sammleEreignisse } from '../echtzeit/test-bus.js';
import { MAIL_MAX_VERSUCHE } from '../mail/arbeiter.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { legeMitgliedAn } from './test-mitglieder.js';

type Eintrag = {
	id: string;
	art: string;
	vorname: string;
	nachname: string;
	geburtsdatum?: string;
	jugendsprecher?: boolean;
	rechte?: string[];
	email?: string;
	untergruppen?: { id: string; name: string }[];
	warnhinweise?: { art: string }[];
	familie?: { erwachsenerId: string; jungfischerId: string; vorname: string; erziehungsberechtigt: boolean }[];
	einladung?: { offen: boolean; mailNichtZugestellt: boolean } | null;
	zugang?: { vorhanden: boolean } | null;
};

describe('Personen', () => {
	const prisma = createPrismaClientFromEnv();
	let server: TestServer;
	const ereignisse = sammleEreignisse();

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, bus: ereignisse.bus }),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	/** Eigener Verein je Test: Listen zeigen den ganzen Verein, Tests duerfen sich nicht stoeren. */
	async function neuerVerein() {
		const verein = await legeVereinAn(prisma, { slug: `personen-${randomUUID().slice(0, 8)}` });
		const api = (pfad: string, cookie?: string) => sende(server.url, `/${verein.slug}/api/v1${pfad}`, { cookie });
		const liste = async (cookie: string) => {
			const r = await api('/personen', cookie);
			expect(r.status).toBe(200);
			return ((await r.json()) as { personen: Eintrag[] }).personen;
		};
		const mitglied = (rechte: Recht[], vorname = 'Leo', art: 'ERWACHSENER' | 'JUNGFISCHER' = 'ERWACHSENER') =>
			legeMitgliedAn(prisma, verein, { art, vorname, rechte });
		const kind = (vorname: string, geburtsdatum = '2015-05-05') =>
			prisma.person.create({
				data: {
					vereinId: verein.id,
					art: 'JUNGFISCHER',
					vorname,
					nachname: 'Kind',
					geburtsdatum: new Date(geburtsdatum),
				},
			});
		const erwachsener = (vorname: string) =>
			prisma.person.create({
				data: {
					vereinId: verein.id,
					art: 'ERWACHSENER',
					vorname,
					nachname: 'Erw',
					email: `${vorname.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`,
				},
			});
		const zuordnen = (erwachsenerId: string, jungfischerId: string, beziehung: 'MUTTER' | 'GROSSMUTTER' = 'MUTTER') =>
			prisma.bezugsperson.create({
				data: {
					vereinId: verein.id,
					erwachsenerId,
					jungfischerId,
					beziehung,
					erziehungsberechtigt: beziehung === 'MUTTER',
				},
			});
		return { verein, api, liste, mitglied, kind, erwachsener, zuordnen };
	}

	it('Verwalter sieht alle mit E-Mail', async () => {
		const v = await neuerVerein();
		const verwalter = await v.mitglied(['MITGLIEDER']);
		const kind = await v.kind('Kai');
		const erw = await v.erwachsener('Anna');
		const liste = await v.liste(verwalter.cookie);
		expect(liste.map((p) => p.id).sort()).toEqual([verwalter.personId, kind.id, erw.id].sort());
		const anna = liste.find((p) => p.id === erw.id);
		expect(anna?.email).toBe(erw.email);
		expect(liste.find((p) => p.id === kind.id)?.geburtsdatum).toBe('2015-05-05');
	});

	it('Betreuer sieht alle ohne E-Mail und ohne Warnhinweis-Einladung', async () => {
		const v = await neuerVerein();
		const betreuer = await v.mitglied(['ANTWORTEN_DETAIL']);
		const kind = await v.kind('Kai');
		const erw = await v.erwachsener('Anna');
		const einladung = await prisma.einladung.create({
			data: {
				vereinId: v.verein.id,
				personId: erw.id,
				art: 'EINLADUNG',
				tokenHash: randomUUID(),
				ablauf: new Date(Date.now() + 86_400_000),
			},
		});
		await prisma.mailWarteschlange.create({
			data: {
				vereinId: v.verein.id,
				empfaenger: erw.email ?? '',
				betreff: 'x',
				text: 'x',
				versuche: MAIL_MAX_VERSUCHE,
				bezug: `einladung:${einladung.id}`,
			},
		});
		const liste = await v.liste(betreuer.cookie);
		expect(liste.map((p) => p.id).sort()).toEqual([betreuer.personId, kind.id, erw.id].sort());
		// Die eigene Adresse sieht jeder selbst, die der anderen nur die Verwaltung.
		for (const p of liste.filter((x) => x.id !== betreuer.personId)) {
			expect(p).not.toHaveProperty('email');
			const arten = (p.warnhinweise ?? []).map((w) => w.art);
			expect(arten).not.toContain('EINLADUNG_OFFEN');
			expect(arten).not.toContain('MAIL_NICHT_ZUGESTELLT');
		}
		// Der Einwilligungsstand gehoert der Verwaltung (Spec 5.2).
		expect(liste.find((p) => p.id === kind.id)?.warnhinweise?.map((w) => w.art)).not.toContain('EINWILLIGUNG_FEHLT');
		// Betreuer sehen die Sicherheitshinweise zum Kind weiterhin.
		expect(liste.find((p) => p.id === kind.id)?.warnhinweise?.map((w) => w.art)).toContain('OHNE_FAMILIE');
		expect(liste.find((p) => p.id === kind.id)?.geburtsdatum).toBe('2015-05-05');
	});

	it('Mutter sieht Kind und Leitung, nicht das fremde Kind', async () => {
		const v = await neuerVerein();
		const mutter = await v.mitglied([]);
		const leitung = await v.mitglied(['MITGLIEDER', 'JUGENDLEITER_RECHTE'], 'Lena');
		const eigenes = await v.kind('Eigen');
		const fremdes = await v.kind('Fremd');
		await v.zuordnen(mutter.personId, eigenes.id);
		const liste = await v.liste(mutter.cookie);
		expect(liste.map((p) => p.id).sort()).toEqual([mutter.personId, eigenes.id, leitung.personId].sort());
		expect(liste.map((p) => p.id)).not.toContain(fremdes.id);
		const leiterin = liste.find((p) => p.id === leitung.personId);
		// Die Leitung erscheint nur als Ansprechpartnerin: Name, kein Geburtsdatum, keine Rechte, keine Adresse.
		expect(leiterin).toMatchObject({ vorname: 'Lena' });
		expect(leiterin).not.toHaveProperty('email');
		expect(leiterin).not.toHaveProperty('rechte');
		expect(leiterin).not.toHaveProperty('warnhinweise');
		// Zur Familie gehoeren die Angaben, aber keine Verwaltungshinweise.
		expect(liste.find((p) => p.id === eigenes.id)?.geburtsdatum).toBe('2015-05-05');
		expect(liste.find((p) => p.id === eigenes.id)).not.toHaveProperty('warnhinweise');
	});

	it('Grabstein erscheint nirgends', async () => {
		const v = await neuerVerein();
		const verwalter = await v.mitglied(['MITGLIEDER']);
		const kind = await v.kind('Weg');
		await prisma.person.update({ where: { id: kind.id }, data: { entferntAm: new Date() } });
		expect((await v.liste(verwalter.cookie)).map((p) => p.id)).not.toContain(kind.id);
	});

	it('GET /personen/:id fremde ID gibt 404', async () => {
		const v = await neuerVerein();
		const w = await neuerVerein();
		const verwalter = await v.mitglied(['MITGLIEDER']);
		const fremd = await w.kind('Fremd');
		expect((await v.api(`/personen/${fremd.id}`, verwalter.cookie)).status).toBe(404);
	});

	it('GET /personen/:id Grabstein gibt 404', async () => {
		const v = await neuerVerein();
		const verwalter = await v.mitglied(['MITGLIEDER']);
		const kind = await v.kind('Weg');
		await prisma.person.update({ where: { id: kind.id }, data: { entferntAm: new Date() } });
		expect((await v.api(`/personen/${kind.id}`, verwalter.cookie)).status).toBe(404);
	});

	it('Mutter ruft die Einzelansicht der Grossmutter auf: 200 (Familie), eines fremden Erwachsenen: 404', async () => {
		const v = await neuerVerein();
		const mutter = await v.mitglied([]);
		const oma = await v.erwachsener('Oma');
		const fremde = await v.erwachsener('Fremde');
		const kind = await v.kind('Kai');
		await v.zuordnen(mutter.personId, kind.id);
		await v.zuordnen(oma.id, kind.id, 'GROSSMUTTER');
		const r = await v.api(`/personen/${oma.id}`, mutter.cookie);
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ id: oma.id, vorname: 'Oma' });
		expect((await v.api(`/personen/${fremde.id}`, mutter.cookie)).status).toBe(404);
	});

	it('Einzelansicht des Kindes: Familie fuer die Mutter, Einladung und Zugang nur fuer die Verwaltung', async () => {
		const v = await neuerVerein();
		const mutter = await v.mitglied([]);
		const verwalter = await v.mitglied(['MITGLIEDER'], 'Vera');
		const kind = await v.kind('Kai');
		await v.zuordnen(mutter.personId, kind.id);
		const alsMutter = (await (await v.api(`/personen/${kind.id}`, mutter.cookie)).json()) as Eintrag;
		expect(alsMutter.familie).toEqual([
			expect.objectContaining({ erwachsenerId: mutter.personId, erziehungsberechtigt: true, beziehung: 'MUTTER' }),
		]);
		expect(alsMutter).not.toHaveProperty('einladung');
		expect(alsMutter).not.toHaveProperty('zugang');
		const alsVerwalter = (await (await v.api(`/personen/${kind.id}`, verwalter.cookie)).json()) as Eintrag;
		expect(alsVerwalter.einladung).toEqual({ offen: false, ablauf: null, mailNichtZugestellt: false });
		expect(alsVerwalter.zugang).toEqual({ vorhanden: false, letzteAnmeldungAm: null, erlaubt: true });
		// Die Mutter sieht im Erwachsenen-Profil statt der Familie die Kinder.
		const sieSelbst = (await (await v.api(`/personen/${mutter.personId}`, mutter.cookie)).json()) as Eintrag;
		expect(sieSelbst.familie).toEqual([expect.objectContaining({ jungfischerId: kind.id, vorname: 'Kai' })]);
	});

	it('Einzelansicht des Kindes: Eine Foto-Einwilligung nimmt den Hinweis "ohne Einwilligung" nicht weg', async () => {
		const v = await neuerVerein();
		const verwalter = await v.mitglied(['MITGLIEDER'], 'Vera');
		const mutter = await v.erwachsener('Mia');
		const kind = await v.kind('Kai');
		await v.zuordnen(mutter.id, kind.id);
		await prisma.einwilligung.create({
			data: { vereinId: v.verein.id, jungfischerId: kind.id, erteiltVon: mutter.id, art: 'FOTOS', textVersion: '1' },
		});

		const alsVerwalter = (await (await v.api(`/personen/${kind.id}`, verwalter.cookie)).json()) as Eintrag;
		expect(alsVerwalter.warnhinweise?.map((w) => w.art)).toContain('EINWILLIGUNG_FEHLT');
	});

	it('Einzelansicht fuer Betreuer: Familie, aber weder Adresse noch Einladung noch Zugang noch Einwilligungshinweis', async () => {
		const v = await neuerVerein();
		const betreuer = await v.mitglied(['ANTWORTEN_DETAIL']);
		const verwalter = await v.mitglied(['MITGLIEDER'], 'Vera');
		const mutter = await v.erwachsener('Mia');
		const kind = await v.kind('Kai');
		await v.zuordnen(mutter.id, kind.id);
		const alsBetreuer = (await (await v.api(`/personen/${kind.id}`, betreuer.cookie)).json()) as Eintrag;
		expect(alsBetreuer.familie).toEqual([expect.objectContaining({ erwachsenerId: mutter.id })]);
		for (const feld of ['email', 'einladung', 'zugang']) expect(alsBetreuer).not.toHaveProperty(feld);
		expect(alsBetreuer.warnhinweise?.map((w) => w.art)).not.toContain('EINWILLIGUNG_FEHLT');
		const alsVerwalter = (await (await v.api(`/personen/${kind.id}`, verwalter.cookie)).json()) as Eintrag;
		expect(alsVerwalter.warnhinweise?.map((w) => w.art)).toContain('EINWILLIGUNG_FEHLT');
	});

	it('Einzelansicht der Leitung durch die Mutter zeigt nur den Namen', async () => {
		const v = await neuerVerein();
		const mutter = await v.mitglied([]);
		const leitung = await v.mitglied(['MITGLIEDER', 'JUGENDLEITER_RECHTE'], 'Lena');
		const r = await v.api(`/personen/${leitung.personId}`, mutter.cookie);
		expect(r.status).toBe(200);
		expect(Object.keys((await r.json()) as object).sort()).toEqual(['art', 'id', 'nachname', 'vorname']);
	});

	it('ein entferntes gemeinsames Kind verbindet Erwachsene nicht mehr', async () => {
		const v = await neuerVerein();
		const mutter = await v.mitglied([]);
		const vater = await v.erwachsener('Vater');
		const kind = await v.kind('Kai');
		await v.zuordnen(mutter.personId, kind.id);
		await v.zuordnen(vater.id, kind.id);
		expect((await v.liste(mutter.cookie)).map((p) => p.id)).toContain(vater.id);
		await prisma.person.update({ where: { id: kind.id }, data: { entferntAm: new Date() } });
		expect((await v.liste(mutter.cookie)).map((p) => p.id)).not.toContain(vater.id);
		expect((await v.api(`/personen/${vater.id}`, mutter.cookie)).status).toBe(404);
	});

	it('Warnhinweise: Kind ohne Familie ist OHNE_FAMILIE, Einladungsmail nach MAIL_MAX_VERSUCHE Fehlschlaegen ist MAIL_NICHT_ZUGESTELLT', async () => {
		const v = await neuerVerein();
		const verwalter = await v.mitglied(['MITGLIEDER']);
		const kind = await v.kind('Kai');
		const erw = await v.erwachsener('Anna');
		const nochNicht = await v.erwachsener('Berta');
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
		const mail = (bezug: string, versuche: number) =>
			prisma.mailWarteschlange.create({
				data: { vereinId: v.verein.id, empfaenger: 'a@example.test', betreff: 'x', text: 'x', versuche, bezug },
			});
		const e1 = await einladung(erw.id);
		await mail(`einladung:${e1.id}`, MAIL_MAX_VERSUCHE);
		const e2 = await einladung(nochNicht.id);
		await mail(`einladung:${e2.id}`, MAIL_MAX_VERSUCHE - 1);

		const liste = await v.liste(verwalter.cookie);
		const arten = (id: string) => liste.find((p) => p.id === id)?.warnhinweise?.map((w) => w.art);
		expect(arten(kind.id)).toContain('OHNE_FAMILIE');
		expect(arten(erw.id)).toEqual(expect.arrayContaining(['EINLADUNG_OFFEN', 'MAIL_NICHT_ZUGESTELLT']));
		expect(arten(nochNicht.id)).toEqual(['EINLADUNG_OFFEN']);
	});

	it('unangemeldet gibt 401', async () => {
		const v = await neuerVerein();
		const kind = await v.kind('Kai');
		expect((await v.api('/personen')).status).toBe(401);
		expect((await v.api(`/personen/${kind.id}`)).status).toBe(401);
	});

	it('GET /ich meldet hatKinder', async () => {
		const v = await neuerVerein();
		const mutter = await v.mitglied([]);
		const ohne = await v.mitglied([]);
		const kind = await v.kind('Kai');
		await v.zuordnen(mutter.personId, kind.id);
		const hat = async (cookie: string) =>
			((await (await v.api('/ich', cookie)).json()) as { hatKinder: boolean }).hatKinder;
		expect(await hat(mutter.cookie)).toBe(true);
		expect(await hat(ohne.cookie)).toBe(false);
	});

	describe('anlegen und aendern', () => {
		const tagesText = (d: Date) => d.toISOString().slice(0, 10);
		/** Geburtstag vor genau jahren Jahren plus tage Tagen Abstand: tage > 0 liegt davor (aelter). */
		const vor = (jahre: number, tage = 0) => {
			const d = new Date();
			d.setUTCFullYear(d.getUTCFullYear() - jahre);
			d.setUTCDate(d.getUTCDate() - tage);
			return tagesText(d);
		};
		const post = (v: Awaited<ReturnType<typeof neuerVerein>>, cookie: string, body: unknown) =>
			sende(server.url, `/${v.verein.slug}/api/v1/personen`, { methode: 'POST', body, cookie });
		const patch = (v: Awaited<ReturnType<typeof neuerVerein>>, cookie: string, id: string, body: unknown) =>
			sende(server.url, `/${v.verein.slug}/api/v1/personen/${id}`, { methode: 'PATCH', body, cookie });
		const belassen = (v: Awaited<ReturnType<typeof neuerVerein>>, cookie: string, id: string) =>
			sende(server.url, `/${v.verein.slug}/api/v1/personen/${id}/volljaehrig-belassen`, { methode: 'POST', cookie });

		it('Jungfischer anlegen mit Untergruppen', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const a = await prisma.untergruppe.create({ data: { vereinId: v.verein.id, name: 'Stufe A' } });
			const b = await prisma.untergruppe.create({ data: { vereinId: v.verein.id, name: 'Stufe B' } });
			const r = await post(v, verwalter.cookie, {
				art: 'JUNGFISCHER',
				vorname: ' Mia ',
				nachname: 'Fisch',
				geburtsdatum: '2014-03-04',
				untergruppenIds: [a.id, b.id, a.id],
			});
			expect(r.status).toBe(201);
			const { id } = (await r.json()) as { id: string };
			const person = await prisma.person.findUniqueOrThrow({ where: { id } });
			expect(person).toMatchObject({ vorname: 'Mia', art: 'JUNGFISCHER', rechte: [], vereinId: v.verein.id });
			const mitgliedschaften = await prisma.untergruppeMitglied.findMany({ where: { personId: id } });
			expect(mitgliedschaften.map((m) => m.untergruppeId).sort()).toEqual([a.id, b.id].sort());
		});

		it('fremde Untergruppe gibt 400 und legt nichts an', async () => {
			const v = await neuerVerein();
			const w = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const fremd = await prisma.untergruppe.create({ data: { vereinId: w.verein.id, name: 'Fremd' } });
			const r = await post(v, verwalter.cookie, {
				art: 'JUNGFISCHER',
				vorname: 'Mia',
				nachname: 'Fisch',
				geburtsdatum: '2014-03-04',
				untergruppenIds: [fremd.id],
			});
			expect(r.status).toBe(400);
			expect(await prisma.person.count({ where: { vereinId: v.verein.id, vorname: 'Mia' } })).toBe(0);
		});

		it('Jungfischer ohne Geburtsdatum gibt 400, Geburtsdatum in der Zukunft ebenso', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const basis = { art: 'JUNGFISCHER', vorname: 'Mia', nachname: 'Fisch' };
			const ohne = await post(v, verwalter.cookie, basis);
			expect(ohne.status).toBe(400);
			expect(await ohne.json()).toMatchObject({ feld: 'geburtsdatum' });
			const zukunft = new Date();
			zukunft.setUTCFullYear(zukunft.getUTCFullYear() + 1);
			expect((await post(v, verwalter.cookie, { ...basis, geburtsdatum: tagesText(zukunft) })).status).toBe(400);
			expect((await post(v, verwalter.cookie, { ...basis, geburtsdatum: '2015-02-31' })).status).toBe(400);
			expect((await post(v, verwalter.cookie, { ...basis, vorname: '  ', geburtsdatum: '2015-02-01' })).status).toBe(
				400,
			);
			expect((await post(v, verwalter.cookie, { ...basis, art: 'ROBOTER', geburtsdatum: '2015-02-01' })).status).toBe(
				400,
			);
		});

		it('Erwachsener: Rechte im Body werden ignoriert, Geburtsdatum ist verboten', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER', 'JUGENDLEITER_RECHTE']);
			const r = await post(v, verwalter.cookie, {
				art: 'ERWACHSENER',
				vorname: 'Egon',
				nachname: 'Erw',
				rechte: ['MITGLIEDER', 'JUGENDLEITER_RECHTE'],
			});
			expect(r.status).toBe(201);
			const { id } = (await r.json()) as { id: string };
			expect((await prisma.person.findUniqueOrThrow({ where: { id } })).rechte).toEqual([]);
			const mitDatum = await post(v, verwalter.cookie, {
				art: 'ERWACHSENER',
				vorname: 'Erna',
				nachname: 'Erw',
				geburtsdatum: '1980-01-01',
			});
			expect(mitDatum.status).toBe(400);
		});

		it('Dublette gibt 409 DOPPELT, mit trotzdem 201', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const bestehend = await v.kind('Kai');
			const body = { art: 'JUNGFISCHER', vorname: 'kai', nachname: 'Kind ', geburtsdatum: '2015-05-05' };
			const r = await post(v, verwalter.cookie, body);
			expect(r.status).toBe(409);
			expect(await r.json()).toMatchObject({
				code: 'DOPPELT',
				person: { id: bestehend.id, vorname: 'Kai', nachname: 'Kind' },
			});
			expect(await prisma.person.count({ where: { vereinId: v.verein.id, nachname: 'Kind' } })).toBe(1);
			expect((await post(v, verwalter.cookie, { ...body, trotzdem: true })).status).toBe(201);
			expect(await prisma.person.count({ where: { vereinId: v.verein.id, nachname: 'Kind' } })).toBe(2);
		});

		it('doppelte E-Mail gibt 409 EMAIL_VERGEBEN, auch in anderer Schreibweise; ungueltige gibt 400', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const vorhanden = await v.erwachsener('Anna');
			const body = {
				art: 'ERWACHSENER',
				vorname: 'Berta',
				nachname: 'Neu',
				email: ` ${(vorhanden.email ?? '').toUpperCase()} `,
			};
			const r = await post(v, verwalter.cookie, body);
			expect(r.status).toBe(409);
			expect(await r.json()).toMatchObject({ code: 'EMAIL_VERGEBEN' });
			expect((await post(v, verwalter.cookie, { ...body, email: 'kaputt' })).status).toBe(400);
			// Dieselbe Adresse in einem anderen Verein ist erlaubt.
			const w = await neuerVerein();
			const fremdVerwalter = await w.mitglied(['MITGLIEDER']);
			expect((await post(w, fremdVerwalter.cookie, { ...body, email: vorhanden.email })).status).toBe(201);
		});

		it('zwei gleichzeitige Anlagen derselben E-Mail: genau eine 201', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const email = `doppelt-${randomUUID().slice(0, 6)}@example.test`;
			const anlegen = (vorname: string) =>
				post(v, verwalter.cookie, { art: 'ERWACHSENER', vorname, nachname: 'Rennen', email, trotzdem: true });
			const antworten = await Promise.all([anlegen('Eins'), anlegen('Zwei'), anlegen('Drei'), anlegen('Vier')]);
			const stati = antworten.map((r) => r.status).sort();
			expect(stati).toEqual([201, 409, 409, 409]);
			expect(await prisma.person.count({ where: { vereinId: v.verein.id, email } })).toBe(1);
		});

		it('Betreuer ohne MITGLIEDER bekommt auf allen drei Routen 404', async () => {
			const v = await neuerVerein();
			const betreuer = await v.mitglied(['ANTWORTEN_DETAIL']);
			const kind = await v.kind('Kai');
			const anlegen = await post(v, betreuer.cookie, {
				art: 'JUNGFISCHER',
				vorname: 'Neu',
				nachname: 'Kind',
				geburtsdatum: '2015-05-05',
			});
			expect(anlegen.status).toBe(404);
			expect((await patch(v, betreuer.cookie, kind.id, { vorname: 'Anders' })).status).toBe(404);
			expect((await belassen(v, betreuer.cookie, kind.id)).status).toBe(404);
			expect(await prisma.person.count({ where: { vereinId: v.verein.id, nachname: 'Kind', vorname: 'Neu' } })).toBe(0);
			expect((await prisma.person.findUniqueOrThrow({ where: { id: kind.id } })).vorname).toBe('Kai');
		});

		it('unangemeldet gibt 401', async () => {
			const v = await neuerVerein();
			const kind = await v.kind('Kai');
			const roh = (pfad: string, methode: string) =>
				sende(server.url, `/${v.verein.slug}/api/v1${pfad}`, { methode, body: {} });
			expect((await roh('/personen', 'POST')).status).toBe(401);
			expect((await roh(`/personen/${kind.id}`, 'PATCH')).status).toBe(401);
			expect((await roh(`/personen/${kind.id}/volljaehrig-belassen`, 'POST')).status).toBe(401);
		});

		it('PATCH: Namen, Geburtsdatum und E-Mail aendern, E-Mail leer entfernt sie', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const kind = await v.kind('Kai');
			const r = await patch(v, verwalter.cookie, kind.id, {
				vorname: ' Karl ',
				geburtsdatum: '2014-01-02',
				email: 'Karl@Example.test',
			});
			expect(r.status).toBe(200);
			expect(await prisma.person.findUniqueOrThrow({ where: { id: kind.id } })).toMatchObject({
				vorname: 'Karl',
				nachname: 'Kind',
				email: 'karl@example.test',
			});
			expect((await patch(v, verwalter.cookie, kind.id, { email: '  ' })).status).toBe(200);
			expect((await prisma.person.findUniqueOrThrow({ where: { id: kind.id } })).email).toBeNull();
			expect((await patch(v, verwalter.cookie, kind.id, { geburtsdatum: '' })).status).toBe(400);
			expect((await patch(v, verwalter.cookie, kind.id, { vorname: '' })).status).toBe(400);
		});

		it('PATCH: doppelte E-Mail gibt 409 EMAIL_VERGEBEN', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const anna = await v.erwachsener('Anna');
			const berta = await v.erwachsener('Berta');
			const r = await patch(v, verwalter.cookie, berta.id, { email: anna.email });
			expect(r.status).toBe(409);
			expect(await r.json()).toMatchObject({ code: 'EMAIL_VERGEBEN' });
		});

		it('PATCH setzt keine Rechte, auch nicht mit rechte im Body', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER', 'JUGENDLEITER_RECHTE']);
			const erw = await v.erwachsener('Anna');
			const r = await patch(v, verwalter.cookie, erw.id, { rechte: ['MITGLIEDER'], nachname: 'Neu' });
			expect(r.status).toBe(200);
			expect(await prisma.person.findUniqueOrThrow({ where: { id: erw.id } })).toMatchObject({
				rechte: [],
				nachname: 'Neu',
			});
		});

		it('PATCH: Jugendsprecher setzen und loeschen', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const kind = await v.kind('Kai');
			expect((await patch(v, verwalter.cookie, kind.id, { jugendsprecher: true })).status).toBe(200);
			expect((await prisma.person.findUniqueOrThrow({ where: { id: kind.id } })).jugendsprecher).toBe(true);
			expect((await patch(v, verwalter.cookie, kind.id, { jugendsprecher: false })).status).toBe(200);
			expect((await prisma.person.findUniqueOrThrow({ where: { id: kind.id } })).jugendsprecher).toBe(false);
			expect((await patch(v, verwalter.cookie, kind.id, { jugendsprecher: 'ja' })).status).toBe(400);
		});

		it('PATCH: Jugendsprecher und Geburtsdatum bei Erwachsenem gibt 400', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const erw = await v.erwachsener('Anna');
			expect((await patch(v, verwalter.cookie, erw.id, { jugendsprecher: true })).status).toBe(400);
			expect((await patch(v, verwalter.cookie, erw.id, { geburtsdatum: '1980-01-01' })).status).toBe(400);
			expect(await prisma.person.findUniqueOrThrow({ where: { id: erw.id } })).toMatchObject({
				jugendsprecher: false,
				geburtsdatum: null,
			});
		});

		it('PATCH: die Adresse eines Erwachsenen mit Zugang bleibt, Aendern und Entfernen gibt 409 EMAIL_MIT_ZUGANG', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const mitZugang = await v.mitglied([], 'Zita');
			const vorher = (await prisma.person.findUniqueOrThrow({ where: { id: mitZugang.personId } })).email;
			expect(vorher).not.toBeNull();
			for (const email of ['andere@example.test', '', null]) {
				const r = await patch(v, verwalter.cookie, mitZugang.personId, { email });
				expect(r.status).toBe(409);
				expect(await r.json()).toMatchObject({ code: 'EMAIL_MIT_ZUGANG' });
			}
			expect((await prisma.person.findUniqueOrThrow({ where: { id: mitZugang.personId } })).email).toBe(vorher);
			// Dieselbe Adresse noch einmal (auch in anderer Schreibweise) aendert nichts und ist erlaubt.
			expect(
				(await patch(v, verwalter.cookie, mitZugang.personId, { email: ` ${(vorher ?? '').toUpperCase()} ` })).status,
			).toBe(200);
		});

		it('PATCH: die Adresse ohne Zugang (Erwachsener) und bei Jungfischern mit Zugang bleibt aenderbar', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const ohneZugang = await v.erwachsener('Anna');
			expect((await patch(v, verwalter.cookie, ohneZugang.id, { email: 'richtig@example.test' })).status).toBe(200);
			expect((await prisma.person.findUniqueOrThrow({ where: { id: ohneZugang.id } })).email).toBe(
				'richtig@example.test',
			);
			const kind = await v.mitglied([], 'Kai', 'JUNGFISCHER');
			expect((await patch(v, verwalter.cookie, kind.personId, { email: 'kai@example.test' })).status).toBe(200);
			expect((await patch(v, verwalter.cookie, kind.personId, { email: '' })).status).toBe(200);
		});

		it('Verwalter ohne JUGENDLEITER_RECHTE aendert einen Jugendleiter nicht: 404, Name unveraendert', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const leitung = await v.mitglied(['MITGLIEDER', 'JUGENDLEITER_RECHTE'], 'Lena');
			const r = await patch(v, verwalter.cookie, leitung.personId, { vorname: 'Geaendert' });
			expect(r.status).toBe(404);
			expect((await prisma.person.findUniqueOrThrow({ where: { id: leitung.personId } })).vorname).toBe('Lena');
			// Mit dem Recht geht es.
			expect((await patch(v, leitung.cookie, leitung.personId, { vorname: 'Lenka' })).status).toBe(200);
		});

		it('PATCH auf Grabstein und unbekannte ID gibt 404', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const kind = await v.kind('Weg');
			await prisma.person.update({ where: { id: kind.id }, data: { entferntAm: new Date() } });
			expect((await patch(v, verwalter.cookie, kind.id, { vorname: 'Zombie' })).status).toBe(404);
			expect((await patch(v, verwalter.cookie, 'gibt-es-nicht', { vorname: 'X' })).status).toBe(404);
		});

		it('volljaehrig-belassen: mit 17 gibt 409, mit 18 gibt 200 und der Hinweis verschwindet', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const minderjaehrig = await v.kind('Jung', vor(17));
			const volljaehrig = await v.kind('Alt', vor(18, 1));
			const hinweise = async (id: string) =>
				((await (await v.api(`/personen/${id}`, verwalter.cookie)).json()) as Eintrag).warnhinweise?.map((w) => w.art);

			expect((await belassen(v, verwalter.cookie, minderjaehrig.id)).status).toBe(409);
			expect(
				(await prisma.person.findUniqueOrThrow({ where: { id: minderjaehrig.id } })).volljaehrigGeprueftAm,
			).toBeNull();

			expect(await hinweise(volljaehrig.id)).toContain('VOLLJAEHRIG');
			expect((await belassen(v, verwalter.cookie, volljaehrig.id)).status).toBe(200);
			expect(await hinweise(volljaehrig.id)).not.toContain('VOLLJAEHRIG');
			expect(
				(await prisma.person.findUniqueOrThrow({ where: { id: volljaehrig.id } })).volljaehrigGeprueftAm,
			).not.toBeNull();
		});

		it('volljaehrig-belassen bei Erwachsenem gibt 404', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const erw = await v.erwachsener('Anna');
			expect((await belassen(v, verwalter.cookie, erw.id)).status).toBe(404);
		});
	});
	describe('Umfeld-Aenderungen auf dem Bus', () => {
		const route = (
			v: Awaited<ReturnType<typeof neuerVerein>>,
			cookie: string,
			methode: string,
			pfad: string,
			body?: unknown,
		) => sende(server.url, `/${v.verein.slug}/api/v1${pfad}`, { methode, body, cookie });

		it('POST /personen: eine Aenderung ohne Thread mit der neuen Person, ein Ereignis mit demselben Stand', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);

			const r = await route(v, verwalter.cookie, 'POST', '/personen', {
				art: 'JUNGFISCHER',
				vorname: 'Mia',
				nachname: 'Fisch',
				geburtsdatum: '2014-03-04',
			});

			expect(r.status).toBe(201);
			const { id } = (await r.json()) as { id: string };
			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [id])).toBe(1);
		});

		it('POST /personen: 400, 409 (Dublette, E-Mail) und 404 schreiben nichts und melden nichts', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const ohneRecht = await v.mitglied([], 'Ohne');
			const anna = await v.erwachsener('Anna');
			await v.kind('Kai');
			const neu = { art: 'ERWACHSENER', vorname: 'Neu', nachname: 'Erw' };

			expect((await route(v, verwalter.cookie, 'POST', '/personen', { ...neu, vorname: '' })).status).toBe(400);
			expect((await route(v, verwalter.cookie, 'POST', '/personen', { ...neu, email: anna.email })).status).toBe(409);
			expect(
				(
					await route(v, verwalter.cookie, 'POST', '/personen', {
						art: 'JUNGFISCHER',
						vorname: 'Kai',
						nachname: 'Kind',
						geburtsdatum: '2015-05-05',
					})
				).status,
			).toBe(409);
			expect((await route(v, ohneRecht.cookie, 'POST', '/personen', neu)).status).toBe(404);

			await erwarteNichts(prisma, ereignisse, v.verein.id);
		});

		it('PATCH /personen/:id: eine Aenderung mit der Person; 404, 400 und 409 nicht', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const kind = await v.kind('Kai');
			expect((await route(v, verwalter.cookie, 'PATCH', '/personen/gibt-es-nicht', { vorname: 'X' })).status).toBe(404);
			expect((await route(v, verwalter.cookie, 'PATCH', `/personen/${kind.id}`, { vorname: '' })).status).toBe(400);
			await erwarteNichts(prisma, ereignisse, v.verein.id);

			expect((await route(v, verwalter.cookie, 'PATCH', `/personen/${kind.id}`, { vorname: 'Karl' })).status).toBe(200);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [kind.id])).toBe(1);
		});

		it('PATCH /personen/:id ohne Aenderung im Body meldet nichts', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const kind = await v.kind('Kai');

			expect((await route(v, verwalter.cookie, 'PATCH', `/personen/${kind.id}`, {})).status).toBe(200);

			await erwarteNichts(prisma, ereignisse, v.verein.id);
		});

		it('volljaehrig-belassen: 200 meldet die Person, 409 und das zweite Belassen nichts', async () => {
			const v = await neuerVerein();
			const verwalter = await v.mitglied(['MITGLIEDER']);
			const jung = await v.kind('Jung', new Date(Date.now() - 17 * 365 * 86_400_000).toISOString().slice(0, 10));
			const alt = await v.kind('Alt', '2000-01-01');
			const belasse = (id: string) => route(v, verwalter.cookie, 'POST', `/personen/${id}/volljaehrig-belassen`);

			expect((await belasse(jung.id)).status).toBe(409);
			await erwarteNichts(prisma, ereignisse, v.verein.id);

			expect((await belasse(alt.id)).status).toBe(200);
			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [alt.id])).toBe(1);

			// Wirkungslos: der erste Zeitpunkt bleibt, es gibt nichts zu melden.
			expect((await belasse(alt.id)).status).toBe(200);
			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [alt.id])).toBe(1);
		});

		it('DELETE /personen/:id: eine Aenderung mit der entfernten Person; 404 und 409 nicht', async () => {
			const v = await neuerVerein();
			const leitung = await v.mitglied(['MITGLIEDER', 'JUGENDLEITER_RECHTE']);
			const kind = await v.kind('Kai');
			expect((await route(v, leitung.cookie, 'DELETE', '/personen/gibt-es-nicht')).status).toBe(404);
			expect((await route(v, leitung.cookie, 'DELETE', `/personen/${leitung.personId}`)).status).toBe(409);
			await erwarteNichts(prisma, ereignisse, v.verein.id);

			expect((await route(v, leitung.cookie, 'DELETE', `/personen/${kind.id}`)).status).toBe(200);

			expect(await erwarteUmfeldAenderung(prisma, ereignisse, v.verein.id, [kind.id])).toBe(1);
		});
	});
});
