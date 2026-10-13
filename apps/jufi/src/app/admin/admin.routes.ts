import type { Routes } from '@angular/router';
import { adminAngemeldet } from './admin-waechter';

/**
 * Der Bereich /admin, nachgeladen (app.routes.ts): Admin-Seiten und qrcode sollen
 * nicht im Startbuendel der Mitglieder landen.
 *
 * anmelden und einrichten stehen vor dem Rahmen und ohne Waechter -- man kommt
 * ja gerade ohne Sitzung dorthin. Alles andere liegt im Rahmen hinter adminAngemeldet.
 */
export const ADMIN_ROUTES: Routes = [
	{ path: 'anmelden', loadComponent: () => import('./anmelden').then((m) => m.AdminAnmeldenComponent) },
	{ path: 'einrichten', loadComponent: () => import('./einrichten').then((m) => m.AdminEinrichtenComponent) },
	{
		path: '',
		loadComponent: () => import('./admin-rahmen').then((m) => m.AdminRahmenComponent),
		canActivate: [adminAngemeldet],
		children: [
			{ path: '', pathMatch: 'full', redirectTo: 'vereine' },
			{ path: 'vereine', loadComponent: () => import('./platzhalter').then((m) => m.AdminPlatzhalterComponent) },
			{ path: 'vereine/neu', loadComponent: () => import('./platzhalter').then((m) => m.AdminPlatzhalterComponent) },
			{ path: 'vereine/:id', loadComponent: () => import('./platzhalter').then((m) => m.AdminPlatzhalterComponent) },
			{ path: 'konto', loadComponent: () => import('./konto').then((m) => m.AdminKontoComponent) },
		],
	},
];
