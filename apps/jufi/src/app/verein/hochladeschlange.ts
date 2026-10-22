import type { HttpClient } from '@angular/common/http';
import { type Signal, signal } from '@angular/core';
import type { DateiArt } from '@jufi/domain';
import type { Subscription } from 'rxjs';
import { ladeHoch, NICHT_ANGEMELDET, WIEDERHOLEN_NACH_VORGABE_S, ZU_VIELE } from './hochladen';

/** Eine Datei auf dem Weg zum Server, bis sie angenommen ist oder die Person sie verwirft. */
export interface Hochladung {
	/** Zaehlt je Schlange hoch; die Zeile der Oberflaeche haengt daran, nie am Index. */
	schluessel: number;
	datei: File;
	/** Die Adresse, an die der Koerper geht; die Oberflaeche ordnet danach Zeilen ihren Orten zu. */
	ziel: string;
	methode: 'POST' | 'PUT';
	zustand: 'wartet' | 'laeuft' | 'fertig' | 'fehler';
	anteil: number;
	fehler: string | null;
	code: string | null;
	/** Nur bei Fotos: eine Adresse fuer das Vorschaubild, bis die Zeile weg ist. */
	vorschau: string | null;
}

export interface SchlangeEinstellung {
	http: HttpClient;
	art: DateiArt;
	/** Je angenommene Datei; die Zeile ist dann schon aus der Reihe. */
	nachErfolg?: (hochladung: Hochladung, antwort: unknown) => void;
	/**
	 * Einmal, wenn nichts mehr laeuft oder wartet und seit dem letzten Mal mindestens eine Datei
	 * angenommen wurde (Fehlerzeilen zaehlen nicht als offen). Ebenso, wenn die Reihe nach 429 fuer
	 * laengere Zeit anhaelt: Die schon angenommenen Fotos sollen dann nicht bis zu zehn Minuten
	 * unsichtbar bleiben. Die Seite laedt dann einmal neu statt je
	 * Datei: Zehn Fotos ergaeben sonst zehn Neuladungen des Threads. Verworfen: je Datei melden und in
	 * den Modul-Bauteilen entprellen; die Schlange weiss als einzige, wann der Stapel durch ist, und
	 * ein Zeitfenster kaeme bei langsamen Uploads zu frueh oder bei schnellen zu spaet.
	 */
	nachStapel?: () => void;
	/** Einmal je Schlange, wenn der Server "nicht angemeldet" sagt; die Seite geht dann zur Anmeldung. */
	beiNichtAngemeldet?: () => void;
}

/**
 * Mehr als diese Wartezeit nimmt die Schlange aus Retry-After nicht an: Ein falscher oder von einem
 * Proxy gesetzter Wert (3600) liesse sonst die ganze Reihe eine Stunde stehen, waehrend die Person
 * davor sitzt. Der Server nennt 2 s; nach 30 s ist "Nochmal" die bessere Antwort als Warten.
 */
const WIEDERHOLEN_MAX_S = 30;

/** Wiederholungen nach 503 (Plan-Entscheidung 16); mit dem ersten Versuch sind es vier. */
const WIEDERHOLUNGEN = 3;

/**
 * Wartezeit nach 429, wenn Retry-After fehlt. Der Server nennt sie immer (annehmen.ts); fehlt sie
 * doch, etwa hinter einem Proxy, liefe die Reihe mit der Vorgabe von 503 (2 s) staendig gegen das
 * volle Fenster.
 */
const ZU_VIELE_VORGABE_S = 60;

/** Laenger nimmt setTimeout nicht an (2^31 - 1 ms); darueber feuerte es sofort. */
const MAX_WARTEN_MS = 2_147_483_647;

/** Der Versuch, der gerade laeuft oder auf seine Wiederholung wartet. */
interface Lauf {
	schluessel: number;
	sub: Subscription | undefined;
}

