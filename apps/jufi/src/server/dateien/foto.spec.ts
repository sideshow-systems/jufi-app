import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verarbeiteFoto } from './foto.js';
import { FotoSchlange } from './foto-schlange.js';
import { erzeugeBild } from './test-bilder.js';

describe('verarbeiteFoto', () => {
	let ordner: string;
	let eingabe: string;
	let haupt: string;
	let vorschau: string;

	beforeEach(async () => {
		ordner = await mkdtemp(join(tmpdir(), 'jufi-foto-'));
		eingabe = join(ordner, 'eingabe');
		haupt = join(ordner, 'haupt');
		vorschau = join(ordner, 'vorschau');
	});
	afterEach(async () => {
		await rm(ordner, { recursive: true, force: true });
	});

	async function lauf(bild: Buffer) {
		await writeFile(eingabe, bild);
		return verarbeiteFoto(eingabe, { haupt, vorschau });
	}

	it('verkleinert auf 2560 und 480 und entfernt EXIF samt GPS', async () => {
		const bild = await erzeugeBild({ breite: 4000, hoehe: 3000, format: 'jpeg', gps: true });
		// Vorbedingung: ohne EXIF in der Eingabe bewiese der Test nichts.
		expect((await sharp(bild).metadata()).exif).toBeDefined();
		expect(bild.includes('Erfunden')).toBe(true);

		const ergebnis = await lauf(bild);
		expect(ergebnis).toMatchObject({ ok: true, breite: 2560, hoehe: 1920 });

		const hauptMeta = await sharp(haupt).metadata();
		expect([hauptMeta.width, hauptMeta.height, hauptMeta.format]).toEqual([2560, 1920, 'jpeg']);
		expect(hauptMeta.exif).toBeUndefined();
		expect((await readFile(haupt)).includes('Erfunden')).toBe(false);

		const vorschauMeta = await sharp(vorschau).metadata();
		expect([vorschauMeta.width, vorschauMeta.height]).toEqual([480, 360]);
		expect(vorschauMeta.exif).toBeUndefined();
	});

	it('dreht nach der EXIF-Orientierung', async () => {
		const bild = await erzeugeBild({ breite: 200, hoehe: 100, format: 'jpeg', orientierung: 6 });
		expect((await sharp(bild).metadata()).orientation).toBe(6);
		const ergebnis = await lauf(bild);
		expect(ergebnis).toMatchObject({ ok: true, breite: 100, hoehe: 200 });
		const meta = await sharp(haupt).metadata();
		expect([meta.width, meta.height]).toEqual([100, 200]);
	});

	it('legt Transparenz auf Weiss', async () => {
		const bild = await erzeugeBild({ breite: 800, hoehe: 600, format: 'png', alpha: true });
		expect((await sharp(bild).metadata()).hasAlpha).toBe(true);
		const ergebnis = await lauf(bild);
		expect(ergebnis.ok).toBe(true);
		const { data, info } = await sharp(haupt).raw().toBuffer({ resolveWithObject: true });
		expect(Array.from(data.subarray(0, info.channels).slice(0, 3))).toEqual([255, 255, 255]);
	});

	it('vergroessert ein kleines Bild nicht', async () => {
		const ergebnis = await lauf(await erzeugeBild({ breite: 300, hoehe: 200, format: 'webp' }));
		expect(ergebnis).toMatchObject({ ok: true, breite: 300, hoehe: 200 });
		const meta = await sharp(haupt).metadata();
		expect([meta.width, meta.height]).toEqual([300, 200]);
		// Auch die Vorschau wird nicht ueber das Hauptbild hinaus vergroessert.
		const v = await sharp(vorschau).metadata();
		expect(v.width).toBeLessThanOrEqual(300);
	});

	it('lehnt mehr als 50 Megapixel ab, bevor es entpackt', async () => {
		const bild = await sharp({ create: { width: 7100, height: 7100, channels: 3, background: '#336699' } })
			.png()
			.toBuffer();
		expect(await lauf(bild)).toEqual({ ok: false, grund: 'PIXEL' });
	});

	it('meldet TYP bei Muell hinter einem JPEG-Kopf', async () => {
		const kopf = (await erzeugeBild({ breite: 50, hoehe: 50, format: 'jpeg' })).subarray(0, 20);
		const muell = Buffer.alloc(2000, 0x41);
		expect(await lauf(Buffer.concat([kopf, muell]))).toEqual({ ok: false, grund: 'TYP' });
	});

	it('meldet TYP bei einer Datei, die kein Bild ist', async () => {
		expect(await lauf(Buffer.from('kein Bild, nur Text'))).toEqual({ ok: false, grund: 'TYP' });
	});

	it('zaehlt beide Fassungen in bytes und hasht die Hauptfassung', async () => {
		const ergebnis = await lauf(await erzeugeBild({ breite: 1000, hoehe: 800, format: 'png' }));
		if (!ergebnis.ok) throw new Error('Verarbeitung gescheitert');
		const summe = (await stat(haupt)).size + (await stat(vorschau)).size;
		expect(ergebnis.bytes).toBe(summe);
		expect(ergebnis.sha256).toBe(
			createHash('sha256')
				.update(await readFile(haupt))
				.digest('hex'),
		);
	});
});

