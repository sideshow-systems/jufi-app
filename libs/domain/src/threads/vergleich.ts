import { fahrtSperre, pruefeFahrtAenderung, RICHTUNG_TEXT } from '../module/fahrt/fahrt.js';
import { helferSperre, pruefeHelferAenderung } from '../module/helfer/helfer.js';
import { pruefeUmfrageAenderung, TEILNAHME_OPTIONEN } from '../module/umfrage/umfrage.js';
import type { ModulDaten } from './ansicht.js';
import type { Feldfehler, ModulEntwurf, OptionEntwurf, PositionEntwurf, ThreadEntwurf } from './entwurf.js';
import type { HelferDaten, UmfrageDaten, ThreadKopf } from './typen.js';
import type { SystemArt } from './verlauf.js';

const UNGUELTIG = 'Ungültige Anfrage';

type UmfrageEntwurf = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;
type HelferEntwurf = Extract<ModulEntwurf, { typ: 'HELFER' }>;
type FahrtEntwurf = Extract<ModulEntwurf, { typ: 'FAHRT' }>;

// Ersatztitel einer Helferliste ohne eigenen Titel, in Konflikt und Systemeintrag (Entscheidung 10).
const HELFERLISTE = 'Helferliste';

// Was an einer Umfrage durch Antworten festliegt. Der Editor sperrt damit seine Felder,
// bevor der Server mit 409 antworten muss; beide fragen dieselbe Funktion.
export interface UmfrageSperre {
	/** Jede Antwortzeile zaehlt, auch eine ohne Option: die Datenbank sperrt das Loeschen sonst mit P2003. */
	beantwortet: boolean;
	/** Schluessel der Optionen, auf die jemand geantwortet hat. */
	schluessel: string[];
	mehrfachGenutzt: boolean;
}

export function umfrageSperre(u: UmfrageDaten): UmfrageSperre {
	const belegt = new Set(u.antworten.flatMap((a) => a.optionIds));
	return {
		beantwortet: u.antworten.length > 0,
		schluessel: u.optionen.filter((o) => belegt.has(o.id)).map((o) => o.schluessel),
		mehrfachGenutzt: u.antworten.some((a) => a.optionIds.length > 1),
	};
}

export interface ModulPlan {
	id: string;
	/** Index im neuen Entwurf. */
	position: number;
	neu: ModulEntwurf;
	/** Inhalt oder Position weichen vom gespeicherten Modul ab. */
	geaendert: boolean;
	/** Schluessel unbeantworteter Optionen, die der Entwurf nicht mehr hat. */
	optionenLoeschen: string[];
	/** Schluessel unbelegter Positionen einer Helferliste, die der Entwurf nicht mehr hat. */
	positionenLoeschen: string[];
}

export interface EntwurfVergleich {
	/** 400: unbekannte oder doppelte Modul-ID, Typwechsel, fremder Options- oder Positionsschluessel. */
	fehler: Feldfehler | null;
	/** 409 BEANTWORTET (Antworten einer Umfrage oder Eintraege einer Helferliste), an einer Fahrgemeinschaft (fahrt) FAHRT_BELEGT. */
	konflikt: Feldfehler | null;
	/** Modul-IDs. */
	loeschen: string[];
	behalten: ModulPlan[];
	anlegen: { position: number; neu: ModulEntwurf }[];
	/** Eine Spalte des Threads (Titel, Modus, Rollenfilter, alle Untergruppen) hat sich geaendert. */
	kopfGeaendert: boolean;
	/** Rollenfilter, Untergruppen-Schalter oder die gewaehlten Untergruppen haben sich geaendert. */
	sichtbarkeitGeaendert: boolean;
	/** Nur Aenderungen am Thread selbst; AUTO_ZURUECKGEZOGEN schreibt die Route des Autos, nicht der Editor. */
	system: { art: Exclude<SystemArt, 'AUTO_ZURUECKGEZOGEN'>; daten: Record<string, unknown> }[];
}

const FESTE_SCHLUESSEL: readonly string[] = TEILNAHME_OPTIONEN.map((o) => o.schluessel);

// Bei fehler oder konflikt wird nichts geschrieben; ein leerer Plan statt eines halben
// verhindert, dass der Aufrufer versehentlich einen Teil davon schreibt.
function leer(rest: Partial<Pick<EntwurfVergleich, 'fehler' | 'konflikt'>>): EntwurfVergleich {
	return {
		fehler: null,
		konflikt: null,
		loeschen: [],
		behalten: [],
		anlegen: [],
		kopfGeaendert: false,
		sichtbarkeitGeaendert: false,
		system: [],
		...rest,
	};
}

