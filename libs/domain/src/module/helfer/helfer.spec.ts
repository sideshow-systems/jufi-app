import type { PositionEntwurf } from '../../threads/entwurf.js';
import type {
	AntwortEinheit,
	AntwortRegel,
	HelferDaten,
	HelferPositionDaten,
	ThreadKopf,
} from '../../threads/typen.js';
import { bowlingUmfeld, JETZT, kopf, MIA } from '../../threads/testhilfe.js';
import {
	darfAustragen,
	darfEintragen,
	hatPlatzFuer,
	helferSperre,
	pruefeHelferAenderung,
	pruefeNotiz,
} from './helfer.js';

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
		expect(pruefeNotiz('a\u202eb')).toEqual({ ok: false });
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

// Kuchen mit zwei Eintraegen (Platz fuer vier), Grill leer (Platz fuer zwei).
function mitbringen(daten: Partial<HelferDaten> = {}): HelferDaten {
	const eintrag = (fuerId: string) => ({ fuerId, vonId: fuerId, notiz: null, eingetragenAm: JETZT });
	return {
		modulId: 'h1',
		titel: 'Mitbringen',
		einheit: 'ERWACHSENER',
		frist: null,
		positionen: [
			{
				id: 'p-kuchen',
				schluessel: 'pkuchen01',
				text: 'Kuchen',
				anzahl: 4,
				eintraege: [eintrag('sandra'), eintrag('peter')],
			},
			{ id: 'p-grill', schluessel: 'pgrill001', text: 'Grill', anzahl: 2, eintraege: [] },
		],
		...daten,
	};
}

// Die Positionen der gespeicherten Liste, wie der Editor sie zurueckschickt.
const wieGespeichert = (): PositionEntwurf[] =>
	mitbringen().positionen.map((p) => ({ schluessel: p.schluessel, text: p.text, anzahl: p.anzahl }));

describe('helferSperre', () => {
	it('nennt Eingetragenes und die Belegung nur belegter Positionen', () => {
		expect(helferSperre(mitbringen())).toEqual({ eingetragen: true, belegt: { pkuchen01: 2 } });
	});

	it('ist ohne Eintraege frei', () => {
		const leer = mitbringen({ positionen: mitbringen().positionen.map((p) => ({ ...p, eintraege: [] })) });
		expect(helferSperre(leer)).toEqual({ eingetragen: false, belegt: {} });
	});
});

describe('pruefeHelferAenderung', () => {
	const neu = (positionen: PositionEntwurf[] = wieGespeichert(), einheit: AntwortEinheit = 'ERWACHSENER') => ({
		einheit,
		positionen,
	});

	it('laesst eine unveraenderte Liste durch', () => {
		expect(pruefeHelferAenderung(mitbringen(), neu())).toEqual([]);
	});

	it('erlaubt das Entfernen einer leeren Position', () => {
		expect(pruefeHelferAenderung(mitbringen(), neu(wieGespeichert().slice(0, 1)))).toEqual([]);
	});

	it('sperrt das Entfernen einer belegten Position', () => {
		expect(pruefeHelferAenderung(mitbringen(), neu(wieGespeichert().slice(1)))).toEqual([
			{ feld: 'positionen', schluessel: 'pkuchen01', art: 'ENTFERNT', belegt: 2 },
		]);
	});

	it('sperrt eine Anzahl unter den Eingetragenen, nicht aber gleich viele', () => {
		const auf = (anzahl: number) => wieGespeichert().map((p) => (p.schluessel === 'pkuchen01' ? { ...p, anzahl } : p));
		expect(pruefeHelferAenderung(mitbringen(), neu(auf(1)))).toEqual([
			{ feld: 'positionen', schluessel: 'pkuchen01', art: 'ANZAHL', belegt: 2 },
		]);
		expect(pruefeHelferAenderung(mitbringen(), neu(auf(2)))).toEqual([]);
	});

	it('erlaubt Umbenennen und Umsortieren', () => {
		const [kuchen, grill] = wieGespeichert();
		expect(pruefeHelferAenderung(mitbringen(), neu([grill, { ...kuchen, text: 'Torte' }]))).toEqual([]);
	});

	it('sperrt die Einheit erst nach dem ersten Eintrag', () => {
		expect(pruefeHelferAenderung(mitbringen(), neu(wieGespeichert(), 'PERSON'))).toEqual([{ feld: 'einheit' }]);
		const leer = mitbringen({ positionen: mitbringen().positionen.map((p) => ({ ...p, eintraege: [] })) });
		expect(pruefeHelferAenderung(leer, neu(wieGespeichert(), 'PERSON'))).toEqual([]);
	});

	it('zaehlt eine neue Position ohne Schluessel nicht als die alte', () => {
		const [kuchen, grill] = wieGespeichert();
		expect(pruefeHelferAenderung(mitbringen(), neu([{ ...kuchen, schluessel: null }, grill]))).toEqual([
			{ feld: 'positionen', schluessel: 'pkuchen01', art: 'ENTFERNT', belegt: 2 },
		]);
	});
});
