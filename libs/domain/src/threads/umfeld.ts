import type { Bezug, ThreadPerson, Umfeld } from './typen.js';

// Vorname, dann Nachname, dann ID: eine feste Reihenfolge, damit Aufzaehlungen
// ("Lena und Max") und das "erste Kind" nicht von der Lade-Reihenfolge abhaengen.
export function nachVorname(a: ThreadPerson, b: ThreadPerson): number {
	return (
		a.vorname.localeCompare(b.vorname, 'de') || a.nachname.localeCompare(b.nachname, 'de') || a.id.localeCompare(b.id)
	);
}

// Entfernte Personen kommen nicht ins Umfeld, und mit ihnen faellt jede Zuordnung und
// Mitgliedschaft weg. So muss keine Regel einzeln an "entfernt" denken; wer fehlt, ist
// fuer alle gleich "ehemaliges Mitglied". Verworfen: Entfernte im Umfeld lassen und in
// jeder Regel filtern, weil die vergessene Stelle ein Kind zeigen oder zaehlen wuerde.
export function baueUmfeld(
	personen: readonly ThreadPerson[],
	zuordnungen: readonly Bezug[],
	mitgliedschaften: readonly { personId: string; untergruppeId: string }[],
): Umfeld {
	const aktive = new Map(personen.filter((p) => !p.entferntAm).map((p) => [p.id, p]));
	const untergruppenVon = new Map<string, Set<string>>();
	for (const m of mitgliedschaften) {
		if (!aktive.has(m.personId)) continue;
		const menge = untergruppenVon.get(m.personId) ?? new Set<string>();
		menge.add(m.untergruppeId);
		untergruppenVon.set(m.personId, menge);
	}
	return {
		personen: aktive,
		zuordnungen: zuordnungen.filter((z) => aktive.has(z.erwachsenerId) && aktive.has(z.jungfischerId)),
		untergruppenVon,
	};
}

// Die Bezuege eines Erwachsenen mit dem jeweiligen Kind, nach Vorname des Kindes.
// Gemeinsame Grundlage fuer kinderVon und die Beziehungsangabe in Namen.
export function bezuegeVon(umfeld: Umfeld, erwachsenerId: string): { kind: ThreadPerson; bezug: Bezug }[] {
	const treffer: { kind: ThreadPerson; bezug: Bezug }[] = [];
	for (const bezug of umfeld.zuordnungen) {
		if (bezug.erwachsenerId !== erwachsenerId) continue;
		const kind = umfeld.personen.get(bezug.jungfischerId);
		if (kind) treffer.push({ kind, bezug });
	}
	return treffer.sort((a, b) => nachVorname(a.kind, b.kind));
}

// Zugeordnet heisst: Erziehungsberechtigung und Alter zaehlen nicht (TP2 5.6), auch
// Grosseltern und volljaehrig gewordene Kinder bleiben die Kinder ihrer Bezugsperson.
export function kinderVon(umfeld: Umfeld, erwachsenerId: string): ThreadPerson[] {
	return bezuegeVon(umfeld, erwachsenerId).map((t) => t.kind);
}