// Ein Schluessel darf nur auf eine Option oder Position zeigen, die es gibt: der Server vergibt
// neue Schluessel selbst (Entscheidung 11), ein erfundener oder doppelter gehoerte sonst zwei
// Eintraegen oder keinem. Ausnahme Teilnahme: ihre Schluessel sind fest.
function schluesselUngueltig(
	optionen: readonly (OptionEntwurf | PositionEntwurf)[],
	erlaubt: ReadonlySet<string>,
): boolean {
	const gesehen = new Set<string>();
	for (const o of optionen) {
		if (o.schluessel === null) continue;
		if (!erlaubt.has(o.schluessel) || gesehen.has(o.schluessel)) return true;
		gesehen.add(o.schluessel);
	}
	return false;
}

function gleicheOptionen(alt: UmfrageDaten['optionen'], neu: readonly OptionEntwurf[]): boolean {
	return alt.length === neu.length && alt.every((o, i) => o.schluessel === neu[i].schluessel && o.text === neu[i].text);
}

function gleichePositionen(alt: HelferDaten['positionen'], neu: readonly PositionEntwurf[]): boolean {
	return (
		alt.length === neu.length &&
		alt.every((p, i) => p.schluessel === neu[i].schluessel && p.text === neu[i].text && p.anzahl === neu[i].anzahl)
	);
}

const fristIso = (u: { frist: Date | null }) => (u.frist ? u.frist.toISOString() : null);

const KONFLIKT_TEXT = {
	einheit: 'Die Einheit lässt sich nach den ersten Antworten nicht mehr ändern.',
	teilnahme: 'Der Teilnahme-Schalter lässt sich nach den ersten Antworten nicht mehr ändern.',
	mehrfach: 'Mehrfachauswahl lässt sich nicht abschalten, solange jemand mehrere Antworten gewählt hat.',
} as const;

// Eigener Satz statt KONFLIKT_TEXT.einheit: Eine Helferliste hat Eintraege, keine Antworten.
// Exportiert, weil der Editor denselben Satz als Hinweis an der gesperrten Einheit zeigt, bevor
// der Server ihn als 409 schicken muesste.
export const HELFER_EINHEIT_GESPERRT = 'Die Einheit lässt sich nach den ersten Einträgen nicht mehr ändern.';

interface Bestehendes {
	geaendert: boolean;
	optionenLoeschen: string[];
	positionenLoeschen: string[];
	konflikt: Feldfehler | null;
	system: EntwurfVergleich['system'];
}

// Vergleich eines Moduls, das der Thread schon hat. Der gleiche Typ ist vorher geprueft; die
// Weiche geht trotzdem ueber beide, damit TypeScript den Entwurf mit verengt. Erschoepfend ueber
// alt.typ: Ein neuer Modultyp bricht hier den Bau, statt still als unveraendert zu gelten.
function vergleicheBestehendes(alt: ModulDaten, neu: ModulEntwurf, i: number): Bestehendes {
	const ergebnis: Bestehendes = {
		geaendert: alt.titel !== neu.titel,
		optionenLoeschen: [],
		positionenLoeschen: [],
		konflikt: null,
		system: [],
	};
	switch (alt.typ) {
		case 'INFO':
			if (neu.typ === 'INFO') ergebnis.geaendert ||= alt.text !== neu.text;
			break;
		case 'TERMIN':
			if (neu.typ === 'TERMIN') {
				const a = alt.termin;
				const n = neu.termin;
				const zeit =
					a.startDatum !== n.startDatum || a.endDatum !== n.endDatum || a.beginn !== n.beginn || a.ende !== n.ende;
				ergebnis.geaendert ||= zeit || a.ort !== n.ort || a.treffpunkt !== n.treffpunkt;
				// Nur die Zeit ist eine Nachricht an die Gruppe; ein anderer Ort nicht (Entscheidung 6).
				// Die Daten tragen den ganzen Termin, damit der Satz im Verlauf ohne zweite Abfrage steht.
				if (zeit) eintrag(ergebnis, 'TERMIN_GEAENDERT', { termin: { modulId: alt.id, ...n } });
			}
			break;
		case 'UMFRAGE':
			if (neu.typ === 'UMFRAGE') umfrage(ergebnis, alt, neu, i);
			break;
		case 'HELFER':
			if (neu.typ === 'HELFER') helfer(ergebnis, alt, neu, i);
			break;
		// Autos und Mitfahrten haben eigene Routen; am Modul stehen nur Titel und Richtungen. Eine
		// geaenderte Richtung ist keine Nachricht an die Gruppe: kein Systemeintrag.
		case 'FAHRT':
			if (neu.typ === 'FAHRT') fahrt(ergebnis, alt, neu, i);
			break;
		// Die Dateien selbst zaehlen nie, sie haben eigene Routen; ausser dem Titel bleibt nichts.
		case 'DATEIEN':
			break;
		case 'FOTOS':
			// Wer hochladen darf, ist eine Einstellung des Moduls und keine Nachricht an die Gruppe:
			// kein Systemeintrag.
			if (neu.typ === 'FOTOS') ergebnis.geaendert ||= alt.hochladen !== neu.hochladen;
			break;
		default: {
			const unerreichbar: never = alt;
			return unerreichbar;
		}
	}
	return ergebnis;
}

