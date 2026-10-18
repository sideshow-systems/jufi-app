import { inject, Injectable, signal } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, map, of, throwError } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';
import { type MitgliedIch, MitgliederApi } from './mitglieder-api';
import { istNichtAngemeldet } from './sitzung-abgelaufen';

/**
 * Was der Waechter zuletzt ueber die Person erfahren hat. Die Startseite braucht daraus
 * nur hatKinder; verworfen: ein zweites GET /ich dort -- die Antwort liegt schon vor,
 * und eine offene Zweitanfrage haelt jede Seite instabil, bis sie beantwortet ist.
 */
@Injectable({ providedIn: 'root' })
export class MitgliedSitzung {
	readonly ich = signal<MitgliedIch | null>(null);

	private readonly api = inject(MitgliederApi);
	private readonly router = inject(Router);

	/**
	 * Meldet ab (nur hier, Mehr und Profil rufen es) und geht zur Anmeldung des Vereins. 401
	 * "nicht angemeldet" gilt als gelungen: Die Sitzung ist schon weg, das Ziel erreicht, und
	 * ein Fehlertext liesse die Person glauben, sie sei noch drin. Andere Fehler werfen weiter,
	 * damit die Seite sie zeigt. Erst navigieren, dann ich leeren: Sonst verlore die Seite
	 * ihre Zeilen (Verwaltung, Meine Jungfischer), bevor sie weg ist. Verworfen: die Logik je
	 * Seite, sie lief schon einmal auseinander (nur Mehr kannte den 401-Fall).
	 */
	async abmelden(slug: string, ueberall = false): Promise<void> {
		try {
			await firstValueFrom(ueberall ? this.api.abmeldenAlle(slug) : this.api.abmelden(slug));
		} catch (ursache) {
			if (!istNichtAngemeldet(alsApiFehler(ursache))) throw ursache;
		}
		try {
			await this.router.navigateByUrl(`/${encodeURIComponent(slug)}/anmelden`);
		} finally {
			this.ich.set(null);
		}
	}
}

/**
 * Laesst nur durch, wen der Server in diesem Verein als angemeldet kennt. Das Cookie
 * ist HttpOnly, die Seite sieht es nicht -- sie fragt also nach (GET /ich).
 *
 * 401 heisst "nicht angemeldet": Umleitung auf die Anmeldung des Vereins, mit der
 * aufgerufenen Seite als weiter. 404 heisst unbekannter oder fuer die Person
 * unsichtbarer Verein: Umleitung auf eine Nicht-gefunden-Seite unter dem Slug
 * (Rahmen-Spec 8, kein 403). Verworfen: eine Seite unter einem festen Pfad
 * ausserhalb des Slugs -- sie waere ein weiterer reservierter Vereinsname. Alle
 * anderen Fehler (Netz, Server) schicken nicht zur Anmeldung, sondern lassen die
 * Navigation sichtbar scheitern wie bei adminAngemeldet: Das Formular taete sonst
 * so, als sei die Sitzung weg, obwohl nur die Leitung fehlt.
 */
export const mitgliedAngemeldet: CanActivateFn = (route, state) => {
	const router = inject(Router);
	const slug = route.paramMap.get('slug') ?? '';
	const sitzung = inject(MitgliedSitzung);
	return inject(MitgliederApi)
		.ich(slug)
		.pipe(
			map((ich) => {
				sitzung.ich.set(ich);
				return true;
			}),
			catchError((fehler: unknown) => {
				sitzung.ich.set(null);
				const status = alsApiFehler(fehler).status;
				const pfad = `/${encodeURIComponent(slug)}`;
				// Die Anmeldung fuehrt ueber weiter zur aufgerufenen Seite zurueck (Spec 2.4). Mitgegeben
				// wird die ganze Adresse samt Suchteil; ob sie sicher ist, prueft erst die Anmeldeseite
				// (sichererWeiterPfad), denn dort kommt der Wert aus der Adresszeile.
				if (status === 401) {
					return of(router.createUrlTree(['/', slug, 'anmelden'], { queryParams: { weiter: state.url } }));
				}
				if (status === 404) return of(router.parseUrl(`${pfad}/nicht-gefunden`));
				return throwError(() => fehler);
			}),
		);
};
