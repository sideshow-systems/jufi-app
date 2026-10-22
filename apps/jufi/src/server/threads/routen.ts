import type { Router } from 'express';
import type { VolleAppDeps } from '../abhaengigkeiten.js';
import { antwortenRouten } from './antworten.js';
import { autoRouten } from './autos.js';
import { helferRouten } from './helfer.js';
import { lesenRouten } from './lesen.js';
import { listeRouten } from './liste.js';
import { mitfahrtRouten } from './mitfahrten.js';
import { schreibenRouten } from './schreiben.js';
import { syncRouten } from './sync.js';
import { verlaufRouten } from './verlauf.js';
import { verwaltenRouten } from './verwalten.js';
import { verwaltungRouten } from './verwaltung.js';

/**
 * Haengt die Thread-Routen ein; jede Datei registriert ihre eigenen. Alle haengen direkt
 * am Router: routenAus lehnt Unter-Router ab.
 */
export function threadRouten(router: Router, deps: VolleAppDeps): void {
	lesenRouten(router, deps);
	listeRouten(router, deps);
	verlaufRouten(router, deps);
	antwortenRouten(router, deps);
	helferRouten(router, deps);
	autoRouten(router, deps);
	mitfahrtRouten(router, deps);
	verwaltungRouten(router, deps);
	schreibenRouten(router, deps);
	verwaltenRouten(router, deps);
	syncRouten(router, deps);
}
