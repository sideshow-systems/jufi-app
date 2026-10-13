import { Routes } from '@angular/router';
import { NichtGefundenComponent } from './seiten/nicht-gefunden';
import { PlattformStartComponent } from './seiten/plattform-start';
import { VereinStartComponent } from './seiten/verein-start';

/**
 * Der erste Pfadteil ist der Verein. '' gehoert der Plattform; reservierte Namen
 * wie admin oder entwurf faengt der Server vor dem Router ab (Spec 2.4).
 */
export const routes: Routes = [
	{ path: '', component: PlattformStartComponent, pathMatch: 'full' },
	{ path: ':slug', component: VereinStartComponent },
	{ path: '**', component: NichtGefundenComponent },
];
