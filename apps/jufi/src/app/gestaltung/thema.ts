import { computed, effect, Injectable, signal } from '@angular/core';
import { vereinsfarben } from './farben';

export type ThemaWahl = 'hell' | 'dunkel' | 'system';

/**
 * Die Darstellung ist eine Vorliebe des Geraets, nicht des Kontos: sie liegt
 * im localStorage und ueberlebt Abmelden und Kontowechsel. Verworfen: sie am
 * Konto zu speichern -- dann stuende beim Anmelden kurz die falsche Darstellung
 * da, und auf einem geteilten Geraet wuerde sie dem naechsten Konto aufgezwungen.
 */
const SCHLUESSEL = 'jufi:thema';

function gemerkteWahl(): ThemaWahl {
	try {
		const w = localStorage.getItem(SCHLUESSEL);
		return w === 'hell' || w === 'dunkel' || w === 'system' ? w : 'system';
	} catch {
		return 'system';
	}
}

/**
 * Hell, Dunkel oder System, dazu die Vereinsfarbe als CSS-Variablen.
 *
 * Die Farben fuer beide Modi werden gleichzeitig gesetzt (--akzent-hell,
 * --akzent-dunkel …); styles.css waehlt je Modus. So wirkt ein Wechsel des
 * Systemmodus ohne JavaScript, und die Vereinsfarbe muss nur einmal gerechnet
 * werden. data-theme traegt light/dark wie in der Spec; bei "System" fehlt es.
 */
@Injectable({ providedIn: 'root' })
export class ThemaService {
	readonly wahl = signal<ThemaWahl>(gemerkteWahl());
	private readonly systemDunkel = signal(false);
	readonly aktiv = computed<'hell' | 'dunkel'>(() => {
		const w = this.wahl();
		return w === 'system' ? (this.systemDunkel() ? 'dunkel' : 'hell') : w;
	});

	constructor() {
		const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
		if (mq) {
			this.systemDunkel.set(mq.matches);
			mq.addEventListener?.('change', (e) => this.systemDunkel.set(e.matches));
		}
		effect(() => {
			const w = this.wahl();
			const html = document.documentElement;
			if (w === 'system') html.removeAttribute('data-theme');
			else html.setAttribute('data-theme', w === 'dunkel' ? 'dark' : 'light');
		});
	}

	setzeWahl(w: ThemaWahl): void {
		this.wahl.set(w);
		try {
			localStorage.setItem(SCHLUESSEL, w);
		} catch {
			// Privater Modus: die Wahl gilt dann nur bis zum Neuladen.
		}
	}

	setzeVereinsfarbe(hex: string): void {
		const f = vereinsfarben(hex);
		const s = document.documentElement.style;
		for (const modus of ['hell', 'dunkel'] as const) {
			s.setProperty(`--akzent-${modus}`, f[modus].akzent);
			s.setProperty(`--akzent-flaeche-${modus}`, f[modus].akzentFlaeche);
			s.setProperty(`--auf-akzent-${modus}`, f[modus].aufAkzent);
		}
	}

	/**
	 * Nimmt die Vereinsfarbe zurueck auf die Vorgaben aus styles.css. Die Werte
	 * stehen als Inline-Eigenschaften auf html und blieben sonst nach dem Verlassen
	 * eines Vereins stehen: die Plattformseite und der naechste Verein erschienen
	 * in der Farbe des vorigen.
	 */
	entferneVereinsfarbe(): void {
		const s = document.documentElement.style;
		for (const modus of ['hell', 'dunkel'] as const) {
			s.removeProperty(`--akzent-${modus}`);
			s.removeProperty(`--akzent-flaeche-${modus}`);
			s.removeProperty(`--auf-akzent-${modus}`);
		}
	}
}
