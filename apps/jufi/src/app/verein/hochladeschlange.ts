import type { HttpClient } from '@angular/common/http';
import { type Signal, signal } from '@angular/core';
import type { DateiArt } from '@jufi/domain';
import type { Subscription } from 'rxjs';
import { ladeHoch, NICHT_ANGEMELDET, WIEDERHOLEN_NACH_VORGABE_S } from './hochladen';

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
	nachErfolg: (hochladung: Hochladung, antwort: unknown) => void;
	/** Einmal je Schlange, wenn der Server "nicht angemeldet" sagt; die Seite geht dann zur Anmeldung. */
	beiNichtAngemeldet?: () => void;
}

/** Wiederholungen nach 503 (Plan-Entscheidung 16); mit dem ersten Versuch sind es vier. */
const WIEDERHOLUNGEN = 3;

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

	private starteNaechste(): void {
		if (this.beendet || this.lauf !== null) return;
		const h = this.zeilen().find((x) => x.zustand === 'wartet');
		if (h) this.starte(h.schluessel);
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
				this.e.nachErfolg(h, stand.antwort);
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
					(stand.wiederholenNach ?? WIEDERHOLEN_NACH_VORGABE_S) * 1000,
				);
				return;
			}
			this.lauf = null;
			this.aendere(schluessel, {
				zustand: 'fehler',
				anteil: 0,
				fehler: stand.text,
				code: stand.code ?? null,
			});
			if (stand.code === NICHT_ANGEMELDET && !this.abgemeldet) {
				this.abgemeldet = true;
				this.e.beiNichtAngemeldet?.();
			}
			this.starteNaechste();
		});
	}
}
