import { Injectable, signal } from '@angular/core';
import type { Id } from './typen';

/**
 * Welche Dokumente "offline verfuegbar" geschaltet sind. Nur im Speicher: der
 * Entwurf zeigt die Bedienung, speichert aber keine Dateien (Spec TP1 4.4).
 * Ein Dienst statt Bauteil-Zustand, weil "Mehr" dieselbe Liste anzeigt.
 */
@Injectable({ providedIn: 'root' })
export class OfflineAuswahl {
	readonly ids = signal<ReadonlySet<Id>>(new Set());

	umschalten(id: Id): void {
		this.ids.update((alt) => {
			const neu = new Set(alt);
			if (!neu.delete(id)) neu.add(id);
			return neu;
		});
	}
}
