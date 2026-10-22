/**
 * Fotoverarbeitung (TP4 Etappe 2, Plan Entscheidung 2).
 *
 * Diese Datei importiert nur `sharp` und `node:*` und nutzt nur loeschbare
 * TypeScript-Syntax (keine enum, keine Parameter-Properties, keine Namespaces).
 * Nur so laeuft sie im Rauchtest von tools/deploy.sh unveraendert im
 * Produktions-Image: Node 22 entfernt die Typen beim Laden, ohne Bau. Importierte
 * sie etwas aus der App (`@jufi/domain`, `../verein/logo.js`), braeuchte die Probe
 * den ganzen Bau, und die Speicherabnahme pruefte eine andere Datei als die, die
 * im Betrieb laeuft. Darum steht auch die Pixelpruefung unten noch einmal hier,
 * statt aus logo.ts zu kommen.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';

// Beide Einstellungen gelten fuer den ganzen Prozess, also auch fuers Logo; das ist
// gewollt. Der Container hat 256 MiB: ein 48-MP-Bild belegt entpackt rund 150 MB,
// und libvips wuerde die Arbeit sonst auf mehrere Faeden verteilen und Zeilen
// zwischenspeichern (Cache), was den Spitzenwert vervielfacht. Verworfen: die
// Grenzen je Aufruf setzen, denn sharp kennt sie nur global.
sharp.concurrency(1);
sharp.cache(false);

/** Hoechste Pixelzahl der Eingabe; sharp bricht beim Oeffnen ab, bevor es entpackt. */
const MAX_PIXEL = 50_000_000;
/** Laengste Seite der Hauptfassung und der Vorschau. */
const HAUPT_SEITE = 2560;
const VORSCHAU_SEITE = 480;

export type FotoErgebnis =
	{ ok: true; breite: number; hoehe: number; bytes: number; sha256: string } | { ok: false; grund: 'PIXEL' | 'TYP' };

// Dieselbe Pruefung wie `istPixelLimit` in verein/logo.ts (Grund siehe Dateikopf).
function istPixelLimit(fehler: unknown): boolean {
	return fehler instanceof Error && /pixel limit/i.test(fehler.message);
}

async function hashe(pfad: string): Promise<string> {
	const hash = createHash('sha256');
	// Als Strom, damit auch die 2560er-Fassung nie ganz im Speicher liegt.
	for await (const teil of createReadStream(pfad)) hash.update(teil as Buffer);
	return hash.digest('hex');
}

/**
 * Macht aus dem Upload die beiden Fassungen eines Fotos: Haupt (lange Seite
 * 2560 px) und Vorschau (480 px), beide JPEG.
 *
 * Das Bild wird immer neu kodiert und nie durchgereicht: sharp schreibt ohne
 * `withMetadata` weder EXIF noch GPS in die Ausgabe, und Daten hinter dem
 * Bildende fallen weg. `rotate()` wendet die Orientierung vorher an, damit das
 * Bild ohne den Tag nicht auf der Seite liegt. JPEG kennt keine Transparenz;
 * `flatten` legt sie auf Weiss, sonst wuerde sie schwarz.
 *
 * Die Vorschau entsteht aus der fertigen Hauptfassung (Entscheidung 3), nicht
 * aus dem Original: ein 48-MP-Bild wird so nur einmal dekodiert. Verworfen: beide
 * Fassungen in einem Zug aus dem Original, das waere der doppelte Speicherbedarf.
 *
 * `bytes` zaehlt beide Fassungen (Spec 2.1), `sha256` gilt der Hauptfassung
 * (Restore-Probe, Spec 12.4).
 */
export async function verarbeiteFoto(
	eingabe: string,
	ausgabe: { haupt: string; vorschau: string },
): Promise<FotoErgebnis> {
	try {
		const haupt = await sharp(eingabe, { limitInputPixels: MAX_PIXEL, failOn: 'error', sequentialRead: true })
			.rotate()
			.resize({ width: HAUPT_SEITE, height: HAUPT_SEITE, fit: 'inside', withoutEnlargement: true })
			.flatten({ background: '#ffffff' })
			.jpeg({ quality: 82 })
			.toFile(ausgabe.haupt);
		// Nicht ueber die Hauptfassung hinaus vergroessern: ein 100-px-Bild braucht keine 480er-Vorschau.
		await sharp(ausgabe.haupt)
			.resize({ width: VORSCHAU_SEITE, height: VORSCHAU_SEITE, fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: 75 })
			.toFile(ausgabe.vorschau);
		const [hauptGroesse, vorschauGroesse, sha256] = await Promise.all([
			stat(ausgabe.haupt),
			stat(ausgabe.vorschau),
			hashe(ausgabe.haupt),
		]);
		return {
			ok: true,
			breite: haupt.width,
			hoehe: haupt.height,
			bytes: hauptGroesse.size + vorschauGroesse.size,
			sha256,
		};
	} catch (fehler) {
		// Jeder andere Fehler (kein Bild, abgeschnitten, beschaedigt) ist fuer den
		// Aufrufer ein falscher Typ; die Einzelheiten helfen ihm nicht weiter.
		return { ok: false, grund: istPixelLimit(fehler) ? 'PIXEL' : 'TYP' };
	}
}
