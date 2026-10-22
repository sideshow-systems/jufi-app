import { createHash } from 'node:crypto';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nimmUpload, type UploadErgebnis } from './hochladen.js';
import { VerzeichnisSpeicher } from './speicher.js';
import { starteTestServer, type TestServer } from '../test-setup.js';

describe('nimmUpload', () => {
	let wurzel: string;
	let speicher: VerzeichnisSpeicher;
	let server: TestServer;
	let maxBytes: number;
	// Das Versprechen von nimmUpload je Anfrage; der Test wartet selbst darauf, damit eine
	// Ablehnung beim Abbruch nicht als unbehandelt durchrutscht.
	let letzter: Promise<UploadErgebnis>;
	let angekommen: () => void;
	let eingang: Promise<void>;

	beforeEach(async () => {
		wurzel = await mkdtemp(join(tmpdir(), 'jufi-upload-'));
		speicher = new VerzeichnisSpeicher(wurzel);
		maxBytes = 1000;
		eingang = new Promise((r) => (angekommen = r));
		const app = express();
		app.put('/up', (req, res) => {
			letzter = nimmUpload(req, { speicher, maxBytes });
			angekommen();
			letzter.then(
				(e) => {
					if (e.ok) res.json({ bytes: e.bytes, sha256: e.sha256, kopf: Buffer.from(e.kopf).toString('hex') });
					else res.status(e.status).set('Connection', 'close').json({ code: e.code });
				},
				() => res.destroy(),
			);
		});
		server = await starteTestServer(app);
	});
	afterEach(async () => {
		await server.schliessen();
		await rm(wurzel, { recursive: true, force: true });
	});

	async function tempInhalt(): Promise<string[]> {
		return readdir(join(wurzel, 'tmp')).catch(() => []);
	}

	/** Roher HTTP-Aufruf: fetch zeigt weder chunked ohne Laenge noch einen Abbruch mitten im Koerper. */
	function sende(opt: { laenge?: number; teile: Buffer[]; abbrechen?: boolean }) {
		const { port } = new URL(server.url);
		const kopf: Record<string, string> = {};
		if (opt.laenge !== undefined) kopf['Content-Length'] = String(opt.laenge);
		return new Promise<{ status: number; body: string } | 'getrennt'>((resolve) => {
			const req = request({ host: '127.0.0.1', port, method: 'PUT', path: '/up', headers: kopf }, (res) => {
				const teile: Buffer[] = [];
				res.on('data', (t) => teile.push(t));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(teile).toString() }));
			});
			req.on('error', () => resolve('getrennt'));
			for (const t of opt.teile) req.write(t);
			if (opt.abbrechen) {
				// Erst warten, bis der Server die Haelfte gesehen hat, dann die Verbindung kappen.
				setTimeout(() => req.destroy(), 100);
			} else req.end();
		});
	}

	it('zaehlt die Bytes, bildet die Pruefsumme und merkt sich den Kopf', async () => {
		const inhalt = Buffer.from('%PDF-1.7 und noch etwas mehr Text');
		const antwort = await sende({ laenge: inhalt.length, teile: [inhalt] });
		if (antwort === 'getrennt') throw new Error('getrennt');
		expect(antwort.status).toBe(200);
		const e = JSON.parse(antwort.body);
		expect(e.bytes).toBe(inhalt.length);
		expect(e.sha256).toBe(createHash('sha256').update(inhalt).digest('hex'));
		expect(e.kopf).toBe(inhalt.subarray(0, 16).toString('hex'));
		const ergebnis = await letzter;
		expect(ergebnis.ok && (await readdir(join(wurzel, 'tmp'))).includes(ergebnis.tempPfad.split('/').pop()!)).toBe(
			true,
		);
	});

	it('kennt 3 Bytes: ein kurzer Kopf ist kuerzer als KOPF_BYTES', async () => {
		const antwort = await sende({ laenge: 3, teile: [Buffer.from('abc')] });
		if (antwort === 'getrennt') throw new Error('getrennt');
		const e = JSON.parse(antwort.body);
		expect(e).toMatchObject({
			bytes: 3,
			sha256: createHash('sha256').update('abc').digest('hex'),
			kopf: Buffer.from('abc').toString('hex'),
		});
	});

	it('merkt sich den Kopf auch, wenn er ueber mehrere Stuecke verteilt ankommt', async () => {
		const teile = [Buffer.from('%PD'), Buffer.from('F-1.'), Buffer.from('7 und danach noch viel mehr')];
		const ganz = Buffer.concat(teile);
		const antwort = await sende({ laenge: ganz.length, teile });
		if (antwort === 'getrennt') throw new Error('getrennt');
		const e = JSON.parse(antwort.body);
		expect(e.kopf).toBe(ganz.subarray(0, 16).toString('hex'));
		expect(e.sha256).toBe(createHash('sha256').update(ganz).digest('hex'));
	});

	it('nimmt einen leeren Koerper an', async () => {
		const antwort = await sende({ laenge: 0, teile: [] });
		if (antwort === 'getrennt') throw new Error('getrennt');
		expect(JSON.parse(antwort.body)).toMatchObject({ bytes: 0, kopf: '' });
	});

	it('antwortet ohne Content-Length (chunked) mit 411', async () => {
		const antwort = await sende({ teile: [Buffer.from('abc')] });
		if (antwort === 'getrennt') throw new Error('getrennt');
		expect(antwort.status).toBe(411);
		expect(await tempInhalt()).toEqual([]);
	});

	it('antwortet auf eine Content-Length, die keine Ganzzahl ist, mit 411', async () => {
		const ergebnisse: UploadErgebnis[] = [];
		for (const wert of ['abc', '-1', '1.5', '', '1e3']) {
			const req = { headers: { 'content-length': wert } } as unknown as import('express').Request;
			ergebnisse.push(await nimmUpload(req, { speicher, maxBytes }));
		}
		for (const e of ergebnisse) expect(e).toEqual({ ok: false, status: 411 });
		expect(await tempInhalt()).toEqual([]);
	});

	it('antwortet auf eine Content-Length ueber der Grenze mit 413, ohne etwas auf die Platte zu legen', async () => {
		const antwort = await sende({ laenge: maxBytes + 1, teile: [Buffer.alloc(10)] });
		if (antwort === 'getrennt') throw new Error('getrennt');
		expect(antwort.status).toBe(413);
		expect(JSON.parse(antwort.body)).toEqual({ code: 'GROESSE' });
		expect(await tempInhalt()).toEqual([]);
		await expect(letzter).resolves.toEqual({ ok: false, status: 413, code: 'GROESSE' });
	});

	it('nimmt genau die Grenze noch an', async () => {
		const antwort = await sende({ laenge: maxBytes, teile: [Buffer.alloc(maxBytes, 1)] });
		if (antwort === 'getrennt') throw new Error('getrennt');
		expect(antwort.status).toBe(200);
		expect(JSON.parse(antwort.body).bytes).toBe(maxBytes);
	});

	it('wirft und raeumt auf, wenn der Client mitten im Koerper abbricht', async () => {
		const gesendet = sende({ laenge: 10, teile: [Buffer.from('halb.')], abbrechen: true });
		await eingang;
		await expect(letzter).rejects.toThrow();
		expect(await gesendet).toBe('getrennt');
		expect(await tempInhalt()).toEqual([]);
	});
});
