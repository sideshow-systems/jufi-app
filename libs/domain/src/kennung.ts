// Benutzername und E-Mail werden vor Speichern und Vergleichen normalisiert (trimmen,
// klein), damit "Florian" und "florian " dieselbe Person sind und die Eindeutigkeit
// in der Datenbank ohne Sonderindex auskommt. Die Pruefung gilt dem normalisierten Wert;
// wer "Florian" ungeprueft durchreicht, bekommt eine Ablehnung statt stiller Korrektur.

export function normalisiereBenutzername(s: string): string {
	return s.trim().toLowerCase();
}

const BENUTZERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export function pruefeBenutzername(s: string): boolean {
	return BENUTZERNAME.test(s);
}

export function normalisiereEmail(s: string): string {
	return s.trim().toLowerCase();
}

// Absichtlich grob: Ob eine Adresse wirklich zustellbar ist, zeigt nur eine Mail.
// Eine strenge Pruefung nach RFC 5322 wiese echte Adressen ab; hier reicht, was
// Tippfehler wie "thomas" oder "thomas@example" faengt. 254 ist die Obergrenze aus RFC 5321.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

export function pruefeEmail(s: string): boolean {
	return s.length <= EMAIL_MAX && EMAIL.test(s);
}
