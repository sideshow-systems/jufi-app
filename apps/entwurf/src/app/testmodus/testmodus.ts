import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import { EntwurfStore, UHR } from '../daten/store';
import { alsIso } from '../daten/zeit';
import { AUFGABEN } from './aufgaben';
import { istErfuellt, PERSON_ID } from './pruefung';
import type { Aufgabe, Ergebnis, PersonKey, TestmodusStand } from './typen';

export type Dialog =
	| { art: 'geschafft'; dauerSek: number }
	| { art: 'nichtWeiter' }
	| { art: 'liste' }
	| { art: 'seite' }
	| { art: 'rueckmeldung' }
	| { art: 'zuruecksetzen' };

const LEER: TestmodusStand = {
	person: null,
	mitAufgaben: true,
	index: { sandra: 0, lena: 0, thomas: 0 },
	ergebnisse: { sandra: [], lena: [], thomas: [] },
	ereignisse: [],
	seitenNotizen: [],
};

/** Ein abgelegter Stand passt nur, wenn die Grundfelder da sind; sonst neu beginnen. */
function alsStand(roh: unknown): TestmodusStand {
	const z = roh as Partial<TestmodusStand> | null;
	if (!z || typeof z !== 'object' || !z.index || !z.ergebnisse || !Array.isArray(z.ereignisse)) return LEER;
	return { ...LEER, ...z, seitenNotizen: Array.isArray(z.seitenNotizen) ? z.seitenNotizen : [] };
}

/**
 * Fortschritt der Testperson (Spec TP1 5). Der Zustand liegt im Store und
 * wird mit dem Datenstand gespeichert; nur der offene Dialog lebt im Speicher.
 */
@Injectable({ providedIn: 'root' })
export class TestmodusService {
	private readonly store = inject(EntwurfStore);
	private readonly uhr = inject(UHR);

	readonly zustand = computed(() => alsStand(this.store.testmodusDaten()));
	readonly dialog = signal<Dialog | null>(null);
	readonly aufgaben = computed<Aufgabe[]>(() => {
		const p = this.zustand().person;
		return p ? AUFGABEN[p] : [];
	});
	/** Index der aktuellen Aufgabe der aktuellen Person; gleich Anzahl, wenn alle durch sind. */
	readonly index = computed(() => {
		const z = this.zustand();
		return z.person ? z.index[z.person] : 0;
	});
	readonly aktuelleAufgabe = computed<Aufgabe | null>(() => {
		const z = this.zustand();
		return z.person && z.mitAufgaben ? (this.aufgaben()[this.index()] ?? null) : null;
	});

	constructor() {
		inject(TESTEREIGNISSE)
			.pipe(takeUntilDestroyed())
			.subscribe((e) => this.aendern((z) => ({ ...z, ereignisse: [...z.ereignisse, e] })));

		// Nach jeder Aenderung am Datenstand oder neuem Ereignis pruefen. Solange
		// ein Dialog offen ist, wartet die Pruefung; sie laeuft beim Schliessen erneut.
		effect(() => {
			const a = this.aktuelleAufgabe();
			if (!a || this.dialog() !== null) return;
			if (istErfuellt(a, this.store.stand(), this.zustand().ereignisse)) {
				this.dialog.set({ art: 'geschafft', dauerSek: this.dauer() });
			}
		});
	}

	waehlePerson(k: PersonKey, mitAufgaben: boolean): void {
		this.store.setzeIch(PERSON_ID[k]);
		this.aendern((z) => ({
			...z,
			person: k,
			mitAufgaben,
			gestartetUm: z.gestartetUm ?? alsIso(this.uhr()),
			aufgabeSeit: this.uhr().getTime(),
			fehlversuche: 0,
		}));
		this.dialog.set(null);
	}

	aufgabenStarten(): void {
		this.aendern((z) => ({ ...z, mitAufgaben: true, aufgabeSeit: this.uhr().getTime(), fehlversuche: 0 }));
	}

	nichtWeiter(notiz?: string): void {
		this.abschliessen({ ausgang: 'nichtWeiter', dauerSek: this.dauer(), notiz: notiz?.trim() || undefined });
	}

	ueberspringen(): void {
		this.abschliessen({ ausgang: 'uebersprungen', dauerSek: this.dauer() });
	}

	/** true bei richtiger Antwort; dann folgt die Bewertung. Falsche zaehlen als Fehlversuch. */
	sucheBeantworten(text: string): boolean {
		const a = this.aktuelleAufgabe();
		if (a?.art !== 'suche') return false;
		if (text === a.antworten(this.store.stand()).richtig) {
			this.dialog.set({ art: 'geschafft', dauerSek: this.dauer() });
			return true;
		}
		this.aendern((z) => ({ ...z, fehlversuche: (z.fehlversuche ?? 0) + 1 }));
		return false;
	}

	bewerten(smiley?: Ergebnis['smiley'], notiz?: string): void {
		const d = this.dialog();
		this.abschliessen({
			ausgang: 'geschafft',
			dauerSek: d?.art === 'geschafft' ? d.dauerSek : this.dauer(),
			smiley,
			notiz: notiz?.trim() || undefined,
		});
	}

	seitenNotiz(pfad: string, text: string): void {
		const t = text.trim();
		if (t) this.aendern((z) => ({ ...z, seitenNotizen: [...z.seitenNotizen, { pfad, text: t }] }));
	}

	/** Ungekuerzt: das Feld haengt per [value] am Zustand, ein trim() hier fraesse beim Tippen die Leerzeichen. */
	wunschSetzen(text: string): void {
		this.aendern((z) => ({ ...z, wunsch: text || undefined }));
	}

	/** Beispieldaten, Bezugstag und Testmodus neu; danach beginnt der Einstieg. */
	allesZuruecksetzen(): void {
		this.dialog.set(null);
		this.store.zuruecksetzen();
	}

	private dauer(): number {
		const seit = this.zustand().aufgabeSeit ?? this.uhr().getTime();
		return Math.max(0, Math.round((this.uhr().getTime() - seit) / 1000));
	}

	private abschliessen(teil: Omit<Ergebnis, 'aufgabeId' | 'fehlversuche'>): void {
		const a = this.aktuelleAufgabe();
		const k = this.zustand().person;
		if (!a || !k) return;
		const ergebnis: Ergebnis = { aufgabeId: a.id, ...teil, fehlversuche: this.zustand().fehlversuche ?? 0 };
		// Undefinierte Felder weglassen, damit der abgelegte Stand schlank bleibt.
		for (const f of ['smiley', 'notiz'] as const) if (ergebnis[f] === undefined) delete ergebnis[f];
		this.aendern((z) => ({
			...z,
			index: { ...z.index, [k]: z.index[k] + 1 },
			ergebnisse: { ...z.ergebnisse, [k]: [...z.ergebnisse[k], ergebnis] },
			aufgabeSeit: this.uhr().getTime(),
			fehlversuche: 0,
		}));
		this.dialog.set(this.aktuelleAufgabe() === null ? { art: 'rueckmeldung' } : null);
	}

	private aendern(fn: (z: TestmodusStand) => TestmodusStand): void {
		this.store.setzeTestmodus(fn(this.zustand()));
	}
}
