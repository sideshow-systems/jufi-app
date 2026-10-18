import { generateLinkToken, hashToken } from '@jufi/auth';
import { createPrismaClientFromEnv, vereinDb } from '@jufi/db';
import { EINLADUNG_GUELTIG_MS, EINWILLIGUNG_TEXT, EINWILLIGUNG_TEXT_VERSION } from '@jufi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { erzeugeEinladung } from '../einladung.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeVereinAn } from '../test-vereine.js';
import { nimmChallenge, speichereChallenge } from './challenges.js';

const UNGUELTIG = { fehler: 'Dieser Link gilt nicht mehr' };

describe('Einladung pruefen und Passkey-Optionen', () => {
	const prisma = createPrismaClientFromEnv();
	const t0 = new Date('2026-10-13T08:00:00Z');
	let uhr = t0;
	let server: TestServer;
	let verein: { id: string; slug: string };
	let fremd: { id: string; slug: string };

	beforeAll(async () => {
		[verein, fremd] = await Promise.all([
			legeVereinAn(prisma, { slug: 'einl-pruefen' }),
			legeVereinAn(prisma, { slug: 'einl-fremd' }),
		]);
		server = await starteTestServer(
			createApp({
				prisma,
				version: { version: '1.2.3', commit: 'abc' },
				umgebung: TEST_UMGEBUNG,
				jetzt: () => uhr,
			}),
		);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	const pruefen = (v: { slug: string }, body?: unknown) =>
		sende(server.url, `/${v.slug}/api/v1/einladung/pruefen`, { methode: 'POST', body });
	const optionen = (v: { slug: string }, body?: unknown) =>
		sende(server.url, `/${v.slug}/api/v1/einladung/passkey-optionen`, { methode: 'POST', body });

	async function lege(
		v: { id: string },
		p: {
			art: 'ERWACHSENER' | 'JUNGFISCHER';
			vorname: string;
			nachname?: string;
			email?: string;
			zugangErlaubt?: boolean;
			entfernt?: boolean;
			zugang?: string | true;
			einwilligung?: boolean;
			einladung?: 'EINLADUNG' | 'RESET';
		},
	): Promise<{ personId: string; token: string }> {
		const person = await prisma.person.create({
			data: {
				vereinId: v.id,
				art: p.art,
				vorname: p.vorname,
				nachname: p.nachname ?? 'Huber',
				email: p.email,
				geburtsdatum: p.art === 'JUNGFISCHER' ? new Date('2015-05-05') : undefined,
				zugangErlaubt: p.zugangErlaubt,
				entferntAm: p.entfernt ? t0 : undefined,
			},
		});
		if (p.zugang !== undefined) {
			await prisma.zugang.create({
				data: {
					vereinId: v.id,
					personId: person.id,
					anmeldename: typeof p.zugang === 'string' ? p.zugang : undefined,
				},
			});
		}
		if (p.einwilligung) {
			// Erteilt von einer eigenen Bezugsperson, wie im echten Ablauf.
			const eltern = await prisma.person.create({
				data: { vereinId: v.id, art: 'ERWACHSENER', vorname: 'Eltern', nachname: 'Huber' },
			});
			await prisma.einwilligung.create({
				data: {
					vereinId: v.id,
					jungfischerId: person.id,
					erteiltVon: eltern.id,
					art: 'DSGVO_ART8',
					textVersion: '1',
				},
			});
			await prisma.bezugsperson.create({
				data: {
					vereinId: v.id,
					erwachsenerId: eltern.id,
					jungfischerId: person.id,
					beziehung: 'MUTTER',
					erziehungsberechtigt: true,
				},
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
		return { personId: person.id, token };
	}

	it('pruefen: gueltige Einladung eines Erwachsenen', async () => {
		uhr = t0;
		const { token } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Thomas', email: 'thomas@example.org' });
		const r = await pruefen(verein, { token });
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({
			vorname: 'Thomas',
			art: 'EINLADUNG',
			vereinsname: 'Jungfischer Test',
			personArt: 'ERWACHSENER',
			kennung: { fest: false, wert: 'thomas@example.org' },
			hatZugang: false,
			einwilligungFehlt: false,
			kinder: [],
			einwilligungsText: { version: EINWILLIGUNG_TEXT_VERSION, text: EINWILLIGUNG_TEXT },
		});
	});

	/** Kind zu einem Erwachsenen; erziehungsberechtigt steuert, ob er fuer es einwilligen darf. */
	async function legeKind(
		v: { id: string },
		erwachsenerId: string,
		k: { vorname: string; erziehungsberechtigt: boolean; geburtsdatum?: string; entfernt?: boolean; erlaubt?: boolean },
	) {
		const kind = await prisma.person.create({
			data: {
				vereinId: v.id,
				art: 'JUNGFISCHER',
				vorname: k.vorname,
				nachname: 'Huber',
				geburtsdatum: new Date(k.geburtsdatum ?? '2015-05-05'),
				zugangErlaubt: k.erlaubt ?? false,
				entferntAm: k.entfernt ? t0 : undefined,
			},
		});
		await prisma.bezugsperson.create({
			data: {
				vereinId: v.id,
				erwachsenerId,
				jungfischerId: kind.id,
				beziehung: k.erziehungsberechtigt ? 'MUTTER' : 'GROSSMUTTER',
				erziehungsberechtigt: k.erziehungsberechtigt,
			},
		});
		return kind;
	}

	it('pruefen nennt die Kinder und den Text', async () => {
		uhr = t0;
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Mutter', email: 'm@example.org' });
		const lena = await legeKind(verein, personId, { vorname: 'Lena', erziehungsberechtigt: true });
		const ben = await legeKind(verein, personId, { vorname: 'Ben', erziehungsberechtigt: true, erlaubt: true });
		// Ben hat schon eine Einwilligung (vom anderen Elternteil).
		const vater = await prisma.person.create({
			data: { vereinId: verein.id, art: 'ERWACHSENER', vorname: 'Vater', nachname: 'Huber' },
		});
		await prisma.bezugsperson.create({
			data: {
				vereinId: verein.id,
				erwachsenerId: vater.id,
				jungfischerId: ben.id,
				beziehung: 'VATER',
				erziehungsberechtigt: true,
			},
		});
		await prisma.einwilligung.create({
			data: { vereinId: verein.id, jungfischerId: ben.id, erteiltVon: vater.id, art: 'DSGVO_ART8', textVersion: '1' },
		});
		const j = await (await pruefen(verein, { token })).json();
		expect(j.einwilligungsText).toEqual({ version: EINWILLIGUNG_TEXT_VERSION, text: EINWILLIGUNG_TEXT });
		expect(j.kinder).toHaveLength(2);
		expect(j.kinder).toEqual(
			expect.arrayContaining([
				{ id: lena.id, vorname: 'Lena', zugangErlaubt: false, einwilligungVorhanden: false },
				{ id: ben.id, vorname: 'Ben', zugangErlaubt: true, einwilligungVorhanden: true },
			]),
		);
	});

	it('pruefen: Kind einer Grossmutter (nicht erziehungsberechtigt) fehlt in kinder', async () => {
		uhr = t0;
		const { token, personId } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Oma', email: 'o@example.org' });
		await legeKind(verein, personId, { vorname: 'Enkel', erziehungsberechtigt: false });
		await legeKind(verein, personId, { vorname: 'Gross', erziehungsberechtigt: true, geburtsdatum: '2000-01-01' });
		await legeKind(verein, personId, { vorname: 'Weg', erziehungsberechtigt: true, entfernt: true });
		const j = await (await pruefen(verein, { token })).json();
		expect(j.kinder).toEqual([]);
	});

	it('pruefen: Erwachsener ohne hinterlegte Adresse hat keinen Wert', async () => {
		uhr = t0;
		const { token } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Ohne' });
		const r = await pruefen(verein, { token });
		expect((await r.json()).kennung).toEqual({ fest: false, wert: null });
	});

	it('pruefen: Jungfischer bekommt Namensvorschlag', async () => {
		uhr = t0;
		// Eigener Verein, damit der Vorschlag nicht von anderen Tests abhaengt.
		const eigen = await legeVereinAn(prisma, { slug: 'einl-vorschlag' });
		const erste = await lege(eigen, { art: 'JUNGFISCHER', vorname: 'Lena' });
		const r1 = await pruefen(eigen, { token: erste.token });
		const k1 = await r1.json();
		expect(k1.kennung).toEqual({ fest: false, wert: 'lena' });
		expect(k1.einwilligungFehlt).toBe(true);

		// Ein anderer hat schon "lena": der Vorschlag weicht aus.
		await lege(eigen, { art: 'JUNGFISCHER', vorname: 'Lena', zugang: 'lena' });
		const zweite = await lege(eigen, { art: 'JUNGFISCHER', vorname: 'Lena', einwilligung: true });
		const r2 = await pruefen(eigen, { token: zweite.token });
		const k2 = await r2.json();
		expect(k2.kennung.wert).toBe('lena2');
		expect(k2.einwilligungFehlt).toBe(false);
	});

	it('pruefen: bestehender Zugang (Reset)', async () => {
		uhr = t0;
		const { token } = await lege(verein, {
			art: 'JUNGFISCHER',
			vorname: 'Mia',
			zugang: 'mia-fest',
			einladung: 'RESET',
		});
		const r = await pruefen(verein, { token });
		const j = await r.json();
		expect(j.art).toBe('RESET');
		expect(j.hatZugang).toBe(true);
		expect(j.kennung).toEqual({ fest: true, wert: 'mia-fest' });
	});

	it('pruefen: ungueltige Links sind alle 404 und aendern nichts', async () => {
		uhr = t0;
		const gueltig = await lege(verein, { art: 'ERWACHSENER', vorname: 'Gueltig', email: 'g@example.org' });
		const abgelaufen = await lege(verein, { art: 'ERWACHSENER', vorname: 'Alt' });
		const eingeloest = await lege(verein, { art: 'ERWACHSENER', vorname: 'Schon' });
		await prisma.einladung.updateMany({
			where: { tokenHash: hashToken(eingeloest.token) },
			data: { eingeloestAm: t0 },
		});
		const entfernt = await lege(verein, { art: 'ERWACHSENER', vorname: 'Weg', entfernt: true });
		const gesperrt = await lege(verein, { art: 'JUNGFISCHER', vorname: 'Gesperrt', zugangErlaubt: false });

		const faelle: [string, { slug: string }, string][] = [
			['unbekannt', verein, generateLinkToken()],
			['eingeloest', verein, eingeloest.token],
			['anderer Verein', fremd, gueltig.token],
			['entfernt', verein, entfernt.token],
			['zugang nicht erlaubt', verein, gesperrt.token],
		];
		for (const [name, v, token] of faelle) {
			const r = await pruefen(v, { token });
			expect(r.status, name).toBe(404);
			expect(await r.json(), name).toEqual(UNGUELTIG);
		}
		// Abgelaufen ueber die Uhr der App.
		uhr = new Date(t0.getTime() + EINLADUNG_GUELTIG_MS + 1000);
		const r = await pruefen(verein, { token: abgelaufen.token });
		expect(r.status).toBe(404);
		expect(await r.json()).toEqual(UNGUELTIG);

		uhr = t0;
		const zeile = await prisma.einladung.findUnique({ where: { tokenHash: hashToken(gueltig.token) } });
		expect(zeile?.eingeloestAm).toBeNull();
	});

	it('pruefen: ohne Token im Body ist 404', async () => {
		for (const body of [undefined, {}, { token: 42 }]) {
			const r = await pruefen(verein, body);
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(UNGUELTIG);
		}
	});

	it('passkey-optionen liefert Optionen und speichert die Challenge', async () => {
		uhr = t0;
		const { token, personId } = await lege(verein, {
			art: 'JUNGFISCHER',
			vorname: 'Sandra',
			nachname: 'Huber',
		});
		const r = await optionen(verein, { token });
		expect(r.status).toBe(200);
		const { optionen: o } = await r.json();
		expect(o.user.name).toBe('Sandra Huber · Jungfischer Test');
		expect(o.authenticatorSelection.residentKey).toBe('required');
		expect(o.authenticatorSelection.userVerification).toBe('required');
		const zeilen = await prisma.webauthnChallenge.findMany({ where: { personId } });
		expect(zeilen).toHaveLength(1);
		expect(zeilen[0]).toMatchObject({
			vereinId: verein.id,
			personId,
			purpose: 'register',
			challenge: o.challenge,
		});
	});

	it('passkey-optionen: ungueltiger Link ist 404 und speichert nichts', async () => {
		uhr = t0;
		// Nur die beiden Vereine dieser Datei: andere Dateien schreiben parallel in dieselbe Tabelle.
		const zaehle = () => prisma.webauthnChallenge.count({ where: { vereinId: { in: [verein.id, fremd.id] } } });
		const vorher = await zaehle();
		const { token } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Weg2', entfernt: true });
		for (const [v, t] of [
			[verein, generateLinkToken()],
			[verein, token],
			[fremd, token],
		] as const) {
			const r = await optionen(v, { token: t });
			expect(r.status).toBe(404);
			expect(await r.json()).toEqual(UNGUELTIG);
		}
		expect((await optionen(verein)).status).toBe(404);
		expect(await zaehle()).toBe(vorher);
	});

	describe('Challenge-Hilfen', () => {
		it('nimmChallenge liefert beim zweiten Mal false', async () => {
			const db = vereinDb(prisma, verein.id);
			await speichereChallenge(db, { challenge: 'c-zweimal', purpose: 'register', jetzt: t0 });
			expect(await nimmChallenge(db, { challenge: 'c-zweimal', purpose: 'register', jetzt: t0 })).toBe(true);
			expect(await nimmChallenge(db, { challenge: 'c-zweimal', purpose: 'register', jetzt: t0 })).toBe(false);
		});

		it('abgelaufen ist false, die Zeile trotzdem weg', async () => {
			const db = vereinDb(prisma, verein.id);
			await speichereChallenge(db, { challenge: 'c-alt', purpose: 'register', jetzt: t0 });
			const spaeter = new Date(t0.getTime() + 10 * 60 * 1000);
			expect(await nimmChallenge(db, { challenge: 'c-alt', purpose: 'register', jetzt: spaeter })).toBe(false);
			expect(await prisma.webauthnChallenge.count({ where: { challenge: 'c-alt' } })).toBe(0);
		});

		it('falscher Zweck ist false', async () => {
			const db = vereinDb(prisma, verein.id);
			await speichereChallenge(db, { challenge: 'c-zweck', purpose: 'register', jetzt: t0 });
			expect(await nimmChallenge(db, { challenge: 'c-zweck', purpose: 'authenticate', jetzt: t0 })).toBe(false);
		});

		it('falsche Person ist false', async () => {
			const db = vereinDb(prisma, verein.id);
			const { personId } = await lege(verein, { art: 'ERWACHSENER', vorname: 'Chal' });
			await speichereChallenge(db, { challenge: 'c-person', purpose: 'register', personId, jetzt: t0 });
			expect(
				await nimmChallenge(db, { challenge: 'c-person', purpose: 'register', personId: 'anderer', jetzt: t0 }),
			).toBe(false);
		});

		it('speichereChallenge raeumt abgelaufene Zeilen dieses Vereins, nicht anderer', async () => {
			const db = vereinDb(prisma, verein.id);
			const dbFremd = vereinDb(prisma, fremd.id);
			await speichereChallenge(db, { challenge: 'c-raeum-a', purpose: 'register', jetzt: t0 });
			await speichereChallenge(dbFremd, { challenge: 'c-raeum-f', purpose: 'register', jetzt: t0 });
			const spaeter = new Date(t0.getTime() + 10 * 60 * 1000);
			await speichereChallenge(db, { challenge: 'c-raeum-neu', purpose: 'register', jetzt: spaeter });
			expect(await prisma.webauthnChallenge.count({ where: { challenge: 'c-raeum-a' } })).toBe(0);
			expect(await prisma.webauthnChallenge.count({ where: { challenge: 'c-raeum-f' } })).toBe(1);
		});

		it('die Challenge eines anderen Vereins ist unsichtbar', async () => {
			await speichereChallenge(vereinDb(prisma, fremd.id), { challenge: 'c-fremd', purpose: 'register', jetzt: t0 });
			expect(
				await nimmChallenge(vereinDb(prisma, verein.id), { challenge: 'c-fremd', purpose: 'register', jetzt: t0 }),
			).toBe(false);
			expect(await prisma.webauthnChallenge.count({ where: { challenge: 'c-fremd' } })).toBe(1);
		});

		it('eine Admin-Challenge ohne vereinId ist unsichtbar', async () => {
			await prisma.webauthnChallenge.create({
				data: { challenge: 'c-admin', purpose: 'register', expiresAt: new Date(t0.getTime() + 60_000) },
			});
			expect(
				await nimmChallenge(vereinDb(prisma, verein.id), { challenge: 'c-admin', purpose: 'register', jetzt: t0 }),
			).toBe(false);
			expect(await prisma.webauthnChallenge.count({ where: { challenge: 'c-admin' } })).toBe(1);
			await prisma.webauthnChallenge.deleteMany({ where: { challenge: 'c-admin' } });
		});
	});
});
