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
