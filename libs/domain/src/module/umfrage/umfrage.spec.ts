import type { AntwortDaten, UmfrageDaten } from '../../threads/typen.js';
import {
	einheitenFuer,
	fristText,
	fristZeitpunkt,
	neueUmfrageVorlage,
	pruefeUmfrageAenderung,
	TEILNAHME_OPTIONEN,
	teilnahmeOptionen,
} from './umfrage.js';

function umfrage(daten: Partial<UmfrageDaten> = {}): UmfrageDaten {
	return {
		modulId: 'm1',
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: true,
		frist: null,
		ergebnisse: 'ALLE',
		optionen: [
			{ id: 'o-dabei', schluessel: 'dabei', text: 'Dabei' },
			{ id: 'o-vielleicht', schluessel: 'vielleicht', text: 'Vielleicht' },
			{ id: 'o-abgesagt', schluessel: 'abgesagt', text: 'Abgesagt' },
		],
		antworten: [],
		...daten,
	};
}

function antwort(fuerId: string, ...optionIds: string[]): AntwortDaten {
	return { fuerId, vonId: fuerId, optionIds, abgegebenAm: new Date('2026-10-21T12:00:00Z') };
}

const alleOptionen = [{ schluessel: 'dabei' }, { schluessel: 'vielleicht' }, { schluessel: 'abgesagt' }];
const gleich = { einheit: 'JUNGFISCHER' as const, mehrfach: false, teilnahme: true, optionen: alleOptionen };

describe('Teilnahme-Optionen', () => {
	it('kennt Dabei, Vielleicht, Abgesagt', () => {
		expect(TEILNAHME_OPTIONEN).toEqual([
			{ schluessel: 'dabei', text: 'Dabei' },
			{ schluessel: 'vielleicht', text: 'Vielleicht' },
			{ schluessel: 'abgesagt', text: 'Abgesagt' },
		]);
	});

	it('laesst Vielleicht weg, wenn es abgeschaltet ist', () => {
		expect(teilnahmeOptionen(true)).toEqual(TEILNAHME_OPTIONEN);
		expect(teilnahmeOptionen(false)).toEqual([
			{ schluessel: 'dabei', text: 'Dabei' },
			{ schluessel: 'abgesagt', text: 'Abgesagt' },
		]);
	});
});

describe('neueUmfrageVorlage', () => {
	it('startet als Teilnahme-Umfrage "Kommst du mit?"', () => {
		expect(neueUmfrageVorlage()).toEqual({
			frage: 'Kommst du mit?',
			einheit: 'JUNGFISCHER',
			mehrfach: false,
			teilnahme: true,
			vielleicht: true,
			frist: null,
			ergebnisse: 'ALLE',
			optionen: [
				{ schluessel: 'dabei', text: 'Dabei' },
				{ schluessel: 'vielleicht', text: 'Vielleicht' },
				{ schluessel: 'abgesagt', text: 'Abgesagt' },
			],
		});
	});

	it('gibt jedes Mal frische Objekte, damit der Editor sie aendern darf', () => {
		const a = neueUmfrageVorlage();
		a.optionen[0].text = 'Ja';
		expect(neueUmfrageVorlage().optionen[0].text).toBe('Dabei');
		expect(TEILNAHME_OPTIONEN[0].text).toBe('Dabei');
	});
});

describe('einheitenFuer', () => {
	it('bietet bei Familie und Austausch alle drei Einheiten', () => {
		const alle = ['JUNGFISCHER', 'ERWACHSENER', 'PERSON'];
		expect(einheitenFuer('JUNGFISCHER_FAMILIE')).toEqual(alle);
		expect(einheitenFuer('JUGENDLEITER_JUGENDSPRECHER')).toEqual(alle);
	});

	it('bietet bei Nur Familie und Nur Jugendleiter keine Jungfischer', () => {
		expect(einheitenFuer('NUR_FAMILIE')).toEqual(['ERWACHSENER', 'PERSON']);
		expect(einheitenFuer('NUR_JUGENDLEITER')).toEqual(['ERWACHSENER', 'PERSON']);
	});
});

