import { terminFehler, type TerminDaten } from '../module/termin/termin.js';
import { einheitenFuer, neueUmfrageVorlage, teilnahmeOptionen } from '../module/umfrage/umfrage.js';
import { berlinerTag, tagPlus } from '../zeit.js';
import type { ModulDaten } from './ansicht.js';
import type { AntwortEinheit, ErgebnisSicht, Rollenfilter, ThreadKopf, ThreadModus } from './typen.js';

// Spec 4.3 und Plan-Entscheidung 8. Dieselben Zahlen stehen als CHECKs im Schema; die
// Pruefung hier ist die freundliche Fassung davor, die Datenbank die letzte Instanz.
export const GRENZEN = {
	titel: 120,
	module: 20,
	optionen: 20,
	infoText: 10_000,
	frage: 200,
	optionText: 200,
	modulTitel: 80,
	ort: 200,
	treffpunkt: 200,
} as const;

export const ROLLENFILTER_TEXT: Readonly<Record<Rollenfilter, string>> = {
	JUNGFISCHER_FAMILIE: 'Jungfischer + Familie',
	NUR_FAMILIE: 'Nur Familie',
	NUR_JUGENDLEITER: 'Nur Jugendleiter',
	JUGENDLEITER_JUGENDSPRECHER: 'Jugendleiter + Jugendsprecher',
};

export const EINHEIT_TEXT: Readonly<Record<AntwortEinheit, string>> = {
	JUNGFISCHER: 'Pro Jungfischer',
	ERWACHSENER: 'Pro Erwachsenem',
	PERSON: 'Pro Person',
};

export const ERGEBNIS_TEXT: Readonly<Record<ErgebnisSicht, string>> = {
	ALLE: 'Für alle',
	SUMME: 'Nur als Summe',
	JUGENDLEITER: 'Nur Jugendleiter',
};

// schluessel null heisst: neue Option, der Server vergibt den Schluessel (Entscheidung 11).
export interface OptionEntwurf {
	schluessel: string | null;
	text: string;
}

export type TerminEntwurf = Omit<TerminDaten, 'modulId'>;

// id null heisst: neues Modul. Die Frist steht als ISO-Zeichenkette (UTC), nicht als Date:
// der Entwurf geht als JSON zwischen Editor und Server hin und her und soll ohne
// Umwandlung gleich bleiben.
export type ModulEntwurf =
	| { typ: 'INFO'; id: string | null; titel: string | null; text: string }
	| { typ: 'TERMIN'; id: string | null; titel: string | null; termin: TerminEntwurf }
	| {
			typ: 'UMFRAGE';
			id: string | null;
			titel: string | null;
			frage: string;
			einheit: AntwortEinheit;
			mehrfach: boolean;
			teilnahme: boolean;
			vielleicht: boolean;
			frist: string | null;
			ergebnisse: ErgebnisSicht;
			optionen: OptionEntwurf[];
	  };

export interface ThreadEntwurf {
	titel: string;
	modus: ThreadModus;
	rollenfilter: Rollenfilter;
	alleUntergruppen: boolean;
	untergruppenIds: string[];
	module: ModulEntwurf[];
}

export interface Feldfehler {
	feld: string;
	text: string;
	konflikt?: true;
}

const MODI: readonly ThreadModus[] = ['AUSHANG', 'KOMMENTARE', 'CHAT'];
const ROLLENFILTER: readonly Rollenfilter[] = [
	'JUNGFISCHER_FAMILIE',
	'NUR_FAMILIE',
	'NUR_JUGENDLEITER',
	'JUGENDLEITER_JUGENDSPRECHER',
];
const EINHEITEN: readonly AntwortEinheit[] = ['JUNGFISCHER', 'ERWACHSENER', 'PERSON'];
const ERGEBNISSE: readonly ErgebnisSicht[] = ['ALLE', 'SUMME', 'JUGENDLEITER'];
const MODULTYPEN = ['INFO', 'TERMIN', 'UMFRAGE'] as const;

// ---------------------------------------------------------------------------------
// Form: entwurfAus
// ---------------------------------------------------------------------------------

