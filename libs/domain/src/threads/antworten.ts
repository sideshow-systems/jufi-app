import { darfFuerKindHandeln, hatRecht, istJugendleiter } from '../rechte.js';
import { kinderImThread, siehtThread } from './sichtbarkeit.js';
import { EHEMALIGES_MITGLIED, kurzname } from './namen.js';
import { darfBearbeiten } from './rechte.js';
import type { ErgebnisSicht, ThreadKopf, ThreadPerson, Umfeld, UmfrageDaten } from './typen.js';
import { nachVorname } from './umfeld.js';

// Spec 3.2. Entfernte sind nie gefragt, weil das Umfeld sie nicht enthaelt; ihre
// Antworten fallen deshalb in jeder Auswertung von selbst weg. Dasselbe gilt fuer
// Personen, die aus der Zielgruppe gefallen sind: gefragt ist, wer jetzt zur Zielgruppe
// gehoert, nicht wer einmal geantwortet hat.
export function gefragte(umfrage: Pick<UmfrageDaten, 'einheit'>, kopf: ThreadKopf, umfeld: Umfeld): ThreadPerson[] {
	const kinder = kinderImThread(kopf, umfeld);
	const kinderIds = new Set(kinder.map((k) => k.id));
	const alle = [...umfeld.personen.values()];
	const jugendleiter = alle.filter((p) => p.art === 'ERWACHSENER' && istJugendleiter(p));

	// Bei "Nur Familie" liefert kinderImThread die Kinder, damit ihre Familien den
	// Thread sehen; gefragt sind sie dort trotzdem nicht (der Editor bietet die Einheit
	// "pro Jungfischer" dort gar nicht an).
	const gefragteKinder = kopf.rollenfilter === 'NUR_FAMILIE' ? [] : kinder;

	// Im Austausch und bei "Nur Jugendleiter" sieht die Familie den Thread nicht, also
	// wird sie auch nicht gefragt. Bei leerer Zielgruppe ergibt sich die leere Menge von
	// selbst, es bleiben die Jugendleiter.
	const familieGefragt = kopf.rollenfilter === 'JUNGFISCHER_FAMILIE' || kopf.rollenfilter === 'NUR_FAMILIE';
	const bezugspersonen = familieGefragt
		? alle.filter(
				(p) =>
					p.art === 'ERWACHSENER' &&
					umfeld.zuordnungen.some((z) => z.erwachsenerId === p.id && kinderIds.has(z.jungfischerId)),
			)
		: [];
	const erwachsene = [...bezugspersonen, ...jugendleiter];

	const gruppe: ThreadPerson[] =
		umfrage.einheit === 'JUNGFISCHER'
			? gefragteKinder
			: umfrage.einheit === 'ERWACHSENER'
				? erwachsene
				: [...gefragteKinder, ...erwachsene];

	// Wer Bezugsperson und Jugendleiter zugleich ist (Thomas), steht nur einmal da: sonst
	// zaehlte seine Antwort doppelt und "Offen" nannte ihn zweimal.
	return [...new Map(gruppe.map((p) => [p.id, p])).values()].sort(nachVorname);
}

export interface AntwortZeile {
	fuerId: string;
	vorname: string;
	selbst: boolean;
}

// Spec 3.2: eine Zeile fuer sich selbst, wenn gefragt, und eine je eigenem gefragten
// Kind. Die Kinderzeile haengt nur an der Zuordnung, nicht an einer Einheit: bei "pro
// Person" antwortet fuer ein Kind ohne Zugang seine Familie. Verworfen: "pro Person"
// als "jeder mit Zugang", weil Kinder ohne Zugang dann keine Stimme haetten.
export function antwortZeilen(
	betrachter: ThreadPerson,
	umfrage: Pick<UmfrageDaten, 'einheit'>,
	kopf: ThreadKopf,
	umfeld: Umfeld,
): AntwortZeile[] {
	if (!siehtThread(betrachter, kopf, umfeld)) return [];
	const gefragt = gefragte(umfrage, kopf, umfeld);
	const zeilen: AntwortZeile[] = [];
	if (gefragt.some((p) => p.id === betrachter.id)) {
		zeilen.push({ fuerId: betrachter.id, vorname: betrachter.vorname, selbst: true });
	}
	for (const kind of gefragt) {
		if (kind.art !== 'JUNGFISCHER' || kind.id === betrachter.id) continue;
		if (darfFuerKindHandeln(betrachter, kind, umfeld.zuordnungen)) {
			zeilen.push({ fuerId: kind.id, vorname: kind.vorname, selbst: false });
		}
	}
	return zeilen;
}

// Der Server macht daraus 404, 409 und 410 (NICHT_GEFUNDEN, ENTWURF, FRIST_ABGELAUFEN).
export type AntwortErlaubnis = 'ERLAUBT' | 'NICHT_GEFUNDEN' | 'ENTWURF' | 'FRIST_ABGELAUFEN';