/**
 * Die Warteschlange der Uploads einer Seite, aus Verwaltung > Dokumente herausgeloest, damit auch
 * die Module auf der Thread-Seite dieselbe haben (Etappe-1-Rueckstand: sie sollte nicht zweimal
 * wachsen).
 *
 * Es laeuft eine Datei zur Zeit. Verworfen: alle gleichzeitig, denn der Server begrenzt die Uploads
 * je Person (60 je zehn Minuten), das Kontingent entscheidet unter einer Sperre, und die Foto-
 * Verarbeitung hat nur einen Platz in Arbeit; zehn parallele Dateien meldeten dort zehnmal
 * "beschaeftigt" statt einmal.
 *
 * Meldet der Server "zu viele Uploads" (429, 60 je zehn Minuten; Spec 9.2), haelt die ganze Reihe
 * an: Die Zeile geht zurueck auf "wartet", ebenso alle dahinter, und nach der Zeit aus Retry-After
 * macht die Schlange von selbst mit derselben Datei weiter. Wann, steht in weiterUm. Hier ohne die
 * Kappung auf 30 s wie bei 503: Das Fenster gibt einen Platz erst frei, wenn der aelteste Upload zehn
 * Minuten alt ist, und eine gekappte Wartezeit fuehrte nur zu weiteren 429. Dass es so lange dauert,
 * sieht die Person an der Uhrzeit. Verworfen: jede Datei einzeln scheitern lassen -- wer nach dem
 * Zeltlager 120 Fotos waehlt, saehe sonst ab dem 61. in Sekunden 60 rote Zeilen mit je "Nochmal".
 *
 * Nach einem 401 haelt die Reihe ebenfalls an, bis die Person "Nochmal" an der Fehlerzeile drueckt:
 * Jede weitere Datei bekaeme dasselbe 401. Das gilt auch, wenn sie inzwischen eine Zeile verwirft
 * oder neue Dateien waehlt; verwirft sie die Fehlerzeile selbst, bleiben die uebrigen stehen. Das
 * nimmt die Schlange in Kauf, denn die Seite ist nach 401 ohnehin auf dem Weg zur Anmeldung
 * (beiNichtAngemeldet). Verworfen: nach verwirf die naechste Datei starten -- sie holte nur das
 * naechste 401 ab.
 *
 * Meldet der Server "beschaeftigt" (503, Foto-Verarbeitung voll), wartet die Schlange die Zeit aus
 * Retry-After und versucht dieselbe Datei bis zu dreimal neu, ohne dass die Zeile einen Fehler zeigt:
 * Sie steht dann auf "wartet", denn das ist, was die Person sieht (Plan-Entscheidung 16). Die
 * Reihe haelt dabei an; verworfen: die naechste Datei vorziehen, denn die liefe in dieselbe volle
 * Verarbeitung. Erst nach dem vierten Mal steht der Fehler da, mit "Nochmal".
 *
 * Gerade Signale statt eines Observables, weil die Oberflaeche die Reihe nur zeichnet und die
 * Schlange keine Anbindung an den Lebenslauf eines Bauteils hat: Wer sie anlegt, ruft beende().
 */
export class Hochladeschlange {
	private readonly zeilen = signal<readonly Hochladung[]>([]);
	readonly reihe: Signal<readonly Hochladung[]> = this.zeilen.asReadonly();

	private naechster = 0;
	private lauf: Lauf | null = null;
	private zeitgeber: ReturnType<typeof setTimeout> | null = null;
	private readonly versuche = new Map<number, number>();
	private beendet = false;
	private abgemeldet = false;
	/** Nach 401: Die Reihe steht, bis nochmal sie wieder freigibt. */
	private angehalten = false;
	/** Nach 429: Die Reihe steht bis zum Ablauf dieses Zeitgebers. */
	private pause: ReturnType<typeof setTimeout> | null = null;
	private readonly weiterUmZeit = signal<number | null>(null);
	/** Wann die Reihe nach 429 von selbst weitermacht (Millisekunden seit 1970), sonst null. */
	readonly weiterUm: Signal<number | null> = this.weiterUmZeit.asReadonly();
	/** Seit der letzten Meldung nachStapel angenommene Dateien. */
	private erfolge = 0;

	constructor(private readonly e: SchlangeEinstellung) {}

	fuegeHinzu(dateien: readonly File[], ziel: string, methode: 'POST' | 'PUT' = 'POST'): void {
		if (this.beendet) return;
		const neu = dateien.map((datei): Hochladung => ({
			schluessel: ++this.naechster,
			datei,
			ziel,
			methode,
			zustand: 'wartet',
			anteil: 0,
			fehler: null,
			code: null,
			vorschau: this.e.art === 'FOTO' ? URL.createObjectURL(datei) : null,
		}));
		this.zeilen.update((alle) => [...alle, ...neu]);
		this.starteNaechste();
	}

	/** Die Zeile eines Fehlers noch einmal von vorn, auch mit frischem Zaehler fuer die Wiederholungen. */
	nochmal(schluessel: number): void {
		if (this.beendet || this.zeile(schluessel)?.zustand !== 'fehler') return;
		// Nach einer neuen Anmeldung setzt Nochmal die ganze Reihe wieder in Gang (siehe Klasse).
		this.angehalten = false;
		this.versuche.delete(schluessel);
		this.aendere(schluessel, { zustand: 'wartet', anteil: 0, fehler: null, code: null });
		this.starteNaechste();
	}

	verwirf(schluessel: number): void {
		const h = this.zeile(schluessel);
		if (!h) return;
		if (this.lauf?.schluessel === schluessel) this.stoppeLauf();
		this.entferne(h);
		this.starteNaechste();
	}

	/** Bricht ab, was laeuft oder wartet, und gibt alle Vorschauadressen frei: Die Seite ist weg. */
	beende(): void {
		this.beendet = true;
		this.stoppeLauf();
		this.beendePause();
		for (const h of this.zeilen()) this.gibFrei(h);
		this.zeilen.set([]);
	}

