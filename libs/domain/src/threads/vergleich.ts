import { pruefeUmfrageAenderung, TEILNAHME_OPTIONEN } from '../module/umfrage/umfrage.js';
import type { ModulDaten } from './ansicht.js';
import type { Feldfehler, ModulEntwurf, OptionEntwurf, ThreadEntwurf } from './entwurf.js';
import type { UmfrageDaten, ThreadKopf } from './typen.js';
import type { SystemArt } from './verlauf.js';

const UNGUELTIG = 'Ungültige Anfrage';

type UmfrageEntwurf = Extract<ModulEntwurf, { typ: 'UMFRAGE' }>;

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
}

export interface EntwurfVergleich {
	/** 400: unbekannte oder doppelte Modul-ID, Typwechsel, fremder Optionsschluessel. */
	fehler: Feldfehler | null;
	/** 409 BEANTWORTET. */
	konflikt: Feldfehler | null;
	/** Modul-IDs. */
	loeschen: string[];
	behalten: ModulPlan[];
	anlegen: { position: number; neu: ModulEntwurf }[];
	/** Eine Spalte des Threads (Titel, Modus, Rollenfilter, alle Untergruppen) hat sich geaendert. */
	kopfGeaendert: boolean;
	/** Rollenfilter, Untergruppen-Schalter oder die gewaehlten Untergruppen haben sich geaendert. */
	sichtbarkeitGeaendert: boolean;
	system: { art: SystemArt; daten: Record<string, unknown> }[];
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

// Ein Schluessel darf nur auf eine Option zeigen, die es gibt: der Server vergibt neue
// Schluessel selbst (Entscheidung 11), ein erfundener oder doppelter gehoerte sonst zwei
// Optionen oder keiner. Ausnahme Teilnahme: ihre Schluessel sind fest.
function schluesselUngueltig(optionen: readonly OptionEntwurf[], erlaubt: ReadonlySet<string>): boolean {
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

const fristIso = (u: UmfrageDaten) => (u.frist ? u.frist.toISOString() : null);

const KONFLIKT_TEXT = {
	einheit: 'Die Einheit lässt sich nach den ersten Antworten nicht mehr ändern.',
	teilnahme: 'Der Teilnahme-Schalter lässt sich nach den ersten Antworten nicht mehr ändern.',
	mehrfach: 'Mehrfachauswahl lässt sich nicht abschalten, solange jemand mehrere Antworten gewählt hat.',
} as const;

interface Bestehendes {
	geaendert: boolean;
	optionenLoeschen: string[];
	konflikt: Feldfehler | null;
	system: EntwurfVergleich['system'];
}

// Vergleich eines Moduls, das der Thread schon hat (gleicher Typ ist geprueft).
function vergleicheBestehendes(alt: ModulDaten, neu: ModulEntwurf, i: number): Bestehendes {
	const ergebnis: Bestehendes = {
		geaendert: alt.titel !== neu.titel,
		optionenLoeschen: [],
		konflikt: null,
		system: [],
	};
	if (alt.typ === 'INFO' && neu.typ === 'INFO') {
		ergebnis.geaendert ||= alt.text !== neu.text;
	} else if (alt.typ === 'TERMIN' && neu.typ === 'TERMIN') {
		const a = alt.termin;
		const n = neu.termin;
		const zeit =
			a.startDatum !== n.startDatum || a.endDatum !== n.endDatum || a.beginn !== n.beginn || a.ende !== n.ende;
		ergebnis.geaendert ||= zeit || a.ort !== n.ort || a.treffpunkt !== n.treffpunkt;
		// Nur die Zeit ist eine Nachricht an die Gruppe; ein anderer Ort nicht (Entscheidung 6).
		// Die Daten tragen den ganzen Termin, damit der Satz im Verlauf ohne zweite Abfrage steht.
		if (zeit) eintrag(ergebnis, 'TERMIN_GEAENDERT', { termin: { modulId: alt.id, ...n } });
	} else if (alt.typ === 'UMFRAGE' && neu.typ === 'UMFRAGE') {
		umfrage(ergebnis, alt, neu, i);
	}
	return ergebnis;
}

function eintrag(e: Bestehendes, art: SystemArt, daten: Record<string, unknown>): void {
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

function gleicheMenge(a: readonly string[], b: readonly string[]): boolean {
	const menge = new Set(a);
	const andere = new Set(b);
	return menge.size === andere.size && [...menge].every((s) => andere.has(s));
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

		const b = vergleicheBestehendes(bisher, m, position);
		if (b.konflikt) konflikte.push({ rang: index, fehler: b.konflikt });
		system.push(...b.system);
		behalten.push({
			id: m.id,
			position,
			neu: m,
			geaendert: b.geaendert || index !== position,
			optionenLoeschen: b.optionenLoeschen,
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
	});
	if (konflikte.length > 0) {
		const erster = konflikte.reduce((a, b) => (b.rang < a.rang ? b : a));
		return leer({ konflikt: erster.fehler });
	}

	const k = alt.kopf;
	const sichtbarkeitGeaendert =
		neu.rollenfilter !== k.rollenfilter ||
		neu.alleUntergruppen !== k.alleUntergruppen ||
		// Bei "alle Untergruppen" sind die IDs ohne Belang, ein Rest im Entwurf aendert nichts.
		(!neu.alleUntergruppen && !gleicheMenge(neu.untergruppenIds, k.untergruppenIds));
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
