import { type Routes, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { NichtGefundenComponent } from './seiten/nicht-gefunden';
import { PlattformStartComponent } from './seiten/plattform-start';
import { mitgliedAngemeldet } from './verein/mitglied-waechter';
import { MitgliederHuelle } from './verein/mitglieder-huelle';
import { VerwaltungHuelle } from './verein/verwaltung/huelle';
import { ungespeichertWaechter } from './verein/verwaltung/threads/ungespeichert';

/**
 * Die Router-Einstellungen gehoeren zu den Routen und stehen deshalb hier; die Tests
 * stellen mit denselben Funktionen bereit, sonst pruefen sie einen anderen Router als den echten.
 * paramsInheritanceStrategy always: withComponentInputBinding reicht slug sonst nicht an die Kinder
 * der Verwaltungs-Huelle weiter, denn eine Eltern-Route mit Komponente vererbt ihre Parameter nicht.
 * Verworfen: der Slug ueber ActivatedRoute.parent, das braeuchte jede Seite der Verwaltung.
 */
export const routerFeatures = [withComponentInputBinding(), withRouterConfig({ paramsInheritanceStrategy: 'always' })];

/**
 * Der erste Pfadteil ist der Verein. '' gehoert der Plattform; reservierte Namen
 * wie entwurf faengt der Server vor dem Router ab (Spec 2.4). admin gehoert dem
 * nachgeladenen Admin-Bereich und steht deshalb vor ':slug'.
 */
export const routes: Routes = [
	{ path: '', component: PlattformStartComponent, pathMatch: 'full' },
	// Wie admin vor ':slug' (beide Namen sind reserviert). Die Texte stehen als Markdown im Repo; Seite, Text und
	// Markdown-Parser werden mit der Route nachgeladen, das Startbuendel traegt nichts davon. Die Seite bekommt art
	// ueber data. Ohne Huelle und ohne Waechter: Sie sind ohne Anmeldung lesbar.
	{
		path: 'impressum',
		loadComponent: () => import('./seiten/rechtstext').then((m) => m.RechtstextComponent),
		data: { art: 'impressum' },
	},
	{
		path: 'datenschutz',
		loadComponent: () => import('./seiten/rechtstext').then((m) => m.RechtstextComponent),
		data: { art: 'datenschutz' },
	},
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
			// Die Verwaltung hat eine eigene Huelle (Seitenleiste) und liegt deshalb neben der Mitglieder-Huelle,
			// vor deren leerem Pfad. Sie zeigt Rechte nur an; entschieden wird auf dem Server. Der Waechter fragt nur
			// nach der Sitzung, die Huelle zeigt ohne jedes Recht Nicht gefunden. Eine Sitzung, die erst beim
			// Seitenwechsel ablaeuft, faengt jede Seite selbst ab (sitzung-abgelaufen.ts).
			{
				path: 'verwaltung',
				component: VerwaltungHuelle,
				canActivate: [mitgliedAngemeldet],
				children: [
					{
						path: '',
						pathMatch: 'full',
						loadComponent: () => import('./verein/verwaltung/mitglieder').then((m) => m.MitgliederComponent),
					},
					{
						path: 'neu',
						loadComponent: () => import('./verein/verwaltung/person-neu').then((m) => m.PersonNeuComponent),
					},
					{
						path: 'personen/:id',
						loadComponent: () => import('./verein/verwaltung/personenseite').then((m) => m.PersonenseiteComponent),
					},
					// threads/neu vor threads/:id, sonst waere "neu" eine Thread-ID.
					{
						path: 'threads',
						loadComponent: () => import('./verein/verwaltung/threads/liste').then((m) => m.ThreadListeComponent),
					},
					{
						path: 'threads/neu',
						loadComponent: () => import('./verein/verwaltung/threads/editor').then((m) => m.ThreadEditorComponent),
						canDeactivate: [ungespeichertWaechter],
					},
					{
						path: 'threads/:id',
						loadComponent: () => import('./verein/verwaltung/threads/editor').then((m) => m.ThreadEditorComponent),
						canDeactivate: [ungespeichertWaechter],
					},
					{
						path: 'threads/:id/antworten',
						loadComponent: () =>
							import('./verein/verwaltung/threads/antworten').then((m) => m.ThreadAntwortenComponent),
					},
					{
						path: 'untergruppen',
						loadComponent: () => import('./verein/verwaltung/untergruppen').then((m) => m.UntergruppenComponent),
					},
					{
						path: 'rechte',
						loadComponent: () => import('./verein/verwaltung/rechte').then((m) => m.RechteComponent),
					},
					{
						path: 'einstellungen',
						loadComponent: () => import('./verein/verwaltung/einstellungen').then((m) => m.EinstellungenComponent),
					},
				],
			},
			// Ziel des Waechters bei 404; unter dem Slug statt als eigener Pfad, sonst waere der Pfadname ein reservierter Verein.
			{ path: 'nicht-gefunden', component: NichtGefundenComponent },
			// Nach anmelden, einladung, zugang-verloren und nicht-gefunden: Eine leere Eltern-Route davor liesse
			// den Router erst in der Huelle suchen, und diese Seiten haben weder Huelle noch Waechter.
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
						path: 'threads',
						loadComponent: () => import('./verein/threads/thread-liste').then((m) => m.ThreadListeComponent),
					},
					{
						path: 'termine',
						loadComponent: () => import('./verein/termine').then((m) => m.TermineComponent),
					},
					{
						path: 'profil',
						loadComponent: () => import('./verein/profil').then((m) => m.ProfilComponent),
					},
					// Spec 6.2: zwei Routen statt einer optionalen Endung, weil die Segmente des Router-Pfads nicht
					// optional sein koennen; beide laden dieselbe Seite, die Eingaenge kommen aus den Parametern.
					{
						path: 't/:segment',
						loadComponent: () => import('./verein/threads/thread-seite').then((m) => m.ThreadSeite),
					},
					{
						path: 't/:segment/m/:modulId',
						loadComponent: () => import('./verein/threads/thread-seite').then((m) => m.ThreadSeite),
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
