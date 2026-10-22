import { terminZeit, wochentagKurz } from '../module/termin/termin.js';
import { berlinerTag, berlinerUhrzeit } from '../zeit.js';
import type { AuswertungsName } from './antworten.js';
import type { ThreadAnsicht, UmfrageAnsicht } from './ansicht.js';
import { threadSegment } from './pfad.js';

// Spec 7.1. Der Text entsteht aus der ThreadAnsicht, die schon je Betrachter gerechnet
// ist (3.4): Namen stehen nur im Text, wenn die Person sie auch auf dem Bildschirm sieht.
// Verworfen: den Text am Server aus den Rohdaten zu bauen, weil Safari navigator.share nur
// innerhalb der Nutzergeste erlaubt und eine Anfrage davor sie verbraucht.

const MAX_NAMEN = 10;

// Die Zeilen der Teilnahme-Umfrage kommen aus den Schluesseln der Optionen, nicht aus
// dem Text: der Ersteller darf "Dabei" in "Ich komme" umbenennen, das Zeichen bleibt.
const TEILNAHME_EMOJI: Record<string, string> = { dabei: '✅', vielleicht: '🤔', abgesagt: '❌' };
// Fuer einen unbekannten Schluessel statt eines geratenen Emojis der neutrale Punkt.
const ANDERE_OPTION = '•';

const FORMATZEICHEN: Record<string, string> = { '*': '∗', _: 'ˍ', '~': '∼', '`': 'ˋ' };

/**
 * Ersetzt WhatsApps Formatzeichen in fremdem Text durch gleich aussehende Zeichen, damit
 * "Bowling *neu*" nicht die Fettschrift des Titels zerreisst. Verworfen: ein unsichtbares
 * Zeichen dazwischen, weil nirgends festgelegt ist, ob WhatsApp es als Grenze wertet; die
 * Ersatzzeichen wirken sicher.
 */
export function ohneFormat(text: string): string {
	return text.replace(/[*_~`]/g, (z) => FORMATZEICHEN[z]);
}

// Ein vorangestelltes Emoji bleibt ausserhalb der Sternchen, sonst faerbt WhatsApp es mit.
// Besteht der Titel nur aus dem Emoji, bleibt kein Text zum Fettdrucken: dann steht es
// samt Sternchen da, damit die Zeile gueltig bleibt und kein leeres "**" entsteht.
function titelteil(titel: string): string {
	const sauber = ohneFormat(titel);
	const treffer = /^(\p{Extended_Pictographic}\S*)\s+(.+)$/su.exec(sauber);
	return treffer ? `${treffer[1]} *${treffer[2]}*` : `*${sauber}*`;
}

// Ab dem elften Namen ", …": eine lange Liste macht den Text am Handy unlesbar.
function namenListe(namen: readonly AuswertungsName[]): string {
	const liste = namen
		.slice(0, MAX_NAMEN)
		.map((n) => ohneFormat(n.name))
		.join(', ');
	return namen.length > MAX_NAMEN ? `${liste}, …` : liste;
}

type Liste = { anzahl: number; namen: AuswertungsName[] | null };

// "Text (n): Namen", bei null Namen ohne Doppelpunkt; ohne Namen (SUMME) "Text: n".
// Hat die Ansicht fuer NAMEN keine Namenliste, gilt sie wie SUMME: lieber weniger sagen.
function zaehlzeile(vorne: string, text: string, liste: Liste): string {
	if (liste.namen === null) return `${vorne} ${text}: ${liste.anzahl}`;
	const kopf = `${vorne} ${text} (${liste.anzahl})`;
	return liste.namen.length === 0 ? kopf : `${kopf}: ${namenListe(liste.namen)}`;
}

function umfrageZeilen(u: UmfrageAnsicht): string[] {
	const e = u.ergebnis;
	if (!e) return [];
	const liste = (optionId: string): Liste =>
		e.optionen.find((o) => o.optionId === optionId) ?? { anzahl: 0, namen: null };
	if (u.teilnahme) {
		return [
			...u.optionen.map((o) =>
				zaehlzeile(TEILNAHME_EMOJI[o.schluessel] ?? ANDERE_OPTION, ohneFormat(o.text), liste(o.id)),
			),
			zaehlzeile('❓', 'Offen', e.offen),
		];
	}
	return [`📊 ${ohneFormat(u.frage)}`, ...u.optionen.map((o) => zaehlzeile('•', ohneFormat(o.text), liste(o.id)))];
}

export function teilenText(e: { ansicht: ThreadAnsicht; basisUrl: string; slug: string; jetzt: Date }): string {
	const { ansicht, jetzt } = e;
	const zeilen = [`${titelteil(ansicht.titel)} – Stand ${wochentagKurz(berlinerTag(jetzt))} ${berlinerUhrzeit(jetzt)}`];
	for (const m of ansicht.module) {
		switch (m.typ) {
			case 'TERMIN': {
				const ort = m.termin.ort ? ` · ${ohneFormat(m.termin.ort)}` : '';
				zeilen.push(`📅 ${terminZeit(m.termin)}${ort}`);
				break;
			}
			case 'UMFRAGE':
				zeilen.push(...umfrageZeilen(m));
				break;
			// Der Infotext ist keine Zeile (TP3-Spec 7.1 nennt nur Termin und Umfrage); wer ihn lesen
			// will, folgt dem Link.
			case 'INFO':
				break;
			// Dateien und Fotos bekommen keine Zeile (Spec 11): Der Text geht an eine Gruppe ausserhalb
			// der App, und ein Name, eine Zahl oder ein Hinweis auf Einwilligungen gehoert nicht dorthin.
			case 'DATEIEN':
			case 'FOTOS':
				break;
			// Die Zeile der Helferliste kommt mit Etappe 6 (Spec 11); bis dahin lieber keine als eine halbe.
			case 'HELFER':
				break;
			default: {
				const unerreichbar: never = m;
				return unerreichbar;
			}
		}
	}
	zeilen.push(`👉 Antworten: ${e.basisUrl}/${e.slug}/t/${threadSegment(ansicht.id, ansicht.titel)}`);
	return zeilen.join('\n');
}
