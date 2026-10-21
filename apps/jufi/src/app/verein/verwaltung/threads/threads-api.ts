import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { AntwortenUebersicht, ThreadBearbeitung, ThreadEntwurf, VerwaltungListe } from '@jufi/domain';
import { catchError, type Observable, throwError } from 'rxjs';
import { alsApiFehler } from '../../../gemeinsam/api-fehler';

/**
 * Die Aufrufe der Verwaltungsrouten fuer Threads (apps/jufi/src/server/threads), einer je Endpunkt,
 * der Slug stets als erster Parameter. Die Antworttypen kommen aus der Domaene. Eigener Dienst
 * neben ThreadApi: Dort stehen die Aufrufe der Mitglieder, hier die der Jugendleiter; beide
 * wuerden sonst bei jeder Etappe um Methoden wachsen, die der jeweils andere Bereich nie braucht.
 *
 * Alle schreibenden Aufrufe liefern wieder die ThreadBearbeitung, damit der Editor nach dem
 * Speichern den neuen Stand (version) und die Sperren aus einer Antwort uebernimmt, ohne
 * nachzuladen.
 */
@Injectable({ providedIn: 'root' })
export class VerwaltungThreadsApi {
	private readonly http = inject(HttpClient);

	private basis(slug: string): string {
		return `/${encodeURIComponent(slug)}/api/v1`;
	}

	private threadPfad(id: string): string {
		return `/threads/${encodeURIComponent(id)}`;
	}

	private holen<T>(slug: string, pfad: string): Observable<T> {
		return this.http
			.get<T>(`${this.basis(slug)}${pfad}`)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	private senden<T>(methode: 'POST' | 'PUT' | 'DELETE', slug: string, pfad: string, koerper?: object): Observable<T> {
		return this.http
			.request<T>(methode, `${this.basis(slug)}${pfad}`, koerper === undefined ? {} : { body: koerper })
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	liste(slug: string): Observable<VerwaltungListe> {
		return this.holen(slug, '/verwaltung/threads');
	}

	bearbeitung(slug: string, id: string): Observable<ThreadBearbeitung> {
		return this.holen(slug, `${this.threadPfad(id)}/bearbeitung`);
	}

	antworten(slug: string, id: string): Observable<AntwortenUebersicht> {
		return this.holen(slug, `${this.threadPfad(id)}/antworten`);
	}

	/** Antwortet 201. */
	lege(slug: string, entwurf: ThreadEntwurf): Observable<ThreadBearbeitung> {
		return this.senden('POST', slug, '/threads', { entwurf });
	}

	/** Die version ist der Stand, den der Editor geladen hat; ein anderer Wert beim Server ergibt 409 VERALTET. */
	ersetze(slug: string, id: string, version: number, entwurf: ThreadEntwurf): Observable<ThreadBearbeitung> {
		return this.senden('PUT', slug, this.threadPfad(id), { version, entwurf });
	}

	veroeffentliche(slug: string, id: string): Observable<ThreadBearbeitung> {
		return this.senden('POST', slug, `${this.threadPfad(id)}/veroeffentlichen`);
	}

	archiviere(slug: string, id: string, archiviert: boolean): Observable<ThreadBearbeitung> {
		return this.senden('PUT', slug, `${this.threadPfad(id)}/archiv`, { archiviert });
	}

	pinne(slug: string, id: string, angepinnt: boolean): Observable<ThreadBearbeitung> {
		return this.senden('PUT', slug, `${this.threadPfad(id)}/angepinnt`, { angepinnt });
	}

	/** Antwortet 204. */
	loesche(slug: string, id: string): Observable<void> {
		return this.senden('DELETE', slug, this.threadPfad(id));
	}
}
