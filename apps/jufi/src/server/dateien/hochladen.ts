import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { KOPF_BYTES } from '@jufi/domain';
import type { Request } from 'express';
import type { DateiSpeicher } from './speicher.js';

export type UploadErgebnis =
	| { ok: true; tempPfad: string; bytes: number; sha256: string; kopf: Uint8Array }
	| { ok: false; status: 411 | 413; code?: 'GROESSE' };

/**
 * Liest den Koerper eines Uploads als Strom in eine Temp-Datei, ohne ihn je ganz im Speicher
 * zu halten (der Container hat 256 MiB, eine Datei bis 25 MB, mehrere Uploads gleichzeitig).
 * Verworfen: multer oder busboy -- der Koerper ist die Datei selbst (octet-stream), es gibt
 * nichts zu zerlegen, und ein Paket mehr in der Lieferkette brauchte es nur dafuer.
 *
 * `Content-Length` zuerst: Was ueber der Grenze liegt, wird abgelehnt, bevor ein Byte auf die
 * Platte kommt. Node begrenzt den Koerper auf genau diese Laenge, der Wert kann also nicht
 * untertreiben. Der Aufrufer, der vorzeitig antwortet, setzt `Connection: close`, weil der
 * Koerper ungelesen bleibt und die Verbindung sonst fuer die naechste Anfrage verdorben ist.
 *
 * Bricht der Client ab, wirft die Funktion und loescht die Temp-Datei selbst: Der Aufrufer
 * hat noch keinen Pfad in der Hand und kann nicht aufraeumen.
 */
export async function nimmUpload(
	req: Request,
	e: { speicher: DateiSpeicher; maxBytes: number },
): Promise<UploadErgebnis> {
	const laenge = req.headers['content-length'];
	// Nur Ziffern: Number('') ist 0, Number('1e3') 1000, Number('-1') -1 -- alles Werte, die
	// eine falsche Laenge behaupten wuerden.
	if (laenge === undefined || !/^\d+$/.test(laenge) || !Number.isSafeInteger(Number(laenge))) {
		return { ok: false, status: 411 };
	}
	if (Number(laenge) > e.maxBytes) return { ok: false, status: 413, code: 'GROESSE' };

	const hash = createHash('sha256');
	const kopf = Buffer.alloc(KOPF_BYTES);
	let kopfLaenge = 0;
	let bytes = 0;
	const zaehler = new Transform({
		transform(stueck: Buffer, _kodierung, weiter) {
			hash.update(stueck);
			if (kopfLaenge < KOPF_BYTES) {
				kopfLaenge += stueck.copy(kopf, kopfLaenge, 0, Math.min(stueck.length, KOPF_BYTES - kopfLaenge));
			}
			bytes += stueck.length;
			weiter(null, stueck);
		},
	});

	const tempPfad = await e.speicher.neueTempDatei();
	try {
		// pipeline statt pipe: pipe gaebe einen Abbruch des Clients nicht an die Datei weiter, und
		// der Aufrufer wartete auf ein Ende, das nie kommt. pipeline wirft bei Abbruch von
		// Quelle (aborted, close vor end) oder Ziel und raeumt die Stroeme ab.
		await pipeline(req, zaehler, createWriteStream(tempPfad));
	} catch (fehler) {
		await rm(tempPfad, { force: true });
		throw fehler;
	}
	return {
		ok: true,
		tempPfad,
		bytes,
		sha256: hash.digest('hex'),
		kopf: new Uint8Array(kopf.subarray(0, kopfLaenge)),
	};
}
