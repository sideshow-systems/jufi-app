import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Wo die Bytes liegen. Eine Schnittstelle statt direkter fs-Aufrufe in den Routen, damit
 * Tests ein Temp-Verzeichnis geben und ein spaeterer Wechsel (Objektspeicher) nur diese
 * Datei beruehrt. Verworfen: die Bytes in Postgres -- jede Sicherung und jeder Dump
 * truege sie mit, und 25-MB-Zeilen belasten den 256-MiB-Container.
 */
export interface DateiSpeicher {
	/** Pfad unter tmp/, das Verzeichnis wird angelegt; die Datei entsteht beim Schreiben. */
	neueTempDatei(): Promise<string>;
	/** Macht aus einer Temp-Datei die Datei unter `schluessel`, atomar (rename). */
	uebernimm(tempPfad: string, schluessel: string): Promise<void>;
	/** null, wenn es die Bytes nicht gibt. */
	lies(schluessel: string): Promise<Readable | null>;
	/** Fehlende Bytes sind kein Fehler: das Loeschen soll wiederholbar sein. */
	loesche(schluessel: string): Promise<void>;
	/** Alle abgelegten Dateien, ohne tmp/. Der Waisen-Schritt des Aufraeumers geht sie durch. */
	liste(): AsyncIterable<{ schluessel: string; geaendertAm: Date }>;
	/** Loescht Temp-Dateien, die vor `aelterAls` zuletzt geaendert wurden; liefert die Anzahl. */
	raeumeTempAuf(aelterAls: Date): Promise<number>;
}

/**
 * Der Schluessel haengt an Verein und Datei-ID, nie am Namen: ein Name aus der Welt
 * (`../../etc/passwd`) kann so keinen Pfad beeinflussen, und Umbenennen kostet kein Kopieren.
 */
export function dateiSchluessel(vereinId: string, dateiId: string, vorschau = false): string {
	return `${vereinId}/${dateiId}${vorschau ? '.vorschau' : ''}`;
}

const TEMP = 'tmp';

function istFehler(e: unknown, code: string): boolean {
	return typeof e === 'object' && e !== null && (e as { code?: string }).code === code;
}

/**
 * Dateien in einem Verzeichnis: `<wurzel>/<vereinId>/<dateiId>`, Uploads zuerst unter
 * `<wurzel>/tmp/`. Temp-Dateien liegen auf demselben Volume wie das Ziel, sonst waere
 * `rename` ein Kopieren ueber Geraete (EXDEV) und nicht atomar: ein Abbruch hinterliesse
 * eine halbe Datei unter dem endgueltigen Schluessel.
 */
export class VerzeichnisSpeicher implements DateiSpeicher {
	constructor(private readonly wurzel: string) {}

	async neueTempDatei(): Promise<string> {
		const verzeichnis = join(this.wurzel, TEMP);
		await mkdir(verzeichnis, { recursive: true });
		return join(verzeichnis, randomUUID());
	}

	async uebernimm(tempPfad: string, schluessel: string): Promise<void> {
		const ziel = this.pfad(schluessel);
		await mkdir(dirname(ziel), { recursive: true });
		await rename(tempPfad, ziel);
	}

	async lies(schluessel: string): Promise<Readable | null> {
		let pfad: string;
		try {
			pfad = this.pfad(schluessel);
		} catch {
			return null;
		}
		try {
			if (!(await stat(pfad)).isFile()) return null;
		} catch (e) {
			if (istFehler(e, 'ENOENT') || istFehler(e, 'ENOTDIR')) return null;
			throw e;
		}
		return createReadStream(pfad);
	}

	async loesche(schluessel: string): Promise<void> {
		await rm(this.pfad(schluessel), { force: true });
	}

	async *liste(): AsyncIterable<{ schluessel: string; geaendertAm: Date }> {
		const vereine = await readdir(this.wurzel, { withFileTypes: true }).catch((e) => {
			if (istFehler(e, 'ENOENT')) return [];
			throw e;
		});
		for (const verein of vereine) {
			if (!verein.isDirectory() || verein.name === TEMP) continue;
			const dateien = await readdir(join(this.wurzel, verein.name), { withFileTypes: true });
			for (const datei of dateien) {
				if (!datei.isFile()) continue;
				// Die Datei kann zwischen readdir und stat verschwinden (Loeschliste laeuft parallel).
				const info = await stat(join(this.wurzel, verein.name, datei.name)).catch(() => null);
				if (info) yield { schluessel: `${verein.name}/${datei.name}`, geaendertAm: info.mtime };
			}
		}
	}

	async raeumeTempAuf(aelterAls: Date): Promise<number> {
		const verzeichnis = join(this.wurzel, TEMP);
		const namen = await readdir(verzeichnis).catch((e) => {
			if (istFehler(e, 'ENOENT')) return [];
			throw e;
		});
		let geloescht = 0;
		for (const name of namen) {
			const pfad = join(verzeichnis, name);
			const info = await stat(pfad).catch(() => null);
			if (info && info.mtime < aelterAls) {
				await rm(pfad, { force: true });
				geloescht++;
			}
		}
		return geloescht;
	}

	/**
	 * Aufgeloester Pfad, der garantiert unter der Wurzel bleibt. Schluessel entstehen aus IDs,
	 * die Pruefung ist ein Netz: ein spaeter Fehler an anderer Stelle soll nicht beliebige
	 * Dateien lesbar oder loeschbar machen.
	 */
	private pfad(schluessel: string): string {
		const wurzel = resolve(this.wurzel);
		const ziel = resolve(wurzel, schluessel);
		const rel = relative(wurzel, ziel);
		if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
			throw new Error('Ungueltiger Dateischluessel');
		}
		return ziel;
	}
}