describe('pruefeUmfrageAenderung', () => {
	it('erlaubt ohne Antworten alles', () => {
		const neu = { einheit: 'PERSON' as const, mehrfach: true, teilnahme: false, optionen: [] };
		expect(pruefeUmfrageAenderung(umfrage(), neu)).toEqual([]);
	});

	it('erlaubt unveraenderte Umfragen mit Antworten', () => {
		expect(pruefeUmfrageAenderung(umfrage({ antworten: [antwort('lena', 'o-dabei')] }), gleich)).toEqual([]);
	});

	it('ignoriert Antworten ohne Option: sie gelten als nicht beantwortet', () => {
		const alt = umfrage({ antworten: [antwort('lena')] });
		expect(pruefeUmfrageAenderung(alt, { ...gleich, einheit: 'PERSON', teilnahme: false })).toEqual([]);
	});

	it('verweigert das Entfernen einer beantworteten Option', () => {
		const alt = umfrage({ antworten: [antwort('lena', 'o-vielleicht')] });
		const neu = { ...gleich, optionen: [{ schluessel: 'dabei' }, { schluessel: 'abgesagt' }] };
		expect(pruefeUmfrageAenderung(alt, neu)).toEqual([{ feld: 'optionen', schluessel: 'vielleicht' }]);
	});

	it('erlaubt das Entfernen einer unbeantworteten Option', () => {
		const alt = umfrage({ antworten: [antwort('lena', 'o-dabei')] });
		const neu = { ...gleich, optionen: [{ schluessel: 'dabei' }, { schluessel: 'abgesagt' }] };
		expect(pruefeUmfrageAenderung(alt, neu)).toEqual([]);
	});

	it('verweigert das Aendern der Einheit und des Teilnahme-Schalters', () => {
		const alt = umfrage({ antworten: [antwort('lena', 'o-dabei')] });
		expect(pruefeUmfrageAenderung(alt, { ...gleich, einheit: 'PERSON' })).toEqual([{ feld: 'einheit' }]);
		expect(pruefeUmfrageAenderung(alt, { ...gleich, teilnahme: false })).toEqual([{ feld: 'teilnahme' }]);
	});

	it('verweigert mehrfach aus nur, wenn eine Antwort mehrere Optionen hat', () => {
		const mehrere = umfrage({ mehrfach: true, antworten: [antwort('lena', 'o-dabei', 'o-vielleicht')] });
		expect(pruefeUmfrageAenderung(mehrere, { ...gleich, mehrfach: false })).toEqual([{ feld: 'mehrfach' }]);
		const einzeln = umfrage({
			mehrfach: true,
			antworten: [antwort('lena', 'o-dabei'), antwort('max', 'o-abgesagt')],
		});
		expect(pruefeUmfrageAenderung(einzeln, { ...gleich, mehrfach: false })).toEqual([]);
	});

	it('meldet mehrere Konflikte zugleich in der Reihenfolge optionen, einheit, teilnahme, mehrfach', () => {
		const alt = umfrage({ mehrfach: true, antworten: [antwort('lena', 'o-dabei', 'o-abgesagt')] });
		const neu = { einheit: 'PERSON' as const, mehrfach: false, teilnahme: false, optionen: [{ schluessel: 'dabei' }] };
		expect(pruefeUmfrageAenderung(alt, neu)).toEqual([
			{ feld: 'optionen', schluessel: 'abgesagt' },
			{ feld: 'einheit' },
			{ feld: 'teilnahme' },
			{ feld: 'mehrfach' },
		]);
	});
});

describe('fristText', () => {
	// Mo 19.10.2026 10:00 Berlin
	const jetzt = new Date('2026-10-19T08:00:00Z');

	it('nennt innerhalb der naechsten sechs Berliner Tage nur den Wochentag', () => {
		expect(fristText(new Date('2026-10-22T16:00:00Z'), jetzt)).toBe('bis Do 18:00');
	});

	it('zaehlt Berliner Kalendertage, nicht 24-Stunden-Spannen: So 23:59 ist der sechste Tag', () => {
		expect(fristText(new Date('2026-10-25T22:59:00Z'), jetzt)).toBe('bis So 23:59');
	});

	it('nennt danach das Datum, auch nach der Zeitumstellung mit Winterzeit', () => {
		expect(fristText(new Date('2026-10-29T17:00:00Z'), jetzt)).toBe('bis Do 29.10. 18:00');
	});

	it('nennt am siebten Tag das Datum', () => {
		expect(fristText(new Date('2026-10-25T23:00:00Z'), jetzt)).toBe('bis Mo 26.10. 00:00');
	});

	it('meldet die Frist ab der Fristsekunde als abgelaufen', () => {
		const frist = new Date('2026-10-19T08:00:00Z');
		expect(fristText(frist, frist)).toBe('Frist abgelaufen');
		expect(fristText(frist, new Date('2026-10-19T08:00:01Z'))).toBe('Frist abgelaufen');
		expect(fristText(frist, new Date('2026-10-19T07:59:59Z'))).toBe('bis Mo 10:00');
	});
});

describe('fristZeitpunkt', () => {
	it('nennt Wochentag, Datum und Berliner Uhrzeit', () => {
		expect(fristZeitpunkt(new Date('2026-10-22T16:00:00Z'))).toBe('Do 22.10. 18:00');
	});
});
