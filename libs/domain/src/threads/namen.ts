import type { Beziehung } from '../personen.js';
import { istJugendleiter } from '../rechte.js';
import type { Bezug, ThreadPerson, Umfeld } from './typen.js';
import { bezuegeVon } from './umfeld.js';

// Exportiert, damit die Ergebnisliste der Umfragen dasselbe Wort fuer Entfernte nimmt.
export const EHEMALIGES_MITGLIED = 'ehemaliges Mitglied';

// Die Woerter stehen hier und nicht nur in apps/jufi (verwaltung/texte.ts), weil die
// Domaene nichts aus den Apps importieren darf. ANDERE nimmt den Freitext; ohne ihn
// "Bezugsperson", denn "Andere von Max" waere kein Satz.
const BEZIEHUNG_WORT: Record<Exclude<Beziehung, 'ANDERE'>, string> = {
	MUTTER: 'Mutter',
	VATER: 'Vater',
	GROSSMUTTER: 'Großmutter',
	GROSSVATER: 'Großvater',
	TANTE: 'Tante',
	ONKEL: 'Onkel',
	GESCHWISTER: 'Geschwister',
	PFLEGEPERSON: 'Pflegeperson',
};

function beziehungWort(b: Pick<Bezug, 'beziehung' | 'beziehungFreitext'>): string {
	if (b.beziehung !== 'ANDERE') return BEZIEHUNG_WORT[b.beziehung];
	return b.beziehungFreitext?.trim() || 'Bezugsperson';
}

// "Lena M.": Kinder und Eltern kennen sich, der volle Nachname ist in einem Thread
// unnoetig und gibt am Handy nur Breite her. Das erste Zeichen als Codepunkt, damit
// ein Umlaut oder Emoji nicht in der Mitte zerbricht.
export function kurzname(p: Pick<ThreadPerson, 'vorname' | 'nachname'>): string {
	const anfang = Array.from(p.nachname.trim())[0];
	return anfang ? `${p.vorname} ${anfang.toLocaleUpperCase('de')}.` : p.vorname;
}

// "Lena", "Lena und Max", "Lena, Max und 1 weiteren". Ab drei Namen wird gekuerzt,
// damit die Zeile bei einer grossen Familie nicht den Kommentar verdraengt.
function kinderListe(vornamen: readonly string[]): string {
	if (vornamen.length <= 2) return vornamen.join(' und ');
	const weitere = vornamen.length - 2;
	return `${vornamen[0]}, ${vornamen[1]} und ${weitere} weiteren`;
}

// Spec 3.10. Jugendleiter vor Bezugsperson: wer beides ist, tritt als Jugendleiter auf
// (der Thread zeigt dann nicht, wessen Kind er ist). Wer nicht im Umfeld steht, ist
// entfernt oder unbekannt und heisst fuer alle gleich, damit die Antwort nichts ueber
// den Grund verraet.
export function absenderName(autorId: string | null, umfeld: Umfeld): string {
	const autor = autorId === null ? undefined : umfeld.personen.get(autorId);
	if (!autor) return EHEMALIGES_MITGLIED;
	if (istJugendleiter(autor)) return `${kurzname(autor)} (Jugendleiter)`;
	if (autor.art === 'JUNGFISCHER') return kurzname(autor);
	const bezuege = bezuegeVon(umfeld, autor.id);
	if (bezuege.length === 0) return kurzname(autor);
	// Die Beziehung zum ersten Kind nach Vorname steht fuer alle: bei gemischten
	// Beziehungen ("Mutter von A, Tante von B") wuerde die Zeile unlesbar.
	const wort = beziehungWort(bezuege[0].bezug);
	return `${kurzname(autor)} (${wort} von ${kinderListe(bezuege.map((b) => b.kind.vorname))})`;
}

// Spec 3.3, die Zeile unter einer eigenen Antwort. null heisst: nichts anzeigen, weil
// jemand fuer sich selbst geantwortet hat. Der Betrachter wird vor der Beziehung
// geprueft, damit "von dir" auch dann gilt, wenn er dem Kind zugeordnet ist.
export function eingetragenVon(vonId: string, fuerId: string, betrachterId: string, umfeld: Umfeld): string | null {
	if (vonId === fuerId) return null;
	if (vonId === betrachterId) return 'von dir eingetragen';
	const von = umfeld.personen.get(vonId);
	if (!von) return 'eingetragen von ehemaligem Mitglied';
	const bezug = umfeld.zuordnungen.find((z) => z.erwachsenerId === vonId && z.jungfischerId === fuerId);
	if (bezug) return `eingetragen von ${beziehungWort(bezug)} ${von.vorname}`;
	return `eingetragen von ${kurzname(von)}`;
}
