import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vereinsfarben } from '../../app/gestaltung/farben.js';
import { initialenIcon, LOGO_MAX_BYTES, verarbeiteLogo } from './logo.js';

// Testbilder entstehen hier mit sharp selbst: Binaerdateien im Repo wuerden
// niemand pruefen, und die Eigenschaften (Alpha, EXIF, Masse) stehen so im Test.
async function png(breite: number, hoehe: number, alpha = true, stark = false): Promise<Buffer> {
	return (
		sharp({
			create: {
				width: breite,
				height: hoehe,
				channels: alpha ? 4 : 3,
				background: alpha ? { r: 200, g: 30, b: 30, alpha: 0.5 } : { r: 200, g: 30, b: 30 },
			},
		})
			// Stark gepackt, damit ein 100-Megapixel-Bild unter 1 MB bleibt.
			.png(stark ? { compressionLevel: 9, effort: 10, palette: true } : {})
			.toBuffer()
	);
}

describe('verarbeiteLogo', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('nimmt ein PNG mit Alphakanal an und liefert quadratische Icons', async () => {
		const r = await verarbeiteLogo(await png(800, 400));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mimeType).toBe('image/png');
		const bild = await sharp(r.bild).metadata();
		expect(bild).toMatchObject({ format: 'png', width: 800, height: 400, hasAlpha: true });
		const k = await sharp(r.icon192).metadata();
		expect([k.format, k.width, k.height]).toEqual(['png', 192, 192]);
		const g = await sharp(r.icon512).metadata();
		expect([g.format, g.width, g.height]).toEqual(['png', 512, 512]);
	});

	it('legt die Icons auf weissen Grund, nicht auf Transparenz', async () => {
		const r = await verarbeiteLogo(await png(800, 400));
		if (!r.ok) throw new Error('erwartet ok');
		const { data, info } = await sharp(r.icon192).raw().toBuffer({ resolveWithObject: true });
		// Oberste linke Ecke liegt im Rand ueber dem breiten Logo.
		expect([...data.subarray(0, info.channels)].slice(0, 3)).toEqual([255, 255, 255]);
		expect(info.channels === 3 || data[3] === 255).toBe(true);
	});

	it('kodiert ein Handyfoto neu: kleiner, gedreht, ohne EXIF und GPS', async () => {
		const foto = await sharp({
			create: { width: 3000, height: 2000, channels: 3, background: { r: 20, g: 90, b: 160 } },
		})
			.jpeg()
			.withMetadata({
				orientation: 6,
				exif: {
					IFD3: {
						GPSLatitudeRef: 'N',
						GPSLatitude: '48/1 8/1 0/1',
						GPSLongitudeRef: 'E',
						GPSLongitude: '11/1 34/1 0/1',
					},
				},
			})
			.toBuffer();
		// Voraussetzung des Tests: das Eingabebild traegt die Metadaten wirklich.
		const vorher = await sharp(foto).metadata();
		expect(vorher.orientation).toBe(6);
		expect(vorher.exif).toBeDefined();

		const r = await verarbeiteLogo(foto);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mimeType).toBe('image/jpeg');
		const m = await sharp(r.bild).metadata();
		expect(m.format).toBe('jpeg');
		// Gedreht: aus 3000 x 2000 mit Orientierung 6 wird Hochformat, 683 x 1024.
		expect(m.height).toBe(1024);
		expect(m.width).toBeLessThan(m.height!);
		expect(m.exif).toBeUndefined();
		expect(m.orientation).toBeUndefined();
	});

	it('vergroessert kleine Bilder nicht', async () => {
		const r = await verarbeiteLogo(await png(100, 50));
		if (!r.ok) throw new Error('erwartet ok');
		const m = await sharp(r.bild).metadata();
		expect([m.width, m.height]).toEqual([100, 50]);
	});

	it.each([
		[
			'GIF',
			async () =>
				sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
					.gif()
					.toBuffer(),
		],
		[
			'SVG',
			async () =>
				Buffer.from(
					'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
				),
		],
		[
			'WebP',
			async () =>
				sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
					.webp()
					.toBuffer(),
		],
		['Text', async () => Buffer.from('das ist kein Bild')],
		['abgeschnittenes PNG', async () => (await png(400, 400, false)).subarray(0, 60)],
		['leere Eingabe', async () => Buffer.alloc(0)],
	])('lehnt %s als Format ab', async (_name, erzeuge) => {
		expect(await verarbeiteLogo(await erzeuge())).toEqual({ ok: false, grund: 'format' });
	});

	it('lehnt mehr als 1 MB ab, ohne sharp aufzurufen', async () => {
		const gross = Buffer.alloc(LOGO_MAX_BYTES + 1);
		// Ein Bild, das sharp lesen koennte: so zeigt nur die Groessenpruefung, dass sharp nie dran war.
		const png1 = await png(10, 10);
		png1.copy(gross);
		const metadata = vi.spyOn(sharp.prototype, 'metadata');
		const toBuffer = vi.spyOn(sharp.prototype, 'toBuffer');
		expect(await verarbeiteLogo(gross)).toEqual({ ok: false, grund: 'zu-gross' });
		expect(metadata).not.toHaveBeenCalled();
		expect(toBuffer).not.toHaveBeenCalled();
	});

	it('nimmt genau 1 MB noch an (Grenze gehoert dazu)', async () => {
		// Kein gueltiges Bild, aber die Groessenpruefung darf es nicht abweisen.
		const r = await verarbeiteLogo(Buffer.alloc(LOGO_MAX_BYTES));
		expect(r).toEqual({ ok: false, grund: 'format' });
	});

	it('lehnt ein kleines PNG mit 10 000 x 10 000 Pixeln als zu gross ab', async () => {
		const riesig = await png(10_000, 10_000, false, true);
		// Voraussetzung: es ist klein genug, um die Byte-Grenze zu passieren.
		expect(riesig.length).toBeLessThan(LOGO_MAX_BYTES);
		expect(await verarbeiteLogo(riesig)).toEqual({ ok: false, grund: 'zu-gross' });
	}, 60_000);
});

