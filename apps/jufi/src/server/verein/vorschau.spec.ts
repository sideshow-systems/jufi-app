import { createPrismaClientFromEnv } from '@jufi/db';
import { threadSegment } from '@jufi/domain';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { setzeInKopf, vorschauTags } from './vorschau.js';
import { starteTestServer, TEST_UMGEBUNG, type TestServer } from '../test-setup.js';
import { legeThreadAn } from '../threads/test-threads.js';
import { legeVereinAn } from '../test-vereine.js';

const GERUEST = '<!doctype html><html><head><title>JuFi App</title></head><body><jf-root></jf-root></body></html>';
const JETZT = new Date('2026-10-22T10:00:00Z');

describe('Link-Vorschau', () => {
	const prisma = createPrismaClientFromEnv();
	const slug = `vorschau-${randomUUID().slice(0, 8)}`;
	const anzeigename = 'Jungfischer Vorschau';
	let html: string | null = GERUEST;
	let server: TestServer;
	let verein: Awaited<ReturnType<typeof legeVereinAn>>;
	let ids: Record<string, string>;
	let fremderThreadId: string;

	const hole = (pfad: string) => fetch(`${server.url}${pfad}`);
	const meta = (eigenschaft: string, inhalt: string) => `<meta property="${eigenschaft}" content="${inhalt}" />`;
	const bild = `${TEST_UMGEBUNG.basisUrl}/${slug}/icon-512.png`;

	beforeAll(async () => {
		verein = await legeVereinAn(prisma, { slug, anzeigename });
		const fremd = await legeVereinAn(prisma, { slug: `${slug}-b`, anzeigename: 'Fremder Verein' });
		const anlegen = async (titel: string, daten: Parameters<typeof legeThreadAn>[3] = {}) =>
			(await legeThreadAn(prisma, verein, JETZT, { titel, ...daten })).threadId;
		ids = {
			bowling: await anlegen('🎳 Bowling'),
			maskiert: await anlegen('Tom & "Jerry" <b>'),
			leiter: await anlegen('Elterngespraech', { rollenfilter: 'NUR_JUGENDLEITER' }),
			entwurf: await anlegen('Geheimer Entwurf', { veroeffentlicht: false }),
		};
		fremderThreadId = (await legeThreadAn(prisma, fremd, JETZT, { titel: 'Fremdes Fest' })).threadId;
		const austausch = await prisma.thread.findFirstOrThrow({
			where: { vereinId: verein.id, art: 'JUGENDSPRECHER_AUSTAUSCH' },
		});
		ids['austausch'] = austausch.id;
		await legeVereinAn(prisma, { slug: `${slug}-gesperrt`, status: 'GESPERRT' });

		const app = createApp({
			prisma,
			version: { version: '1', commit: 'x' },
			umgebung: TEST_UMGEBUNG,
			seitenHtml: async () => html,
		});
		server = await starteTestServer(app);
	});

	afterAll(async () => {
		await server.schliessen();
		await prisma.$disconnect();
	});

	it('setzt Titel und Bild eines veroeffentlichten Familien-Threads in den Kopf', async () => {
		const r = await hole(`/${slug}/t/${threadSegment(ids['bowling'], '🎳 Bowling')}`);
		expect(r.status).toBe(200);
		expect(r.headers.get('cache-control')).toBe('no-store');
		expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
		const text = await r.text();
		expect(text).toContain(meta('og:title', '🎳 Bowling'));
		expect(text).toContain(meta('og:image', bild));
		expect(text).toContain(meta('og:site_name', anzeigename));
		expect(text).toContain(meta('og:image:width', '512'));
		expect(text).toContain('<jf-root></jf-root>');
		expect(text.indexOf('og:title')).toBeLessThan(text.indexOf('</head>'));
	});

	it('maskiert den Titel in den Attributen', async () => {
		const text = await (await hole(`/${slug}/t/${ids['maskiert']}`)).text();
		expect(text).toContain(meta('og:title', 'Tom &amp; &quot;Jerry&quot; &lt;b&gt;'));
		expect(text).not.toContain('<b>');
	});

	it('antwortet auf alles, was die Person nicht sehen darf, byte-gleich mit dem Vereinsnamen', async () => {
		const pfade = [
			`/${slug}/t/${ids['leiter']}-elterngespraech`,
			`/${slug}/t/${ids['entwurf']}-geheimer-entwurf`,
			`/${slug}/t/${ids['austausch']}`,
			`/${slug}/t/clzzzzzzzzzzzzzzzzzzzzzzz-unbekannt`,
			`/${slug}/t/---`,
			`/${slug}/t/${fremderThreadId}-fremdes-fest`,
		];
		const antworten = await Promise.all(pfade.map(async (p) => (await hole(p)).text()));
		for (const text of antworten) {
			expect(text).toContain(meta('og:title', anzeigename));
			expect(text).not.toMatch(/Elterngespraech|Geheimer Entwurf|Fremdes Fest|Fremder Verein/);
		}
		for (const text of antworten) expect(text).toBe(antworten[0]);
	});

	it('behandelt eine Query wie keine', async () => {
		const mit = await (await hole(`/${slug}/t/${ids['bowling']}?reiter=verlauf`)).text();
		const ohne = await (await hole(`/${slug}/t/${ids['bowling']}`)).text();
		expect(mit).toBe(ohne);
		expect(mit).toContain(meta('og:title', '🎳 Bowling'));
	});

	it('reicht unbekannte und gesperrte Vereine weiter, ohne Tags', async () => {
		for (const pfad of [`/gibt-es-nicht/t/${ids['bowling']}`, `/${slug}-gesperrt/t/${ids['bowling']}`]) {
			const r = await hole(pfad);
			expect(r.status).toBe(404);
			expect(await r.text()).not.toContain('og:');
		}
	});

	it('reicht weiter, wenn die Seite nicht kommt', async () => {
		html = null;
		try {
			const r = await hole(`/${slug}/t/${ids['bowling']}`);
			expect(r.status).toBe(404);
			expect(await r.text()).not.toContain('og:');
		} finally {
			html = GERUEST;
		}
	});
});

describe('setzeInKopf', () => {
	it('setzt die Tags vor das erste </head>', () => {
		expect(setzeInKopf('<head><title>x</title></head><body></head></body>', 'TAGS')).toBe(
			'<head><title>x</title>TAGS\n</head><body></head></body>',
		);
	});

	it('laesst eine Seite ohne </head> unveraendert', () => {
		expect(setzeInKopf('<body>kein Kopf</body>', 'TAGS')).toBe('<body>kein Kopf</body>');
	});

	it('wertet $-Muster im Titel nicht aus', () => {
		const tags = vorschauTags({ siteName: 'V', titel: "$& $' $1", bild: 'http://x/b.png' });
		const html = setzeInKopf('<head></head>', tags);
		expect(html).toContain('content="$&amp; $&#39; $1"');
		expect(html.match(/<\/head>/g)).toHaveLength(1);
	});
});
