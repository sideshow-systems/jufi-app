import type { Bezugsperson, Person, VereinDb } from '@jufi/db';
import type { PersonSicht } from '@jufi/domain';
import type { Response } from 'express';

/**
 * Alle Nicht-Entfernten und alle Zuordnungen des Vereins, so wie die Regeln in
 * libs/domain sie brauchen. Der Verein hat wenige hundert Personen; eine Abfrage
 * je Tabelle und die Entscheidung im Speicher ist einfacher und schneller als
 * je Person nachzufragen. Verworfen: die Sichtbarkeit in die Abfrage zu
 * uebersetzen -- die Regel stuende dann zweimal da, einmal als Funktion, einmal
 * als where, und beide liefen auseinander.
 *
 * Geliefert werden die ganzen Zeilen (Untertypen von PersonSicht und Zuordnung),
 * damit Aufrufer Namen und Beziehung nicht noch einmal laden.
 */
export async function ladeUmfeld(db: VereinDb): Promise<{ personen: Person[]; zuordnungen: Bezugsperson[] }> {
	const [personen, zuordnungen] = await Promise.all([
		db.person.findMany({
			where: { entferntAm: null },
			orderBy: [{ nachname: 'asc' }, { vorname: 'asc' }, { id: 'asc' }],
		}),
		db.bezugsperson.findMany(),
	]);
	return { personen, zuordnungen };
}

export function alsSicht(p: Person): PersonSicht {
	return { id: p.id, art: p.art, rechte: p.rechte, geburtsdatum: p.geburtsdatum, entferntAm: p.entferntAm };
}

/** Eine Stelle fuer den Text: Wer etwas nicht sehen darf, bekommt dieselbe Antwort wie bei etwas, das es nicht gibt. */
export function statt404(res: Response): void {
	res.status(404).json({ fehler: 'nicht gefunden' });
}
