// Pfade und Dateien auf oberster Ebene der Plattform (Spec 2.4). Ein Verein darf
// sich nicht so nennen, sonst wuerde seine Adresse eine Plattformseite verdecken.
// favicon.ico und robots.txt scheitern am Format ohnehin (Punkt), stehen aber in
// der Liste, weil sie auf oberster Ebene der Plattform gehoeren; die Liste soll
// vollstaendig sein, statt sich auf das Format zu verlassen.
export const RESERVIERTE_SLUGS: readonly string[] = [
	'admin',
	'api',
	'entwurf',
	'assets',
	'impressum',
	'datenschutz',
	'healthz',
	'favicon.ico',
	'robots.txt',
];

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 30;

export type SlugPruefung = { ok: true } | { ok: false; grund: 'format' | 'laenge' | 'reserviert' };

// Reihenfolge Format, Laenge, Reserviert: Die Laenge ist nur fuer gueltig
// geformte Slugs eine sinnvolle Rueckmeldung ("" ist ein Formatfehler, kein
// "zu kurz"), und "reserviert" erst, wenn der Name sonst gueltig waere.
export function pruefeSlug(slug: string): SlugPruefung {
	if (!SLUG_FORMAT.test(slug)) return { ok: false, grund: 'format' };
	if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return { ok: false, grund: 'laenge' };
	if (RESERVIERTE_SLUGS.includes(slug)) return { ok: false, grund: 'reserviert' };
	return { ok: true };
}