// Geworfen statt als Rueckgabewert durchgereicht: Jedes Feld waere sonst ein
// "wert | Fehler" mit Weiche davor, und die Lesefunktion bestuende zur Haelfte aus Weichen.
// Der Wurf endet in entwurfAus und verlaesst die Datei nie.
class Ungueltig {
	constructor(readonly feld: string) {}
}

// Ein Zeitpunkt mit Zone. Ohne Zone lase Date.parse die Zeichenkette in der Zeitzone des
// Prozesses (Server UTC, Entwicklerrechner Berlin), und dieselbe Frist waere zwei Zeitpunkte.
// Verworfen: Date.parse allein, es nimmt je nach Laufzeit auch Formen wie "morgen 5".
const ISO_ZEITPUNKT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const istObjekt = (w: unknown): w is Record<string, unknown> =>
	typeof w === 'object' && w !== null && !Array.isArray(w);

function text(w: unknown, feld: string): string {
	if (typeof w !== 'string') throw new Ungueltig(feld);
	return w.trim();
}

// Fehlendes Feld, null und '' heissen alle "nicht gesetzt": Ein leeres Eingabefeld im Editor
// schickt '', ein altes Modul ohne das Feld schickt nichts.
function textOderNull(w: unknown, feld: string): string | null {
	if (w === undefined || w === null) return null;
	return text(w, feld) || null;
}

function wahrheit(w: unknown, feld: string): boolean {
	if (typeof w !== 'boolean') throw new Ungueltig(feld);
	return w;
}

// includes auf einer Liste statt "in" auf einem Objekt: Letzteres liesse "toString" durch.
function wahl<T extends string>(w: unknown, erlaubt: readonly T[], feld: string): T {
	if (typeof w !== 'string' || !erlaubt.includes(w as T)) throw new Ungueltig(feld);
	return w as T;
}

function frist(w: unknown, feld: string): string | null {
	const roh = textOderNull(w, feld);
	if (roh === null) return null;
	const ms = Date.parse(roh);
	if (!ISO_ZEITPUNKT.test(roh) || Number.isNaN(ms)) throw new Ungueltig(feld);
	// Normalisiert auf UTC: So gleicht der Vergleich mit der gespeicherten Frist
	// (entwurfAusThread schreibt toISOString) nicht an der Schreibweise.
	return new Date(ms).toISOString();
}

function termin(w: unknown, i: number): TerminEntwurf {
	const f = (name: string) => `module.${i}.${name}`;
	if (!istObjekt(w)) throw new Ungueltig(f('termin'));
	// Datum und Uhrzeiten teilen sich das Feld "termin", Ort und Treffpunkt haben eigene.
	return {
		startDatum: text(w['startDatum'], f('termin')),
		endDatum: textOderNull(w['endDatum'], f('termin')),
		beginn: textOderNull(w['beginn'], f('termin')),
		ende: textOderNull(w['ende'], f('termin')),
		ort: textOderNull(w['ort'], f('ort')),
		treffpunkt: textOderNull(w['treffpunkt'], f('treffpunkt')),
	};
}

function optionen(w: unknown, feld: string): OptionEntwurf[] {
	if (!Array.isArray(w)) throw new Ungueltig(feld);
	return w.map((o: unknown) => {
		if (!istObjekt(o)) throw new Ungueltig(feld);
		return { schluessel: textOderNull(o['schluessel'], feld), text: text(o['text'], feld) };
	});
}

