import { InjectionToken } from '@angular/core';
import { Subject } from 'rxjs';
import type { Id } from './typen';

/**
 * Was der Testmodus pruefen muss, aber nicht im Datenstand steht: ein
 * Dokument geoeffnet, ein Foto gross angesehen, geteilt, eine Einladung
 * erzeugt (Spec TP1 5.3), einen Termin in den Kalender eingetragen. Die
 * Bildschirme melden es hier, der Testmodus hoert zu.
 */
export type Testereignis =
	| { art: 'dokumentGeoeffnet'; id: Id }
	/** Erst beim Schliessen der Grossansicht gemeldet (siehe FotosBauteil). */
	| { art: 'fotoGeoeffnet'; threadId: Id; fotoId: Id }
	| { art: 'geteilt'; threadId: Id }
	| { art: 'einladungErzeugt'; personId: Id }
	| { art: 'kalenderEingetragen'; threadId: Id; modulId: Id; weg: 'ics' | 'google' };

export const TESTEREIGNISSE = new InjectionToken<Subject<Testereignis>>('TESTEREIGNISSE', {
	providedIn: 'root',
	factory: () => new Subject<Testereignis>(),
});
