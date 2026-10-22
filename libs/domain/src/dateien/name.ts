import { ENDUNGEN } from './typ.js';

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

// Die gemeinsame Saeuberung von bereinigeDateiname (Kopf, prozent-kodiert) und
// pruefeDateiname (Formularfeld, schon Klartext): Dekodieren gehoert nur zum Kopf, ein
// "100%.pdf" aus einem Formular darf nicht daran scheitern. Verworfen: pruefeDateiname
// ueber bereinigeDateiname mit encodeURIComponent zu fuehren, weil der Hin- und Rueckweg
// durch die Kodierung nur eine Fehlerquelle mehr waere.
// Leerraum wird vor den Steuerzeichen zusammengezogen, sonst verschwaende aus "a\nb" das
// Trennzeichen. \p{Cf} faellt mit weg: U+202E dreht die Schreibrichtung, und aus
// "a<U+202E>fdp.exe" wird in der Liste "aexe.pdf" -- ein Name, der eine Endung vortaeuscht.
// Dass auch der Zero-Width-Joiner geht und Familien-Emoji in ihre Teile zerfallen, ist der
// Preis; verworfen: nur die Richtungszeichen zu entfernen, weil die Liste der Fehlgriffe
// (U+200B, U+2060, U+FEFF ...) laenger ist als die der Emoji.
function saeubere(roh: string): string | null {
	let name = roh.slice(Math.max(roh.lastIndexOf('/'), roh.lastIndexOf('\\')) + 1);
	name = name
		.replace(/\s+/gu, ' ')
		.replace(/[\p{Cc}\p{Cf}"]/gu, '')
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

// Der Name kommt prozent-kodiert aus einem Kopf (X-Dateiname), weil Kopfwerte nur ASCII
// vertragen. Er dient nur der Anzeige und dem Download-Namen; der Speicherschluessel
// haengt nie an ihm, daher genuegt es, ihn lesbar und harmlos zu machen.
export function bereinigeDateiname(roh: string | undefined): string | null {
	if (roh === undefined) return null;
	try {
		return saeubere(decodeURIComponent(roh));
	} catch {
		return null;
	}
}

// Fuer Namen, die als Klartext ankommen (Umbenennen im JSON-Body).
export function pruefeDateiname(roh: string): { ok: true; name: string } | { ok: false; fehler: string } {
	const name = saeubere(roh);
	return name === null ? { ok: false, fehler: 'Der Name darf nicht leer sein' } : { ok: true, name };
}

// Alle Endungen, die irgendein erkannter Typ traegt: Nur sie werden ersetzt. Eine
// unbekannte wie ".final" in "Bericht.final" ist Teil des Namens, und ".2" in "Version 1.2"
// ebenso; verworfen: jede Endung zu ersetzen, weil dabei Teile des Namens verschwaenden.
const BEKANNTE_ENDUNGEN = new Set([...ENDUNGEN.values()].flat());

/**
 * Der Name mit der Endung, die zum erkannten Typ passt (Plan, Entscheidung 9): Er wird
 * dem Empfaenger angezeigt und beim Download vorgeschlagen, und ein PNG namens "x.pdf"
 * liesse sich nicht oeffnen. Die Schreibweise einer passenden Endung bleibt ("Foto.JPEG").
 * Gekuerzt wird der Stamm, nie die Endung.
 */
export function passendeEndung(name: string, typ: string): string {
	const passend = ENDUNGEN.get(typ) ?? [];
	const start = endungsStart(name);
	const vorhanden = start < 0 ? '' : name.slice(start + 1).toLowerCase();
	let ergebnis = name;
	if (passend.length > 0 && !passend.includes(vorhanden)) {
		const stamm = BEKANNTE_ENDUNGEN.has(vorhanden) ? name.slice(0, start) : name;
		ergebnis = `${stamm}.${passend[0]}`;
	}
	const zeichen = Array.from(ergebnis);
	if (zeichen.length <= MAX_ZEICHEN) return ergebnis;
	const endungStart = endungsStart(ergebnis);
	if (endungStart < 0) return zeichen.slice(0, MAX_ZEICHEN).join('');
	const endung = Array.from(ergebnis.slice(endungStart));
	return (
		Array.from(ergebnis.slice(0, endungStart))
			.slice(0, MAX_ZEICHEN - endung.length)
			.join('')
			.trimEnd() + endung.join('')
	);
}
