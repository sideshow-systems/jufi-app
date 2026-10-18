import { leitungsEinladungsText, mitgliedEinladungsText, mitgliedResetText, notfallLinkText } from '../einladung.js';

/**
 * Text und Betreff einer Einladung. Die Texte selbst stehen bei der Einladung,
 * weil Dauer und Wirkung des Links dort entschieden werden; hier kommt nur der
 * Betreff dazu. Beim Notfall-Link steht schon im Betreff, dass es kein
 * gewoehnlicher Einladungslink ist.
 */
export function einladungsMail(t: {
	vorname: string;
	anzeigename: string;
	link: string;
	art: 'einladung' | 'notfall';
}): { betreff: string; text: string } {
	if (t.art === 'notfall') {
		return { betreff: `Neuer Zugangslink für ${t.anzeigename}`, text: notfallLinkText(t) };
	}
	return { betreff: `Einladung zur JuFi App: ${t.anzeigename}`, text: leitungsEinladungsText(t) };
}

/**
 * Reset-Mail. Die Stunde steht wortgleich in der Gueltigkeit des Reset-Links;
 * wer sie aendert, muss den Text mitziehen. Der Satz fuer Unbeteiligte steht
 * dabei, weil jeder eine Reset-Mail an eine fremde Adresse ausloesen kann.
 * Eine Fusszeile mit dem offiziellen Vereinsnamen entfaellt in TP2.
 */
export function resetMail(t: { vorname: string; anzeigename: string; link: string }): {
	betreff: string;
	text: string;
} {
	return {
		betreff: `Zugang zurücksetzen: ${t.anzeigename}`,
		text:
			`Hallo ${t.vorname}, für „${t.anzeigename}“ in der JuFi App wurde ein Zugang zum Zurücksetzen angefordert. ` +
			`Der Link gilt 1 Stunde und nur für dich:\n${t.link}\n\n` +
			`Falls du das nicht warst, ignoriere diese Mail.`,
	};
}

/** Betreff und Text der Mail zu einem Link aus der Verwaltung (Einladung oder Reset, je nach Art). */
export function mitgliedMail(t: { vorname: string; anzeigename: string; link: string; art: 'EINLADUNG' | 'RESET' }): {
	betreff: string;
	text: string;
} {
	if (t.art === 'RESET') {
		return { betreff: `Neuer Zugangslink für ${t.anzeigename}`, text: mitgliedResetText(t) };
	}
	return { betreff: `Einladung zur JuFi App: ${t.anzeigename}`, text: mitgliedEinladungsText(t) };
}
