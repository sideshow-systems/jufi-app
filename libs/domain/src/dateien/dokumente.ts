// Spec 3.1. Beim Anlegen eines Vereins entstehen sie in dieser Reihenfolge; Kategorien behalten ihre Handreihenfolge.
export const STANDARD_KATEGORIEN = ['Ordnungen', 'Merkblätter', 'Formulare'] as const;

const KATEGORIE_MAX = 40;
const TITEL_MAX = 120;

function pruefeText(roh: string, was: string, max: number): { ok: true; wert: string } | { ok: false; fehler: string } {
	const wert = roh.trim();
	if (wert === '') return { ok: false, fehler: `${was} darf nicht leer sein` };
	// Codepoints, damit ein Emoji als ein Zeichen zaehlt, wie die Person es sieht.
	if (Array.from(wert).length > max) return { ok: false, fehler: `${was} darf höchstens ${max} Zeichen haben` };
	return { ok: true, wert };
}

export function pruefeKategorieName(roh: string): { ok: true; name: string } | { ok: false; fehler: string } {
	const r = pruefeText(roh, 'Der Name', KATEGORIE_MAX);
	return r.ok ? { ok: true, name: r.wert } : r;
}

export function pruefeDokumentTitel(roh: string): { ok: true; titel: string } | { ok: false; fehler: string } {
	const r = pruefeText(roh, 'Der Titel', TITEL_MAX);
	return r.ok ? { ok: true, titel: r.wert } : r;
}

// Alphabetisch statt in Handreihenfolge (Plan, Entscheidung 4): Eine Handreihenfolge
// braeuchte je Kategorie eine Sortier-Oberflaeche, und alphabetisch findet man schneller.
// localeCompare mit 'de' statt Codepoint-Vergleich, sonst stuende "Ärzte" hinter "Zeltlager"
// und jeder Grossbuchstabe vor jedem Kleinbuchstaben.
export function sortiereDokumente<T extends { titel: string }>(liste: readonly T[]): T[] {
	return [...liste].sort((a, b) => a.titel.localeCompare(b.titel, 'de'));
}
