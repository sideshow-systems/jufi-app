import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { TESTEREIGNISSE } from '../daten/ereignisse';
import { EntwurfStore } from '../daten/store';
import type { Thread } from '../daten/typen';
import { teilenText } from '../regeln/teilen';
import { MeldungService } from './meldung';

/**
 * Teilt einen Text: am Handy ueber das Teilen-Menue (Web Share API), sonst
 * in die Zwischenablage (Rahmen 6.7). "abgebrochen", wenn die Person das Menue
 * schliesst — das zaehlt trotzdem als ausgeloest.
 */
export async function teileText(text: string): Promise<'geteilt' | 'kopiert' | 'abgebrochen' | 'fehler'> {
	if (typeof navigator.share === 'function') {
		try {
			await navigator.share({ text });
			return 'geteilt';
		} catch (e) {
			if ((e as Error)?.name === 'AbortError') return 'abgebrochen';
		}
	}
	return kopiere(text);
}

export async function kopiere(text: string): Promise<'kopiert' | 'fehler'> {
	try {
		await navigator.clipboard.writeText(text);
		return 'kopiert';
	} catch {
		return 'fehler';
	}
}

/**
 * Teilt den Stand eines Threads (Thread-Kopf und Antwort-Uebersicht der
 * Verwaltung) und meldet es dem Testmodus. Die Adresse zeigt auf diesen
 * Entwurf, damit ein Link aus WhatsApp wieder hier landet.
 */
@Injectable({ providedIn: 'root' })
export class ThreadTeilen {
	private readonly store = inject(EntwurfStore);
	private readonly meldung = inject(MeldungService);
	private readonly ereignisse = inject(TESTEREIGNISSE);
	private readonly dokument = inject(DOCUMENT);

	async teilen(t: Thread): Promise<void> {
		const basis = `${this.dokument.location.origin}/entwurf`;
		const ergebnis = await teileText(teilenText(this.store.stand(), t, basis, this.store.jetzt()));
		if (ergebnis === 'fehler') {
			this.meldung.zeige('Teilen nicht möglich');
			return;
		}
		if (ergebnis === 'kopiert') this.meldung.zeige('Text kopiert');
		this.ereignisse.next({ art: 'geteilt', threadId: t.id });
	}
}
