import type { Datenstand, Modul, Thread } from '../daten/typen';

/** Kleine Helfer fuer die Regel-Tests; nicht im ausgelieferten Code benutzt. */
export const threadVon = (stand: Datenstand, id: string): Thread => stand.threads.find((t) => t.id === id)!;

export const modulVon = <X extends Modul>(stand: Datenstand, threadId: string, modulId: string): X =>
	threadVon(stand, threadId).module.find((m) => m.id === modulId) as X;

/** Liefert eine Kopie des Stands, in der fn ein Modul veraendert hat. */
export function mitModul<X extends Modul>(
	stand: Datenstand,
	threadId: string,
	modulId: string,
	fn: (m: X) => X,
): Datenstand {
	return {
		...stand,
		threads: stand.threads.map((t) =>
			t.id !== threadId ? t : { ...t, module: t.module.map((m) => (m.id === modulId ? fn(m as X) : m)) },
		),
	};
}
