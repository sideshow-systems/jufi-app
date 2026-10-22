import { terminFehler, type TerminDaten } from '../module/termin/termin.js';
import { einheitenFuer, neueUmfrageVorlage, teilnahmeOptionen } from '../module/umfrage/umfrage.js';
import { berlinerTag, istKalendertag, tagPlus } from '../zeit.js';
import type { ModulDaten } from './ansicht.js';
import type { FotoHochladen } from './rechte.js';
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
	positionen: 30,
	positionText: 80,
	anzahl: 99,
	notiz: 80,
	plaetze: 8,
	autosJeRichtung: 30,
	autoText: 200,
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

// Wie bei Optionen: schluessel null heisst neue Position, den Schluessel vergibt der Server.
// Er bleibt beim Umbenennen und Umsortieren, daran haengen die Eintraege (Spec 5.2).
export interface PositionEntwurf {
	schluessel: string | null;
	text: string;
	anzahl: number;
}

export type TerminEntwurf = Omit<TerminDaten, 'modulId'>;

// id null heisst: neues Modul. Datei- und Foto-Module tragen keine Dateien im Entwurf: Die
// Bytes kommen ueber eigene Upload-Routen, der Entwurf beschreibt nur das Modul (Plan-
// Entscheidung 10). Die Frist steht als ISO-Zeichenkette (UTC), nicht als Date:
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
	  }
	| { typ: 'DATEIEN'; id: string | null; titel: string | null }
	| { typ: 'FOTOS'; id: string | null; titel: string | null; hochladen: FotoHochladen }
	| {
			typ: 'HELFER';
			id: string | null;
			titel: string | null;
			einheit: AntwortEinheit;
			frist: string | null;
			positionen: PositionEntwurf[];
	  }
	| { typ: 'FAHRT'; id: string | null; titel: string | null; hin: boolean; rueck: boolean };

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
	/**
	 * Ein Konflikt an einer Fahrgemeinschaft. Der Server meldet ihn mit eigenem Code (DOPPELTE_FAHRT,
	 * FAHRT_BELEGT) statt mit dem der Umfrage, die vorher die einzigen Konflikte stellte. Verworfen: den
	 * Code am Feldnamen oder am Satz zu erkennen, denn "module" (Entfernen) teilen sich Umfrage,
	 * Helferliste und Fahrgemeinschaft.
	 */
	fahrt?: true;
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
const FOTO_HOCHLADEN: readonly FotoHochladen[] = ['JUGENDLEITER', 'ALLE'];
const MODULTYPEN = ['INFO', 'TERMIN', 'UMFRAGE', 'DATEIEN', 'FOTOS', 'HELFER', 'FAHRT'] as const;

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
	// Date.parse rollt "2026-02-30T..." still in den Maerz; der Tag muss einer sein, den es gibt
	// (Spec 2.2), wie beim Datum eines Termins. Verworfen: den gelesenen Zeitpunkt zurueck mit
	// der Eingabe zu vergleichen, denn bei einer Zone wie +02:00 ist der UTC-Tag ein anderer.
	if (!ISO_ZEITPUNKT.test(roh) || !istKalendertag(roh.slice(0, 10)) || Number.isNaN(ms)) throw new Ungueltig(feld);
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

// Die Anzahl wird hier nur als Zahl gelesen; ob sie ganz und im Bereich ist, sagt entwurfFehler
// mit einem eigenen Satz. Verworfen: 1.5 schon hier als "Ungültige Anfrage" abzuweisen, denn
// der Editor zeigt dieselbe Pruefung am Feld, und dort waere der knappe Satz keine Hilfe.
function positionen(w: unknown, feld: string): PositionEntwurf[] {
	if (!Array.isArray(w)) throw new Ungueltig(feld);
	return w.map((p: unknown) => {
		if (!istObjekt(p)) throw new Ungueltig(feld);
		const anzahl = p['anzahl'];
		if (typeof anzahl !== 'number' || !Number.isFinite(anzahl)) throw new Ungueltig(feld);
		return { schluessel: textOderNull(p['schluessel'], feld), text: text(p['text'], feld), anzahl };
	});
}

