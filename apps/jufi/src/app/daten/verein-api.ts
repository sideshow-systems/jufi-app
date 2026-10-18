import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, type Observable, throwError } from 'rxjs';

/** Was die API ueber einen Verein ohne Anmeldung preisgibt (nur das, was die Startseite braucht). */
export interface OeffentlicherVerein {
	slug: string;
	anzeigename: string;
	farbe: string;
	hatLogo: boolean;
	/** ISO-Zeit der letzten Logo-Aenderung; haengt als ?v= an Logo- und Icon-Adressen. null ohne Logo. */
	logoStand: string | null;
}

@Injectable({ providedIn: 'root' })
export class VereinApi {
	private readonly http = inject(HttpClient);

	/**
	 * Absoluter Pfad, weil base href "/" ist und der Slug der erste Pfadteil: ein
	 * relativer Pfad hinge am Router-Stand und landete auf der Unterseite unter
	 * /demo/gibt/.../api. 404 ist ein erwarteter Ausgang (unbekannter, gesperrter
	 * oder unmoeglicher Slug sehen von aussen gleich aus), kein Fehler -- alles
	 * andere, etwa fehlendes Netz, geht als Fehler weiter an die Seite.
	 */
	lade(slug: string): Observable<OeffentlicherVerein | 'nicht-gefunden'> {
		return this.http.get<OeffentlicherVerein>(`/${encodeURIComponent(slug)}/api/v1/verein`).pipe(
			map((verein): OeffentlicherVerein | 'nicht-gefunden' => verein),
			catchError((fehler: unknown) =>
				fehler instanceof HttpErrorResponse && fehler.status === 404
					? [<const>'nicht-gefunden']
					: throwError(() => fehler),
			),
		);
	}
}