// Spec 3.3. Die Reihenfolge ist Teil der Regel: wer den Thread oder die Gefragte nicht
// sehen darf, erfaehrt nichts ueber den Zustand (404 vor 409 und 410). Wer bearbeiten
// darf, traegt auch nach der Frist nach (Anrufe), aber nie in einen Entwurf.
// Fristende ist "jetzt >= frist" (Plan-Entscheidung 8): "bis Do 18:00" heisst, um
// 18:00:00 ist Schluss.
export function darfAntworten(
	person: ThreadPerson,
	fuerId: string,
	umfrage: Pick<UmfrageDaten, 'einheit' | 'frist'>,
	kopf: ThreadKopf,
	umfeld: Umfeld,
	jetzt: Date,
): AntwortErlaubnis {
	if (!siehtThread(person, kopf, umfeld)) return 'NICHT_GEFUNDEN';
	const fuer = gefragte(umfrage, kopf, umfeld).find((p) => p.id === fuerId);
	if (!fuer) return 'NICHT_GEFUNDEN';
	if (!kopf.veroeffentlichtAm) return 'ENTWURF';
	if (darfBearbeiten(person, kopf)) return 'ERLAUBT';
	const eigen =
		fuer.id === person.id || (fuer.art === 'JUNGFISCHER' && darfFuerKindHandeln(person, fuer, umfeld.zuordnungen));
	if (!eigen) return 'NICHT_GEFUNDEN';
	if (umfrage.frist && jetzt.getTime() >= umfrage.frist.getTime()) return 'FRIST_ABGELAUFEN';
	return 'ERLAUBT';
}

export type ErgebnisAnsichtArt = 'NAMEN' | 'SUMME' | 'NICHTS';

// Spec 3.4. Zusaetzlich zur Tabelle sehen Namen, die den Thread bearbeiten duerfen
// (Plan-Entscheidung 5): wer nachtraegt, muss sehen, wer fehlt. Entfernte sehen nichts,
// auch wenn ihnen Rechte anhaengen (wie darfBearbeiten); der Server antwortet ihnen
// ohnehin mit 404.
export function ergebnisAnsicht(
	betrachter: ThreadPerson,
	umfrage: { ergebnisse: ErgebnisSicht },
	kopf: ThreadKopf,
): ErgebnisAnsichtArt {
	if (betrachter.entferntAm) return 'NICHTS';
	if (umfrage.ergebnisse === 'ALLE') return 'NAMEN';
	if (hatRecht(betrachter, 'ANTWORTEN_DETAIL') || darfBearbeiten(betrachter, kopf)) return 'NAMEN';
	if (umfrage.ergebnisse === 'SUMME') return 'SUMME';
	return istJugendleiter(betrachter) ? 'SUMME' : 'NICHTS';
}

export interface AuswertungsName {
	fuerId: string;
	name: string;
	eingetragenVon: string | null;
}

export interface Auswertung {
	ansicht: 'NAMEN' | 'SUMME';
	optionen: { optionId: string; anzahl: number; namen: AuswertungsName[] | null }[];
	offen: { anzahl: number; namen: AuswertungsName[] | null };
}

// Spec 3.4. Gezaehlt wird nur, wer jetzt gefragt ist (Review-Schwerpunkt 3): eine
// Antwort fuer eine entfernte oder aus der Untergruppe gefallene Person bleibt in der
// Datenbank, taucht aber weder in Zahlen noch in Namen auf. Bei "mehrfach" zaehlt eine
// Person unter jeder gewaehlten Option, "Offen" sind nur die ohne jede Antwort. Eine
// Antwort ohne Option gilt als keine Antwort (Etappe 2 verweigert sie serverseitig): eine
// verirrte Zeile darf niemanden aus "Offen" verschwinden lassen, weil dann die Person
// weder gezaehlt noch als fehlend genannt wuerde.
// "eingetragen von" ist hier der Vermerk der Ergebnisliste fuer Jugendleiter, nicht
// namen.eingetragenVon, das die Zeile unter der eigenen Antwort formuliert ("von dir").
export function auswertung(
	betrachter: ThreadPerson,
	umfrage: UmfrageDaten,
	kopf: ThreadKopf,
	umfeld: Umfeld,
): Auswertung | null {
	const ansicht = ergebnisAnsicht(betrachter, umfrage, kopf);
	if (ansicht === 'NICHTS') return null;

	const gefragt = gefragte(umfrage, kopf, umfeld);
	const antwortVon = new Map(umfrage.antworten.filter((a) => a.optionIds.length > 0).map((a) => [a.fuerId, a]));
	const mitVermerk = istJugendleiter(betrachter);

	const name = (p: ThreadPerson): AuswertungsName => {
		const antwort = antwortVon.get(p.id);
		let eingetragenVon: string | null = null;
		if (mitVermerk && antwort && antwort.vonId !== p.id) {
			const von = umfeld.personen.get(antwort.vonId);
			eingetragenVon = von ? kurzname(von) : EHEMALIGES_MITGLIED;
		}
		return { fuerId: p.id, name: kurzname(p), eingetragenVon };
	};
	const liste = (personen: readonly ThreadPerson[]) => ({
		anzahl: personen.length,
		namen: ansicht === 'NAMEN' ? personen.map(name) : null,
	});

	// gefragt ist nach Vorname sortiert, die Teilmengen erben die Reihenfolge.
	return {
		ansicht,
		optionen: umfrage.optionen.map((o) => ({
			optionId: o.id,
			...liste(gefragt.filter((p) => antwortVon.get(p.id)?.optionIds.includes(o.id))),
		})),
		offen: liste(gefragt.filter((p) => !antwortVon.has(p.id))),
	};
}
