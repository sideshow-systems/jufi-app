#!/usr/bin/env node
//
// Fotoprobe im Rauchtest (tools/deploy.sh, Tor 4; Plan, Entscheidung 1). Laeuft **im**
// Produktions-Image, nicht auf dem Entwicklungsrechner:
//   node /app/probe/fotoprobe.mjs <bild> [<bild> ...]
//
// Je Bild ruft sie verarbeiteFoto aus genau der Datei, die im Betrieb laeuft
// (apps/jufi/src/server/dateien/foto.ts), und gibt Eingabe- und Ausgabemasse und die
// Bytes beider Fassungen aus. Den Spitzenwert des Speichers liest danach deploy.sh aus
// der cgroup; hier steht nur der eigene Hoechststand des Prozesses (maxRSS) dabei.
//
// deploy.sh legt foto.ts als foto.mts neben dieses Skript. Node 22 entfernt die Typen
// beim Laden, ohne Bau (darum darf foto.ts nur loeschbare Syntax nutzen und nur sharp
// und node:* importieren). Die Endung .mts sagt Node selbst, dass es ein ES-Modul ist.
// Mit .ts nimmt Node den Modultyp aus der naechsten package.json; im Image ist das
// /app/package.json, die "type": "module" nur der CLI wegen traegt
// (tools/runtime-package.mjs). Fiele das Feld dort weg, warnte jeder Rauchtest mit
// MODULE_TYPELESS_PACKAGE_JSON (so geschieht es beim Laden aus dem Repo, dessen
// package.json kein "type" hat). Verworfen: --no-warnings (verschluckte auch Warnungen,
// die etwas bedeuten) und eine eigene package.json im Probeverzeichnis (eine dritte
// Datei, die nur einer Warnung wegen mitkopiert werden muesste). sharp findet Node von
// /app/probe aus in /app/node_modules.
//
// Die Ausgaben landen in einem eigenen Verzeichnis unter tmpdir und werden danach
// geloescht. Exit 1, wenn ein Bild abgelehnt wird: Die Probe-Bilder liegen unter den
// Grenzen der App, eine Ablehnung hiesse, dass foto.ts etwas anderes tut als erwartet.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';

const bilder = process.argv.slice(2);
if (bilder.length === 0) {
	console.error('Aufruf: node fotoprobe.mjs <bild> [<bild> ...]');
	process.exit(2);
}

const { verarbeiteFoto } = await import(new URL('./foto.mts', import.meta.url).href);
const arbeit = await mkdtemp(join(tmpdir(), 'fotoprobe-'));
let fehler = false;
try {
	for (const [i, bild] of bilder.entries()) {
		// Nur der Kopf: Die Masse der Eingabe kosten so keinen Speicher, der die Messung verfaelschte.
		const kopf = await sharp(bild).metadata();
		const beginn = Date.now();
		const ergebnis = await verarbeiteFoto(bild, {
			haupt: join(arbeit, `${i}-haupt.jpg`),
			vorschau: join(arbeit, `${i}-vorschau.jpg`),
		});
		const dauer = Date.now() - beginn;
		if (!ergebnis.ok) {
			console.error(`${basename(bild)}: abgelehnt (${ergebnis.grund})`);
			fehler = true;
			continue;
		}
		console.log(
			`${basename(bild)}: ${kopf.width} x ${kopf.height} -> ${ergebnis.breite} x ${ergebnis.hoehe}, ` +
				`${ergebnis.bytes} Bytes (beide Fassungen), ${dauer} ms`,
		);
	}
} finally {
	await rm(arbeit, { recursive: true, force: true });
}
// maxRSS in KiB (Node-Dokumentation zu process.resourceUsage).
console.log(`Probe-Prozess: hoechstens ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB`);
process.exit(fehler ? 1 : 0);