function eintrag(e: Bestehendes, art: EntwurfVergleich['system'][number]['art'], daten: Record<string, unknown>): void {
	e.system.push({ art, daten });
}

function umfrage(e: Bestehendes, alt: ModulDaten & { typ: 'UMFRAGE' }, neu: UmfrageEntwurf, i: number): void {
	const u = alt.umfrage;
	const frist = fristIso(u) !== neu.frist;
	e.geaendert ||=
		frist ||
		u.frage !== neu.frage ||
		u.einheit !== neu.einheit ||
		u.mehrfach !== neu.mehrfach ||
		u.teilnahme !== neu.teilnahme ||
		u.vielleicht !== neu.vielleicht ||
		u.ergebnisse !== neu.ergebnisse ||
		!gleicheOptionen(u.optionen, neu.optionen);
	// Der Satz nennt die Frage, wie sie jetzt heisst: So steht er neben dem, was die Gefragten sehen.
	if (frist) eintrag(e, 'FRIST_GEAENDERT', { frage: neu.frage, frist: neu.frist });

	const bleibt = new Set(neu.optionen.flatMap((o) => (o.schluessel === null ? [] : [o.schluessel])));
	// Eine beantwortete Option unter den wegfallenden ist ein Konflikt, und dann bleibt der
	// Plan leer; in optionenLoeschen kann also nur Unbeantwortetes landen, sobald es gilt.
	e.optionenLoeschen = u.optionen.filter((o) => !bleibt.has(o.schluessel)).map((o) => o.schluessel);
	// Nur der erste Konflikt der Umfrage: der Server meldet einen, der Editor bekommt die
	// uebrigen aus umfrageSperre schon vorher als gesperrte Felder.
	const [k] = pruefeUmfrageAenderung(u, {
		einheit: neu.einheit,
		mehrfach: neu.mehrfach,
		teilnahme: neu.teilnahme,
		optionen: [...bleibt].map((schluessel) => ({ schluessel })),
	});
	if (k) {
		const f = (name: string) => `module.${i}.${name}`;
		if (k.feld === 'optionen') {
			const text = u.optionen.find((o) => o.schluessel === k.schluessel)?.text ?? k.schluessel;
			e.konflikt = {
				feld: f('optionen'),
				text: `Auf „${text}“ hat schon jemand geantwortet.`,
				konflikt: true,
			};
		} else {
			e.konflikt = { feld: f(k.feld), text: KONFLIKT_TEXT[k.feld], konflikt: true };
		}
	}
}

function helfer(e: Bestehendes, alt: ModulDaten & { typ: 'HELFER' }, neu: HelferEntwurf, i: number): void {
	const h = alt.helfer;
	const frist = fristIso(h) !== neu.frist;
	e.geaendert ||= frist || h.einheit !== neu.einheit || !gleichePositionen(h.positionen, neu.positionen);
	// Entscheidung 10: wie bei der Umfrage, mit dem Titel, wie er jetzt heisst, an Stelle der Frage.
	if (frist) eintrag(e, 'FRIST_GEAENDERT', { frage: neu.titel ?? HELFERLISTE, frist: neu.frist });

	const bleibt = new Set(neu.positionen.flatMap((p) => (p.schluessel === null ? [] : [p.schluessel])));
	// Eine belegte Position unter den wegfallenden ist ein Konflikt, und dann bleibt der Plan leer;
	// in positionenLoeschen kann also nur Unbelegtes landen, sobald es gilt.
	e.positionenLoeschen = h.positionen.filter((p) => !bleibt.has(p.schluessel)).map((p) => p.schluessel);
	// Nur der erste Konflikt, wie bei der Umfrage: Die uebrigen kennt der Editor aus helferSperre.
	const [k] = pruefeHelferAenderung(h, { einheit: neu.einheit, positionen: neu.positionen });
	if (!k) return;
	const f = (name: string) => `module.${i}.${name}`;
	if (k.feld === 'einheit') {
		e.konflikt = { feld: f('einheit'), text: HELFER_EINHEIT_GESPERRT, konflikt: true };
		return;
	}
	// Eine entfernte Position nennt ihren alten Text, denn im Editor steht sie nicht mehr. Eine
	// zu kleine Anzahl nennt den Text, den der Editor gerade zeigt, auch wenn er umbenannt ist.
	const altText = h.positionen.find((p) => p.schluessel === k.schluessel)?.text ?? k.schluessel;
	const text =
		k.art === 'ENTFERNT'
			? `Für „${altText}“ hat sich schon jemand eingetragen.`
			: `Für „${neu.positionen.find((p) => p.schluessel === k.schluessel)?.text ?? altText}“ sind schon ${k.belegt} eingetragen.`;
	e.konflikt = { feld: f('positionen'), text, konflikt: true };
}

