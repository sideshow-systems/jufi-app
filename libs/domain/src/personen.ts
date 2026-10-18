import {
	hatRecht,
	istErziehungsberechtigt,
	istJugendleiter,
	istVolljaehrig,
	type PersonSicht,
	type Zuordnung,
} from './rechte.js';

// VOLL = alle Angaben (Verwaltung mit MITGLIEDER, oder die eigenen Daten bzw. die der
// Familie); LESEN = uebrige Jugendleiter, ohne E-Mail; NAME = nur der Name, so sieht
// der Normalbetrachter die Jugendleiter als Ansprechpartner.
export type Einsicht = 'VOLL' | 'LESEN' | 'NAME';

function sindFamilie(a: PersonSicht, b: PersonSicht, zuordnungen: readonly Zuordnung[]): boolean {
	return zuordnungen.some(
		(z) =>
			(z.erwachsenerId === a.id && z.jungfischerId === b.id) || (z.erwachsenerId === b.id && z.jungfischerId === a.id),
	);
}

// Familie sieht das Kind auch ohne Erziehungsberechtigung und auch nach der
// Volljaehrigkeit: Spec 5.6 ("darf weiter sehen"). Die Sicht haengt deshalb an der
// Zuordnung allein, nicht an istErziehungsberechtigt; Alternative waere, Grosseltern
// auszuschliessen, verworfen, weil sie das Kind trotzdem abholen und betreuen.
// Geschwister sind nicht verbunden (keine Zuordnung untereinander) und sehen sich nicht.
// Entfernte sind fuer alle null, auch fuer sich selbst: eine entfernte Person
// kann sich nicht mehr anmelden, und niemand soll sie weiter in Listen finden.
export function einsichtIn(
	betrachter: PersonSicht,
	person: PersonSicht,
	zuordnungen: readonly Zuordnung[],
): Einsicht | null {
	if (person.entferntAm) return null;
	if (hatRecht(betrachter, 'MITGLIEDER')) return 'VOLL';
	if (betrachter.id === person.id || sindFamilie(betrachter, person, zuordnungen)) return 'VOLL';
	if (istJugendleiter(betrachter)) return 'LESEN';
	if (istJugendleiter(person)) return 'NAME';
	return null;
}

export function darfPersonSehen(
	betrachter: PersonSicht,
	person: PersonSicht,
	zuordnungen: readonly Zuordnung[],
): boolean {
	return einsichtIn(betrachter, person, zuordnungen) !== null;
}

export function sichtbarePersonen<T extends PersonSicht>(
	betrachter: PersonSicht,
	personen: readonly T[],
	zuordnungen: readonly Zuordnung[],
): { person: T; einsicht: Einsicht }[] {
	const ergebnis: { person: T; einsicht: Einsicht }[] = [];
	for (const person of personen) {
		const einsicht = einsichtIn(betrachter, person, zuordnungen);
		if (einsicht) ergebnis.push({ person, einsicht });
	}
	return ergebnis;
}

export function pruefeName(s: string): boolean {
	const laenge = s.trim().length;
	return laenge >= 1 && laenge <= 60;
}

export function pruefeGeburtsdatum(d: Date, jetzt: Date): boolean {
	const t = d.getTime();
	return !Number.isNaN(t) && t <= jetzt.getTime() && t >= Date.UTC(1900, 0, 1);
}

interface DublettenMerkmale {
	vorname: string;
	nachname: string;
	geburtsdatum: Date | null;
}

function normiert(s: string): string {
	return s.trim().toLowerCase();
}

// Nur ein Hinweis fuer die Verwaltung, nie eine Sperre: gleichnamige Menschen mit
// gleichem Geburtstag gibt es. Zwei fehlende Geburtsdaten zaehlen als gleich
// (Erwachsene haben oft keines); ein fehlendes gegen ein vorhandenes nicht, sonst
// wuerde jeder Erwachsene gleichen Namens ein Kind gleichen Namens "doppeln".
export function istDoppelt(a: DublettenMerkmale, b: DublettenMerkmale): boolean {
	if (normiert(a.vorname) !== normiert(b.vorname) || normiert(a.nachname) !== normiert(b.nachname)) return false;
	if (a.geburtsdatum === null || b.geburtsdatum === null) return a.geburtsdatum === b.geburtsdatum;
	return a.geburtsdatum.getTime() === b.geburtsdatum.getTime();
}

export type Beziehung =
	'MUTTER' | 'VATER' | 'GROSSMUTTER' | 'GROSSVATER' | 'TANTE' | 'ONKEL' | 'GESCHWISTER' | 'PFLEGEPERSON' | 'ANDERE';

// Nur eine Vorbelegung im Formular; die Verwaltung kann sie ueberstimmen. Gespeichert
// wird das Flag an der Zuordnung, nicht die Beziehung, die rechtliche Lage haengt
// nicht am Verwandtschaftsgrad (Pflegepersonen sind es ohne Verwandtschaft).
export function beziehungVorbelegung(b: Beziehung): boolean {
	return b === 'MUTTER' || b === 'VATER' || b === 'PFLEGEPERSON';
}

export type Warnhinweis =
	| { art: 'OHNE_FAMILIE' }
	| { art: 'EINWILLIGUNG_FEHLT' }
	| { art: 'EINLADUNG_OFFEN'; ablauf: Date }
	| { art: 'MAIL_NICHT_ZUGESTELLT' }
	| { art: 'VOLLJAEHRIG'; seit: Date };

export function warnhinweise(
	e: {
		person: PersonSicht;
		zuordnungen: readonly Zuordnung[];
		hatGueltigeEinwilligung: boolean;
		offeneEinladungAblauf: Date | null;
		einladungsmailGescheitert: boolean;
		volljaehrigGeprueftAm: Date | null;
	},
	jetzt: Date,
): Warnhinweis[] {
	const hinweise: Warnhinweis[] = [];
	const { person } = e;
	const jungfischer = person.art === 'JUNGFISCHER';
	const volljaehrig = istVolljaehrig(person, jetzt);

	if (
		jungfischer &&
		!e.zuordnungen.some((z) => z.jungfischerId === person.id && istErziehungsberechtigt(z, person, jetzt))
	) {
		hinweise.push({ art: 'OHNE_FAMILIE' });
	}
	if (jungfischer && !volljaehrig && !e.hatGueltigeEinwilligung) hinweise.push({ art: 'EINWILLIGUNG_FEHLT' });
	if (e.offeneEinladungAblauf) hinweise.push({ art: 'EINLADUNG_OFFEN', ablauf: e.offeneEinladungAblauf });
	if (e.einladungsmailGescheitert) hinweise.push({ art: 'MAIL_NICHT_ZUGESTELLT' });
	if (jungfischer && volljaehrig && !e.volljaehrigGeprueftAm && person.geburtsdatum) {
		const g = person.geburtsdatum;
		hinweise.push({
			art: 'VOLLJAEHRIG',
			seit: new Date(Date.UTC(g.getUTCFullYear() + 18, g.getUTCMonth(), g.getUTCDate())),
		});
	}
	return hinweise;
}
