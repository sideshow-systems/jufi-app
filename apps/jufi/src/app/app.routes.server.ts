import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Alles clientseitig rendern.
 *
 * Die App liegt hinter einer Anmeldung, und Suchmaschinen sollen sie nicht
 * sehen -- SSR braechte keinen Gegenwert, aber Hydration-Fehler und
 * isPlatformBrowser-Pruefungen um jeden Browserzugriff. Vom Server-Teil wird
 * ausschliesslich die API genutzt.
 */
export const serverRoutes: ServerRoute[] = [
	{
		path: '**',
		renderMode: RenderMode.Client,
	},
];