function fahrt(e: Bestehendes, alt: ModulDaten & { typ: 'FAHRT' }, neu: FahrtEntwurf, i: number): void {
	const f = alt.fahrt;
	e.geaendert ||= f.hin !== neu.hin || f.rueck !== neu.rueck;
	// Nur der erste Konflikt, die Hinfahrt zuerst: Die Richtungen, die der Editor sperrt, kennt er
	// aus fahrtSperre schon vorher.
	const [k] = pruefeFahrtAenderung(f, { hin: neu.hin, rueck: neu.rueck });
	if (!k) return;
	e.konflikt = {
		feld: `module.${i}.${k.richtung === 'HIN' ? 'hin' : 'rueck'}`,
		text: `Für die ${RICHTUNG_TEXT[k.richtung]} gibt es schon Autos oder Mitfahrten.`,
		konflikt: true,
		fahrt: true,
	};
}

function gleicheMenge(a: readonly string[], b: readonly string[]): boolean {
	const menge = new Set(a);
	const andere = new Set(b);
	return menge.size === andere.size && [...menge].every((s) => andere.has(s));
}

/**
 * Ob der Entwurf eine andere Zielgruppe hat als der gespeicherte Thread: Rollenfilter,
 * Untergruppen-Schalter oder (ohne "alle") die gewaehlten Untergruppen als Menge. Eine Regel
 * fuer SICHTBARKEIT (vergleicheEntwurf) und fuer das Verbot am Austausch, damit beide nie
 * Verschiedenes unter "Zielgruppe geaendert" verstehen.
 */
export function zielgruppeGeaendert(
	kopf: Pick<ThreadKopf, 'rollenfilter' | 'alleUntergruppen' | 'untergruppenIds'>,
	entwurf: ThreadEntwurf,
): boolean {
	return (
		entwurf.rollenfilter !== kopf.rollenfilter ||
		entwurf.alleUntergruppen !== kopf.alleUntergruppen ||
		// Bei "alle Untergruppen" sind die IDs ohne Belang, ein Rest im Entwurf aendert nichts.
		(!entwurf.alleUntergruppen && !gleicheMenge(entwurf.untergruppenIds, kopf.untergruppenIds))
	);
}

/**
 * Was ein Entwurf am gespeicherten Thread aendert, ohne zu schreiben: welche Module bleiben,
 * kommen, gehen, welche Optionen wegfallen, ob Kopf und Sichtbarkeit sich aendern und welche
 * Systemeintraege der Verlauf bekommen soll. Der Server ruft sie unter der Sperre der
 * Vereinszeile auf und schreibt genau das Ergebnis; so entscheidet eine Funktion, ob eine
 * Antwort die Aenderung verbietet (Spec 3.14), und sie passt zur Datenbank.
 *
 * fehler (400) geht vor konflikt (409): Ein Entwurf, der nicht lesbar ist, ist auch dann
 * keiner, wenn er zugleich eine Antwort entwerten wuerde. Bei beiden ist der Rest leer.
 * Der Konflikt ist der erste in der Reihenfolge der gespeicherten Module, damit die
 * Meldung nicht von der Sortierung im Editor abhaengt.
 * Die Systemeintraege entstehen unabhaengig vom Veroeffentlichungsstand; der Server
 * schreibt sie nur bei veroeffentlichten Threads (Entscheidung 6).
 */
