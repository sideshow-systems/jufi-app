import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dateiSchluessel, VerzeichnisSpeicher } from './speicher.js';

async function lesen(strom: NodeJS.ReadableStream): Promise<string> {
	const teile: Buffer[] = [];
	for await (const teil of strom) teile.push(Buffer.from(teil as Buffer));
	return Buffer.concat(teile).toString('utf8');
}

async function sammle<T>(quelle: AsyncIterable<T>): Promise<T[]> {
	const alle: T[] = [];
	for await (const eintrag of quelle) alle.push(eintrag);
	return alle;
}

describe('dateiSchluessel', () => {
	it('haengt den Schluessel an Verein und Datei, die Vorschau bekommt ein Suffix', () => {
		expect(dateiSchluessel('v1', 'd1')).toBe('v1/d1');
		expect(dateiSchluessel('v1', 'd1', true)).toBe('v1/d1.vorschau');
		expect(dateiSchluessel('v1', 'd1', false)).toBe('v1/d1');
	});
});

describe('VerzeichnisSpeicher', () => {
	let wurzel: string;
	let speicher: VerzeichnisSpeicher;

	beforeEach(async () => {
		wurzel = await mkdtemp(join(tmpdir(), 'jufi-speicher-'));
		speicher = new VerzeichnisSpeicher(wurzel);
	});
	afterEach(() => rm(wurzel, { recursive: true, force: true }));

	async function ablegen(schluessel: string, inhalt: string): Promise<void> {
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, inhalt);
		await speicher.uebernimm(temp, schluessel);
	}

	it('legt beim Uebernehmen das Vereinsverzeichnis an und liefert den Inhalt wieder', async () => {
		await ablegen('v1/d1', 'Inhalt');
		expect((await stat(join(wurzel, 'v1'))).isDirectory()).toBe(true);
		const gelesen = await speicher.lies('v1/d1');
		expect(gelesen).not.toBeNull();
		expect(await lesen(gelesen!.strom)).toBe('Inhalt');
	});

	it('nennt die Groesse der Bytes in Bytes, nicht in Zeichen', async () => {
		await ablegen('v1/d1', 'Grüße 🎣');
		const gelesen = await speicher.lies('v1/d1');
		const inhalt = await lesen(gelesen!.strom);
		expect(gelesen!.bytes).toBe(Buffer.byteLength('Grüße 🎣'));
		expect(Buffer.byteLength(inhalt)).toBe(gelesen!.bytes);
		expect((await stat(join(wurzel, 'v1/d1'))).size).toBe(gelesen!.bytes);
	});

	it('nimmt die Temp-Datei weg, statt sie zu kopieren', async () => {
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, 'x');
		await speicher.uebernimm(temp, 'v1/d1');
		await expect(stat(temp)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('legt neue Temp-Dateien unter tmp/ an und vergibt jedes Mal einen anderen Pfad', async () => {
		const a = await speicher.neueTempDatei();
		const b = await speicher.neueTempDatei();
		expect(a).not.toBe(b);
		expect(a.startsWith(join(wurzel, 'tmp') + '/')).toBe(true);
		expect((await stat(join(wurzel, 'tmp'))).isDirectory()).toBe(true);
	});

	it('liefert null, wo es keine Bytes gibt', async () => {
		expect(await speicher.lies('v1/gibt-es-nicht')).toBeNull();
		await ablegen('v1/d1', 'x');
		// Ein Verzeichnis ist keine Datei.
		expect(await speicher.lies('v1')).toBeNull();
	});

	it('loescht zweimal ohne Fehler', async () => {
		await ablegen('v1/d1', 'x');
		await speicher.loesche('v1/d1');
		await expect(speicher.loesche('v1/d1')).resolves.toBeUndefined();
		expect(await speicher.lies('v1/d1')).toBeNull();
	});

	it('weist Schluessel ab, die aus der Wurzel herausfuehren wuerden', async () => {
		const temp = await speicher.neueTempDatei();
		await writeFile(temp, 'x');
		await expect(speicher.uebernimm(temp, '../ausserhalb')).rejects.toThrow();
		await expect(speicher.uebernimm(temp, 'v1/../../ausserhalb')).rejects.toThrow();
		expect(await speicher.lies('../ausserhalb')).toBeNull();
		await expect(speicher.loesche('../ausserhalb')).rejects.toThrow();
	});

	it('listet Dateien und Vorschauen, aber nichts aus tmp/', async () => {
		await ablegen('v1/d1', 'a');
		await ablegen('v1/d1.vorschau', 'b');
		await ablegen('v2/d2', 'c');
		await speicher.neueTempDatei().then((p) => writeFile(p, 'unfertig'));

		const liste = await sammle(speicher.liste());
		expect(liste.map((e) => e.schluessel).sort()).toEqual(['v1/d1', 'v1/d1.vorschau', 'v2/d2']);
		for (const e of liste) expect(e.geaendertAm).toBeInstanceOf(Date);
	});

	it('listet nichts, solange es noch kein Verzeichnis gibt', async () => {
		const leer = new VerzeichnisSpeicher(join(wurzel, 'noch-nicht-da'));
		expect(await sammle(leer.liste())).toEqual([]);
		expect(await leer.raeumeTempAuf(new Date())).toBe(0);
	});

	it('raeumt nur Temp-Dateien auf, die aelter sind als die Grenze', async () => {
		const alt = await speicher.neueTempDatei();
		const neu = await speicher.neueTempDatei();
		await writeFile(alt, 'alt');
		await writeFile(neu, 'neu');
		await ablegen('v1/d1', 'bleibt');
		const jetzt = new Date('2026-10-21T12:00:00Z');
		await utimes(alt, new Date('2026-10-21T10:00:00Z'), new Date('2026-10-21T10:00:00Z'));
		await utimes(neu, new Date('2026-10-21T11:30:00Z'), new Date('2026-10-21T11:30:00Z'));

		const geloescht = await speicher.raeumeTempAuf(new Date(jetzt.getTime() - 3_600_000));

		expect(geloescht).toBe(1);
		expect(await readdir(join(wurzel, 'tmp'))).toEqual([neu.split('/').pop()]);
		(await speicher.lies('v1/d1'))?.strom.destroy();
		expect(await speicher.lies('v1/d1')).not.toBeNull();
	});
});
