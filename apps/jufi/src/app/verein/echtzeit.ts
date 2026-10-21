import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
	DestroyRef,
	inject,
	Injectable,
	InjectionToken,
	PLATFORM_ID,
	type Provider,
	signal,
	type Signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { EchtzeitSignal, SyncAntwort } from '@jufi/domain';
import { type Observable, Subject, Subscription } from 'rxjs';
import { alsApiFehler } from '../gemeinsam/api-fehler';
import { beiAbgelaufenerSitzung } from './sitzung-abgelaufen';
import { ThreadApi } from './threads/thread-api';

/** Was der Dienst vom WebSocket des Browsers braucht; Tests reichen eine Attrappe. */
export type EchtzeitSocket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onclose' | 'close'>;

/**
 * Der Bauer der Sockets, als Token statt des globalen WebSocket: So reicht ein Test einen
 * falschen Socket, ohne das Fenster zu veraendern (verworfen: globalThis.WebSocket in jeder
 * Spec ueberschreiben und zuruecksetzen).
 */
export const WEB_SOCKET = new InjectionToken<new (url: string) => EchtzeitSocket>('WEB_SOCKET', {
	providedIn: 'root',
	factory: () => globalThis.WebSocket,
});

/**
 * Was die Seiten erfahren: ein Signal vom Server, das Ergebnis eines Abgleichs mit mindestens
 * einem Thread, oder "alles neu" (Abgleich ohne lueckenlosen Stand, Entscheidungen 3 und 6).
 */
export type EchtzeitEreignis =
	| { typ: 'signal'; signal: EchtzeitSignal }
	| { typ: 'sync'; geaendert: readonly string[]; unsichtbar: readonly string[] }
	| { typ: 'alles' };

/**
 * Ob ein Ereignis den Thread betrifft. Ein Signal ohne Thread ist eine Aenderung am Umfeld
 * (Entscheidung 3) und kann jeden Thread sichtbar oder unsichtbar machen.
 */
export function betrifft(e: EchtzeitEreignis, threadId: string): boolean {
	switch (e.typ) {
		case 'signal':
			return e.signal.threadId === threadId || e.signal.threadId === null;
		case 'sync':
			return e.geaendert.includes(threadId) || e.unsichtbar.includes(threadId);
		case 'alles':
			return true;
	}
}

const ERSTE_WARTEZEIT_MS = 1000;
const LAENGSTE_WARTEZEIT_MS = 30_000;
/** ±20 %: Nach einem Neustart des Servers verbinden sich nicht alle Clients im selben Augenblick. */
const ZUFALL_ANTEIL = 0.2;
/** Ein kurzer Abbruch (Neustart, Netzwechsel) soll den Hinweis im Kopf nicht aufblitzen lassen. */
const HINWEIS_NACH_MS = 2000;
/** Der Server faehrt herunter (Entscheidung 5); ein Abgleich jetzt traefe den sterbenden Prozess. */
const SERVER_FAEHRT_HERUNTER = 1012;
const NORMAL_GESCHLOSSEN = 1000;

/**
 * Haelt die Verbindung der Huelle zum Server und meldet, was sich geaendert hat. Eine Instanz
 * je Huelle (echtzeitDerHuelle): Mit der Huelle endet die Verbindung, und ein anderer Verein
 * bekommt seinen eigenen Socket und Stand.
 *
 * stand ist das Hoechste aus Signalen und Abgleichen und anfangs null: Der erste Abgleich nach
 * dem Oeffnen fragt ohne seit und laedt alles (Entscheidung 7), weil zwischen dem Laden der
 * Seite und dem Verbinden etwas geschehen sein kann. Verworfen: den Stand des ersten Signals
 * ungeprueft uebernehmen, die Aenderung davor fehlte bis zur naechsten Navigation.
 *
 * Schliesst der Server mit 1012, verbindet der Dienst sich mit Backoff neu. Jeder andere Abbruch
 * geht erst ueber GET /sync, denn ein gescheiterter Upgrade kommt im Browser nur als 1006 ohne
 * Status an: Erst die REST-Antwort sagt 401 (Sitzung weg, zur Anmeldung) oder 404 (Verein weg);
 * in beiden Faellen hoert der Dienst auf. Verworfen: auch 4401 direkt zur Anmeldung schicken,
 * das kann ebenso ein gesperrter Verein sein, der 404 ist und keine Anmeldung braucht.
 *
 * Im Server-Rendering tut starte nichts: kein Socket, kein Zeitgeber, kein Dokument.
 */
