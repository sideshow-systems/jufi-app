import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sicherheitsHeader } from './sicherheit.js';

const NGINX = fileURLToPath(new URL('../../../../deploy/nginx-sicherheit.conf', import.meta.url));

function appCsp(): string {
	const koepfe = new Map<string, string>();
	const res = { setHeader: (name: string, wert: string) => void koepfe.set(name, wert) } as unknown as Response;
	sicherheitsHeader({} as Request, res, () => undefined);
	return koepfe.get('Content-Security-Policy') ?? '';
}

const direktive = (csp: string, name: string) =>
	csp
		.split(';')
		.map((d) => d.trim())
		.find((d) => d.startsWith(`${name} `));

describe('Content-Security-Policy', () => {
	it('erlaubt Bilder vom eigenen Ursprung und blob: (Vorschau vor dem Hochladen)', () => {
		expect(direktive(appCsp(), 'img-src')).toBe("img-src 'self' blob:");
	});

	it('hat in der nginx-Datei dieselbe img-src-Direktive wie die App', async () => {
		const nginx = await readFile(NGINX, 'utf8');
		const zeile = /add_header Content-Security-Policy "([^"]*)"/u.exec(nginx)?.[1] ?? '';
		expect(direktive(zeile, 'img-src')).toBe(direktive(appCsp(), 'img-src'));
		// Auch sonst Zeichen fuer Zeichen dieselbe Richtlinie.
		expect(zeile).toBe(appCsp());
	});
});
