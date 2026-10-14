import { Routes } from '@angular/router';
import { NichtGefundenComponent } from './seiten/nicht-gefunden';
import { PlattformStartComponent } from './seiten/plattform-start';
import { VereinStartComponent } from './seiten/verein-start';
import { mitgliedAngemeldet } from './verein/mitglied-waechter';

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
	// Ohne component, damit die Kinder den Slug erben (der Waechter liest ihn aus den
	// Parametern). Die Seiten der Mitglieder werden einzeln nachgeladen.
	{
		path: ':slug',
		children: [
			{ path: '', component: VereinStartComponent, pathMatch: 'full', canActivate: [mitgliedAngemeldet] },
			{
				path: 'anmelden',
				loadComponent: () => import('./verein/anmelden').then((m) => m.AnmeldenComponent),
			},
			{
				path: 'einladung',
				loadComponent: () => import('./verein/einladung').then((m) => m.EinladungComponent),
			},
			{
				path: 'zugang-verloren',
				loadComponent: () => import('./verein/zugang-verloren').then((m) => m.ZugangVerlorenComponent),
			},
			{
				path: 'profil',
				loadComponent: () => import('./verein/platzhalter').then((m) => m.PlatzhalterProfilComponent),
				canActivate: [mitgliedAngemeldet],
			},
			// Ziel des Waechters bei 404; unter dem Slug statt als eigener Pfad, sonst waere der Pfadname ein reservierter Verein.
			{ path: 'nicht-gefunden', component: NichtGefundenComponent },
		],
	},
	{ path: '**', component: NichtGefundenComponent },
];