@Injectable()
export class Echtzeit {
	private readonly api = inject(ThreadApi);
	private readonly router = inject(Router);
	private readonly dokument = inject(DOCUMENT);
	private readonly bauer = inject(WEB_SOCKET);
	private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

	private readonly verbundenWert = signal(false);
	private readonly getrenntWert = signal(false);
	private readonly vordergrundWert = signal(this.browser ? this.dokument.visibilityState === 'visible' : true);
	private readonly quelle = new Subject<EchtzeitEreignis>();

	/** Ein Socket ist offen. */
	readonly verbunden: Signal<boolean> = this.verbundenWert.asReadonly();
	/** Seit mindestens 2 s ohne offenen Socket; dann zeigt die Huelle den Hinweis. */
	readonly getrennt: Signal<boolean> = this.getrenntWert.asReadonly();
	/** Das Dokument ist sichtbar; nur dann melden Seiten etwas als gelesen (Entscheidung 8). */
	readonly vordergrund: Signal<boolean> = this.vordergrundWert.asReadonly();
	readonly ereignisse: Observable<EchtzeitEreignis> = this.quelle.asObservable();

	private slug: string | null = null;
	/** Wahr nach 401 oder 404: Neu verbinden haette keine Aussicht, bis die Huelle neu startet. */
	private aufgegeben = false;
	private socket: EchtzeitSocket | null = null;
	private stand: number | null = null;
	private wartezeit = ERSTE_WARTEZEIT_MS;
	private neuVersuch: ReturnType<typeof setTimeout> | null = null;
	private hinweis: ReturnType<typeof setTimeout> | null = null;
	private abgleiche = new Subscription();
	/**
	 * Wahr ab dem Beginn eines Abgleichs bis zum Erfolg des zuletzt begonnenen. Solange heben Signale
	 * den Stand nicht an: Der Abgleich soll die Luecke davor belegen, und scheitert er, faengt der
	 * naechste beim alten Stand an statt bei dem eines Signals, das ueber die Luecke hinweg kam
	 * (Review Task 9). Verworfen: nur den Socket nach einem Fehler schliessen, denn ein Signal zwischen
	 * Beginn und Fehler haette den Stand schon gehoben.
	 */
	private abgleichOffen = false;
	private abgleichNr = 0;

	private readonly sichtbarkeit = (): void => this.sichtbarkeitGeaendert();

	constructor() {
		inject(DestroyRef).onDestroy(() => this.stoppe());
	}

	starte(slug: string): void {
		if (!this.browser || slug === this.slug) return;
		this.stoppe();
		this.slug = slug;
		this.dokument.addEventListener('visibilitychange', this.sichtbarkeit);
		this.verbinde();
	}

	/** Schliesst ohne neu zu verbinden; danach faengt starte wieder ohne Stand an. */
	stoppe(): void {
		if (this.slug === null) return;
		this.dokument.removeEventListener('visibilitychange', this.sichtbarkeit);
		this.slug = null;
		this.aufgegeben = false;
		this.stand = null;
		this.abgleichOffen = false;
		this.wartezeit = ERSTE_WARTEZEIT_MS;
		this.abgleiche.unsubscribe();
		this.abgleiche = new Subscription();
		this.loescheZeitgeber();
		this.schliesseSocket();
		this.verbundenWert.set(false);
		this.getrenntWert.set(false);
	}

