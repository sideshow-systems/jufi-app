import { createPrismaClientFromEnv, type Recht } from '@jufi/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
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

describe('Personen lesen', () => {
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
			expect(p).not.toHaveProperty('einladung');
			expect(p).not.toHaveProperty('zugang');
			const arten = (p.warnhinweise ?? []).map((w) => w.art);
			expect(arten).not.toContain('EINLADUNG_OFFEN');
			expect(arten).not.toContain('MAIL_NICHT_ZUGESTELLT');
		}
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
});