describe('FotoSchlange', () => {
	/** Eine Arbeit, die erst endet, wenn der Test es sagt. */
	function aufgeschoben() {
		let erfuelle!: (wert: number) => void;
		let lehneAb!: (grund: Error) => void;
		const versprechen = new Promise<number>((res, rej) => {
			erfuelle = res;
			lehneAb = rej;
		});
		return { versprechen, erfuelle, lehneAb };
	}

	it('nimmt eine laufende und acht wartende an, die zehnte nicht', () => {
		const schlange = new FotoSchlange();
		const arbeiten = Array.from({ length: 9 }, () => aufgeschoben());
		for (const a of arbeiten) {
			expect(schlange.reihe(() => a.versprechen)).not.toBeNull();
		}
		expect(schlange.voll()).toBe(true);
		expect(schlange.reihe(async () => 1)).toBeNull();
		for (const a of arbeiten) a.erfuelle(1);
	});

	it('fuehrt hoechstens eine Arbeit gleichzeitig aus', async () => {
		const schlange = new FotoSchlange();
		let gleichzeitig = 0;
		let spitze = 0;
		const ergebnisse = Array.from({ length: 5 }, (_, i) =>
			schlange.reihe(async () => {
				gleichzeitig++;
				spitze = Math.max(spitze, gleichzeitig);
				await new Promise((r) => setTimeout(r, 5));
				gleichzeitig--;
				return i;
			}),
		);
		expect(await Promise.all(ergebnisse)).toEqual([0, 1, 2, 3, 4]);
		expect(spitze).toBe(1);
	});

	it('nimmt nach dem Ende der ersten wieder an', async () => {
		const schlange = new FotoSchlange();
		const arbeiten = Array.from({ length: 9 }, () => aufgeschoben());
		const laeufe = arbeiten.map((a) => schlange.reihe(() => a.versprechen));
		expect(schlange.voll()).toBe(true);
		arbeiten[0].erfuelle(0);
		await laeufe[0];
		expect(schlange.voll()).toBe(false);
		const neu = schlange.reihe(async () => 42);
		expect(neu).not.toBeNull();
		for (const a of arbeiten.slice(1)) a.erfuelle(1);
		expect(await neu).toBe(42);
	});

	it('bleibt nach einer abgelehnten Arbeit nicht stehen', async () => {
		const schlange = new FotoSchlange();
		const kaputt = schlange.reihe(async () => {
			throw new Error('kaputt');
		});
		const danach = schlange.reihe(async () => 'weiter');
		await expect(kaputt).rejects.toThrow('kaputt');
		await expect(danach).resolves.toBe('weiter');
		expect(schlange.voll()).toBe(false);
	});

	it('nimmt die Zahl der Wartenden aus dem Konstruktor', () => {
		const schlange = new FotoSchlange(1);
		const a = aufgeschoben();
		const b = aufgeschoben();
		expect(schlange.reihe(() => a.versprechen)).not.toBeNull();
		expect(schlange.reihe(() => b.versprechen)).not.toBeNull();
		expect(schlange.reihe(async () => 1)).toBeNull();
		a.erfuelle(1);
		b.erfuelle(1);
	});
});
