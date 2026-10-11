import { computed, DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { kannRechtEntziehen } from '../regeln/personen';
import { type Ablage, browserAblage, frisch, laden, speichern } from './speicher';
import type { Auto, Datenstand, Id, KostenStatus, Modul, Person, Recht, Thread } from './typen';
import { alsIso, jetzt } from './zeit';

export const ABLAGE = new InjectionToken<Ablage>('ABLAGE', { providedIn: 'root', factory: browserAblage });

/** Die echte Uhr; in Tests ersetzt, damit "jetzt" feststeht. */
export const UHR = new InjectionToken<() => Date>('UHR', { providedIn: 'root', factory: () => () => new Date() });

let zaehler = 0;
const neueId = (praefix: string) => `${praefix}-${Date.now().toString(36)}${(++zaehler).toString(36)}`;

/**
 * Der gesamte Datenstand des Entwurfs als Signale (Spec TP1 8.2).
 *
 * Jede Aktion erzeugt einen neuen Stand und legt ihn sofort ab. Verworfen: ein
 * effect, der nachtraeglich speichert — der liefe erst nach dem naechsten
 * Zeichnen, und ein Neuladen direkt nach dem Tippen verloere die Eingabe.
 */
@Injectable({ providedIn: 'root' })
export class EntwurfStore {
	private readonly ablage = inject(ABLAGE);
	private readonly uhr = inject(UHR);

	private readonly geladen = laden(this.ablage, this.uhr());
	private readonly _stand = signal<Datenstand>(this.geladen.stand);
	private readonly _ich = signal<Id>(this.geladen.ich);
	private readonly _testmodus = signal<unknown>(this.geladen.testmodus);
	private readonly echt = signal(this.uhr());

	readonly stand = this._stand.asReadonly();
	/** Die "angemeldete" Person; gewechselt wird sie vom Testmodus. */
	readonly ich = this._ich.asReadonly();
	readonly testmodusDaten = this._testmodus.asReadonly();
	readonly jetzt = computed(() => jetzt(this._stand().bezugstag, this.echt()));
	readonly person = computed(() => this._stand().personen.find((p) => p.id === this._ich())!);

	constructor() {
		// Minuetlich, damit "Stand 10:05" im Teilen-Text und Fristen mitlaufen.
		const takt = setInterval(() => this.echt.set(this.uhr()), 60_000);
		inject(DestroyRef).onDestroy(() => clearInterval(takt));
	}

	setzeIch(id: Id): void {
		this._ich.set(id);
		this.ablegen();
	}

	setzeTestmodus(daten: unknown): void {
		this._testmodus.set(daten);
		this.ablegen();
	}

	antworten(threadId: Id, modulId: Id, fuer: Id, optionen: Id[]): void {
		const zeit = this.zeit();
		this.modulAendern(threadId, modulId, (m) =>
			m.typ !== 'umfrage'
				? m
				: {
						...m,
						antworten: [...m.antworten.filter((a) => a.fuer !== fuer), { fuer, von: this._ich(), optionen, zeit }],
					},
		);
	}

	/** false, wenn der Platz voll ist oder die Person dort schon steht. */
	helferEintragen(threadId: Id, modulId: Id, platzId: Id, fuer: Id): boolean {
		let ok = false;
		this.modulAendern(threadId, modulId, (m) => {
			if (m.typ !== 'helfer') return m;
			return {
				...m,
				plaetze: m.plaetze.map((p) => {
					if (p.id !== platzId || p.eintraege.length >= p.anzahl || p.eintraege.some((e) => e.fuer === fuer)) return p;
					ok = true;
					return { ...p, eintraege: [...p.eintraege, { fuer, von: this._ich() }] };
				}),
			};
		});
		return ok;
	}

	helferAustragen(threadId: Id, modulId: Id, platzId: Id, fuer: Id): void {
		this.modulAendern(threadId, modulId, (m) =>
			m.typ !== 'helfer'
				? m
				: {
						...m,
						plaetze: m.plaetze.map((p) =>
							p.id === platzId ? { ...p, eintraege: p.eintraege.filter((e) => e.fuer !== fuer) } : p,
						),
					},
		);
	}

	autoAnbieten(threadId: Id, modulId: Id, auto: Omit<Auto, 'id' | 'mitfahrer'>): void {
		this.modulAendern(threadId, modulId, (m) =>
			m.typ !== 'fahrt' ? m : { ...m, autos: [...m.autos, { ...auto, id: neueId('a'), mitfahrer: [] }] },
		);
	}

	/**
	 * Setzt ein Kind fuer eine Richtung in ein Auto (null: aus allen Autos
	 * heraus). Ein Kind sitzt je Richtung in hoechstens einem Auto; false, wenn
	 * das Ziel voll ist.
	 */
	mitfahrerSetzen(threadId: Id, modulId: Id, kindId: Id, autoId: Id | null, richtung: 'hin' | 'rueck'): boolean {
		let ok = true;
		this.modulAendern(threadId, modulId, (m) => {
			if (m.typ !== 'fahrt') return m;
			const ziel = m.autos.find((a) => a.id === autoId);
			if (ziel && !ziel.mitfahrer.includes(kindId) && ziel.mitfahrer.length >= ziel.plaetze) {
				ok = false;
				return m;
			}
			return {
				...m,
				autos: m.autos.map((a) => {
					if (a.richtung !== richtung) return a;
					const ohne = a.mitfahrer.filter((id) => id !== kindId);
					return { ...a, mitfahrer: a.id === autoId ? [...ohne, kindId] : ohne };
				}),
			};
		});
		return ok;
	}

	kostenSetzen(threadId: Id, modulId: Id, kindId: Id, status: KostenStatus): void {
		this.modulAendern(threadId, modulId, (m) => {
			if (m.typ !== 'kosten') return m;
			const { [kindId]: _, ...rest } = m.status;
			return { ...m, status: status === 'offen' ? rest : { ...rest, [kindId]: status } };
		});
	}

	nachrichtSchreiben(threadId: Id, text: string): void {
		const t = text.trim();
		if (!t) return;
		this.threadAendern(threadId, (th) => ({
			...th,
			verlauf: [...th.verlauf, { id: neueId('v'), art: 'nachricht', von: this._ich(), text: t, zeit: this.zeit() }],
		}));
	}

	/** Legt einen neuen Thread an (leere id) oder ersetzt einen vorhandenen. */
	threadSpeichern(t: Thread): Thread {
		const stand = this._stand();
		const vorhanden = stand.threads.some((x) => x.id === t.id && t.id !== '');
		const gespeichert: Thread = vorhanden
			? { ...t, letzteAktivitaet: this.zeit() }
			: {
					...t,
					id: neueId('t'),
					nr: Math.max(0, ...stand.threads.map((x) => x.nr)) + 1,
					letzteAktivitaet: this.zeit(),
				};
		this.setze({
			...stand,
			threads: vorhanden
				? stand.threads.map((x) => (x.id === t.id ? gespeichert : x))
				: [...stand.threads, gespeichert],
		});
		return gespeichert;
	}

	threadArchivieren(threadId: Id, archiviert: boolean): void {
		this.threadAendern(threadId, (t) => ({ ...t, archiviert }));
	}

	personAnlegen(p: Omit<Person, 'id'>, kinder: Id[]): Id {
		const id = neueId('p');
		const stand = this._stand();
		this.setze({
			...stand,
			personen: [...stand.personen, { ...p, id }],
			elternschaften: [...stand.elternschaften, ...kinder.map((kind) => ({ elternteil: id, kind }))],
			letzterBesuch: { ...stand.letzterBesuch, [id]: this.zeit() },
		});
		return id;
	}

	/** Das Recht "Rechte verwalten" bleibt beim letzten Inhaber (Rahmen 4.2). */
	rechteSetzen(personId: Id, rechte: Recht[]): void {
		const stand = this._stand();
		const behalten =
			!rechte.includes('rechteVerwalten') &&
			stand.personen.find((p) => p.id === personId)?.rechte.includes('rechteVerwalten') &&
			!kannRechtEntziehen(stand, personId, 'rechteVerwalten');
		const neu: Recht[] = behalten ? [...rechte, 'rechteVerwalten'] : rechte;
		this.personAendern(personId, (p) => ({ ...p, rechte: neu }));
	}

	fotoEinwilligungSetzen(kindId: Id, wert: boolean): void {
		this.personAendern(kindId, (p) => ({ ...p, fotoEinwilligung: wert }));
	}

	vereinsfarbeSetzen(hex: string): void {
		const stand = this._stand();
		this.setze({ ...stand, verein: { ...stand.verein, farbe: hex } });
	}

	besuchMerken(personId: Id): void {
		const stand = this._stand();
		this.setze({ ...stand, letzterBesuch: { ...stand.letzterBesuch, [personId]: this.zeit() } });
	}

	zuruecksetzen(): void {
		const g = frisch(this.uhr());
		this._stand.set(g.stand);
		this._ich.set(g.ich);
		this._testmodus.set(null);
		this.ablegen();
	}

	private zeit(): string {
		return alsIso(this.jetzt());
	}

	private setze(stand: Datenstand): void {
		this._stand.set(stand);
		this.ablegen();
	}

	private ablegen(): void {
		speichern(this.ablage, { stand: this._stand(), testmodus: this._testmodus(), ich: this._ich() });
	}

	private threadAendern(threadId: Id, fn: (t: Thread) => Thread): void {
		const stand = this._stand();
		const zeit = this.zeit();
		this.setze({
			...stand,
			threads: stand.threads.map((t) => (t.id === threadId ? { ...fn(t), letzteAktivitaet: zeit } : t)),
		});
	}

	private modulAendern(threadId: Id, modulId: Id, fn: (m: Modul) => Modul): void {
		this.threadAendern(threadId, (t) => ({ ...t, module: t.module.map((m) => (m.id === modulId ? fn(m) : m)) }));
	}

	private personAendern(personId: Id, fn: (p: Person) => Person): void {
		const stand = this._stand();
		this.setze({ ...stand, personen: stand.personen.map((p) => (p.id === personId ? fn(p) : p)) });
	}
}
