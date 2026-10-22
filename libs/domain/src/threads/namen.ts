import { undListe } from '../dateien/medien.js';
import { type EinwilligungZeile, fotoEinwilligungGilt } from '../einwilligung.js';
import type { Beziehung } from '../personen.js';
import { istJugendleiter } from '../rechte.js';
import { kinderImThread } from './sichtbarkeit.js';
import type { Bezug, ThreadDaten, ThreadKopf, ThreadPerson, Umfeld } from './typen.js';
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

// Wer in einem Thread nicht auf Fotos gezeigt werden darf: die Kinder seiner Zielgruppe ohne
// gueltige Foto-Einwilligung (bei Volljaehrigen die eigene, siehe fotoEinwilligungGilt). Mit
// einer Teilnahme-Umfrage zaehlen nur die, die dabei sind -- wer absagt, steht auf keinem
// Foto der Veranstaltung, und ein Hinweis auf ihn waere Laerm. Verworfen: alle Kinder des
// Vereins, weil der Hinweis dann auch Kinder nennte, die den Thread gar nicht sehen.
// Die Einwilligungen kommen als Wert vom Aufrufer, damit die Regel ohne Datenbank laeuft.
export function ohneFotoEinwilligung(
	kopf: ThreadKopf,
	umfeld: Umfeld,
	e: { fotoEinwilligungen: ReadonlyMap<string, readonly EinwilligungZeile[]>; dabei: ReadonlySet<string> | null },
	jetzt: Date,
): ThreadPerson[] {
	return kinderImThread(kopf, umfeld)
		.filter((kind) => e.dabei === null || e.dabei.has(kind.id))
		.filter(
			(kind) =>
				!fotoEinwilligungGilt(
					kind,
					e.fotoEinwilligungen.get(kind.id) ?? [],
					umfeld.personen,
					umfeld.zuordnungen,
					jetzt,
				),
		)
		.sort((a, b) => kurzname(a).localeCompare(kurzname(b), 'de'));
}

// Die Kinder, die laut Teilnahme-Umfrage dabei sind. Die Option wird am Schluessel erkannt,
// nicht am Text: der Ersteller darf "Dabei" umbenennen (wie bei den Emojis in teilen.ts).
// null heisst "keine Auskunft" und ist etwas anderes als eine leere Menge: ohne Umfrage sind
// alle gemeint, mit Umfrage ohne Zusagen niemand. Fehlt der Schluessel (der Ersteller hat die
// Option geloescht), gibt es ebenfalls keine Auskunft statt "niemand", damit der Hinweis nicht
// leise verschwindet.
export function dabeiKinder(daten: Pick<ThreadDaten, 'umfragen'>): ReadonlySet<string> | null {
	const umfrage = daten.umfragen.find((u) => u.teilnahme);
	const option = umfrage?.optionen.find((o) => o.schluessel === 'dabei');
	if (!umfrage || !option) return null;
	return new Set(umfrage.antworten.filter((a) => a.optionIds.includes(option.id)).map((a) => a.fuerId));
}

// Der Satz ueber dem Foto-Modul. Sortiert wird hier noch einmal, damit die Reihenfolge
// nicht davon abhaengt, wer die Liste bildet. null bei leerer Liste: dann gibt es nichts zu sagen.
export function fotoHinweis(personen: readonly ThreadPerson[]): string | null {
	if (personen.length === 0) return null;
	const namen = personen.map(kurzname).sort((a, b) => a.localeCompare(b, 'de'));
	return `Von ${undListe(namen)} dürfen keine Fotos gezeigt werden`;
}
