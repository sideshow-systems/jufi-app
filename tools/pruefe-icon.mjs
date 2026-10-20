#!/usr/bin/env node
//
// Prueft ein Initialen-Icon (PNG von stdin): richtige Groesse, und es sind
// Buchstaben darauf. Aufruf: node tools/pruefe-icon.mjs <groesse> < icon.png
//
// Gemessen wird der Anteil der Pixel, die vom Pixel in der Ecke (0, 0) abweichen
// (Summe der Kanalabstaende > 40). Die Ecke ist die Vereinsfarbe, denn die
// Initialen sitzen in der Mitte. Zwei Schranken:
//   - bis 3 %: einfarbige Flaeche -- die Schrift fehlt und es gab
//     kein Ersatzzeichen, der Fehler bliebe sonst unsichtbar.
//   - ab 60 %: kein Buchstabenbild mehr, sondern eine Flaeche voller Kaestchen
//     oder Rauschen.
// Verworfen: ein Vergleich mit einem Referenzbild. Das braeche bei jeder
// Schrift- oder Farbaenderung und prueft mehr, als hier gefragt ist.
//
// Das ist nur die eine Haelfte: fehlt die Schrift und fontconfig greift auf eine
// andere zurueck, zeichnet das Bild trotzdem Buchstaben -- nur falsche. Tofu
// (Kaestchen) hat ebenfalls Kontrast und passiert die Schranken. Die andere
// Haelfte ist deshalb `fc-match` im Image (tools/deploy.sh, Tor 4).

import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const MIN_ANTEIL = 0.03;
const MAX_ANTEIL = 0.6;
const SCHWELLE = 40;

const groesse = Number(process.argv[2]);
if (!Number.isInteger(groesse) || groesse <= 0) {
	console.error('Aufruf: node tools/pruefe-icon.mjs <groesse> < icon.png');
	process.exit(2);
}

try {
	const bild = sharp(readFileSync(0));
	const { data, info } = await bild.removeAlpha().raw().toBuffer({ resolveWithObject: true });
	if (info.width !== groesse || info.height !== groesse) {
		console.error(`Icon ist ${info.width} x ${info.height}, erwartet ${groesse} x ${groesse}.`);
		process.exit(1);
	}
	const k = info.channels;
	const [r0, g0, b0] = [data[0], data[1], data[2]];
	let abweichend = 0;
	for (let i = 0; i < data.length; i += k) {
		if (Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0) > SCHWELLE) abweichend++;
	}
	const anteil = abweichend / (info.width * info.height);
	const text = `${info.width} x ${info.height}, ${(anteil * 100).toFixed(1)} % Zeichen`;
	if (anteil <= MIN_ANTEIL) {
		console.error(`${text}: keine Zeichen (Schrift fehlt?).`);
		process.exit(1);
	}
	if (anteil >= MAX_ANTEIL) {
		console.error(`${text}: zu viele abweichende Pixel (Kaestchen oder Rauschen?).`);
		process.exit(1);
	}
	console.log(text);
} catch (fehler) {
	console.error(`Kein lesbares PNG: ${fehler instanceof Error ? fehler.message : fehler}`);
	process.exit(1);
}
