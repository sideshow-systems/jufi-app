/**
 * Typen fuer den tiefen Import einzelner Lucide-Symbole (wie in HWYD).
 * lucide deklariert nur das Sammelbuendel; der Einzelimport aus
 * dist/esm/icons/*.mjs haelt das Buendel klein, braucht aber diese Deklaration,
 * sonst laege unter strict ein implizites any vor.
 */
declare module 'lucide/dist/esm/icons/*.mjs' {
	type LucideIconNode = [
		'circle' | 'ellipse' | 'line' | 'path' | 'polygon' | 'polyline' | 'rect',
		Record<string, string>,
	][];
	const node: LucideIconNode;
	export default node;
}
