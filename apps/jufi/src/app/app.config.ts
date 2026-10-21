import { HttpXhrBackend, provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { routerFeatures, routes } from './app.routes';
import { chunkFehlerHandler } from './chunk-fehler';
import { HOCHLADE_BACKEND } from './verein/dateien-api';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		// Der Handler steht hier und nicht in routerFeatures: Die Tests stellen den Router mit routerFeatures
		// bereit und sollen nie die Seite neu laden. Die Konfiguration gilt auch auf dem Server; dort fehlt
		// sessionStorage, und der Handler laedt dann nicht neu (try/catch in chunk-fehler.ts).
		provideRouter(routes, ...routerFeatures, withNavigationErrorHandler(chunkFehlerHandler())),
		provideHttpClient(withFetch()),
		{ provide: HOCHLADE_BACKEND, useClass: HttpXhrBackend },
	],
};