function modul(w: unknown, i: number): ModulEntwurf {
	const f = (name: string) => `module.${i}.${name}`;
	if (!istObjekt(w)) throw new Ungueltig(f('typ'));
	const typ = wahl(w['typ'], MODULTYPEN, f('typ'));
	const kopf = { id: textOderNull(w['id'], f('id')), titel: textOderNull(w['titel'], f('titel')) };
	if (typ === 'INFO') return { typ, ...kopf, text: text(w['text'], f('text')) };
	if (typ === 'TERMIN') return { typ, ...kopf, termin: termin(w['termin'], i) };

	const teilnahme = wahrheit(w['teilnahme'], f('teilnahme'));
	const vielleicht = wahrheit(w['vielleicht'], f('vielleicht'));
	return {
		typ,
		...kopf,
		frage: text(w['frage'], f('frage')),
		einheit: wahl(w['einheit'], EINHEITEN, f('einheit')),
		mehrfach: wahrheit(w['mehrfach'], f('mehrfach')),
		teilnahme,
		vielleicht,
		frist: frist(w['frist'], f('frist')),
		ergebnisse: wahl(w['ergebnisse'], ERGEBNISSE, f('ergebnisse')),
		// Eine Teilnahme hat feste Antworten (Spec 3.12): Was der Client schickt, zaehlt nicht.
		// Verworfen: sie zu pruefen und bei Abweichung abzulehnen, denn der Schalter "Vielleicht"
		// allein bestimmt sie, und ein veralteter Client soll daran nicht scheitern.
		optionen: teilnahme ? teilnahmeOptionen(vielleicht) : optionen(w['optionen'], f('optionen')),
	};
}

/**
 * Liest den Anfragekoerper als Entwurf und prueft nur die Form: Typen, Enum-Werte,
 * Arrays, lesbare Frist. Was ein Entwurf bedeutet, prueft entwurfFehler; die Trennung
 * laesst den Editor beides mit denselben Funktionen tun, und der Server antwortet bei
 * einem Koerper, den kein Editor je schickt, knapp mit "Ungültige Anfrage".
 * Feldname fuer einen Koerper ohne Objekt ist der Titel, das erste Feld des Formulars.
 */
export function entwurfAus(koerper: unknown): { entwurf: ThreadEntwurf } | { fehler: Feldfehler } {
	try {
		if (!istObjekt(koerper)) throw new Ungueltig('titel');
		const titel = text(koerper['titel'], 'titel');
		const modus = wahl(koerper['modus'], MODI, 'modus');
		const rollenfilter = wahl(koerper['rollenfilter'], ROLLENFILTER, 'zielgruppe');
		const alleUntergruppen = wahrheit(koerper['alleUntergruppen'], 'zielgruppe');
		const ids = koerper['untergruppenIds'];
		if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Ungueltig('zielgruppe');
		if (!Array.isArray(koerper['module'])) throw new Ungueltig('module');
		const module = koerper['module'].map(modul);
		return { entwurf: { titel, modus, rollenfilter, alleUntergruppen, untergruppenIds: [...ids], module } };
	} catch (e) {
		if (e instanceof Ungueltig) return { fehler: { feld: e.feld, text: 'Ungültige Anfrage' } };
		throw e;
	}
}

// ---------------------------------------------------------------------------------
// Bedeutung: entwurfFehler
// ---------------------------------------------------------------------------------

// Code-Points wie die CHECKs (char_length), nicht UTF-16-Einheiten: Ein Emoji im Titel
// ("🎳 Bowling") zaehlt eins, nicht zwei.
const laenge = (s: string) => [...s].length;

const zahl = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const hoechstens = (n: number) => `Höchstens ${zahl(n)} Zeichen.`;

// Gemessen wird der getrimmte Text, denn entwurfAus schneidet den Leerraum ab, bevor der
// Server prueft. Der Editor ruft entwurfFehler auf dem rohen Formularzustand; mit dem
// ungetrimmten Wert gaebe er "gueltig" fuer "   " und der Server 400. Verworfen: den
// Editor vorher trimmen lassen, denn dann stuende die Regel an zwei Orten.
// null (nicht gesetzt) ist immer gueltig.
function laengeFehler(feld: string, wert: string | null, grenze: number): Feldfehler[] {
	return wert !== null && laenge(wert.trim()) > grenze ? [{ feld, text: hoechstens(grenze) }] : [];
}

// Leerer Text und zu langer Text als je ein Satz.
function pflichtFehler(feld: string, wert: string, grenze: number, fehlt: string): Feldfehler[] {
	if (wert.trim() === '') return [{ feld, text: fehlt }];
	return laengeFehler(feld, wert, grenze);
}

