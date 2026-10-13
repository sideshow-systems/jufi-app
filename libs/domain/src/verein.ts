import { pruefeSlug, type SlugPruefung } from './slug.js';

// Der Demo-Verein (pnpm run demo) ist ueber seine Adresse erreichbar, soll aber
// weder neu angelegt noch durch eine Slug-Korrektur erreicht werden: Die CLI loescht
// und baut ihn bei jedem Lauf neu auf, ein echter Verein darunter ginge verloren.
// Deshalb sperrt nur pruefeNeuenSlug den Namen; pruefeSlug (Routing) laesst ihn durch.
export const DEMO_SLUG = 'demo';

export function pruefeNeuenSlug(slug: string): SlugPruefung {
	const ergebnis = pruefeSlug(slug);
	if (!ergebnis.ok) return ergebnis;
	if (slug === DEMO_SLUG) return { ok: false, grund: 'reserviert' };
	return ergebnis;
}

export const SLUG_HINWEIS: Record<'format' | 'laenge' | 'reserviert', string> = {
	format: 'Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche',
	laenge: '3 bis 30 Zeichen',
	reserviert: 'Dieser Slug ist reserviert',
};

const SLUG_MAX = 30;

// Vorschlag fuers Formular, der Mensch darf ihn ueberschreiben. Umlaute werden
// ausgeschrieben (ae/oe/ue/ss) statt gestrichen, weil "jungfischer-ueber" lesbarer ist
// als "jungfischer-uber"; erst danach entfernt NFD uebrige Akzente (Cafe, Elan).
// Besteht das Ergebnis die Pruefung nicht, kommt '' statt eines halben Vorschlags:
// Ein Vorschlag, den der Server ohnehin ablehnt, waere schlimmer als keiner.
export function slugVorschlag(anzeigename: string): string {
	const slug = anzeigename
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_MAX)
		.replace(/-+$/, '');
	return pruefeNeuenSlug(slug).ok ? slug : '';
}

export function normalisiereFarbe(s: string): string {
	return s.trim().toLowerCase();
}

// Nur die lange Kleinschreibform: Eine einzige Schreibweise in der Datenbank, damit
// der CHECK der Migration und diese Regel dasselbe Muster haben.
export function pruefeFarbe(s: string): boolean {
	return /^#[0-9a-f]{6}$/.test(s);
}

function laengeImBereich(s: string, min: number, max: number): boolean {
	const n = [...s.trim()].length;
	return n >= min && n <= max;
}

// Der Anzeigename steht in der kleinen Kopfzeile der App, daher kurz.
export function pruefeAnzeigename(s: string): boolean {
	return laengeImBereich(s, 1, 24);
}

export function pruefeVereinsname(s: string): boolean {
	return laengeImBereich(s, 1, 120);
}
