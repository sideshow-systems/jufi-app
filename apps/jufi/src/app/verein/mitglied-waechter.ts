import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { catchError, map, of, throwError } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';
import { MitgliederApi } from './mitglieder-api';

/**
 * Laesst nur durch, wen der Server in diesem Verein als angemeldet kennt. Das Cookie
 * ist HttpOnly, die Seite sieht es nicht -- sie fragt also nach (GET /ich).
 *
 * 401 heisst "nicht angemeldet": Umleitung auf die Anmeldung des Vereins. 404 heisst
 * unbekannter oder fuer die Person unsichtbarer Verein: Umleitung auf eine
 * Nicht-gefunden-Seite unter dem Slug (Rahmen-Spec 8, kein 403). Verworfen: eine
 * Seite unter einem festen Pfad ausserhalb des Slugs -- sie waere ein weiterer
 * reservierter Vereinsname. Alle anderen Fehler (Netz, Server) schicken nicht zur
 * Anmeldung, sondern lassen die Navigation sichtbar scheitern wie bei adminAngemeldet:
 * Das Formular taete sonst so, als sei die Sitzung weg, obwohl nur die Leitung fehlt.
 */
export const mitgliedAngemeldet: CanActivateFn = (route) => {
	const router = inject(Router);
	const slug = route.paramMap.get('slug') ?? '';
	return inject(MitgliederApi)
		.ich(slug)
		.pipe(
			map(() => true),
			catchError((fehler: unknown) => {
				const status = alsApiFehler(fehler).status;
				const pfad = `/${encodeURIComponent(slug)}`;
				if (status === 401) return of(router.parseUrl(`${pfad}/anmelden`));
				if (status === 404) return of(router.parseUrl(`${pfad}/nicht-gefunden`));
				return throwError(() => fehler);
			}),
		);
};