	private zeile(schluessel: number): Hochladung | undefined {
		return this.zeilen().find((h) => h.schluessel === schluessel);
	}

	private aendere(schluessel: number, teil: Partial<Hochladung>): void {
		this.zeilen.update((alle) => alle.map((h) => (h.schluessel === schluessel ? { ...h, ...teil } : h)));
	}

	private entferne(h: Hochladung): void {
		this.versuche.delete(h.schluessel);
		this.gibFrei(h);
		this.zeilen.update((alle) => alle.filter((x) => x.schluessel !== h.schluessel));
	}

	private gibFrei(h: Hochladung): void {
		if (h.vorschau !== null) URL.revokeObjectURL(h.vorschau);
	}

	private stoppeLauf(): void {
		this.lauf?.sub?.unsubscribe();
		this.lauf = null;
		if (this.zeitgeber !== null) clearTimeout(this.zeitgeber);
		this.zeitgeber = null;
	}

	private beendePause(): void {
		if (this.pause !== null) clearTimeout(this.pause);
		this.pause = null;
		this.weiterUmZeit.set(null);
	}

	private starteNaechste(): void {
		if (this.beendet || this.lauf !== null || this.angehalten || this.pause !== null) return;
		const h = this.zeilen().find((x) => x.zustand === 'wartet');
		if (h) return this.starte(h.schluessel);
		this.meldeStapel();
	}

	private meldeStapel(): void {
		if (this.erfolge > 0) {
			this.erfolge = 0;
			this.e.nachStapel?.();
		}
	}

	/** Haelt die Reihe nach 429 an und setzt sie nach `sekunden` von selbst fort (siehe Klasse). */
	private pausiere(sekunden: number): void {
		const ms = Math.min(sekunden * 1000, MAX_WARTEN_MS);
		this.weiterUmZeit.set(Date.now() + ms);
		this.pause = setTimeout(() => {
			this.pause = null;
			this.weiterUmZeit.set(null);
			this.starteNaechste();
		}, ms);
		this.meldeStapel();
	}

	private starte(schluessel: number): void {
		const h = this.zeile(schluessel);
		if (!h) return;
		// Die Marke steht vor dem Abonnieren: Eine zu grosse Datei meldet ihren Fehler sofort, noch
		// bevor subscribe zurueckkehrt, und die naechste Datei startet dann schon darin.
		const lauf: Lauf = { schluessel, sub: undefined };
		this.lauf = lauf;
		this.aendere(schluessel, { zustand: 'laeuft', anteil: 0 });
		lauf.sub = ladeHoch(h.ziel, h.datei, h.methode, this.e.http, this.e.art).subscribe((stand) => {
			if (this.lauf !== lauf) return;
			if (stand.art === 'fortschritt') return this.aendere(schluessel, { anteil: stand.anteil });
			if (stand.art === 'fertig') {
				this.lauf = null;
				this.entferne(h);
				this.erfolge++;
				this.e.nachErfolg?.(h, stand.antwort);
				return this.starteNaechste();
			}
			if (stand.code === 'BESCHAEFTIGT' && (this.versuche.get(schluessel) ?? 0) < WIEDERHOLUNGEN) {
				this.versuche.set(schluessel, (this.versuche.get(schluessel) ?? 0) + 1);
				this.aendere(schluessel, { zustand: 'wartet', anteil: 0 });
				// Der Lauf bleibt belegt: Die Reihe haelt an, bis diese Datei durch ist oder aufgibt.
				lauf.sub = undefined;
				this.zeitgeber = setTimeout(
					() => {
						this.zeitgeber = null;
						if (this.lauf === lauf) this.starte(schluessel);
					},
					Math.min(stand.wiederholenNach ?? WIEDERHOLEN_NACH_VORGABE_S, WIEDERHOLEN_MAX_S) * 1000,
				);
				return;
			}
			if (stand.code === ZU_VIELE) {
				this.lauf = null;
				this.aendere(schluessel, { zustand: 'wartet', anteil: 0 });
				return this.pausiere(stand.wiederholenNach ?? ZU_VIELE_VORGABE_S);
			}
			this.lauf = null;
			this.aendere(schluessel, {
				zustand: 'fehler',
				anteil: 0,
				fehler: stand.text,
				code: stand.code ?? null,
			});
			// Nach einem 401 starten die wartenden Dateien nicht: Sie bekaemen alle dasselbe 401, und nach der
			// Anmeldung soll Nochmal sie wieder in Gang setzen. Sie bleiben dafuer auf wartet.
			if (stand.code === NICHT_ANGEMELDET) {
				this.angehalten = true;
				if (!this.abgemeldet) {
					this.abgemeldet = true;
					this.e.beiNichtAngemeldet?.();
				}
				return;
			}
			this.starteNaechste();
		});
	}
}
