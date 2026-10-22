import type { AntwortEinheit, AntwortRegel, HelferPositionDaten, ThreadKopf } from '../../threads/typen.js';
import { bowlingUmfeld, JETZT, kopf, MIA } from '../../threads/testhilfe.js';
import { darfAustragen, darfEintragen, hatPlatzFuer, pruefeNotiz } from './helfer.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;

// Frist morgen: vor JETZT liegt nichts, was sie schon beendet haette.
const FRIST = new Date('2026-10-23T10:00:00Z');

function regel(einheit: AntwortEinheit = 'ERWACHSENER', frist: Date | null = FRIST): AntwortRegel {
	return { einheit, frist };
}

function position(belegt: number, anzahl: number): HelferPositionDaten {
	return {
		id: 'p-kuchen',
		schluessel: 'kuchen',
		text: 'Kuchen',
		anzahl,
		eintraege: Array.from({ length: belegt }, (_, i) => ({
			fuerId: `person-${i}`,
			vonId: `person-${i}`,
			notiz: null,
			eingetragenAm: new Date(Date.UTC(2026, 9, 21, 12, i)),
		})),
	};
}

const daten = (k: Partial<ThreadKopf> = {}) => ({ kopf: kopf(k), termine: [] });

describe('hatPlatzFuer', () => {
	it('hat bei 3 von 4 Platz', () => {
		expect(hatPlatzFuer(position(3, 4), 'sandra')).toBe(true);
	});

	it('hat bei 4 von 4 fuer eine Neue keinen Platz', () => {
		expect(hatPlatzFuer(position(4, 4), 'sandra')).toBe(false);
	});

	it('hat bei 4 von 4 fuer eine schon Eingetragene Platz (Notiz aendern)', () => {
		expect(hatPlatzFuer(position(4, 4), 'person-2')).toBe(true);
	});

	it('hat bei Anzahl 1 und leerer Position Platz', () => {
		expect(hatPlatzFuer(position(0, 1), 'sandra')).toBe(true);
	});
});

describe('pruefeNotiz', () => {
	it('schneidet Leerzeichen ab', () => {
		expect(pruefeNotiz('  Marmorkuchen ')).toEqual({ ok: true, notiz: 'Marmorkuchen' });
	});

	it('macht aus Leerem und Fehlendem null', () => {
		expect(pruefeNotiz('')).toEqual({ ok: true, notiz: null });
		expect(pruefeNotiz('   ')).toEqual({ ok: true, notiz: null });
		expect(pruefeNotiz(undefined)).toEqual({ ok: true, notiz: null });
		expect(pruefeNotiz(null)).toEqual({ ok: true, notiz: null });
	});

	it('zaehlt Codepunkte: 81 a sind zu viel, 80 ä nicht', () => {
		expect(pruefeNotiz('a'.repeat(81))).toEqual({ ok: false });
		expect(pruefeNotiz('ä'.repeat(80))).toEqual({ ok: true, notiz: 'ä'.repeat(80) });
	});

	it('lehnt Steuer- und Formatzeichen ab', () => {
		expect(pruefeNotiz('a‮b')).toEqual({ ok: false });
		expect(pruefeNotiz('a\u0007b')).toEqual({ ok: false });
	});

	it('lehnt Nicht-Strings ab', () => {
		expect(pruefeNotiz(42)).toEqual({ ok: false });
	});
});

describe('darfEintragen', () => {
	const eintragen = (
		von: string,
		fuer: string,
		k: Partial<ThreadKopf> = {},
		r: AntwortRegel = regel(),
		jetzt: Date = JETZT,
	) => darfEintragen(person(von), fuer, r, daten(k), umfeld, jetzt);

	it('erlaubt der Mutter, sich selbst einzutragen', () => {
		expect(eintragen('sandra', 'sandra')).toBe('ERLAUBT');
	});

	it('erlaubt der Mutter ihr Kind nur bei pro Jungfischer', () => {
		expect(eintragen('sandra', 'lena')).toBe('NICHT_GEFUNDEN');
		expect(eintragen('sandra', 'lena', {}, regel('JUNGFISCHER'))).toBe('ERLAUBT');
	});

	it('meldet einen Entwurf dem, der ihn sieht; die Familie sieht ihn gar nicht', () => {
		expect(eintragen('petra', 'petra', { veroeffentlichtAm: null })).toBe('ENTWURF');
		expect(eintragen('thomas', 'sandra', { veroeffentlichtAm: null })).toBe('ENTWURF');
		expect(eintragen('sandra', 'sandra', { veroeffentlichtAm: null })).toBe('NICHT_GEFUNDEN');
	});

	it('meldet ab der Fristsekunde das Fristende, die Leitung traegt nach', () => {
		expect(eintragen('sandra', 'sandra', {}, regel(), FRIST)).toBe('FRIST_ABGELAUFEN');
		expect(eintragen('thomas', 'sandra', {}, regel(), FRIST)).toBe('ERLAUBT');
	});

	it('meldet das Archiv, die Leitung traegt nach', () => {
		expect(eintragen('sandra', 'sandra', { archivModus: 'ARCHIVIERT' })).toBe('ARCHIVIERT');
		expect(eintragen('thomas', 'sandra', { archivModus: 'ARCHIVIERT' })).toBe('ERLAUBT');
	});

	it('verraet dem, der den Thread nicht sieht, auch das Archiv nicht', () => {
		const nurKlein: Partial<ThreadKopf> = { alleUntergruppen: false, untergruppenIds: ['klein'] };
		expect(eintragen('peter', 'peter', nurKlein)).toBe('NICHT_GEFUNDEN');
		expect(eintragen('peter', 'peter', { ...nurKlein, archivModus: 'ARCHIVIERT' })).toBe('NICHT_GEFUNDEN');
	});
});

describe('darfAustragen', () => {
	const austragen = (von: string, fuerId: string, k: Partial<ThreadKopf> = {}) =>
		darfAustragen(person(von), { fuerId }, regel(), daten(k), umfeld, JETZT);

	it('erlaubt der Leitung, eine entfernte Person auszutragen', () => {
		expect(austragen('thomas', MIA.id)).toBe('ERLAUBT');
	});

	it('verweigert der Mutter eine entfernte Person', () => {
		expect(austragen('sandra', MIA.id)).toBe('NICHT_GEFUNDEN');
	});

	it('meldet der Leitung einen Entwurf', () => {
		expect(austragen('thomas', 'sandra', { veroeffentlichtAm: null })).toBe('ENTWURF');
	});
});
