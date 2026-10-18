// Die Rechte als Literal-Union statt des Prisma-Enums: libs/domain haengt nicht an
// @jufi/db (reine Regeln, auch in der Oberflaeche nutzbar). Die Werte sind die des
// Enums Recht im Schema; Prisma-Enum-Werte sind Strings gleichen Namens und daher
// ohne Umwandlung zuweisbar.
export type RechtName =
	| 'MITGLIEDER'
	| 'THREADS_ERSTELLEN'
	| 'ALLE_THREADS'
	| 'DOKUMENTE'
	| 'ANTWORTEN_DETAIL'
	| 'JUGENDLEITER_RECHTE'
	| 'EINSTELLUNGEN';

export const ALLE_RECHTE: readonly RechtName[] = [
	'MITGLIEDER',
	'THREADS_ERSTELLEN',
	'ALLE_THREADS',
	'DOKUMENTE',
	'ANTWORTEN_DETAIL',
	'JUGENDLEITER_RECHTE',
	'EINSTELLUNGEN',
];

// Vorlagen sind nur Vorbelegungen beim Vergeben, keine gespeicherte Rolle: gespeichert
// werden stets die einzelnen Rechte. Eine Rolle als Spalte wurde verworfen, weil jede
// Abweichung ("Betreuer, aber mit Dokumenten") ein neuer Rollentyp waere.
// Der Jugendleiter bekommt weder JUGENDLEITER_RECHTE noch EINSTELLUNGEN, damit nur die
// Leitung Rechte weitergibt und den Verein einstellt.
export const RECHTE_VORLAGEN: Record<'LEITUNG' | 'JUGENDLEITER' | 'BETREUER', readonly RechtName[]> = {
	LEITUNG: ALLE_RECHTE,
	JUGENDLEITER: ['MITGLIEDER', 'THREADS_ERSTELLEN', 'ALLE_THREADS', 'DOKUMENTE', 'ANTWORTEN_DETAIL'],
	BETREUER: ['ANTWORTEN_DETAIL'],
};

export interface PersonSicht {
	id: string;
	art: 'ERWACHSENER' | 'JUNGFISCHER';
	rechte: readonly RechtName[];
	geburtsdatum: Date | null;
	entferntAm: Date | null;
}

export interface Zuordnung {
	erwachsenerId: string;
	jungfischerId: string;
	erziehungsberechtigt: boolean;
}

export function hatRecht(p: Pick<PersonSicht, 'rechte'>, r: RechtName): boolean {
	return p.rechte.includes(r);
}

// Jugendleiter ist, wer irgendein Recht hat; eine eigene Kennzeichnung gibt es nicht,
// sonst koennten Kennzeichen und Rechte auseinanderlaufen.
export function istJugendleiter(p: Pick<PersonSicht, 'rechte'>): boolean {
	return p.rechte.length > 0;
}

// Volljaehrig ab dem 18. Geburtstag um 0 Uhr. Das Geburtsdatum ist eine reine
// Kalenderangabe (@db.Date, UTC-Mitternacht); deshalb wird der Geburtstag als
// UTC-Zeitpunkt (Jahr + 18, gleicher Monat und Tag) gebildet und mit jetzt verglichen.
// Date.UTC rollt den 29. Februar im Nicht-Schaltjahr auf den 1. Maerz: wer an einem
// Schalttag geboren ist, wird dort am 1. Maerz volljaehrig. Alternative waere der
// 28. Februar; verworfen, weil ein Kind dann vor seinem "vollen" Alter volljaehrig
// wuerde. jetzt ist ein Parameter, damit die Regel ohne Uhr testbar bleibt.
// Ohne Geburtsdatum gilt das Kind als minderjaehrig (die sicherere Annahme).
export function istVolljaehrig(p: Pick<PersonSicht, 'geburtsdatum'>, jetzt: Date): boolean {
	if (!p.geburtsdatum) return false;
	const g = p.geburtsdatum;
	const geburtstag18 = Date.UTC(g.getUTCFullYear() + 18, g.getUTCMonth(), g.getUTCDate());
	return jetzt.getTime() >= geburtstag18;
}

export function istErziehungsberechtigt(z: Zuordnung, kind: PersonSicht, jetzt: Date): boolean {
	return z.erziehungsberechtigt && !kind.entferntAm && !istVolljaehrig(kind, jetzt);
}

// Handeln fuer das Kind (z. B. antworten) haengt nur an der Zuordnung, nicht an
// Erziehungsberechtigung oder Alter: auch Grosseltern und volljaehrig gewordene Kinder
// bleiben zugeordnet, sonst wuerde eine Antwort am 18. Geburtstag stillschweigend ungueltig.
export function darfFuerKindHandeln(
	erwachsener: PersonSicht,
	kind: PersonSicht,
	zuordnungen: readonly Zuordnung[],
): boolean {
	return zuordnungen.some((z) => z.erwachsenerId === erwachsener.id && z.jungfischerId === kind.id);
}

// Spec 4.1. Ziele mit Rechten einzuladen heisst Rechte zu vergeben, daher nur mit
// JUGENDLEITER_RECHTE; MITGLIEDER allein reicht dafuer nicht.
export function darfEinladen(
	h: PersonSicht,
	ziel: PersonSicht,
	zuordnungen: readonly Zuordnung[],
	jetzt: Date,
): boolean {
	if (ziel.entferntAm) return false;
	if (istJugendleiter(ziel)) return hatRecht(h, 'JUGENDLEITER_RECHTE');
	if (hatRecht(h, 'MITGLIEDER')) return true;
	return (
		ziel.art === 'JUNGFISCHER' &&
		zuordnungen.some(
			(z) => z.erwachsenerId === h.id && z.jungfischerId === ziel.id && istErziehungsberechtigt(z, ziel, jetzt),
		)
	);
}

// neueRechte ist (noch) ohne Wirkung auf die Entscheidung; es steht in der Signatur,
// damit spaetere Grenzen (z. B. nur Rechte vergeben, die man selbst hat) keine
// Aufrufer aendern.
export function darfRechteAendern(h: PersonSicht, ziel: PersonSicht, _neueRechte: readonly RechtName[]): boolean {
	return hatRecht(h, 'JUGENDLEITER_RECHTE') && ziel.art === 'ERWACHSENER';
}

// Ein Verein ohne Leitung kann niemanden mehr einladen oder Rechte vergeben.
// Entfernte zaehlen nicht: sie koennen sich nicht mehr anmelden.
// Die Invariante zaehlt Personen mit dem Recht, nicht Personen mit Zugang: rettet ein vergebenes
// Recht ohne Zugang den Verein nicht, hilft nur der Notfall-Link des Plattform-Admins.
export function wuerdeLetzteLeitungVerlieren(
	erwachsene: readonly Pick<PersonSicht, 'id' | 'rechte' | 'entferntAm'>[],
	zielId: string,
	neueRechte: readonly RechtName[],
): boolean {
	return !erwachsene.some((e) => {
		if (e.entferntAm) return false;
		const rechte = e.id === zielId ? neueRechte : e.rechte;
		return rechte.includes('JUGENDLEITER_RECHTE');
	});
}
