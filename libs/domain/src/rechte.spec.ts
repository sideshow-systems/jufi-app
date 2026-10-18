import {
	ALLE_RECHTE,
	darfEinladen,
	darfFuerKindHandeln,
	darfRechteAendern,
	hatRecht,
	istErziehungsberechtigt,
	istJugendleiter,
	istVolljaehrig,
	RECHTE_VORLAGEN,
	wuerdeLetzteLeitungVerlieren,
	type PersonSicht,
	type RechtName,
	type Zuordnung,
} from './rechte.js';

const JETZT = new Date('2026-10-18T12:00:00Z');

function person(id: string, aenderung: Partial<PersonSicht> = {}): PersonSicht {
	return { id, art: 'ERWACHSENER', rechte: [], geburtsdatum: null, entferntAm: null, ...aenderung };
}

function kind(id: string, geburtsdatum: Date | null, aenderung: Partial<PersonSicht> = {}): PersonSicht {
	return person(id, { art: 'JUNGFISCHER', geburtsdatum, ...aenderung });
}

function zuordnung(erwachsenerId: string, jungfischerId: string, erziehungsberechtigt = true): Zuordnung {
	return { erwachsenerId, jungfischerId, erziehungsberechtigt };
}

describe('istVolljaehrig', () => {
	it('ist genau am 18. Geburtstag um 0 Uhr volljaehrig', () => {
		const p = { geburtsdatum: new Date('2008-03-10') };
		expect(istVolljaehrig(p, new Date('2026-03-09T23:59:00Z'))).toBe(false);
		expect(istVolljaehrig(p, new Date('2026-03-10T00:00:00Z'))).toBe(true);
	});

	it('behandelt den 29. Februar im Nicht-Schaltjahr als 1. Maerz', () => {
		const p = { geburtsdatum: new Date('2008-02-29') };
		expect(istVolljaehrig(p, new Date('2026-02-28T12:00:00Z'))).toBe(false);
		expect(istVolljaehrig(p, new Date('2026-03-01T00:00:00Z'))).toBe(true);
	});

	it('haelt ein Kind ohne Geburtsdatum fuer nicht volljaehrig', () => {
		expect(istVolljaehrig({ geburtsdatum: null }, JETZT)).toBe(false);
	});
});

describe('Vorlagen', () => {
	it('gibt der Leitung alle sieben Rechte', () => {
		expect(ALLE_RECHTE).toHaveLength(7);
		expect([...RECHTE_VORLAGEN.LEITUNG].sort()).toEqual([...ALLE_RECHTE].sort());
	});

	it('nimmt dem Jugendleiter Jugendleiter-Rechte und Einstellungen', () => {
		expect(RECHTE_VORLAGEN.JUGENDLEITER).not.toContain('JUGENDLEITER_RECHTE');
		expect(RECHTE_VORLAGEN.JUGENDLEITER).not.toContain('EINSTELLUNGEN');
	});

	it('gibt dem Betreuer nur die Antwort-Details', () => {
		expect(RECHTE_VORLAGEN.BETREUER).toEqual(['ANTWORTEN_DETAIL']);
	});
});

describe('hatRecht und istJugendleiter', () => {
	it('prueft das einzelne Recht', () => {
		expect(hatRecht({ rechte: ['MITGLIEDER'] }, 'MITGLIEDER')).toBe(true);
		expect(hatRecht({ rechte: ['MITGLIEDER'] }, 'DOKUMENTE')).toBe(false);
	});

	it('macht jeden mit mindestens einem Recht zum Jugendleiter', () => {
		expect(istJugendleiter({ rechte: [] })).toBe(false);
		expect(istJugendleiter({ rechte: ['ANTWORTEN_DETAIL'] })).toBe(true);
	});
});

