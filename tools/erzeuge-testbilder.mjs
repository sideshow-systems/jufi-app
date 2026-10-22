#!/usr/bin/env node
//
// Erzeugt Testbilder, nie echte Fotos (TP4-Spec 1.2). Aufruf:
//   node tools/erzeuge-testbilder.mjs <verzeichnis> [--bunt <n>]
//
// Immer entstehen die Bilder der Fotoprobe im Rauchtest (tools/deploy.sh, Tor 4). Sie decken
// die teuersten Faelle ab, die die Upload-Route noch annimmt (hoechstens 20 MiB und 50 MP,
// TP4-Spec 2.4). Teuer heisst dabei nicht gross nach Bytes, sondern viele Pixel in einer
// Kodierung, die der Dekoder nicht zeilenweise lesen kann:
//   - gross.jpg: 8000 x 6000 (48 MP), baseline, Farbverlauf mit leichtem Rauschen,
//     Qualitaet 90. Das groesste Bild, das ein Handy heute liefert; libjpeg verkleinert
//     es schon beim Laden, darum ist es der guenstige Fall.
//   - gross-progressiv.jpg: dasselbe Bild progressiv mit 4:2:0. Progressiv puffert der
//     Dekoder alle DCT-Koeffizienten (bei 48 MP rund 144 MB); so speichern Lightroom,
//     Photoshop und manche Bildbearbeitungs-Apps.
//   - gross-progressiv-444.jpg: progressiv ohne Farbunterabtastung (4:4:4), doppelt so
//     viele Koeffizienten (rund 288 MB): der teuerste JPEG-Fall.
//   - gross-adam7.png: 8160 x 6120 (knapp 50 MP), RGBA, interlaced (Adam7). Interlaced
//     muss der Dekoder das ganze Bild entpacken, bevor er die erste Zeile liefert (rund
//     200 MB); der Alphakanal laesst zudem flatten arbeiten. Glatte Verlaeufe, damit die
//     Datei trotz 50 MP weit unter 20 MiB bleibt.
//   - gross.webp: 8000 x 6000, dasselbe Bild wie gross.jpg; libwebp dekodiert immer ganz.
//   - gross.png: RGB-Rauschen, so bemessen, dass die Datei knapp unter der Fotogrenze
//     liegt (18 bis 20 MiB). Rauschen, weil es sich nicht komprimieren laesst: Nur so wird
//     die Datei so gross, und der Dekoder muss sie ganz lesen. Es sind dann aber nur 6,6 MP;
//     es prueft die Bytegrenze, nicht den Speicher.
// Groesse und Pixelzahl werden geprueft; liegt ein Bild ausserhalb, bricht das Skript ab,
// statt eine Probe zu liefern, die etwas anderes misst als die Grenze (die Upload-Route
// nimmt hoechstens 20 MiB an, und foto.ts lehnt mehr als 50 MP ab: ein solches Bild kaeme
// gar nicht bis zum Dekodieren).
//
// Mit --bunt <n> zusaetzlich n Bilder 1600 x 1200 aus Kreisen und Rechtecken in
// zufaelligen Farben (bunt-1.jpg ...), fuer die Abnahme im Browser (Plan, Entscheidung 15):
// Ein Raster aus lauter gleichen Verlaeufen zeigte nicht, ob Reihenfolge und Blaettern stimmen.
//
// Der Zufall ist geseedet, damit zwei Laeufe dieselben Bilder liefern und eine gemessene
// Spitze nicht vom Wurf abhaengt. Verworfen: Math.random -- dann schwankte die Groesse
// von gross.jpg von Lauf zu Lauf, und ein Ausreisser ueber 20 MiB braeche den Deploy zufaellig.
//
// Laeuft auf dem Entwicklungsrechner, wo sharp steht (wie tools/pruefe-icon.mjs), nicht im Image.

import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

// Die Grenzen der App (GRENZE_BYTES.FOTO und FOTO_MAX_PIXEL in libs/domain/src/dateien/typ.ts,
// MAX_PIXEL in foto.ts) noch einmal hier: Das Skript laeuft ohne Bau, und der Domain-Code
// importiert mit .js-Endungen, die Node aus dem Quelltext nicht aufloest.
const FOTO_GRENZE = 20 * 1024 * 1024;
const FOTO_MAX_PIXEL = 50_000_000;
const PNG_UNTERGRENZE = 18 * 1024 * 1024;

function abbruch(text) {
	console.error(`erzeuge-testbilder: ${text}`);
	process.exit(1);
}

const argumente = process.argv.slice(2);
const ziel = argumente[0];
if (!ziel || ziel.startsWith('--')) abbruch('Aufruf: node tools/erzeuge-testbilder.mjs <verzeichnis> [--bunt <n>]');
let bunt = 0;
const buntStelle = argumente.indexOf('--bunt');
if (buntStelle !== -1) {
	bunt = Number(argumente[buntStelle + 1]);
	if (!Number.isInteger(bunt) || bunt < 1) abbruch('--bunt braucht eine ganze Zahl ab 1.');
}
mkdirSync(ziel, { recursive: true });

