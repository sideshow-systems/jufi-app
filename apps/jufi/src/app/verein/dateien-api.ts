import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { DokumenteAntwort } from '@jufi/domain';
import { catchError, type Observable, throwError } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';

/**
 * Die Aufrufe der Dateien- und Dokumente-Routen des Servers (apps/jufi/src/server/dateien), der
 * Slug stets als erster Parameter. Eigener Dienst neben ThreadApi und MitgliederApi: Dateien
 * gehoeren zu keinem von beiden und wachsen mit Etappe 2 (Fotos) weiter.
 */
@Injectable({ providedIn: 'root' })
export class DateienApi {
	private readonly http = inject(HttpClient);

	private basis(slug: string): string {
		return `/${encodeURIComponent(slug)}/api/v1`;
	}

	dokumente(slug: string): Observable<DokumenteAntwort> {
		return this.http
			.get<DokumenteAntwort>(`${this.basis(slug)}/dokumente`)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	/**
	 * Adresse einer Datei fuer einen Link, kein Aufruf: Der Browser holt sie selbst (neuer Tab oder
	 * Speichern), die Sitzung haengt am Cookie. Verworfen: ein Blob ueber HttpClient, das hielte die
	 * ganze Datei im Speicher des Handys, nur um sie gleich wieder abzulegen.
	 */
	dateiAdresse(slug: string, dateiId: string, herunterladen = false): string {
		return `${this.basis(slug)}/dateien/${encodeURIComponent(dateiId)}${herunterladen ? '?herunterladen=1' : ''}`;
	}
}
