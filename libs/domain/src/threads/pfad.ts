/**
 * Adresse eines Threads: `<id>-<titel-slug>`. Der Slug ist nur zum Lesen da, die
 * ID entscheidet. Verworfen: den Titel weglassen, weil Links in Mails und im
 * Browserverlauf dann nichtssagend waeren. Verworfen: den Slug mitpruefen und bei
 * einem umbenannten Thread auf die neue Adresse umleiten, weil jeder alte Link
 * ohnehin ueber die ID aufgeht.
 */

const SLUG_LAENGE = 40;

// Umlaute werden ausgeschrieben statt zerlegt, so wie man sie von Hand schreibt.
const UMLAUTE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

function slug(titel: string): string {
	const roh = titel
		.toLowerCase()
		.replace(/[äöüß]/g, (z) => UMLAUTE[z])
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	// Nach dem Kuerzen kann ein Bindestrich am Ende stehen.
	return roh.slice(0, SLUG_LAENGE).replace(/-+$/, '');
}

export function threadSegment(id: string, titel: string): string {
	const s = slug(titel);
	return s ? `${id}-${s}` : id;
}

// Der Austausch kommt aus der Migration mit gen_random_uuid() und hat selbst
// Bindestriche; nur dort darf die ID ueber den ersten Bindestrich hinausgehen.
const UUID_ANFANG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=-|$)/;
// cuid: Kleinbuchstaben und Ziffern, bis zum ersten Bindestrich.
const CUID_ANFANG = /^[a-z0-9]+(?=-|$)/;

export function idAusSegment(segment: string): string | null {
	return UUID_ANFANG.exec(segment)?.[0] ?? CUID_ANFANG.exec(segment)?.[0] ?? null;
}
