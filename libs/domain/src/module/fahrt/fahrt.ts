import { istKalendertag } from '../../zeit.js';
import { darfFuerKindHandeln } from '../../rechte.js';
import type { ModulDaten } from '../../threads/ansicht.js';
import { istArchiviert } from '../../threads/archiv.js';
import { GRENZEN } from '../../threads/entwurf.js';
import { absenderName, dabeiKinder, EHEMALIGES_MITGLIED, kurzname } from '../../threads/namen.js';
import { darfBearbeiten } from '../../threads/rechte.js';
import { kinderImThread, siehtThread } from '../../threads/sichtbarkeit.js';
import type {
	AutoDaten,
	FahrtDaten,
	MitfahrtDaten,
	Richtung,
	ThreadDaten,
	ThreadKopf,
	ThreadPerson,
	Umfeld,
	UmfrageDaten,
} from '../../threads/typen.js';
import { letzterTag, UHRZEIT, type TerminDaten } from '../termin/termin.js';

export const RICHTUNG_TEXT: Readonly<Record<Richtung, string>> = { HIN: 'Hinfahrt', RUECK: 'Rückfahrt' };

// Hinfahrt vor Rueckfahrt: die Reihenfolge der Ansicht und der Konflikte. Exportiert, damit
// Vorschau, Editor und Thread-Seite nicht je ihre eigene Liste fuehren, die beim Erweitern
// (eine dritte Richtung) still auseinanderliefe.
export const RICHTUNGEN: readonly Richtung[] = ['HIN', 'RUECK'];

// Der Server macht aus NICHT_GEFUNDEN 404 und aus den anderen vier die 409 mit dem
// gleichnamigen Code.
export type FahrtErlaubnis = 'ERLAUBT' | 'NICHT_GEFUNDEN' | 'ENTWURF' | 'ARCHIVIERT' | 'NICHT_DABEI';

// Was die Regeln aus ThreadDaten brauchen: den Kopf fuer Sicht und Rechte, die Termine fuer
// die Archivregel, die Umfragen fuer die Teilnahme.
export type FahrtKontext = { kopf: ThreadKopf; termine: readonly TerminDaten[]; umfragen: readonly UmfrageDaten[] };

// Die Kinder, die einen Platz brauchen koennen: die der Zielgruppe, bei einer
// Teilnahme-Umfrage nur die mit "Dabei" (dabeiKinder; null heisst dort "keine Auskunft",
// also alle). Ein Vielleicht reserviert keinen Platz (Spec 6.2), sonst bliebe ein Auto
// fuer ein Kind frei, das am Ende absagt. Verworfen: auch das Vielleicht mitzurechnen,
// denn dann stuende die halbe Gruppe unter "Braucht noch Mitfahrt".
export function betrachteteKinder(
	kopf: ThreadKopf,
	daten: Pick<FahrtKontext, 'umfragen'>,
	umfeld: Umfeld,
): ThreadPerson[] {
	const dabei = dabeiKinder(daten);
	const kinder = kinderImThread(kopf, umfeld);
	return dabei === null ? kinder : kinder.filter((k) => dabei.has(k.id));
}

// "Braucht noch Mitfahrt": Betrachtete ohne Eintrag in dieser Richtung. "Kommt selbst" ist
// ein Eintrag (autoId null) und nimmt das Kind aus der Liste, ohne dass ein Platz belegt
// wird. Die Richtungen rechnen getrennt: wer hin im Auto sitzt, braucht zurueck noch eines.
// Nach Kurzname, damit die Liste nicht von der Ladereihenfolge abhaengt (Entscheidung 16).
export function brauchtMitfahrt(
	fahrt: FahrtDaten,
	richtung: Richtung,
	betrachtete: readonly ThreadPerson[],
): ThreadPerson[] {
	const versorgt = new Set(fahrt.mitfahrten.filter((m) => m.richtung === richtung).map((m) => m.kindId));
	return betrachtete
		.filter((k) => !versorgt.has(k.id))
		.sort((a, b) => kurzname(a).localeCompare(kurzname(b), 'de') || a.id.localeCompare(b.id));
}