describe('initialenIcon', () => {
	it('zeichnet Initialen auf die Akzentfarbe', async () => {
		const icon = await initialenIcon('Jungfischer Demo', '#1d4ed8', 192);
		const { data, info } = await sharp(icon).raw().toBuffer({ resolveWithObject: true });
		expect(await sharp(icon).metadata()).toMatchObject({ format: 'png', width: 192, height: 192 });
		const pixel = (x: number, y: number) => {
			const i = (y * info.width + x) * info.channels;
			return [...data.subarray(i, i + 3)];
		};
		const { akzent } = vereinsfarben('#1d4ed8').hell;
		const erwartet = [1, 3, 5].map((i) => parseInt(akzent.slice(i, i + 2), 16));
		expect(pixel(2, 2)).toEqual(erwartet);
		expect(pixel(189, 189)).toEqual(erwartet);
		// In der Mitte steht Schrift: dort weichen viele Pixel von der Akzentfarbe ab.
		let abweichend = 0;
		for (let y = 64; y < 128; y++) {
			for (let x = 40; x < 152; x++) if (pixel(x, y).join() !== erwartet.join()) abweichend++;
		}
		expect(abweichend).toBeGreaterThan(100);
	});

	it('liefert auch 512 x 512', async () => {
		const m = await sharp(await initialenIcon('Fischer', '#0f766e', 512)).metadata();
		expect([m.width, m.height]).toEqual([512, 512]);
	});

	it('uebersteht XML-Sonderzeichen in den Initialen', async () => {
		const m = await sharp(await initialenIcon('&<> "Verein"', '#0f766e', 192)).metadata();
		expect([m.width, m.height]).toEqual([192, 192]);
	});
});
