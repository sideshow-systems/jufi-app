import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { ThreadAnsicht, UmfrageAnsicht, VerlaufAnsicht } from '@jufi/domain';
import { catchError, type Observable, throwError } from 'rxjs';
import { alsApiFehler } from '../../gemeinsam/api-fehler';

/**
 * Die Aufrufe der Thread-Routen des Servers (apps/jufi/src/server/threads), einer je Endpunkt,
 * der Slug stets als erster Parameter. Die Antworttypen kommen aus der Domaene und werden nicht
 * nachgeschrieben (Plan-Entscheidung 5). Eigener Dienst statt weiterer Methoden in MitgliederApi:
 * Die Datei ist mit den Personen- und Anmelderouten schon gross genug, und Threads wachsen mit
 * jeder Etappe weiter.
 */
@Injectable({ providedIn: 'root' })
export class ThreadApi {
	private readonly http = inject(HttpClient);

	private basis(slug: string): string {
		return `/${encodeURIComponent(slug)}/api/v1`;
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

	thread(slug: string, id: string): Observable<ThreadAnsicht> {
		return this.holen(slug, `/threads/${encodeURIComponent(id)}`);
	}

	/** Ohne vor die neueste Seite, mit vor die davor liegende (Cursor ist die Id des aeltesten gezeigten Eintrags). */
	verlauf(slug: string, id: string, vor?: string): Observable<{ eintraege: VerlaufAnsicht[]; weitere: boolean }> {
		const abfrage = vor === undefined ? '' : `?vor=${encodeURIComponent(vor)}`;
		return this.holen(slug, `/threads/${encodeURIComponent(id)}/verlauf${abfrage}`);
	}

	/** Antwortet 201, bei einer Wiederholung mit derselben clientId 200 und dem vorhandenen Eintrag. */
	schreibe(
		slug: string,
		id: string,
		koerper: { text: string; clientId: string },
	): Observable<{ eintrag: VerlaufAnsicht; stand: number }> {
		return this.senden('POST', slug, `/threads/${encodeURIComponent(id)}/verlauf`, koerper);
	}

	loescheNachricht(slug: string, eintragId: string): Observable<void> {
		return this.senden('DELETE', slug, `/verlauf/${encodeURIComponent(eintragId)}`);
	}

	/** Der Server merkt sich max(alt, min(bis, aktueller Stand)); ein spaeter Aufruf setzt nichts zurueck. */
	gelesen(slug: string, id: string, koerper: { bereich: 'uebersicht' | 'verlauf'; bis: number }): Observable<void> {
		return this.senden('PUT', slug, `/threads/${encodeURIComponent(id)}/gelesen`, koerper);
	}

	antworte(
		slug: string,
		modulId: string,
		fuerId: string,
		koerper: { optionIds: string[]; clientId: string },
	): Observable<{ modul: UmfrageAnsicht; stand: number }> {
		return this.senden(
			'PUT',
			slug,
			`/umfragen/${encodeURIComponent(modulId)}/antworten/${encodeURIComponent(fuerId)}`,
			koerper,
		);
	}
}