function optionenFehler(feld: string, optionen: readonly OptionEntwurf[]): Feldfehler[] {
	const fehler = (text: string): Feldfehler[] => [{ feld, text }];
	if (optionen.length > GRENZEN.optionen) return fehler(`Höchstens ${GRENZEN.optionen} Antworten.`);
	if (optionen.length < 2) return fehler('Bitte mindestens zwei Antworten.');
	if (optionen.some((o) => o.text.trim() === '')) return fehler('Bitte jede Antwort ausfüllen.');
	if (optionen.some((o) => laenge(o.text.trim()) > GRENZEN.optionText)) return fehler(hoechstens(GRENZEN.optionText));
	// Ohne Gross-/Kleinschreibung: "Ja" und "ja" waeren fuer die Gefragten dieselbe Antwort.
	const gesehen = new Set(optionen.map((o) => o.text.trim().toLowerCase()));
	if (gesehen.size < optionen.length) return fehler('Jede Antwort nur einmal.');
	return [];
}

function modulFehler(m: ModulEntwurf, i: number, rollenfilter: Rollenfilter, teilnahmeSchonDa: boolean): Feldfehler[] {
	const f = (name: string) => `module.${i}.${name}`;
	const fehler = laengeFehler(f('titel'), m.titel, GRENZEN.modulTitel);
	if (m.typ === 'INFO') {
		return [...fehler, ...pflichtFehler(f('text'), m.text, GRENZEN.infoText, 'Bitte einen Text eingeben.')];
	}
	if (m.typ === 'TERMIN') {
		// Wie entwurfAus getrimmt, sonst ist " 2026-10-24" im Editor ein Fehler und am Server keiner.
		const roh = m.termin;
		const t = terminFehler({
			modulId: '',
			startDatum: roh.startDatum.trim(),
			endDatum: roh.endDatum?.trim() || null,
			beginn: roh.beginn?.trim() || null,
			ende: roh.ende?.trim() || null,
			ort: null,
			treffpunkt: null,
		});
		return [
			...fehler,
			...(t === null ? [] : [{ feld: f('termin'), text: t }]),
			...laengeFehler(f('ort'), m.termin.ort, GRENZEN.ort),
			...laengeFehler(f('treffpunkt'), m.termin.treffpunkt, GRENZEN.treffpunkt),
		];
	}
	fehler.push(...pflichtFehler(f('frage'), m.frage, GRENZEN.frage, 'Bitte eine Frage eingeben.'));
	if (!einheitenFuer(rollenfilter).includes(m.einheit)) {
		fehler.push({ feld: f('einheit'), text: 'Diese Einheit fragt bei dieser Zielgruppe niemanden.' });
	}
	// Die Optionen einer Teilnahme sind fest (entwurfAus setzt sie), eine Pruefung liefe leer.
	if (!m.teilnahme) fehler.push(...optionenFehler(f('optionen'), m.optionen));
	if (m.teilnahme && teilnahmeSchonDa) {
		fehler.push({ feld: f('teilnahme'), text: 'Es gibt schon eine Teilnahme-Umfrage.', konflikt: true });
	}
	return fehler;
}

/**
 * Prueft, was ein Entwurf bedeutet, und liefert alle Fehler in der Reihenfolge des
 * Formulars: Titel, Zielgruppe, Modulzahl, dann Modul fuer Modul. Der Server schickt
 * den ersten, der Editor zeigt alle. Konflikt (statt Eingabefehler) heisst: Der Entwurf
 * ist in sich stimmig genug zu lesen, aber ein Thread darf nur eine Teilnahme-Umfrage
 * haben (Spec 3.12); der Server antwortet dann 409.
 */
