import type { MarkedExtension, Tokens } from 'marked';

/** Die Schemata, die als Link erscheinen duerfen (Spec 3.11); alles andere bleibt Text. */
const ERLAUBTE_SCHEMATA = new Set(['https:', 'http:', 'mailto:']);

function maskiere(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Ein Block ausserhalb der Teilmenge als Absatz mit seinem Rohtext; die Zeilen bleiben Zeilen. */
function blockAlsText(roh: string): string {
	const text = roh.replace(/^\n+|\n+$/g, '');
	return text ? `<p>${maskiere(text).replace(/\n/g, '<br>')}</p>\n` : '';
}

/** Die Adresse, wenn sie als Link erscheinen darf, sonst null. */
function erlaubteAdresse(href: string): string | null {
	let schema: string;
	try {
		schema = new URL(href).protocol;
	} catch {
		// Relative oder kaputte Adressen haben kein Ziel ausserhalb der App, das der Text meinen koennte.
		return null;
	}
	if (!ERLAUBTE_SCHEMATA.has(schema)) return null;
	try {
		// Wie marked selbst: Leerzeichen und Umlaute kodieren, ein schon kodiertes Prozentzeichen nicht doppelt.
		return encodeURI(href).replace(/%25/g, '%');
	} catch {
		return null;
	}
}

/**
 * Der Renderer der Teilmenge (Spec 3.11): Absaetze, fett, kursiv, Listen mit "- " und Links auf
 * https, http und mailto. Alles andere gibt seinen Rohtext maskiert zurueck und erscheint so, wie
 * es getippt wurde. Verworfen: die Tokenizer fuer Ueberschriften, Code, HTML und Bilder abschalten;
 * marked faellt bei einem abgelehnten Tokenizer auf den eingebauten zurueck, und ein Renderer, der
 * jeden Token-Typ selbst beantwortet, laesst keinen Weg zu HTML offen, den eine neue Version von
 * marked als Standard mitbringen koennte. Angulars Sanitizer bei [innerHTML] bleibt der zweite Riegel.
 */
const TEILMENGE: MarkedExtension = {
	renderer: {
		heading: (t: Tokens.Heading) => blockAlsText(t.raw),
		code: (t: Tokens.Code) => blockAlsText(t.raw),
		blockquote: (t: Tokens.Blockquote) => blockAlsText(t.raw),
		hr: (t: Tokens.Hr) => blockAlsText(t.raw),
		table: (t: Tokens.Table) => blockAlsText(t.raw),
		def: (t: Tokens.Def) => blockAlsText(t.raw),
		// Nummerierte Listen gehoeren nicht zur Teilmenge; ihre Zeilen bleiben trotzdem lesbar.
		list: (t: Tokens.List) => (t.ordered ? blockAlsText(t.raw) : false),
		checkbox: (t: Tokens.Checkbox) => maskiere(t.raw),
		html: (t: Tokens.HTML | Tokens.Tag) => ('block' in t && t.block ? blockAlsText(t.raw) : maskiere(t.raw)),
		codespan: (t: Tokens.Codespan) => maskiere(t.raw),
		del: (t: Tokens.Del) => maskiere(t.raw),
		image: (t: Tokens.Image) => maskiere(t.raw),
		link(t: Tokens.Link) {
			const href = erlaubteAdresse(t.href);
			if (href === null) return maskiere(t.raw);
			const text = t.tokens ? this.parser.parseInline(t.tokens) : maskiere(t.text);
			return `<a href="${maskiere(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
		},
	},
};

let parser: Promise<(text: string) => string> | undefined;

/**
 * Der Info-Text als HTML. marked wird erst beim ersten Info-Modul geladen, wie bei den
 * Rechtstexten: Wer nie einen Thread mit Info-Text oeffnet, traegt den Parser nicht im
 * Startbuendel. Die Instanz bleibt danach erhalten; eine eigene statt des globalen marked,
 * damit der Renderer nicht in die Rechtstexte durchschlaegt, die Ueberschriften brauchen.
 */
export function infoHtml(text: string): Promise<string> {
	parser ??= import('marked')
		.then(({ Marked }) => {
			const marked = new Marked({ gfm: true, breaks: true }, TEILMENGE);
			return (t: string) => marked.parse(t, { async: false });
		})
		.catch((ursache: unknown) => {
			// Ein gescheiterter Nachladeversuch (Netz weg) soll beim naechsten Modul neu versucht werden.
			parser = undefined;
			throw ursache;
		});
	return parser.then((parse) => parse(text));
}