export function vergleicheEntwurf(
	alt: { kopf: ThreadKopf; module: readonly ModulDaten[] },
	neu: ThreadEntwurf,
): EntwurfVergleich {
	const altIndex = new Map(alt.module.map((m, i) => [m.id, i]));
	const gesehen = new Set<string>();
	const konflikte: { rang: number; fehler: Feldfehler }[] = [];
	const behalten: ModulPlan[] = [];
	const anlegen: EntwurfVergleich['anlegen'] = [];
	const system: EntwurfVergleich['system'] = [];

	if (neu.modus !== alt.kopf.modus) system.push({ art: 'MODUS_GEAENDERT', daten: { modus: neu.modus } });

	for (const [position, m] of neu.module.entries()) {
		const ungueltig = (name = ''): EntwurfVergleich =>
			leer({ fehler: { feld: `module.${position}${name}`, text: UNGUELTIG } });
		const fest = m.typ === 'UMFRAGE' && m.teilnahme ? FESTE_SCHLUESSEL : [];

		if (m.id === null) {
			if (m.typ === 'UMFRAGE' && schluesselUngueltig(m.optionen, new Set(fest))) return ungueltig('.optionen');
			// Eine neue Liste hat noch keine Position, auf die ein Schluessel zeigen koennte.
			if (m.typ === 'HELFER' && schluesselUngueltig(m.positionen, new Set())) return ungueltig('.positionen');
			anlegen.push({ position, neu: m });
			continue;
		}
		const index = altIndex.get(m.id);
		if (index === undefined || gesehen.has(m.id) || alt.module[index].typ !== m.typ) return ungueltig();
		gesehen.add(m.id);
		const bisher = alt.module[index];
		if (bisher.typ === 'UMFRAGE' && m.typ === 'UMFRAGE') {
			const erlaubt = new Set([...fest, ...bisher.umfrage.optionen.map((o) => o.schluessel)]);
			if (schluesselUngueltig(m.optionen, erlaubt)) return ungueltig('.optionen');
		}
		if (bisher.typ === 'HELFER' && m.typ === 'HELFER') {
			const erlaubt = new Set(bisher.helfer.positionen.map((p) => p.schluessel));
			if (schluesselUngueltig(m.positionen, erlaubt)) return ungueltig('.positionen');
		}

		const b = vergleicheBestehendes(bisher, m, position);
		if (b.konflikt) konflikte.push({ rang: index, fehler: b.konflikt });
		system.push(...b.system);
		behalten.push({
			id: m.id,
			position,
			neu: m,
			geaendert: b.geaendert || index !== position,
			optionenLoeschen: b.optionenLoeschen,
			positionenLoeschen: b.positionenLoeschen,
		});
	}

	const loeschen: string[] = [];
	alt.module.forEach((m, index) => {
		if (gesehen.has(m.id)) return;
		loeschen.push(m.id);
		if (m.typ === 'UMFRAGE' && umfrageSperre(m.umfrage).beantwortet) {
			konflikte.push({
				rang: index,
				fehler: {
					feld: 'module',
					text: `Die Umfrage „${m.umfrage.frage}“ hat schon Antworten und lässt sich nicht entfernen.`,
					konflikt: true,
				},
			});
		}
		// Spec 8: Eintraege zaehlen wie Antworten. Ohne diese Pruefung endete das Loeschen am
		// Fremdschluessel (NoAction) statt mit einem Satz am Feld.
		if (m.typ === 'HELFER' && helferSperre(m.helfer).eingetragen) {
			konflikte.push({
				rang: index,
				fehler: {
					feld: 'module',
					text: `Die Helferliste „${m.titel ?? HELFERLISTE}“ hat schon Einträge und lässt sich nicht entfernen.`,
					konflikt: true,
				},
			});
		}
		// Plan-Entscheidung 10: Autos und Mitfahrten zaehlen wie Antworten (NoAction am Fremdschluessel).
		if (m.typ === 'FAHRT' && fahrtSperre(m.fahrt).eingetragen) {
			konflikte.push({
				rang: index,
				fehler: {
					feld: 'module',
					text: 'Die Fahrgemeinschaft hat schon Einträge und lässt sich nicht entfernen.',
					konflikt: true,
					fahrt: true,
				},
			});
		}
	});
	if (konflikte.length > 0) {
		const erster = konflikte.reduce((a, b) => (b.rang < a.rang ? b : a));
		return leer({ konflikt: erster.fehler });
	}

	const k = alt.kopf;
	const sichtbarkeitGeaendert = zielgruppeGeaendert(k, neu);
	return {
		fehler: null,
		konflikt: null,
		loeschen,
		behalten,
		anlegen,
		kopfGeaendert:
			neu.titel !== k.titel ||
			neu.modus !== k.modus ||
			neu.rollenfilter !== k.rollenfilter ||
			neu.alleUntergruppen !== k.alleUntergruppen,
		sichtbarkeitGeaendert,
		system,
	};
}
