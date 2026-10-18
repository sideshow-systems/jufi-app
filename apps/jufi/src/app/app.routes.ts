import { Routes } from '@angular/router';
import { NichtGefundenComponent } from './seiten/nicht-gefunden';
import { PlattformStartComponent } from './seiten/plattform-start';
import { mitgliedAngemeldet } from './verein/mitglied-waechter';
import { MitgliederHuelle } from './verein/mitglieder-huelle';

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
			// Die Verwaltung zeigt Rechte nur an; entschieden wird auf dem Server. Der Waechter fragt nur nach der Sitzung.
			{
				path: 'verwaltung',
				loadComponent: () => import('./verein/verwaltung/mitglieder').then((m) => m.MitgliederComponent),
				canActivate: [mitgliedAngemeldet],
			},
			{
				path: 'verwaltung/neu',
				loadComponent: () => import('./verein/verwaltung/person-neu').then((m) => m.PersonNeuComponent),
				canActivate: [mitgliedAngemeldet],
			},
			{
				path: 'verwaltung/untergruppen',
				loadComponent: () => import('./verein/verwaltung/untergruppen').then((m) => m.UntergruppenComponent),
				canActivate: [mitgliedAngemeldet],
			},
			{
				path: 'verwaltung/rechte',
				loadComponent: () => import('./verein/verwaltung/rechte').then((m) => m.RechteComponent),
				canActivate: [mitgliedAngemeldet],
			},
			{
				path: 'verwaltung/personen/:id',
				loadComponent: () => import('./verein/verwaltung/personenseite').then((m) => m.PersonenseiteComponent),
				canActivate: [mitgliedAngemeldet],
			},
			// Ziel des Waechters bei 404; unter dem Slug statt als eigener Pfad, sonst waere der Pfadname ein reservierter Verein.
			{ path: 'nicht-gefunden', component: NichtGefundenComponent },
			// Nach anmelden, einladung, zugang-verloren und nicht-gefunden: Eine leere Eltern-Route davor liesse
			// den Router erst in der Huelle suchen, und diese Seiten haben weder Huelle noch Waechter.
			// Die Verwaltung hat noch ihre eigenen Routen und bekommt eine eigene Huelle.
			{
				path: '',
				component: MitgliederHuelle,
				canActivate: [mitgliedAngemeldet],
				children: [
					{
						path: '',
						pathMatch: 'full',
						loadComponent: () => import('./verein/start').then((m) => m.StartComponent),
					},
					{
						path: 'mehr',
						loadComponent: () => import('./verein/mehr').then((m) => m.MehrComponent),
					},
					{
						path: 'profil',
						loadComponent: () => import('./verein/profil').then((m) => m.ProfilComponent),
					},
					// Spec 2.4: meine-jungfischer statt jungfischer. Der alte Pfad war nie ausgeliefert, darum keine Weiterleitung.
					{
						path: 'meine-jungfischer',
						loadComponent: () => import('./verein/jungfischer').then((m) => m.JungfischerComponent),
					},
				],
			},
		],
	},
	{ path: '**', component: NichtGefundenComponent },
];
