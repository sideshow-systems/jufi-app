import type { Datenstand, Id, Person, Recht } from '../daten/typen';

/** Rollen sind nur Vorlagen fuer die Haekchen; gespeichert werden Einzelrechte (Rahmen 4.2). */
export const ROLLEN_VORLAGEN: Record<'leitung' | 'jugendleiter' | 'betreuer', Recht[]> = {
	leitung: [
		'mitglieder',
		'threadsErstellen',
		'alleThreads',
		'dokumente',
		'antwortenDetail',
		'rechteVerwalten',
		'einstellungen',
	],
	jugendleiter: ['mitglieder', 'threadsErstellen', 'alleThreads', 'dokumente', 'antwortenDetail'],
	betreuer: ['antwortenDetail'],
};

export function person(stand: Datenstand, id: Id): Person | undefined {
	return stand.personen.find((p) => p.id === id);
}

export function kinderVon(stand: Datenstand, id: Id): Person[] {
	const ids = stand.elternschaften.filter((e) => e.elternteil === id).map((e) => e.kind);
	return stand.personen.filter((p) => ids.includes(p.id));
}

export function elternVon(stand: Datenstand, kindId: Id): Person[] {
	const ids = stand.elternschaften.filter((e) => e.kind === kindId).map((e) => e.elternteil);
	return stand.personen.filter((p) => ids.includes(p.id));
}

/**
 * Jugendleiter ist, wer mindestens ein Recht hat. Ein eigenes Rollenfeld gibt
 * es nicht: so kann ein Elternteil zugleich Jugendleiter sein (Rahmen 3.3),
 * ohne dass zwei Angaben auseinanderlaufen.
 */
export function istJugendleiter(p: Person): boolean {
	return p.rechte.length > 0;
}

export function darf(p: Person, recht: Recht): boolean {
	return p.rechte.includes(recht);
}

/** Das Recht, Rechte zu verwalten, darf dem letzten Inhaber nicht entzogen werden (Rahmen 4.2). */
export function kannRechtEntziehen(stand: Datenstand, personId: Id, recht: Recht): boolean {
	if (recht !== 'rechteVerwalten') return true;
	return stand.personen.some((p) => p.id !== personId && darf(p, 'rechteVerwalten'));
}
