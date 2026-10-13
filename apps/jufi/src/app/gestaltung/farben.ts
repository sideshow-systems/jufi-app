/**
 * Akzentfarben aus der einen Vereinsfarbe (Rahmen 5.1.1).
 *
 * Vereine geben eine Farbe ein; daraus entstehen Akzent, Akzentflaeche und
 * Text auf Akzent fuer hell und dunkel. Die Farbe wird so lange abgedunkelt
 * (hell) bzw. aufgehellt (dunkel), bis Akzent auf Flaeche und Text auf Akzent
 * WCAG AA (4,5:1) erreichen. Verworfen: die Farbe unveraendert zu nehmen und
 * schwache Kontraste anzumahnen — Vereinsfarben wie Gelb waeren dann auf
 * weissen Karten schlicht unlesbar, und das faellt erst den Eltern auf.
 */

export const AUSGANGSFARBE = '#0f766e';

/** Die festen Flaechen, gegen die der Akzent bestehen muss. Gleiche Werte wie in styles.css. */
export const FLAECHEN = {
	hell: { seite: '#eef5f4', karte: '#ffffff' },
	dunkel: { seite: '#0e1716', karte: '#172423' },
} as const;

export interface Akzentsatz {
	akzent: string;
	akzentFlaeche: string;
	aufAkzent: string;
}

const AA = 4.5;

function rgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexAus(r: number, g: number, b: number): string {
	return (
		'#' +
		[r, g, b]
			.map((x) =>
				Math.round(Math.min(255, Math.max(0, x)))
					.toString(16)
					.padStart(2, '0'),
			)
			.join('')
	);
}

function luminanz(hex: string): number {
	const [r, g, b] = rgb(hex).map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhaeltnis zweier Hex-Farben nach WCAG 2. */
export function kontrast(a: string, b: string): number {
	const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
}

function hsl(hex: string): [number, number, number] {
	const [r, g, b] = rgb(hex).map((c) => c / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l * 100];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h * 60, s * 100, l * 100];
}

function ausHsl(h: number, s: number, l: number): string {
	const sat = s / 100;
	const hell = l / 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = sat * Math.min(hell, 1 - hell);
	const f = (n: number) => hell - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return hexAus(f(0) * 255, f(8) * 255, f(4) * 255);
}

function normiert(hex: string): string {
	const kurz = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim());
	if (kurz) return `#${kurz[1]}${kurz[1]}${kurz[2]}${kurz[2]}${kurz[3]}${kurz[3]}`.toLowerCase();
	const lang = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	return lang ? `#${lang[1].toLowerCase()}` : AUSGANGSFARBE;
}

function satz(farbe: string, modus: 'hell' | 'dunkel'): Akzentsatz {
	const flaechen = FLAECHEN[modus];
	const [h, s, l0] = hsl(farbe);
	// Die Akzentflaeche traegt leise Knoepfe mit Akzent-Schrift; sie ist deshalb
	// sehr hell bzw. sehr dunkel und zaehlt bei der Kontrastpruefung mit.
	const akzentFlaeche = modus === 'hell' ? ausHsl(h, Math.min(s, 60), 96) : ausHsl(h, Math.min(s, 40), 16);
	const reicht = (c: string) =>
		kontrast(c, flaechen.karte) >= AA && kontrast(c, flaechen.seite) >= AA && kontrast(c, akzentFlaeche) >= AA;
	let akzent = farbe;
	// In 2-Prozent-Schritten: fein genug, dass die Farbe erkennbar bleibt, und
	// nach hoechstens 50 Schritten am Ende der Skala.
	for (let l = l0; !reicht(akzent) && l >= 0 && l <= 100; l += modus === 'hell' ? -2 : 2) {
		akzent = ausHsl(h, s, l);
	}
	const dunklerTon = ausHsl(h, Math.min(s, 60), 10);
	const aufAkzent =
		modus === 'hell'
			? kontrast('#ffffff', akzent) >= AA
				? '#ffffff'
				: dunklerTon
			: kontrast(dunklerTon, akzent) >= AA
				? dunklerTon
				: '#000000';
	return { akzent, akzentFlaeche, aufAkzent };
}

export function vereinsfarben(hex: string): { hell: Akzentsatz; dunkel: Akzentsatz } {
	const farbe = normiert(hex);
	return { hell: satz(farbe, 'hell'), dunkel: satz(farbe, 'dunkel') };
}