// Die Reihenfolge ist Teil jeder Regel dieser Datei und dieselbe wie bei der Helferliste
// (darfEintragen): wer den Thread nicht sehen darf, erfaehrt nichts ueber seinen Zustand
// (404 vor 409), dann Entwurf, dann Archiv. Im Archiv traegt nur noch die Leitung ein,
// wie nach einer Frist; die Fahrgemeinschaft hat keine eigene Frist. Erst danach gilt das
// Recht der jeweiligen Handlung, das die Funktionen selbst pruefen.
// Verworfen: darfAntworten fuer das Archiv zu erweitern, denn dann aenderte sich nebenbei
// die Umfrage.
function grundErlaubnis(person: ThreadPerson, daten: FahrtKontext, umfeld: Umfeld, jetzt: Date): FahrtErlaubnis {
	if (!siehtThread(person, daten.kopf, umfeld)) return 'NICHT_GEFUNDEN';
	if (!daten.kopf.veroeffentlichtAm) return 'ENTWURF';
	if (!darfBearbeiten(person, daten.kopf) && istArchiviert(daten.kopf, daten.termine, jetzt)) return 'ARCHIVIERT';
	return 'ERLAUBT';
}

// Wer fuer ein Kind handeln darf: das Kind selbst oder wer ihm zugeordnet ist (Spec 6.2 meint
// die Bezugsperson). Verworfen: das Antwortrecht (darfAntworten mit Einheit JUNGFISCHER),
// denn das haengt an gefragte, und die ist bei "Nur Familie" fuer Kinder leer: dort duerfte
// nur die Leitung einsetzen, obwohl die Fahrgemeinschaft in jedem Rollenfilter erlaubt ist
// (Plan-Entscheidung 14). Die Leitung prueft der Aufrufer vorher.
function darfFuerKind(person: ThreadPerson, kind: ThreadPerson | undefined, umfeld: Umfeld): boolean {
	if (!kind || kind.art !== 'JUNGFISCHER') return false;
	return kind.id === person.id || darfFuerKindHandeln(person, kind, umfeld.zuordnungen);
}

// Plan-Entscheidung 8: Ein Auto bietet jede Person nur fuer sich selbst an, auch die
// Leitung; wer fahrt, soll es selbst zusagen. Deshalb gilt hier nur "Erwachsener" und kein
// Leitungsrecht. Verworfen: Autos im Namen anderer, die dann nach einer Zusage aussehen,
// die niemand gegeben hat.
export function darfAnbieten(person: ThreadPerson, daten: FahrtKontext, umfeld: Umfeld, jetzt: Date): FahrtErlaubnis {
	const grund = grundErlaubnis(person, daten, umfeld, jetzt);
	if (grund !== 'ERLAUBT') return grund;
	return person.art === 'ERWACHSENER' ? 'ERLAUBT' : 'NICHT_GEFUNDEN';
}

// Aendern und Zurueckziehen eines Autos: der Fahrer oder die Leitung (die ein Auto
// wegnehmen kann, dessen Fahrer nicht mehr erreichbar ist).
export function darfAutoAendern(
	person: ThreadPerson,
	auto: Pick<AutoDaten, 'fahrerId'>,
	daten: FahrtKontext,
	umfeld: Umfeld,
	jetzt: Date,
): FahrtErlaubnis {
	const grund = grundErlaubnis(person, daten, umfeld, jetzt);
	if (grund !== 'ERLAUBT') return grund;
	return auto.fahrerId === person.id || darfBearbeiten(person, daten.kopf) ? 'ERLAUBT' : 'NICHT_GEFUNDEN';
}

