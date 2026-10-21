import { DestroyRef, effect, type Injector, type Signal, signal, untracked } from '@angular/core';

/** Anlaesse binnen dieser Zeit ergeben ein Neuladen: Ein Abgleich nach dem Wiederverbinden bringt oft mehrere auf einmal. */
const ENTPRELLEN_MS = 250;

/**
 * Laedt eine Ressource auf Anlass neu, ohne einen Anlass zu verlieren (Entscheidung 10). reload() ist
 * waehrend einer laufenden Anfrage wirkungslos; kaeme ein Signal genau dann, zeigte die Seite die
 * Antwort von davor, bis zum naechsten Anlass (Rueckstand M2). Deshalb merkt sich der Nachlader den
 * Anlass und laedt nach dem Ende der Anfrage genau einmal neu. Verworfen: reload() direkt aufrufen
 * (eben jener Verlust) und die laufende Anfrage abbrechen und neu stellen (bei vielen Signalen kaeme
 * die Ressource nie zu einer Antwort).
 *
 * Der Zeitgeber laeuft nur, wenn es einen Anlass gibt; im Server-Rendering kommt keiner, denn dort
 * verbindet sich Echtzeit nicht.
 */
export function nachlader(r: { isLoading: Signal<boolean>; reload(): boolean }, injector: Injector): () => void {
	let zeitgeber: ReturnType<typeof setTimeout> | null = null;
	const vorgemerkt = signal(false);

	effect(
		() => {
			if (!vorgemerkt() || r.isLoading()) return;
			vorgemerkt.set(false);
			untracked(() => r.reload());
		},
		{ injector },
	);

	injector.get(DestroyRef).onDestroy(() => {
		if (zeitgeber !== null) clearTimeout(zeitgeber);
	});

	return () => {
		if (zeitgeber !== null) return;
		zeitgeber = setTimeout(() => {
			zeitgeber = null;
			// Ohne laufende Anfrage sofort, statt auf den naechsten Durchlauf der Effekte zu warten.
			if (r.isLoading()) vorgemerkt.set(true);
			else r.reload();
		}, ENTPRELLEN_MS);
	};
}
