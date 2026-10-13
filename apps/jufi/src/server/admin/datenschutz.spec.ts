import { createPrismaClientFromEnv, Recht } from '@jufi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { sende, starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { meldeAdminAn } from './test-admin.js';

const ALLE_RECHTE = Object.values(Recht);

/**
 * Namen, die der Admin nie zu sehen bekommt (Spec 7.4): Kinder, Familien und
 * Erwachsene ohne "Jugendleiter & Rechte verwalten". Nur die Leitung darf
 * erscheinen, als Ansprechpartner.
 */
const VERBORGEN = ['Katrin', 'Muster', 'Sandra', 'Hans', 'Huber', 'Lena', 'Max', 'Jonas', 'Weber'];

/**
 * Spec 9, Admin-Test: ein erfundener Verein mit den Personen des Demo-Vereins.
 * Nachgebaut statt demoEinspielen aufzurufen: das liegt in apps/cli und ist von
 * hier nicht importierbar. Geprueft wird der Body als Text (JSON.stringify),
 * nicht die ganze Antwort: In den Kopfzeilen stuende etwa "Max-Age", und das
 * ist kein Name.
 *
 * Die Antworten der Vereinsaktionen (sperren, Einladung, Notfall-Link) gehoeren
 * dazu: Ihr Einladungstext nennt einen Namen, und der darf nur der der Leitung sein.
 */
describe('Admin-Datenschutz: nur Kennzahlen und Ansprechpartner', () => {
	const prisma = createPrismaClientFromEnv();
	const uhr = new Date('2026-10-13T08:00:00Z');
	let server: TestServer;
	let cookie = '';
	let vereinId = '';
	let leitungId = '';

	beforeAll(async () => {
		server = await starteTestServer(
			createApp({ prisma, version: { version: '1.2.3', commit: 'abc' }, umgebung: TEST_UMGEBUNG, jetzt: () => uhr }),
		);
		({ cookie } = await meldeAdminAn(prisma, uhr));

		// Ueber die Route angelegt, damit auch Einladung und Protokoll in den Antworten stehen.
		const r = await sende(server.url, '/admin/api/v1/vereine', {
			methode: 'POST',
			cookie,
			body: {
				name: 'Fischereiverein Datenschutz e.V.',
				anzeigename: 'Jungfischer Datenschutz',
				slug: 'datenschutz-test',
				farbe: '#0f766e',
				leitung: { vorname: 'Thomas', nachname: 'Beispiel', email: 'thomas.beispiel@example.org' },
			},
		});
		expect(r.status).toBe(201);
		vereinId = ((await r.json()) as { id: string }).id;
		leitungId = (await prisma.person.findFirstOrThrow({ where: { vereinId } })).id;

		const erwachsener = (vorname: string, nachname: string, rechte: Recht[]) =>
			prisma.person.create({
				data: {
					vereinId,
					art: 'ERWACHSENER',
					vorname,
					nachname,
					rechte,
					email: `${vorname}.${nachname}@example.org`.toLowerCase(),
				},
			});
		const jungfischer = (vorname: string, nachname: string, geburtsdatum: string, jugendsprecher = false) =>
			prisma.person.create({
				data: { vereinId, art: 'JUNGFISCHER', vorname, nachname, geburtsdatum: new Date(geburtsdatum), jugendsprecher },
			});

		await erwachsener(
			'Katrin',
			'Muster',
			ALLE_RECHTE.filter((r) => r !== 'JUGENDLEITER_RECHTE' && r !== 'EINSTELLUNGEN'),
		);
		const sandra = await erwachsener('Sandra', 'Huber', []);
		const hans = await erwachsener('Hans', 'Huber', []);
		const lena = await jungfischer('Lena', 'Huber', '2012-04-01');
		const max = await jungfischer('Max', 'Huber', '2014-04-01');
		const jonas = await jungfischer('Jonas', 'Weber', '2009-04-01', true);
		await prisma.bezugsperson.createMany({
			data: [
				{ vereinId, erwachsenerId: sandra.id, jungfischerId: lena.id, beziehung: 'MUTTER', erziehungsberechtigt: true },
				{ vereinId, erwachsenerId: sandra.id, jungfischerId: max.id, beziehung: 'MUTTER', erziehungsberechtigt: true },
				{
					vereinId,
					erwachsenerId: hans.id,
					jungfischerId: lena.id,
					beziehung: 'GROSSVATER',
					erziehungsberechtigt: false,
				},
			],
		});
		await prisma.untergruppe.create({
			data: { vereinId, name: 'Ältere', mitglieder: { create: [{ personId: lena.id }, { personId: jonas.id }] } },
		});
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	async function body(pfad: string): Promise<string> {
		const r = await sende(server.url, `/admin/api/v1${pfad}`, { cookie });
		expect(r.status).toBe(200);
		return JSON.stringify(await r.json());
	}

	/**
	 * Ohne das Token hinter dem #: 43 Zufallszeichen enthalten "Max" oder "Hans"
	 * etwa einmal in tausend Laeufen, und der Test schluege dann ohne Grund an.
	 */
	async function aktion(pfad: string, mitBody: unknown = {}): Promise<string> {
		const r = await sende(server.url, `/admin/api/v1${pfad}`, { methode: 'POST', cookie, body: mitBody });
		expect(r.status).toBe(200);
		return JSON.stringify(await r.json()).replace(/#[A-Za-z0-9_-]+/g, '#');
	}

	function enthalteneNamen(text: string): string[] {
		return VERBORGEN.filter((name) => text.includes(name));
	}

	it('die Vereinsliste nennt keine Personen', async () => {
		expect(enthalteneNamen(await body('/vereine'))).toEqual([]);
	});

	it('die Vereinsseite nennt nur die Leitung', async () => {
		const text = await body(`/vereine/${vereinId}`);
		expect(enthalteneNamen(text)).toEqual([]);
		expect(text).toContain('Thomas');
	});

	it('Sperren und Entsperren nennen niemanden', async () => {
		for (const pfad of ['sperren', 'entsperren']) {
			expect(enthalteneNamen(await aktion(`/vereine/${vereinId}/${pfad}`))).toEqual([]);
		}
	});

	it('Notfall-Link, Einladung erneuern und Slug korrigieren nennen nur die Leitung', async () => {
		const antworten = [
			await aktion(`/vereine/${vereinId}/notfall-link`, { personId: leitungId }),
			await aktion(`/vereine/${vereinId}/einladung-erneuern`),
			// Zuletzt: Danach heisst der Verein anders.
			await aktion(`/vereine/${vereinId}/slug`, { slug: 'datenschutz-neu' }),
		];
		for (const text of antworten) {
			expect(enthalteneNamen(text)).toEqual([]);
			expect(text).toContain('Thomas');
		}
	});
});