// Plan-Entscheidung 7: Einsetzen und "kommt selbst" gelten nur fuer betrachtete Kinder,
// auch fuer die Leitung. Das Recht kommt zuerst: wer ein Kind nicht fuehren darf, erfaehrt
// nicht, ob es zugesagt hat (404 statt NICHT_DABEI). Ein Kind, das nicht zum Thread
// gehoert, und eine erwachsene Person sind fuer alle "nicht gefunden", auch fuer die
// Leitung; darfAntworten laesst die Leitung sonst fuer jede Zeile durch, die es gibt.
// Verworfen: NICHT_DABEI nur fuer die Familie, weil die Leitung dann ueber das Vielleicht
// einen Platz reservierte, den Spec 6.2 nicht vergibt.
export function darfEinsetzen(
	person: ThreadPerson,
	kindId: string,
	daten: FahrtKontext,
	umfeld: Umfeld,
	jetzt: Date,
): FahrtErlaubnis {
	const grund = grundErlaubnis(person, daten, umfeld, jetzt);
	if (grund !== 'ERLAUBT') return grund;
	const kind = kinderImThread(daten.kopf, umfeld).find((k) => k.id === kindId);
	if (!kind) return 'NICHT_GEFUNDEN';
	if (!darfBearbeiten(person, daten.kopf) && !darfFuerKind(person, kind, umfeld)) return 'NICHT_GEFUNDEN';
	return betrachteteKinder(daten.kopf, daten, umfeld).some((k) => k.id === kindId) ? 'ERLAUBT' : 'NICHT_DABEI';
}

// Spec 6.2, "Abgesagt, aber im Auto": Herausnehmen geht immer, auch fuer ein Kind, das
// inzwischen nicht mehr betrachtet wird; sonst bliebe ein Platz belegt, den niemand mehr
// freigeben duerfte. Deshalb fehlt hier die Betrachtet-Pruefung von darfEinsetzen. Recht
// hat die Leitung, der Fahrer des Autos (er raeumt seinen Platz selbst) und wer fuer das
// Kind handeln darf (darfFuerKind); das Kind muss dafuer nicht mehr zum Thread gehoeren. Verworfen: das Herausnehmen auf die Familie zu beschraenken, denn
// ein Fahrer, dem ein Kind absagt, muss den Platz freigeben koennen.
export function darfHerausnehmen(
	person: ThreadPerson,
	mitfahrt: Pick<MitfahrtDaten, 'kindId' | 'autoId'>,
	fahrt: FahrtDaten,
	daten: FahrtKontext,
	umfeld: Umfeld,
	jetzt: Date,
): FahrtErlaubnis {
	const grund = grundErlaubnis(person, daten, umfeld, jetzt);
	if (grund !== 'ERLAUBT') return grund;
	if (darfBearbeiten(person, daten.kopf)) return 'ERLAUBT';
	const fahrerId = mitfahrt.autoId === null ? null : fahrt.autos.find((a) => a.id === mitfahrt.autoId)?.fahrerId;
	if (fahrerId === person.id) return 'ERLAUBT';
	return darfFuerKind(person, umfeld.personen.get(mitfahrt.kindId), umfeld) ? 'ERLAUBT' : 'NICHT_GEFUNDEN';
}

// Wer schon im Auto sitzt, aendert nichts am Fuellstand und darf bleiben (auch im vollen
// Auto, etwa beim erneuten Absenden); "kommt selbst" belegt keinen Platz. Gezaehlt wird
// jede Mitfahrt, die auf das Auto zeigt, auch die eines Kindes, das nicht mehr betrachtet
// wird, denn es sitzt noch darin (wie bei hatPlatzFuer der Helferliste).
export function hatPlatzIn(auto: AutoDaten, fahrt: FahrtDaten, kindId: string): boolean {
	const imAuto = fahrt.mitfahrten.filter((m) => m.autoId === auto.id);
	return imAuto.some((m) => m.kindId === kindId) || imAuto.length < auto.plaetze;
}