/** mulberry32: klein, schnell, geseedet; fuer Testbilder genuegt das. */
function zufall(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pruefe(pfad, breite, hoehe, unten, oben) {
	if (breite * hoehe > FOTO_MAX_PIXEL)
		abbruch(`${pfad} hat ${breite * hoehe} Pixel, die App nimmt hoechstens ${FOTO_MAX_PIXEL}.`);
	const bytes = statSync(pfad).size;
	if (bytes > oben || bytes < unten) {
		abbruch(`${pfad} hat ${bytes} Bytes, erwartet ${unten} bis ${oben}.`);
	}
	console.log(`${pfad}: ${breite} x ${hoehe}, ${bytes} Bytes`);
}

/** Die 48 MP, aus denen alle Fassungen von gross.jpg und gross.webp entstehen. */
function verlaufMitRauschen(breite, hoehe) {
	const roh = Buffer.alloc(breite * hoehe * 3);
	const z = zufall(48);
	for (let y = 0; y < hoehe; y++) {
		for (let x = 0; x < breite; x++) {
			const i = (y * breite + x) * 3;
			// Leichtes Rauschen (+-6): Ein glatter Verlauf schrumpfte als JPEG auf einen Bruchteil
			// und gaebe dem Dekoder kaum Arbeit; mit Rauschen sind es rund 7 MB wie bei einem Foto.
			const r = Math.floor(z() * 13) - 6;
			roh[i] = Math.min(255, Math.max(0, Math.round((x / breite) * 255) + r));
			roh[i + 1] = Math.min(255, Math.max(0, Math.round((y / hoehe) * 255) + r));
			roh[i + 2] = Math.min(255, Math.max(0, 128 + r));
		}
	}
	return roh;
}

async function grosseFotos() {
	const breite = 8000;
	const hoehe = 6000;
	const roh = verlaufMitRauschen(breite, hoehe);
	const fassungen = [
		['gross.jpg', (bild) => bild.jpeg({ quality: 90 })],
		['gross-progressiv.jpg', (bild) => bild.jpeg({ quality: 90, progressive: true, chromaSubsampling: '4:2:0' })],
		['gross-progressiv-444.jpg', (bild) => bild.jpeg({ quality: 90, progressive: true, chromaSubsampling: '4:4:4' })],
		// effort 0: Das Kodieren von 48 MP dauerte mit dem Standard (4) ein Vielfaches, und
		// fuer den Dekoder ist die Datei dieselbe Arbeit.
		['gross.webp', (bild) => bild.webp({ quality: 90, effort: 0 })],
	];
	for (const [name, kodiere] of fassungen) {
		const pfad = join(ziel, name);
		await kodiere(sharp(roh, { raw: { width: breite, height: hoehe, channels: 3 } })).toFile(pfad);
		pruefe(pfad, breite, hoehe, 0, FOTO_GRENZE);
	}
}

async function interlacedPng() {
	// Knapp unter FOTO_MAX_PIXEL (8160 x 6120 = 49 939 200) im Seitenverhaeltnis 4:3.
	const breite = 8160;
	const hoehe = 6120;
	const roh = Buffer.alloc(breite * hoehe * 4);
	for (let y = 0; y < hoehe; y++) {
		for (let x = 0; x < breite; x++) {
			const i = (y * breite + x) * 4;
			roh[i] = Math.round((x / breite) * 255);
			roh[i + 1] = Math.round((y / hoehe) * 255);
			roh[i + 2] = Math.round(((x + y) / (breite + hoehe)) * 255);
			// Durchscheinend von links nach rechts, damit flatten wirklich etwas zu tun hat.
			roh[i + 3] = 128 + Math.round((x / breite) * 127);
		}
	}
	const pfad = join(ziel, 'gross-adam7.png');
	await sharp(roh, { raw: { width: breite, height: hoehe, channels: 4 } })
		.png({ progressive: true })
		.toFile(pfad);
	pruefe(pfad, breite, hoehe, 0, FOTO_GRENZE);
}

async function grossesPng() {
	// Rauschen komprimiert nicht: Die Datei hat rund 3 Bytes je Pixel plus ein Filterbyte je
	// Zeile. 2980 x 2228 ergibt so knapp 19 MiB, mitten zwischen den Grenzen.
	const breite = 2980;
	const hoehe = 2228;
	const roh = Buffer.alloc(breite * hoehe * 3);
	const z = zufall(20);
	for (let i = 0; i < roh.length; i++) roh[i] = Math.floor(z() * 256);
	const pfad = join(ziel, 'gross.png');
	await sharp(roh, { raw: { width: breite, height: hoehe, channels: 3 } })
		.png()
		.toFile(pfad);
	pruefe(pfad, breite, hoehe, PNG_UNTERGRENZE, FOTO_GRENZE);
}

function farbe(z) {
	const kanal = () => Math.floor(z() * 256);
	return `rgb(${kanal()},${kanal()},${kanal()})`;
}

async function buntesBild(nummer) {
	const breite = 1600;
	const hoehe = 1200;
	const z = zufall(1000 + nummer);
	const formen = [];
	for (let i = 0; i < 24; i++) {
		const x = Math.floor(z() * breite);
		const y = Math.floor(z() * hoehe);
		if (z() < 0.5) {
			formen.push(`<circle cx="${x}" cy="${y}" r="${40 + Math.floor(z() * 220)}" fill="${farbe(z)}"/>`);
		} else {
			const w = 60 + Math.floor(z() * 500);
			const h = 60 + Math.floor(z() * 400);
			formen.push(`<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="${farbe(z)}"/>`);
		}
	}
	// Die Nummer gross in die Mitte: So sieht man beim Blaettern, welches Bild gerade da ist.
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${breite}" height="${hoehe}">
		<rect width="100%" height="100%" fill="${farbe(z)}"/>
		${formen.join('\n')}
		<text x="50%" y="50%" font-family="sans-serif" font-size="320" font-weight="bold" fill="#ffffff"
			stroke="#000000" stroke-width="8" text-anchor="middle" dominant-baseline="central">${nummer}</text>
	</svg>`;
	const pfad = join(ziel, `bunt-${nummer}.jpg`);
	await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(pfad);
	console.log(`${pfad}: ${breite} x ${hoehe}`);
}

await grosseFotos();
await interlacedPng();
await grossesPng();
for (let n = 1; n <= bunt; n++) await buntesBild(n);
