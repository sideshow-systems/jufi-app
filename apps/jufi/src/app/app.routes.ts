import { Routes } from '@angular/router';
import { NichtGefundenComponent } from './seiten/nicht-gefunden';
import { PlattformStartComponent } from './seiten/plattform-start';
import { VereinStartComponent } from './seiten/verein-start';

/**
 * Der erste Pfadteil ist der Verein. '' gehoert der Plattform; reservierte Namen
 * wie entwurf faengt der Server vor dem Router ab (Spec 2.4). admin gehoert dem
 * nachgeladenen Admin-Bereich und steht deshalb vor ':slug'.
 */
export const routes: Routes = [
	{ path: '', component: PlattformStartComponent, pathMatch: 'full' },
	// Vor ':slug', sonst waere "admin" ein Vereinsname. Nachgeladen, damit Admin-Seiten
	// und qrcode nicht im Startbuendel der Mitglieder liegen.
	{ path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
	{ path: ':slug', component: VereinStartComponent },
	{ path: '**', component: NichtGefundenComponent },
];
