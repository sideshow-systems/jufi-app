import { WHATSAPP_NUMMER } from '../../konfig.generated';
import { teileText } from '../gestaltung/teilen-aktion';

export type Versandweg = 'whatsapp' | 'geteilt' | 'kopiert' | 'abgebrochen' | 'fehler';

/** wa.me mit dem ganzen Text als Parameter; encodeURIComponent traegt Umlaute, Emoji und Zeilenumbrueche. */
export function whatsappUrl(nummer: string, text: string): string {
	return `https://wa.me/${nummer}?text=${encodeURIComponent(text)}`;
}

/**
 * Rueckmeldung verschicken (Spec TP1 5.5): mit konfigurierter Nummer direkt in
 * WhatsApp; ohne Nummer oder wenn der Browser das Fenster blockiert, ueber das
 * Teilen-Menue, sonst in die Zwischenablage.
 */
export async function versenden(text: string, nummer: string | null = WHATSAPP_NUMMER): Promise<Versandweg> {
	if (nummer) {
		try {
			if (window.open(whatsappUrl(nummer, text), '_blank')) return 'whatsapp';
		} catch {
			// Blockiert: weiter mit Teilen bzw. Kopieren.
		}
	}
	return teileText(text);
}