	private verbinde(): void {
		const slug = this.slug;
		if (slug === null || this.aufgegeben) return;
		this.planeHinweis();
		const ort = this.dokument.location;
		// Ohne Abfrageteil: Der Dev-Proxy erkennt den Pfad an ^/[^/]+/ws$ samt Abfrage.
		const s = new this.bauer(
			`${ort.protocol === 'https:' ? 'wss' : 'ws'}://${ort.host}/${encodeURIComponent(slug)}/ws`,
		);
		this.socket = s;
		s.onopen = () => {
			if (this.socket !== s) return;
			this.wartezeit = ERSTE_WARTEZEIT_MS;
			this.verbundenWert.set(true);
			this.getrenntWert.set(false);
			if (this.hinweis !== null) clearTimeout(this.hinweis);
			this.hinweis = null;
			this.gleicheAb();
		};
		s.onmessage = (nachricht) => {
			if (this.socket !== s) return;
			const signal = liesSignal(nachricht.data);
			if (!signal) return;
			if (!this.abgleichOffen) this.stand = Math.max(this.stand ?? signal.stand, signal.stand);
			this.quelle.next({ typ: 'signal', signal });
		};
		s.onclose = (ereignis) => {
			if (this.socket !== s) return;
			this.socket = null;
			this.verbundenWert.set(false);
			this.planeHinweis();
			if (ereignis.code === SERVER_FAEHRT_HERUNTER) this.planeNeuVersuch();
			else this.gleicheAb();
		};
	}

	/**
	 * Fragt GET /sync ab dem bekannten Stand. 401 und 404 beenden die Verbindung. Ein Fehler ohne
	 * Aussage (Netz, 5xx) bei offenem Socket schliesst ihn: Der Abgleich nach dem naechsten Oeffnen
	 * holt nach, und der Backoff des Neuverbindens taktet auch die Wiederholung (verworfen: ein eigener
	 * Zeitgeber fuer den Abgleich neben dem des Neuverbindens). Ohne Socket (nach einem Abbruch) folgt
	 * auf jeden solchen Ausgang der geplante Neuversuch.
	 */
	private gleicheAb(): void {
		const slug = this.slug;
		if (slug === null) return;
		const socket = this.socket;
		const nr = ++this.abgleichNr;
		this.abgleichOffen = true;
		this.abgleiche.add(
			this.api.sync(slug, this.stand).subscribe({
				next: (antwort) => {
					if (nr === this.abgleichNr) this.abgleichOffen = false;
					this.wendeAn(antwort);
					this.weiterNachAbgleich();
				},
				error: (roh: unknown) => {
					const fehler = alsApiFehler(roh);
					if (fehler.status === 401 || fehler.status === 404) {
						this.gibAuf();
						if (fehler.status === 401) void beiAbgelaufenerSitzung(this.router, slug, fehler);
						return;
					}
					if (socket !== null && this.socket === socket) this.trenne();
					this.weiterNachAbgleich();
				},
			}),
		);
	}

	/** Ohne Socket und ohne geplanten Versuch neu verbinden; ein offener oder geplanter bleibt, wie er ist. */
	private weiterNachAbgleich(): void {
		if (this.socket === null && this.neuVersuch === null) this.planeNeuVersuch();
	}

	/**
	 * Nach "alles" gilt der Stand des Servers, auch wenn er unter dem bisherigen liegt: Die Datenbank
	 * kann aus einer Sicherung stammen, und mit dem hoeheren Stand ueberginge der naechste Abgleich die
	 * Aenderungen bis dorthin. Sonst das Hoechste aus beiden (ein Signal kann den Abgleich ueberholen).
	 */
	private wendeAn(antwort: SyncAntwort): void {
		if (antwort.vollstaendig) {
			this.stand = antwort.stand;
			this.quelle.next({ typ: 'alles' });
			return;
		}
		this.stand = Math.max(this.stand ?? antwort.stand, antwort.stand);
		if (antwort.geaendert.length > 0 || antwort.unsichtbar.length > 0) {
			this.quelle.next({ typ: 'sync', geaendert: antwort.geaendert, unsichtbar: antwort.unsichtbar });
		}
	}

	/** Ohne Neuverbinden; der Hinweis kommt wie nach jedem Abbruch, denn die Inhalte stehen still. */
	private gibAuf(): void {
		this.aufgegeben = true;
		if (this.neuVersuch !== null) clearTimeout(this.neuVersuch);
		this.neuVersuch = null;
		this.trenne();
	}

