import { initialen, LOGO_MAX_BYTES } from '@jufi/domain';
import sharp from 'sharp';
import { vereinsfarben } from '../../app/gestaltung/farben.js';

/**
 * Hoechste Pixelzahl der Eingabe. Ein PNG mit 10 000 x 10 000 Pixeln ist
 * einfarbig nur wenige KB gross, entpackt aber 400 MB. Die Bytegrenze allein
 * schuetzt davor nicht; sharp bricht beim Oeffnen ab, bevor es entpackt.
 */
export const LOGO_MAX_PIXEL = 25_000_000;

/** Laengste Seite des gespeicherten Logos. */
const LOGO_MAX_SEITE = 1024;

export type LogoErgebnis =
	| { ok: true; bild: Buffer; mimeType: 'image/png' | 'image/jpeg'; icon192: Buffer; icon512: Buffer }
	| { ok: false; grund: 'format' | 'zu-gross' };

const MIME = { png: 'image/png', jpeg: 'image/jpeg' } as const;

function istPixelLimit(fehler: unknown): boolean {
	return fehler instanceof Error && /pixel limit/i.test(fehler.message);
}

/**
 * Prueft ein hochgeladenes Logo und kodiert es neu.
 *
 * Das Format bestimmt der Inhalt (`metadata().format`), nicht der Content-Type
 * des Aufrufers: der ist frei waehlbar. Zugelassen sind nur PNG und JPEG.
 * Verworfen: SVG, weil es Skripte und fremde Verweise tragen kann, sowie GIF
 * und WebP, weil kein Bedarf besteht und jedes Format mehr Angriffsflaeche
 * bedeutet.
 *
 * Das Bild wird immer neu kodiert und nie durchgereicht. Ein Handyfoto traegt
 * sonst womoeglich den GPS-Ort in den EXIF-Daten, und ein Bild kann hinter
 * seinem Ende weitere Daten verstecken. sharp schreibt ohne `withMetadata` keine
 * Metadaten in die Ausgabe; `.rotate()` wendet die EXIF-Orientierung vorher an,
 * damit das Bild nach dem Wegfall des Tags nicht auf der Seite liegt.
 */
export async function verarbeiteLogo(eingabe: Buffer): Promise<LogoErgebnis> {
	// Vor jedem Zugriff auf sharp: die Groesse kostet nichts.
	if (eingabe.length > LOGO_MAX_BYTES) return { ok: false, grund: 'zu-gross' };
	try {
		const optionen = { limitInputPixels: LOGO_MAX_PIXEL, failOn: 'error' } as const;
		const format = (await sharp(eingabe, optionen).metadata()).format;
		if (format !== 'png' && format !== 'jpeg') return { ok: false, grund: 'format' };

		let pipeline = sharp(eingabe, optionen)
			.rotate()
			.resize({ width: LOGO_MAX_SEITE, height: LOGO_MAX_SEITE, fit: 'inside', withoutEnlargement: true });
		pipeline = format === 'png' ? pipeline.png() : pipeline.jpeg({ quality: 85 });
		const bild = await pipeline.toBuffer();

		return { ok: true, bild, mimeType: MIME[format], icon192: await icon(bild, 192), icon512: await icon(bild, 512) };
	} catch (fehler) {
		// Jeder andere Fehler (kein Bild, abgeschnitten, beschaedigt) ist fuer den
		// Aufrufer ein falsches Format; die Einzelheiten helfen ihm nicht weiter.
		return { ok: false, grund: istPixelLimit(fehler) ? 'zu-gross' : 'format' };
	}
}

/**
 * Quadratisches Icon aus dem Logo. `contain` statt `cover`: ein breites Logo
 * soll nicht angeschnitten werden. Der weisse Grund ersetzt die Transparenz,
 * denn iOS fuellt durchsichtige Icons schwarz.
 */
async function icon(bild: Buffer, groesse: number): Promise<Buffer> {
	return sharp(bild)
		.resize({ width: groesse, height: groesse, fit: 'contain', background: '#ffffff' })
		.flatten({ background: '#ffffff' })
		.png()
		.toBuffer();
}

function xmlEscape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Icon fuer einen Verein ohne Logo: Initialen auf der Vereinsfarbe.
 *
 * Die Schrift ist DejaVu Sans Bold. Das Image bringt sie ueber `apk add
 * font-dejavu` mit (Dockerfile); eine Schriftdatei im Repo ist verworfen, siehe
 * Plan. Fehlt sie, zeichnet librsvg mit irgendeiner Ersatzschrift und der
 * Test faellt nicht auf: deshalb prueft der Plan das Icon in Etappe 6 auf dem
 * Server.
 */
export async function initialenIcon(anzeigename: string, farbe: string, groesse: 192 | 512): Promise<Buffer> {
	const { akzent, aufAkzent } = vereinsfarben(farbe).hell;
	const text = xmlEscape(initialen(anzeigename));
	// Zwei Zeichen nehmen etwa die halbe Breite ein; dy zentriert senkrecht, weil
	// librsvg dominant-baseline nicht verlaesslich umsetzt.
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${groesse}" height="${groesse}" viewBox="0 0 ${groesse} ${groesse}">` +
		`<rect width="${groesse}" height="${groesse}" fill="${akzent}"/>` +
		`<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" ` +
		`font-size="${Math.round(groesse * 0.42)}" fill="${aufAkzent}">${text}</text></svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}