export type AutoEingabe = {
	plaetze: number;
	abfahrtTag: string | null;
	abfahrtZeit: string | null;
	ort: string | null;
	notiz: string | null;
};

// Steuer- und Formatzeichen (etwa die Richtungsumkehr U+202E) koennten den Namen daneben
// optisch verdrehen; Ort und Notiz sind kurze Saetze und brauchen keines davon.
const UNSICHTBAR = /[\p{Cc}\p{Cf}]/u;

// Laenge in Codepunkten nach trim, wie alle Grenzen in GRENZEN: ein Emoji zaehlt einmal.
// Leer heisst "keine Angabe" (null). undefined (Feld fehlt) gilt wie null.
function pruefeText(roh: unknown): { ok: true; wert: string | null } | { ok: false } {
	if (roh === undefined || roh === null) return { ok: true, wert: null };
	if (typeof roh !== 'string') return { ok: false };
	const wert = roh.trim();
	if (wert === '') return { ok: true, wert: null };
	if (UNSICHTBAR.test(wert) || [...wert].length > GRENZEN.autoText) return { ok: false };
	return { ok: true, wert };
}

// Tag und Uhrzeit sind optional, aber wenn gesetzt, dann in der Form, die Termine und
// Datenbank kennen. Ein leerer String ist kein Tag: der Client schickt null.
function pruefeMuster(
	roh: unknown,
	gueltig: (s: string) => boolean,
): { ok: true; wert: string | null } | { ok: false } {
	if (roh === undefined || roh === null) return { ok: true, wert: null };
	return typeof roh === 'string' && gueltig(roh) ? { ok: true, wert: roh } : { ok: false };
}

// Spec 6.1 und 6.2 fuer die Eingabe eines Autos, ohne Angular und ohne Server. Das erste
// ungueltige Feld nennt der Server als 400 (ungueltigesFeld); die Reihenfolge ist die von
// AutoEingabe. Die Grenzen stehen auch als CHECKs im Schema (GRENZEN.plaetze).
export function pruefeAuto(roh: unknown): { ok: true; auto: AutoEingabe } | { ok: false; feld: keyof AutoEingabe } {
	const e: Record<string, unknown> = typeof roh === 'object' && roh !== null ? (roh as Record<string, unknown>) : {};
	const plaetze = e['plaetze'];
	if (typeof plaetze !== 'number' || !Number.isInteger(plaetze) || plaetze < 1 || plaetze > GRENZEN.plaetze) {
		return { ok: false, feld: 'plaetze' };
	}
	const tag = pruefeMuster(e['abfahrtTag'], istKalendertag);
	if (!tag.ok) return { ok: false, feld: 'abfahrtTag' };
	const zeit = pruefeMuster(e['abfahrtZeit'], (s) => UHRZEIT.test(s));
	if (!zeit.ok) return { ok: false, feld: 'abfahrtZeit' };
	const ort = pruefeText(e['ort']);
	if (!ort.ok) return { ok: false, feld: 'ort' };
	const notiz = pruefeText(e['notiz']);
	if (!notiz.ok) return { ok: false, feld: 'notiz' };
	return {
		ok: true,
		auto: { plaetze, abfahrtTag: tag.wert, abfahrtZeit: zeit.wert, ort: ort.wert, notiz: notiz.wert },
	};
}

// Was an einer Fahrgemeinschaft durch Eintraege festliegt, je Richtung: ein Auto oder eine
// Mitfahrt (auch "kommt selbst") genuegt. Der Editor sperrt damit Umschalter und Entfernen,
// bevor der Server mit 409 antworten muss; beide fragen dieselbe Funktion (wie helferSperre).
export interface FahrtSperre {
	/** Irgendeine Richtung hat Eintraege: das Modul laesst sich nicht entfernen. */
	eingetragen: boolean;
	HIN: boolean;
	RUECK: boolean;
}

