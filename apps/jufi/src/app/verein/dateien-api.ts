import { HttpBackend, HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import type { DateiZeile, DokumentAnsicht, DokumenteAntwort, SpeicherAntwort } from '@jufi/domain';
import { catchError, type Observable, throwError } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';
import { vereinsApi } from './dateien-anzeige';

/**
 * Das Backend, ueber das Uploads laufen. Vorgabe ist das der App (Fetch); app.config.ts setzt hier
 * XHR ein, denn Fetch meldet beim Hochladen keinen Fortschritt und der Balken bliebe leer. Ein
 * eigener Schluessel statt withXhr fuer die ganze App: Die Seiten werden auch auf dem Server
 * gerendert, wo XHR veraltet ist; ein Upload laeuft nur im Browser. Die Tests behalten die Vorgabe
 * und damit das Test-Backend.
 */
export const HOCHLADE_BACKEND = new InjectionToken<HttpBackend>('HOCHLADE_BACKEND', {
	providedIn: 'root',
	factory: () => inject(HttpBackend),
});

export interface DokumentAenderung {
	titel?: string;
	kategorieId?: string;
}

/**
 * Die Aufrufe der Dateien- und Dokumente-Routen des Servers (apps/jufi/src/server/dateien), der
 * Slug stets als erster Parameter. Eigener Dienst neben ThreadApi und MitgliederApi: Dateien
 * gehoeren zu keinem von beiden; mit Etappe 2 kamen Fotos und die Dateien der Module dazu.
 */
@Injectable({ providedIn: 'root' })
export class DateienApi {
	private readonly http = inject(HttpClient);
	private readonly hochladeBackend = inject(HOCHLADE_BACKEND);
	private uploadClient: HttpClient | undefined;

	private basis(slug: string): string {
		return vereinsApi(slug);
	}

	dokumente(slug: string): Observable<DokumenteAntwort> {
		return this.http
			.get<DokumenteAntwort>(`${this.basis(slug)}/dokumente`)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	/** Das Vorschaubild eines Fotos (480 px), wie dateiAdresse ein Link fuer img und nie ein Aufruf. */
	vorschauAdresse(slug: string, dateiId: string): string {
		return `${this.basis(slug)}/dateien/${encodeURIComponent(dateiId)}/vorschau`;
	}

	/** Ziel einer neuen Datei im Datei-Modul (POST, roher Koerper). */
	modulDateienAdresse(slug: string, modulId: string): string {
		return `${this.basis(slug)}/module/${encodeURIComponent(modulId)}/dateien`;
	}

	/** Ziel eines neuen Fotos im Foto-Modul (POST, roher Koerper). */
	modulFotosAdresse(slug: string, modulId: string): string {
		return `${this.basis(slug)}/module/${encodeURIComponent(modulId)}/fotos`;
	}

	/** Nur fuer Dateien eines Datei-Moduls; Dokumente benennt die Verwaltung ueber ihren Titel um. */
	benenneDatei(slug: string, id: string, name: string): Observable<DateiZeile> {
		return this.senden('PUT', slug, `/dateien/${encodeURIComponent(id)}`, { name });
	}

	loescheDatei(slug: string, id: string): Observable<void> {
		return this.senden('DELETE', slug, `/dateien/${encodeURIComponent(id)}`);
	}

	speicher(slug: string): Observable<SpeicherAntwort> {
		return this.http
			.get<SpeicherAntwort>(`${this.basis(slug)}/speicher`)
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}

	legeKategorieAn(slug: string, name: string): Observable<{ id: string; name: string }> {
		return this.senden('POST', slug, '/dokument-kategorien', { name });
	}

	benenneKategorie(slug: string, id: string, name: string): Observable<{ id: string; name: string }> {
		return this.senden('PUT', slug, `/dokument-kategorien/${encodeURIComponent(id)}`, { name });
	}

	/** Alle Ids in der neuen Reihenfolge; der Server nimmt nur genau die Menge aller Kategorien. */
	sortiereKategorien(slug: string, ids: string[]): Observable<void> {
		return this.senden('PUT', slug, '/dokument-kategorien/reihenfolge', { ids });
	}

	loescheKategorie(slug: string, id: string): Observable<void> {
		return this.senden('DELETE', slug, `/dokument-kategorien/${encodeURIComponent(id)}`);
	}

	aendereDokument(slug: string, id: string, aenderung: DokumentAenderung): Observable<DokumentAnsicht> {
		return this.senden('PUT', slug, `/dokumente/${encodeURIComponent(id)}`, aenderung);
	}

	loescheDokument(slug: string, id: string): Observable<void> {
		return this.senden('DELETE', slug, `/dokumente/${encodeURIComponent(id)}`);
	}

	/** Ziel eines neuen Dokuments in der Kategorie (POST, roher Koerper). */
	dokumentAdresse(slug: string, kategorieId: string): string {
		return `${this.basis(slug)}/dokumente?kategorie=${encodeURIComponent(kategorieId)}`;
	}

	/** Ziel beim Ersetzen der Datei eines Dokuments (PUT, roher Koerper). */
	dokumentDateiAdresse(slug: string, id: string): string {
		return `${this.basis(slug)}/dokumente/${encodeURIComponent(id)}/datei`;
	}

	/**
	 * Der Client der Uploads, ohne Interceptoren und mit dem XHR-Backend (HOCHLADE_BACKEND). Erst beim
	 * ersten Upload gebaut: Die Medien-Seite wird auch auf dem Server gerendert und soll dort das
	 * XHR-Backend nicht einmal anfassen. Die Warteschlange (Hochladeschlange) nimmt ihn als Parameter,
	 * denn sie ist eine freie Klasse ohne Injektionskontext.
	 */
	hochlader(): HttpClient {
		this.uploadClient ??= new HttpClient(this.hochladeBackend);
		return this.uploadClient;
	}

	private senden<T>(methode: 'POST' | 'PUT' | 'DELETE', slug: string, pfad: string, koerper?: object): Observable<T> {
		return this.http
			.request<T>(methode, `${this.basis(slug)}${pfad}`, koerper === undefined ? {} : { body: koerper })
			.pipe(catchError((e: unknown) => throwError(() => alsApiFehler(e))));
	}
}
