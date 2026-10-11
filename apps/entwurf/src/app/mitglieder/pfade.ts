import type { Datenstand, Id } from '../daten/typen';
import { threadPfad } from '../regeln/teilen';

/** Absoluter Router-Pfad eines Threads, optional mit Modul-Anker. */
export function pfadZuThread(stand: Datenstand, threadId: Id, modulId?: Id): string {
	const t = stand.threads.find((x) => x.id === threadId);
	if (!t) return `/${stand.verein.slug}/threads`;
	return threadPfad(t, stand.verein.slug) + (modulId ? `/m/${modulId}` : '');
}