export function fahrtSperre(f: FahrtDaten): FahrtSperre {
	const belegt = (richtung: Richtung) =>
		f.autos.some((a) => a.richtung === richtung) || f.mitfahrten.some((m) => m.richtung === richtung);
	const hin = belegt('HIN');
	const rueck = belegt('RUECK');
	return { eingetragen: hin || rueck, HIN: hin, RUECK: rueck };
}

export type FahrtKonflikt = { richtung: Richtung };

// Plan-Entscheidung 10: Eine Richtung mit Autos oder Mitfahrten laesst sich nicht abschalten.
// Verworfen: die Eintraege dabei still zu loeschen, denn dann stuende eine Familie ohne
// Nachricht nicht mehr in ihrem Auto. Hinfahrt zuerst, der Server meldet nur den ersten.
export function pruefeFahrtAenderung(alt: FahrtDaten, neu: { hin: boolean; rueck: boolean }): FahrtKonflikt[] {
	const sperre = fahrtSperre(alt);
	const an: Record<Richtung, boolean> = { HIN: neu.hin, RUECK: neu.rueck };
	return RICHTUNGEN.filter((richtung) => sperre[richtung] && !an[richtung]).map((richtung) => ({ richtung }));
}

export interface FahrtKind {
	kindId: string;
	/** kurzname; ein Kind, das nicht im Umfeld steht (entfernt), heisst ehemaliges Mitglied. */
	name: string;
	/** Das Kind gehoert nicht mehr zu den betrachteten (abgesagt, Vielleicht): es sitzt noch im Auto. */
	nichtMehrDabei: boolean;
	darfHerausnehmen: boolean;
}

export interface FahrtAutoAnsicht {
	id: string;
	fahrerId: string;
	/** absenderName: wie ein Absender im Verlauf. */
	fahrer: string;
	eigenes: boolean;
	darfAendern: boolean;
	plaetze: number;
	frei: number;
	abfahrtTag: string | null;
	abfahrtZeit: string | null;
	ort: string | null;
	notiz: string | null;
	mitfahrer: FahrtKind[];
}

export interface FahrtRichtungAnsicht {
	richtung: Richtung;
	/** Plan-Entscheidung 15: Vorbelegung des Abfahrtstags im Formular, ohne Termin null. */
	vorschlagTag: string | null;
	darfAnbieten: boolean;
	autos: FahrtAutoAnsicht[];
	brauchtMitfahrt: { kindId: string; name: string }[];
	kommtSelbst: FahrtKind[];
}

export interface FahrtModulAnsicht {
	typ: 'FAHRT';
	id: string;
	titel: string | null;
	leitung: boolean;
	richtungen: FahrtRichtungAnsicht[];
	/** Die Kinder, die die Person selbst einsetzen darf; die Leitung setzt andere ueber "Umsetzen" um. */
	kinder: { kindId: string; vorname: string; selbst: boolean }[];
}

/**
 * Die Fahrgemeinschaft so, wie die Person sie sieht. Alle Leser sehen alle Autos und Mitfahrer
 * (Plan-Entscheidung 11: alle Leser sehen die Fahrgemeinschaft); was die Person tun darf, kommt je
 * Auto und je Kind aus den Regeln dieser Datei, damit Entwurf, Archiv und Zuordnung an einer
 * Stelle entschieden werden.
 *
 * "Kinder" sind die, fuer die die Person einsetzen darf und die betrachtet werden, mit der
 * Zuordnung als Grenze auch fuer die Leitung: Sie darf jedes betrachtete Kind einsetzen
 * (darfEinsetzen), die Liste soll aber nur ihre eigenen zeigen, sonst stuende am Handy jedes
 * Kind des Vereins als Knopf neben ihrem. Verworfen: die Liste aus antwortZeilen zu bilden,
 * denn gefragte ist bei "Nur Familie" fuer Kinder leer, obwohl die Mutter dort einsetzen darf.
 * Die Leitung setzt fremde Kinder ueber "Umsetzen" an der Mitfahrt um.
 */