function modul(w: unknown, i: number): ModulEntwurf {
	const f = (name: string) => `module.${i}.${name}`;
	if (!istObjekt(w)) throw new Ungueltig(f('typ'));
	const typ = wahl(w['typ'], MODULTYPEN, f('typ'));
	const kopf = { id: textOderNull(w['id'], f('id')), titel: textOderNull(w['titel'], f('titel')) };
	if (typ === 'INFO') return { typ, ...kopf, text: text(w['text'], f('text')) };
	if (typ === 'TERMIN') return { typ, ...kopf, termin: termin(w['termin'], i) };
	if (typ === 'DATEIEN') return { typ, ...kopf };
	if (typ === 'FOTOS') return { typ, ...kopf, hochladen: wahl(w['hochladen'], FOTO_HOCHLADEN, f('hochladen')) };
	if (typ === 'FAHRT') {
		return { typ, ...kopf, hin: wahrheit(w['hin'], f('hin')), rueck: wahrheit(w['rueck'], f('rueck')) };
	}
	if (typ === 'HELFER') {
		return {
			typ,
			...kopf,
			einheit: wahl(w['einheit'], EINHEITEN, f('einheit')),
			frist: frist(w['frist'], f('frist')),
			positionen: positionen(w['positionen'], f('positionen')),
		};
	}

	const teilnahme = wahrheit(w['teilnahme'], f('teilnahme'));
	const vielleicht = wahrheit(w['vielleicht'], f('vielleicht'));
	// Eine Teilnahme ist eine Antwort aus dabei, vielleicht, abgesagt; "Mehrfachauswahl" gibt es
	// dort nicht, der Editor blendet sie aus. Ein verstecktes true liesse die Teilnahme als
	// Mehrfachauswahl speichern. Gelesen wird der Wert trotzdem, damit ein Nicht-Wahrheitswert
	// weiter ungueltig ist. Verworfen: ein true bei Teilnahme abzulehnen, denn ein Client, der
	// das Feld nicht kennt, soll daran nicht scheitern (wie bei den Optionen).
	const mehrfach = wahrheit(w['mehrfach'], f('mehrfach'));
	return {
		typ,
		...kopf,
		frage: text(w['frage'], f('frage')),
		einheit: wahl(w['einheit'], EINHEITEN, f('einheit')),
		mehrfach: teilnahme ? false : mehrfach,
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

// Ein Satz je Liste wie bei den Optionen, in fester Reihenfolge: Zahl, leer, Laenge, doppelt,
// Anzahl. Verworfen: einen Fehler je Position, weil der Editor die Meldung am Feld der ganzen
// Liste zeigt und zehn gleiche Saetze dort nichts sagen, was der erste nicht sagt.
function positionenFehler(feld: string, positionen: readonly PositionEntwurf[]): Feldfehler[] {
	const fehler = (text: string): Feldfehler[] => [{ feld, text }];
	if (positionen.length === 0) return fehler('Bitte mindestens eine Position.');
	if (positionen.length > GRENZEN.positionen) return fehler(`Höchstens ${GRENZEN.positionen} Positionen.`);
	if (positionen.some((p) => p.text.trim() === '')) return fehler('Bitte jede Position ausfüllen.');
	if (positionen.some((p) => laenge(p.text.trim()) > GRENZEN.positionText)) {
		return fehler(hoechstens(GRENZEN.positionText));
	}
	// Ohne Gross-/Kleinschreibung wie bei den Optionen: "Kuchen" und "kuchen" waeren dieselbe Bitte.
	const gesehen = new Set(positionen.map((p) => p.text.trim().toLowerCase()));
	if (gesehen.size < positionen.length) return fehler('Jede Position nur einmal.');
	if (positionen.some((p) => !Number.isInteger(p.anzahl) || p.anzahl < 1 || p.anzahl > GRENZEN.anzahl)) {
		return fehler(`Die Anzahl muss zwischen 1 und ${GRENZEN.anzahl} liegen.`);
	}
	return [];
}

// Umfrage und Helferliste fragen dieselben Personen (gefragte in antworten.ts), also gilt fuer
// beide dieselbe Einheitenregel mit demselben Satz.
function einheitFehler(feld: string, einheit: AntwortEinheit, rollenfilter: Rollenfilter): Feldfehler[] {
	if (einheitenFuer(rollenfilter).includes(einheit)) return [];
	return [{ feld, text: 'Diese Einheit fragt bei dieser Zielgruppe niemanden.' }];
}

function terminModulFehler(m: Extract<ModulEntwurf, { typ: 'TERMIN' }>, f: (name: string) => string): Feldfehler[] {
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
		...(t === null ? [] : [{ feld: f('termin'), text: t }]),
		...laengeFehler(f('ort'), m.termin.ort, GRENZEN.ort),
		...laengeFehler(f('treffpunkt'), m.termin.treffpunkt, GRENZEN.treffpunkt),
	];
}

function umfrageFehler(
	m: Extract<ModulEntwurf, { typ: 'UMFRAGE' }>,
	f: (name: string) => string,
	rollenfilter: Rollenfilter,
	teilnahmeSchonDa: boolean,
): Feldfehler[] {
	const fehler = [
		...pflichtFehler(f('frage'), m.frage, GRENZEN.frage, 'Bitte eine Frage eingeben.'),
		...einheitFehler(f('einheit'), m.einheit, rollenfilter),
	];
	// Die Optionen einer Teilnahme sind fest (entwurfAus setzt sie), eine Pruefung liefe leer.
	if (!m.teilnahme) fehler.push(...optionenFehler(f('optionen'), m.optionen));
	if (m.teilnahme && teilnahmeSchonDa) {
		fehler.push({ feld: f('teilnahme'), text: 'Es gibt schon eine Teilnahme-Umfrage.', konflikt: true });
	}
	return fehler;
}

// Erschoepfend ueber typ: Ein neuer Modultyp bricht hier den Bau, statt ungeprueft durchzugehen.
function modulFehler(
	m: ModulEntwurf,
	i: number,
	rollenfilter: Rollenfilter,
	teilnahmeSchonDa: boolean,
	fahrtSchonDa: boolean,
): Feldfehler[] {
	const f = (name: string) => `module.${i}.${name}`;
	const titel = laengeFehler(f('titel'), m.titel, GRENZEN.modulTitel);
	switch (m.typ) {
		case 'INFO':
			return [...titel, ...pflichtFehler(f('text'), m.text, GRENZEN.infoText, 'Bitte einen Text eingeben.')];
		case 'TERMIN':
			return [...titel, ...terminModulFehler(m, f)];
		case 'UMFRAGE':
			return [...titel, ...umfrageFehler(m, f, rollenfilter, teilnahmeSchonDa)];
		// Datei- und Foto-Module haben ausser dem Titel nichts zu pruefen.
		case 'DATEIEN':
		case 'FOTOS':
			return titel;
		// Die Frist prueft schon entwurfAus (lesbarer Zeitpunkt), wie bei der Umfrage; eine Frist in
		// der Vergangenheit ist erlaubt, sie schliesst die Liste.
		case 'HELFER':
			return [
				...titel,
				...einheitFehler(f('einheit'), m.einheit, rollenfilter),
				...positionenFehler(f('positionen'), m.positionen),
			];
		// Ohne Richtung gaebe es nichts zu fahren; das Feld ist der Umschalter "Hin". Die zweite
		// Fahrgemeinschaft ist wie die zweite Teilnahme ein Konflikt (Plan-Entscheidung 9): Der
		// Editor blendet den Typ aus, ein Client ohne ihn wuerde sonst an der Datenbank scheitern.
		case 'FAHRT': {
			const fehler: Feldfehler[] = [...titel];
			if (!m.hin && !m.rueck) fehler.push({ feld: f('hin'), text: 'Bitte mindestens eine Richtung.' });
			if (fahrtSchonDa) {
				fehler.push({ feld: f('typ'), text: 'Es gibt schon eine Fahrgemeinschaft.', konflikt: true, fahrt: true });
			}
			return fehler;
		}
		default: {
			const unerreichbar: never = m;
			return unerreichbar;
		}
	}
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
	let fahrtSchonDa = false;
	e.module.forEach((m, i) => {
		fehler.push(...modulFehler(m, i, e.rollenfilter, teilnahmeSchonDa, fahrtSchonDa));
		if (m.typ === 'UMFRAGE' && m.teilnahme) teilnahmeSchonDa = true;
		if (m.typ === 'FAHRT') fahrtSchonDa = true;
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
	typ: ModulEntwurf['typ'],
	vorhandene: readonly ModulEntwurf[],
	jetzt: Date,
	rollenfilter: Rollenfilter,
): ModulEntwurf {
	const neu = { id: null, titel: null };
	if (typ === 'INFO') return { typ, ...neu, text: '' };
	if (typ === 'DATEIEN') return { typ, ...neu };
	// Beide Richtungen sind die Vorgabe: Wer nur hin oder nur rueck braucht, schaltet eine ab.
	// Die vorhandenen Module kennt die Funktion hier nicht; ob schon eine Fahrgemeinschaft da ist,
	// sagt modulFehler beim Speichern, und der Editor bietet den Typ dann gar nicht an.
	if (typ === 'FAHRT') return { typ, ...neu, hin: true, rueck: true };
	// Fotos von allen Lesern sind die Ausnahme, die der Ersteller bewusst waehlt: Die Vorgabe
	// bleibt bei den Jugendleitern. Verworfen: "ALLE" als Vorgabe, weil ein vergessener Schalter
	// dann fremde Bilder in einen Familien-Thread liesse.
	if (typ === 'FOTOS') return { typ, ...neu, hochladen: 'JUGENDLEITER' };
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
	// Spec 5.1: Mitbringen und Helfen ist Sache der Erwachsenen, also ist das die Vorgabe, solange
	// der Rollenfilter sie zulaesst. Die leere Position zeigt dem Ersteller gleich, was er ausfuellen
	// soll. Die Umfrage bekommt den Rollenfilter nicht: Ihre Vorlage ist fest, der Editor passt ihre
	// Einheit danach an (mitPassenderEinheit).
	if (typ === 'HELFER') {
		const erlaubt = einheitenFuer(rollenfilter);
		const einheit = erlaubt.includes('ERWACHSENER') ? 'ERWACHSENER' : (erlaubt[0] ?? 'ERWACHSENER');
		return { typ, ...neu, einheit, frist: null, positionen: [{ schluessel: null, text: '', anzahl: 1 }] };
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
			switch (m.typ) {
				case 'INFO':
					return { typ: m.typ, id: m.id, titel: m.titel, text: m.text };
				case 'TERMIN': {
					const { startDatum, endDatum, beginn, ende, ort, treffpunkt } = m.termin;
					const termin = { startDatum, endDatum, beginn, ende, ort, treffpunkt };
					return { typ: m.typ, id: m.id, titel: m.titel, termin };
				}
				case 'DATEIEN':
					return { typ: m.typ, id: m.id, titel: m.titel };
				case 'FOTOS':
					return { typ: m.typ, id: m.id, titel: m.titel, hochladen: m.hochladen };
				case 'HELFER': {
					const h = m.helfer;
					return {
						typ: m.typ,
						id: m.id,
						titel: m.titel,
						einheit: h.einheit,
						frist: h.frist ? h.frist.toISOString() : null,
						// Ohne Eintraege: Die haben eigene Routen, der Entwurf beschreibt nur die Liste.
						positionen: h.positionen.map((p) => ({ schluessel: p.schluessel, text: p.text, anzahl: p.anzahl })),
					};
				}
				case 'FAHRT':
					// Ohne Autos und Mitfahrten: Die haben eigene Routen, der Entwurf beschreibt nur das Modul.
					return { typ: m.typ, id: m.id, titel: m.titel, hin: m.fahrt.hin, rueck: m.fahrt.rueck };
				case 'UMFRAGE': {
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
				}
				default: {
					const unerreichbar: never = m;
					return unerreichbar;
				}
			}
		}),
	};
}
