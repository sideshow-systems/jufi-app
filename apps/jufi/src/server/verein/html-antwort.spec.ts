import { describe, expect, it } from 'vitest';
import { htmlAusAntwort } from './html-antwort.js';

describe('htmlAusAntwort', () => {
	it('liefert den Text einer 200-Antwort mit HTML', async () => {
		const antwort = new Response('<html></html>', {
			status: 200,
			headers: { 'content-type': 'text/html; charset=utf-8' },
		});
		expect(await htmlAusAntwort(antwort)).toBe('<html></html>');
	});

	it('gibt null fuer die 400-Antwort der Host-Pruefung (text/plain, gibt einen Header-Wert wieder)', async () => {
		const antwort = new Response('URL with hostname "boese.example" is not allowed.', {
			status: 400,
			headers: { 'content-type': 'text/plain' },
		});
		expect(await htmlAusAntwort(antwort)).toBeNull();
	});

	it('gibt null fuer eine Weiterleitung', async () => {
		const antwort = new Response(null, { status: 302, headers: { location: '/anderswo' } });
		expect(await htmlAusAntwort(antwort)).toBeNull();
	});

	it('gibt null fuer ein 404 auch dann, wenn es HTML ist', async () => {
		const antwort = new Response('<html>weg</html>', { status: 404, headers: { 'content-type': 'text/html' } });
		expect(await htmlAusAntwort(antwort)).toBeNull();
	});

	it('gibt null fuer 200 ohne HTML-Inhaltstyp', async () => {
		expect(
			await htmlAusAntwort(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
		).toBeNull();
		expect(await htmlAusAntwort(new Response('x', { status: 200 }))).toBeNull();
	});

	it('gibt null, wenn Angular den Pfad nicht beansprucht', async () => {
		expect(await htmlAusAntwort(null)).toBeNull();
	});
});