export function fahrtAnsicht(
	ich: ThreadPerson,
	modul: Extract<ModulDaten, { typ: 'FAHRT' }>,
	daten: ThreadDaten,
	umfeld: Umfeld,
	jetzt: Date,
): FahrtModulAnsicht {
	const f = modul.fahrt;
	const betrachtete = betrachteteKinder(daten.kopf, daten, umfeld);
	const betrachtetIds = new Set(betrachtete.map((k) => k.id));
	const name = (id: string) => {
		const p = umfeld.personen.get(id);
		return p ? kurzname(p) : EHEMALIGES_MITGLIED;
	};
	const kind = (m: MitfahrtDaten): FahrtKind => ({
		kindId: m.kindId,
		name: name(m.kindId),
		nichtMehrDabei: !betrachtetIds.has(m.kindId),
		darfHerausnehmen: darfHerausnehmen(ich, m, f, daten, umfeld, jetzt) === 'ERLAUBT',
	});
	// Der erste Termin in Modulreihenfolge (Plan-Entscheidung 15), nicht der fruehste: Der Ersteller
	// ordnet die Module, und ein Thread hat in der Regel einen.
	const termin = daten.termine[0];
	const vorschlag: Record<Richtung, string | null> = {
		HIN: termin ? termin.startDatum : null,
		RUECK: termin ? letzterTag(termin) : null,
	};
	const anbietenErlaubt = darfAnbieten(ich, daten, umfeld, jetzt) === 'ERLAUBT';

	return {
		typ: 'FAHRT',
		id: modul.id,
		titel: modul.titel,
		leitung: darfBearbeiten(ich, daten.kopf),
		richtungen: RICHTUNGEN.filter((richtung) => (richtung === 'HIN' ? f.hin : f.rueck)).map(
			(richtung): FahrtRichtungAnsicht => ({
				richtung,
				vorschlagTag: vorschlag[richtung],
				darfAnbieten: anbietenErlaubt && !f.autos.some((a) => a.richtung === richtung && a.fahrerId === ich.id),
				autos: f.autos
					.filter((a) => a.richtung === richtung)
					.map((a): FahrtAutoAnsicht => {
						const mitfahrer = f.mitfahrten.filter((m) => m.autoId === a.id).map(kind);
						return {
							id: a.id,
							fahrerId: a.fahrerId,
							fahrer: absenderName(a.fahrerId, umfeld),
							eigenes: a.fahrerId === ich.id,
							darfAendern: darfAutoAendern(ich, a, daten, umfeld, jetzt) === 'ERLAUBT',
							plaetze: a.plaetze,
							// Auch ein Kind, das nicht mehr betrachtet wird, belegt seinen Platz (hatPlatzIn).
							frei: Math.max(0, a.plaetze - mitfahrer.length),
							abfahrtTag: a.abfahrtTag,
							abfahrtZeit: a.abfahrtZeit,
							ort: a.ort,
							notiz: a.notiz,
							mitfahrer,
						};
					}),
				brauchtMitfahrt: brauchtMitfahrt(f, richtung, betrachtete).map((k) => ({
					kindId: k.id,
					name: kurzname(k),
				})),
				kommtSelbst: f.mitfahrten
					.filter((m) => m.richtung === richtung && m.autoId === null)
					.map(kind)
					.sort((a, b) => a.name.localeCompare(b.name, 'de') || a.kindId.localeCompare(b.kindId)),
			}),
		),
		kinder: betrachtete
			.filter((k) => darfFuerKind(ich, k, umfeld) && darfEinsetzen(ich, k.id, daten, umfeld, jetzt) === 'ERLAUBT')
			.map((k) => ({ kindId: k.id, vorname: k.vorname, selbst: k.id === ich.id })),
	};
}
