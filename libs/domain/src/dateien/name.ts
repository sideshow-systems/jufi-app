const MAX_ZEICHEN = 120;

// Die Endung beginnt am letzten Punkt, aber nur wenn davor etwas steht (".gitignore" hat
// keine) und danach kein Leerraum folgt: In "Version 1.2 Entwurf" ist ".2 Entwurf" keine.
function endungsStart(name: string): number {
	const m = /\.[^./\\\s]{1,10}$/u.exec(name);
	return m && m.index > 0 ? m.index : -1;
}

export function ohneEndung(name: string): string {
	const start = endungsStart(name);
	return start < 0 ? name : name.slice(0, start);
}

// Der Name kommt prozent-kodiert aus einem Kopf (X-Dateiname), weil Kopfwerte nur ASCII
// vertragen. Er dient nur der Anzeige und dem Download-Namen; der Speicherschluessel
// haengt nie an ihm, daher genuegt es, ihn lesbar und harmlos zu machen. Leerraum wird
// vor den Steuerzeichen zusammengezogen, sonst verschwaende aus "a\nb" das Trennzeichen.
export function bereinigeDateiname(roh: string | undefined): string | null {
	if (roh === undefined) return null;
	let name: string;
	try {
		name = decodeURIComponent(roh);
	} catch {
		return null;
	}
	name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
	name = name
		.replace(/\s+/gu, ' ')
		.replace(/[\p{Cc}"]/gu, '')
		.trim();
	const zeichen = Array.from(name);
	if (zeichen.length > MAX_ZEICHEN) {
		// Nach Codepoints, damit kein Emoji zerbricht. Die Endung bleibt, damit der Download
		// sich weiter oeffnen laesst; ist sie selbst zu lang, wird der Name einfach gekappt.
		const start = endungsStart(name);
		const endung = start < 0 ? [] : Array.from(name.slice(start));
		name =
			endung.length < MAX_ZEICHEN
				? Array.from(name.slice(0, start))
						.slice(0, MAX_ZEICHEN - endung.length)
						.join('') + endung.join('')
				: zeichen.slice(0, MAX_ZEICHEN).join('');
	}
	name = name.trim();
	return name === '' ? null : name;
}
