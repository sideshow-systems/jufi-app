import sharp from 'sharp';

export interface BildWunsch {
	breite: number;
	hoehe: number;
	format: 'jpeg' | 'png' | 'webp';
	/** Durchsichtig (Alpha 0) statt deckend; JPEG kennt keine Transparenz. */
	alpha?: boolean;
	/** EXIF-Orientierung 1 bis 8. */
	orientierung?: number;
	/** Erfundene Kamera und ein erfundener GPS-Ort in den EXIF-Daten. */
	gps?: boolean;
}

/**
 * Erzeugt ein Testbild. Nie ein echtes Foto (Spec 1.2): der Inhalt ist ein
 * Farbverlauf, den sharp aus rohen Pixeln kodiert.
 *
 * Verworfen: sharp-`create` mit einer Vollfarbe. Ein einfarbiges Bild
 * komprimiert so gut, dass ein 4000 x 3000 Foto wenige KB gross waere und die
 * Kodierung nichts Echtes zu tun haette.
 */
export async function erzeugeBild(e: BildWunsch): Promise<Buffer> {
	const kanaele = e.alpha && e.format !== 'jpeg' ? 4 : 3;
	const roh = Buffer.alloc(e.breite * e.hoehe * kanaele);
	for (let y = 0; y < e.hoehe; y++) {
		for (let x = 0; x < e.breite; x++) {
			const i = (y * e.breite + x) * kanaele;
			roh[i] = Math.round((x / e.breite) * 255);
			roh[i + 1] = Math.round((y / e.hoehe) * 255);
			roh[i + 2] = 128;
			if (kanaele === 4) roh[i + 3] = 0;
		}
	}
	let bild = sharp(roh, { raw: { width: e.breite, height: e.hoehe, channels: kanaele } });
	if (e.gps) {
		bild = bild.withExif({
			IFD0: { Make: 'Erfunden' },
			IFD3: {
				GPSLatitudeRef: 'N',
				GPSLatitude: '52/1 30/1 0/1',
				GPSLongitudeRef: 'E',
				GPSLongitude: '13/1 24/1 0/1',
			},
		});
	}
	if (e.orientierung !== undefined) bild = bild.withMetadata({ orientation: e.orientierung });
	return bild.toFormat(e.format).toBuffer();
}
