import { HAEUFIGE_PASSWOERTER } from './haeufige-passwoerter.js';

// Spec 3.4: Laenge statt Zusammensetzungsregeln. "Ein Grossbuchstabe, eine Ziffer"
// treibt Leute zu "Passwort1!"; zehn Zeichen und eine Sperrliste halten die
// offensichtlichen Fehlgriffe draussen, ohne Gedaechtnisstuetzen zu verbieten.
export const PASSWORT_MIN = 10;

export type PasswortPruefung = { ok: true } | { ok: false; grund: 'zu-kurz' | 'zu-haeufig' };

export const PASSWORT_HINWEIS: Record<'zu-kurz' | 'zu-haeufig', string> = {
	'zu-kurz': 'Mindestens 10 Zeichen',
	'zu-haeufig': 'Dieses Passwort ist zu verbreitet',
};

// Code-Points statt string.length: Ein Emoji zaehlt als ein Zeichen, nicht als zwei
// UTF-16-Einheiten. Sonst waeren fuenf Fische ein "zehn Zeichen langes" Passwort.
export function pruefePasswort(passwort: string): PasswortPruefung {
	if ([...passwort].length < PASSWORT_MIN) return { ok: false, grund: 'zu-kurz' };
	// Ein einziges wiederholtes Zeichen steht in keiner Liste vollstaendig (aaaaaaaaaaaa,
	// 0000000000000), ist aber das Erste, was jemand ausprobiert.
	if (HAEUFIGE_PASSWOERTER.has(passwort.toLowerCase()) || /^(.)\1+$/u.test(passwort)) {
		return { ok: false, grund: 'zu-haeufig' };
	}
	return { ok: true };
}
