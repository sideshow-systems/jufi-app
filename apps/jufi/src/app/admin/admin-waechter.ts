import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { catchError, map, of, throwError } from 'rxjs';
import { AdminApi, alsAdminFehler } from './admin-api';

/**
 * Laesst nur durch, wen der Server als angemeldeten Admin kennt. Das Cookie ist
 * HttpOnly, die Seite sieht es nicht -- sie fragt also nach (GET /ich).
 *
 * Nur 401 heisst "nicht angemeldet". Ein Netz- oder Serverfehler schickt nicht zur
 * Anmeldung: Dort wuerde das Formular so tun, als sei die Sitzung weg, obwohl nur
 * die Leitung fehlt. Die Navigation scheitert dann sichtbar; sicher ist das ohnehin,
 * weil der Server jede Admin-Anfrage selbst prueft. Der Waechter ist Komfort.
 */
export const adminAngemeldet: CanActivateFn = () => {
	const router = inject(Router);
	return inject(AdminApi)
		.ich()
		.pipe(
			map(() => true),
			catchError((fehler: unknown) =>
				alsAdminFehler(fehler).status === 401 ? of(router.parseUrl('/admin/anmelden')) : throwError(() => fehler),
			),
		);
};