describe('Familie', () => {
	const kindJung = kind('k', new Date('2015-05-05'));
	const z = zuordnung('e', 'k');

	it('erkennt Erziehungsberechtigte eines minderjaehrigen Kindes', () => {
		expect(istErziehungsberechtigt(z, kindJung, JETZT)).toBe(true);
		expect(istErziehungsberechtigt(zuordnung('e', 'k', false), kindJung, JETZT)).toBe(false);
	});

	it('wirkt bei volljaehrigem Kind nicht mehr erziehungsberechtigt, darf aber weiter handeln', () => {
		const gross = kind('k', new Date('2005-01-01'));
		expect(istErziehungsberechtigt(z, gross, JETZT)).toBe(false);
		expect(darfFuerKindHandeln(person('e'), gross, [z])).toBe(true);
	});

	it('kennt bei entferntem Kind nie Erziehungsberechtigte', () => {
		const weg = kind('k', new Date('2015-05-05'), { entferntAm: new Date('2026-01-01') });
		expect(istErziehungsberechtigt(z, weg, JETZT)).toBe(false);
	});

	it('laesst fremde Erwachsene nicht fuer das Kind handeln', () => {
		expect(darfFuerKindHandeln(person('x'), kindJung, [z])).toBe(false);
	});

	it('laesst auch Nicht-Erziehungsberechtigte mit Zuordnung handeln', () => {
		expect(darfFuerKindHandeln(person('e'), kindJung, [zuordnung('e', 'k', false)])).toBe(true);
	});
});

describe('darfEinladen', () => {
	const verwalter = person('v', { rechte: ['MITGLIEDER'] });

	it('laesst Verwalter einen Erwachsenen ohne Rechte einladen', () => {
		expect(darfEinladen(verwalter, person('z'), [], JETZT)).toBe(true);
	});

	it('verlangt fuer Ziele mit Rechten JUGENDLEITER_RECHTE', () => {
		const ziel = person('z', { rechte: ['DOKUMENTE'] });
		expect(darfEinladen(verwalter, ziel, [], JETZT)).toBe(false);
		expect(darfEinladen(person('l', { rechte: [...RECHTE_VORLAGEN.LEITUNG] }), ziel, [], JETZT)).toBe(true);
	});

	it('laesst Erziehungsberechtigte das eigene Kind einladen, fremde nicht', () => {
		const eltern = person('e');
		const eigen = kind('k', new Date('2015-05-05'));
		const fremd = kind('f', new Date('2015-05-05'));
		const zuordnungen = [zuordnung('e', 'k')];
		expect(darfEinladen(eltern, eigen, zuordnungen, JETZT)).toBe(true);
		expect(darfEinladen(eltern, fremd, zuordnungen, JETZT)).toBe(false);
	});

	it('laedt das Kind eines volljaehrigen Kindes nicht ein', () => {
		const gross = kind('k', new Date('2005-01-01'));
		expect(darfEinladen(person('e'), gross, [zuordnung('e', 'k')], JETZT)).toBe(false);
	});

	it('laedt Entfernte nie ein', () => {
		const ziel = person('z', { entferntAm: new Date('2026-01-01') });
		expect(darfEinladen(verwalter, ziel, [], JETZT)).toBe(false);
	});
});

describe('darfRechteAendern', () => {
	const leitung = person('l', { rechte: ['JUGENDLEITER_RECHTE'] });

	it('verlangt JUGENDLEITER_RECHTE', () => {
		const ohne = person('v', { rechte: ['MITGLIEDER'] });
		expect(darfRechteAendern(ohne, person('z'), ['DOKUMENTE'])).toBe(false);
		expect(darfRechteAendern(leitung, person('z'), ['DOKUMENTE'])).toBe(true);
	});

	it('gilt nicht fuer Jungfischer', () => {
		expect(darfRechteAendern(leitung, kind('k', null), ['DOKUMENTE'])).toBe(false);
	});
});

describe('wuerdeLetzteLeitungVerlieren', () => {
	const inhaber = (id: string, entferntAm: Date | null = null) => ({
		id,
		rechte: ['JUGENDLEITER_RECHTE'] as RechtName[],
		entferntAm,
	});

	it('ist wahr, wenn der einzige Inhaber abgibt', () => {
		expect(wuerdeLetzteLeitungVerlieren([inhaber('a')], 'a', ['DOKUMENTE'])).toBe(true);
	});

	it('ist falsch, wenn ein zweiter Inhaber bleibt', () => {
		expect(wuerdeLetzteLeitungVerlieren([inhaber('a'), inhaber('b')], 'a', [])).toBe(false);
	});

	it('ist wahr, wenn der andere Inhaber entfernt ist', () => {
		expect(wuerdeLetzteLeitungVerlieren([inhaber('a'), inhaber('b', new Date('2026-01-01'))], 'a', [])).toBe(true);
	});

	it('ist falsch, wenn das Ziel das Recht behaelt', () => {
		expect(wuerdeLetzteLeitungVerlieren([inhaber('a')], 'a', ['JUGENDLEITER_RECHTE'])).toBe(false);
	});
});
