import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { antwortenRouten } from './antworten.js';
import { lesenRouten } from './lesen.js';
import { verlaufRouten } from './verlauf.js';

/**
 * Haengt die Thread-Routen ein; jede Datei registriert ihre eigenen. Alle haengen direkt
 * am Router: routenAus lehnt Unter-Router ab.
 */
export function threadRouten(router: Router, deps: VolleAppDeps): void {
	lesenRouten(router, deps);
	verlaufRouten(router, deps);
	antwortenRouten(router, deps);
}