export function entwurfFehler(e: ThreadEntwurf, untergruppenIds: ReadonlySet<string>): Feldfehler[] {
	const fehler = pflichtFehler('titel', e.titel, GRENZEN.titel, 'Bitte einen Titel eingeben.');
	if (!e.alleUntergruppen) {
		if (e.untergruppenIds.length === 0) {
			fehler.push({ feld: 'zielgruppe', text: 'Bitte mindestens eine Untergruppe wählen.' });
		} else if (e.untergruppenIds.some((id) => !untergruppenIds.has(id))) {
			fehler.push({ feld: 'zielgruppe', text: 'Diese Untergruppe gibt es nicht mehr.' });
		}
	}
	if (e.module.length > GRENZEN.module) fehler.push({ feld: 'module', text: `Höchstens ${GRENZEN.module} Module.` });
	let teilnahmeSchonDa = false;
	e.module.forEach((m, i) => {
		fehler.push(...modulFehler(m, i, e.rollenfilter, teilnahmeSchonDa));
		if (m.typ === 'UMFRAGE' && m.teilnahme) teilnahmeSchonDa = true;
	});
	return fehler;
}

// ---------------------------------------------------------------------------------
// Anlegen und Lesen
// ---------------------------------------------------------------------------------

/**
 * Das Modul, das der Editor beim Hinzufuegen anlegt. Die erste Umfrage ist die
 * Teilnahme-Vorlage (Spec 3.12, der haeufigste Fall); gibt es schon eine, waere sie
 * sofort ein Konflikt, also kommt eine leere Ja-Nein-Umfrage. Der Termin liegt sieben
 * Berliner Tage nach jetzt: Der Tag ist in der Regel zu aendern, aber nie in der
 * Vergangenheit. jetzt kommt vom Aufrufer, die Regel kennt keine Uhr.
 */
export function neuesModul(
	typ: 'INFO' | 'TERMIN' | 'UMFRAGE',
	vorhandene: readonly ModulEntwurf[],
	jetzt: Date,
): ModulEntwurf {
	const neu = { id: null, titel: null };
	if (typ === 'INFO') return { typ, ...neu, text: '' };
	if (typ === 'TERMIN') {
		const termin: TerminEntwurf = {
			startDatum: tagPlus(berlinerTag(jetzt), 7),
			endDatum: null,
			beginn: '18:00',
			ende: '20:00',
			ort: null,
			treffpunkt: null,
		};
		return { typ, ...neu, termin };
	}
	const vorlage = neueUmfrageVorlage();
	if (vorhandene.some((m) => m.typ === 'UMFRAGE' && m.teilnahme)) {
		return {
			typ,
			...neu,
			...vorlage,
			teilnahme: false,
			frage: '',
			optionen: [
				{ schluessel: null, text: 'Ja' },
				{ schluessel: null, text: 'Nein' },
			],
		};
	}
	return { typ, ...neu, ...vorlage };
}

/** Der gespeicherte Thread als Entwurf, damit der Editor ihn bearbeiten und mit entwurfFehler pruefen kann. */
export function entwurfAusThread(k: ThreadKopf, module: readonly ModulDaten[]): ThreadEntwurf {
	return {
		titel: k.titel,
		modus: k.modus,
		rollenfilter: k.rollenfilter,
		alleUntergruppen: k.alleUntergruppen,
		untergruppenIds: [...k.untergruppenIds],
		module: module.map((m): ModulEntwurf => {
			if (m.typ === 'INFO') return { typ: m.typ, id: m.id, titel: m.titel, text: m.text };
			if (m.typ === 'TERMIN') {
				const { startDatum, endDatum, beginn, ende, ort, treffpunkt } = m.termin;
				const termin = { startDatum, endDatum, beginn, ende, ort, treffpunkt };
				return { typ: m.typ, id: m.id, titel: m.titel, termin };
			}
			const u = m.umfrage;
			return {
				typ: m.typ,
				id: m.id,
				titel: m.titel,
				frage: u.frage,
				einheit: u.einheit,
				mehrfach: u.mehrfach,
				teilnahme: u.teilnahme,
				vielleicht: u.vielleicht,
				frist: u.frist ? u.frist.toISOString() : null,
				ergebnisse: u.ergebnisse,
				optionen: u.optionen.map((o) => ({ schluessel: o.schluessel, text: o.text })),
			};
		}),
	};
}