	private trenne(): void {
		this.schliesseSocket();
		this.verbundenWert.set(false);
		this.planeHinweis();
	}

	/** 1 s, verdoppelt bis 30 s, je ±20 %; ganze Millisekunden, damit Zeitgeber nicht runden muessen. */
	private planeNeuVersuch(): void {
		if (this.aufgegeben || this.slug === null) return;
		const warten = Math.round(this.wartezeit * (1 - ZUFALL_ANTEIL + 2 * ZUFALL_ANTEIL * Math.random()));
		this.wartezeit = Math.min(this.wartezeit * 2, LAENGSTE_WARTEZEIT_MS);
		if (this.neuVersuch !== null) clearTimeout(this.neuVersuch);
		this.neuVersuch = setTimeout(() => {
			this.neuVersuch = null;
			this.verbinde();
		}, warten);
	}

	private planeHinweis(): void {
		if (this.hinweis !== null || this.verbundenWert()) return;
		this.hinweis = setTimeout(() => {
			this.hinweis = null;
			this.getrenntWert.set(true);
		}, HINWEIS_NACH_MS);
	}

	/**
	 * Zurueck im Vordergrund: Ein schlafendes Handy hat den Socket womoeglich verloren, ohne dass der
	 * Backoff schon dran waere; deshalb sofort verbinden statt warten. Mit offenem Socket ein Abgleich,
	 * denn ein Browser im Hintergrund kann Nachrichten verworfen haben.
	 */
	private sichtbarkeitGeaendert(): void {
		const sichtbar = this.dokument.visibilityState === 'visible';
		this.vordergrundWert.set(sichtbar);
		if (!sichtbar || this.aufgegeben) return;
		if (this.verbundenWert()) {
			this.gleicheAb();
		} else if (this.neuVersuch !== null) {
			clearTimeout(this.neuVersuch);
			this.neuVersuch = null;
			this.verbinde();
		}
	}

	private schliesseSocket(): void {
		const s = this.socket;
		this.socket = null;
		s?.close(NORMAL_GESCHLOSSEN);
	}

	private loescheZeitgeber(): void {
		if (this.neuVersuch !== null) clearTimeout(this.neuVersuch);
		if (this.hinweis !== null) clearTimeout(this.hinweis);
		this.neuVersuch = null;
		this.hinweis = null;
	}
}

/** Eine Nachricht, die kein Signal ist (etwa aus einer neueren Server-Version), wird uebergangen. */
function liesSignal(daten: unknown): EchtzeitSignal | null {
	if (typeof daten !== 'string') return null;
	try {
		const wert = JSON.parse(daten) as Partial<EchtzeitSignal> | null;
		return wert && typeof wert.stand === 'number' ? (wert as EchtzeitSignal) : null;
	} catch {
		return null;
	}
}

/**
 * Bereitstellung in der Huelle: je Huelle ein eigener Dienst, ausser weiter oben steht schon einer.
 * Das ist die stille Attrappe der Tests (adminTestAnbieter); in der App stellt ihn niemand sonst
 * bereit, und das muss so bleiben: Stuende Echtzeit an der Wurzel oder an einer Route, teilten sich
 * alle Huellen einen Dienst, und das Schliessen ueber die DestroyRef der Huelle entfiele.
 * Verworfen: Echtzeit schlicht in providers, dann kaeme keine Attrappe an der Huelle vorbei, und jede
 * Spec unter ihr oeffnete einen Socket; TestBed.overrideProvider, das die Anbieter einer erst ueber
 * den Router erreichten Komponente nicht sicher trifft; TestBed.overrideComponent an der Huelle, das
 * in jeder Spec neben configureTestingModule stehen muesste (adminTestAnbieter liefert nur Anbieter)
 * und die Huelle je Test neu uebersetzte.
 */
export const echtzeitDerHuelle: Provider = {
	provide: Echtzeit,
	useFactory: () => inject(Echtzeit, { skipSelf: true, optional: true }) ?? new Echtzeit(),
};
