import { InjectionToken } from '@angular/core';
import { Subject } from 'rxjs';
import type { Id } from './typen';

/**
 * Was der Testmodus pruefen muss, aber nicht im Datenstand steht: ein
 * Dokument geoeffnet, ein Foto gross angesehen, geteilt, eine Einladung
 * erzeugt (Spec TP1 5.3). Die Bildschirme melden es hier, der Testmodus hoert zu.
 */
export type Testereignis =
	| { art: 'dokumentGeoeffnet'; id: Id }
	| { art: 'fotoGeoeffnet'; threadId: Id; fotoId: Id }
	| { art: 'geteilt'; threadId: Id }
	| { art: 'einladungErzeugt'; personId: Id };

export const TESTEREIGNISSE = new InjectionToken<Subject<Testereignis>>('TESTEREIGNISSE', {
	providedIn: 'root',
	factory: () => new Subject<Testereignis>(),
});
