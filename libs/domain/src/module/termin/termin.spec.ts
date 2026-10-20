import {
	beginnZeitpunkt,
	endeZeitpunkt,
	geraetAus,
	istMehrtaegig,
	kartenLink,
	letzterTag,
	naechsteTermine,
	terminFehler,
	terminZeit,
	termineImMonat,
	type TerminDaten,
	type TerminEintrag,
} from './termin.js';

function termin(aenderung: Partial<TerminDaten> = {}): TerminDaten {
	return {
		modulId: 'm1',
		startDatum: '2026-10-17',
		endDatum: null,
		beginn: null,
		ende: null,
		ort: null,
		treffpunkt: null,
		...aenderung,
	};
}

function eintrag(threadId: string, aenderung: Partial<TerminDaten> = {}): TerminEintrag {
	return { threadId, titel: `Thread ${threadId}`, termin: termin({ modulId: `m-${threadId}`, ...aenderung }) };
}

describe('letzterTag und istMehrtaegig', () => {
	it('nimmt ohne Enddatum den Starttag', () => {
		expect(letzterTag(termin())).toBe('2026-10-17');
		expect(istMehrtaegig(termin())).toBe(false);
	});

	it('zaehlt ein Enddatum gleich dem Startdatum als eintaegig', () => {
		const t = termin({ endDatum: '2026-10-17' });
		expect(letzterTag(t)).toBe('2026-10-17');
		expect(istMehrtaegig(t)).toBe(false);
	});

	it('nimmt bei mehreren Tagen das Enddatum', () => {
		const t = termin({ startDatum: '2026-10-23', endDatum: '2026-10-25' });
		expect(letzterTag(t)).toBe('2026-10-25');
		expect(istMehrtaegig(t)).toBe(true);
	});
});

describe('terminZeit', () => {
	it('zeigt nur das Datum als ganztaegig', () => {
		expect(terminZeit(termin())).toBe('Sa 17.10. · ganztägig');
	});

	it('zeigt Beginn und Ende', () => {
		expect(terminZeit(termin({ beginn: '14:00', ende: '17:00' }))).toBe('Sa 17.10. · 14:00–17:00');
	});

	it('zeigt nur den Beginn', () => {
		expect(terminZeit(termin({ beginn: '14:00' }))).toBe('Sa 17.10. · 14:00');
	});

	it('zeigt nur das Ende mit "bis"', () => {
		expect(terminZeit(termin({ ende: '12:00' }))).toBe('Sa 17.10. · bis 12:00');
	});

	it('zeigt Mehrtaegiges ohne Zeiten', () => {
		expect(terminZeit(termin({ startDatum: '2026-10-23', endDatum: '2026-10-25' }))).toBe('Fr 23.10. – So 25.10.');
	});

	it('zeigt Mehrtaegiges mit beiden Zeiten', () => {
		expect(
			terminZeit(termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', beginn: '17:00', ende: '12:00' })),
		).toBe('Fr 23.10. 17:00 – So 25.10. 12:00');
	});

	it('laesst bei Mehrtaegigem die fehlende Zeit weg', () => {
		expect(terminZeit(termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', ende: '12:00' }))).toBe(
			'Fr 23.10. – So 25.10. 12:00',
		);
		expect(terminZeit(termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', beginn: '17:00' }))).toBe(
			'Fr 23.10. 17:00 – So 25.10.',
		);
	});

	it('zeigt ein Enddatum gleich dem Startdatum wie einen eintaegigen Termin', () => {
		expect(terminZeit(termin({ endDatum: '2026-10-17', beginn: '14:00' }))).toBe('Sa 17.10. · 14:00');
	});
});

describe('terminFehler', () => {
	it('lehnt ein Enddatum vor dem Startdatum ab', () => {
		expect(terminFehler(termin({ endDatum: '2026-10-16' }))).toBe('Das Enddatum liegt vor dem Startdatum.');
	});

	it('lehnt am selben Tag ein Ende vor dem Beginn ab', () => {
		expect(terminFehler(termin({ beginn: '17:00', ende: '14:00' }))).toBe('Das Ende liegt vor dem Beginn.');
		expect(terminFehler(termin({ endDatum: '2026-10-17', beginn: '17:00', ende: '14:00' }))).toBe(
			'Das Ende liegt vor dem Beginn.',
		);
	});

	it('lehnt am selben Tag auch ein Ende gleich dem Beginn ab', () => {
		expect(terminFehler(termin({ beginn: '14:00', ende: '14:00' }))).toBe('Das Ende liegt vor dem Beginn.');
	});

	it('erlaubt mehrtaegig ein Ende vor dem Beginn der Uhrzeit nach', () => {
		expect(
			terminFehler(termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', beginn: '17:00', ende: '12:00' })),
		).toBeNull();
	});

	it('lehnt eine ungueltige Uhrzeit ab', () => {
		expect(terminFehler(termin({ beginn: '25:00' }))).toBe('Uhrzeit bitte als HH:MM.');
		expect(terminFehler(termin({ ende: '12:60' }))).toBe('Uhrzeit bitte als HH:MM.');
		expect(terminFehler(termin({ beginn: '9:00' }))).toBe('Uhrzeit bitte als HH:MM.');
	});

	it('erlaubt ein Ende ohne Beginn und einen Beginn ohne Ende', () => {
		expect(terminFehler(termin({ ende: '12:00' }))).toBeNull();
		expect(terminFehler(termin({ beginn: '14:00' }))).toBeNull();
		expect(terminFehler(termin())).toBeNull();
	});
});

describe('beginnZeitpunkt und endeZeitpunkt', () => {
	it('rechnet Beginn und Ende in Berliner Zeitpunkte', () => {
		const t = termin({ startDatum: '2026-10-24', beginn: '14:00', ende: '17:00' });
		expect(beginnZeitpunkt(t).toISOString()).toBe('2026-10-24T12:00:00.000Z');
		expect(endeZeitpunkt(t).toISOString()).toBe('2026-10-24T15:00:00.000Z');
	});

	it('nimmt ohne Beginn Mitternacht des Starttags', () => {
		expect(beginnZeitpunkt(termin({ startDatum: '2026-10-24' })).toISOString()).toBe('2026-10-23T22:00:00.000Z');
	});

	it('endet ein ganztaegiger Termin um Mitternacht nach dem letzten Tag, hier mit Umstellung', () => {
		expect(endeZeitpunkt(termin({ startDatum: '2026-10-25' })).toISOString()).toBe('2026-10-25T23:00:00.000Z');
	});

	it('endet Mehrtaegiges ohne Zeiten um Mitternacht nach dem letzten Tag', () => {
		const t = termin({ startDatum: '2026-10-23', endDatum: '2026-10-25' });
		expect(endeZeitpunkt(t).toISOString()).toBe('2026-10-25T23:00:00.000Z');
	});

	it('endet ein eintaegiger Termin mit Beginn ohne Ende wie ohne Ende', () => {
		const t = termin({ startDatum: '2026-10-24', beginn: '14:00' });
		expect(endeZeitpunkt(t).toISOString()).toBe('2026-10-24T22:00:00.000Z');
	});

	it('nimmt bei Mehrtaegigem die Endezeit des letzten Tags', () => {
		const t = termin({ startDatum: '2026-10-23', endDatum: '2026-10-25', beginn: '17:00', ende: '12:00' });
		expect(endeZeitpunkt(t).toISOString()).toBe('2026-10-25T11:00:00.000Z');
	});

	it('erlaubt ein Ende ohne Beginn', () => {
		expect(endeZeitpunkt(termin({ startDatum: '2026-10-24', ende: '12:00' })).toISOString()).toBe(
			'2026-10-24T10:00:00.000Z',
		);
	});
});

describe('naechsteTermine', () => {
	const jetzt = new Date('2026-10-24T10:00:00Z');

	it('behaelt ein laufendes mehrtaegiges Zeltlager', () => {
		const lager = eintrag('lager', { startDatum: '2026-10-23', endDatum: '2026-10-25' });
		expect(naechsteTermine([lager], jetzt, 5)).toEqual([lager]);
	});

	it('laesst einen Termin von gestern weg', () => {
		const gestern = eintrag('gestern', { startDatum: '2026-10-23', beginn: '14:00', ende: '17:00' });
		expect(naechsteTermine([gestern], jetzt, 5)).toEqual([]);
	});

	it('laesst einen Termin ab dem Zeitpunkt seines Endes weg', () => {
		const e = eintrag('a', { startDatum: '2026-10-24', beginn: '10:00', ende: '12:00' });
		expect(naechsteTermine([e], new Date('2026-10-24T09:59:59Z'), 5)).toEqual([e]);
		expect(naechsteTermine([e], new Date('2026-10-24T10:00:00Z'), 5)).toEqual([]);
	});

	it('stellt am selben Tag ganztaegig vor 14:00', () => {
		const spaet = eintrag('a', { startDatum: '2026-10-24', beginn: '14:00' });
		const ganz = eintrag('b', { startDatum: '2026-10-24' });
		expect(naechsteTermine([spaet, ganz], jetzt, 5).map((e) => e.threadId)).toEqual(['b', 'a']);
	});

	it('sortiert nach Startdatum, dann Beginn, dann threadId', () => {
		const e = [
			eintrag('z', { startDatum: '2026-10-26' }),
			eintrag('b', { startDatum: '2026-10-25', beginn: '09:00' }),
			eintrag('a', { startDatum: '2026-10-25', beginn: '09:00' }),
			eintrag('c', { startDatum: '2026-10-25', beginn: '08:00' }),
		];
		expect(naechsteTermine(e, jetzt, 10).map((x) => x.threadId)).toEqual(['c', 'a', 'b', 'z']);
	});

	it('begrenzt auf anzahl und aendert die Eingabe nicht', () => {
		const e = [
			eintrag('d', { startDatum: '2026-10-28' }),
			eintrag('c', { startDatum: '2026-10-27' }),
			eintrag('b', { startDatum: '2026-10-26' }),
			eintrag('a', { startDatum: '2026-10-25' }),
		];
		const kopie = [...e];
		expect(naechsteTermine(e, jetzt, 3).map((x) => x.threadId)).toEqual(['a', 'b', 'c']);
		expect(e).toEqual(kopie);
	});
});

describe('termineImMonat', () => {
	const e = [
		eintrag('vor', { startDatum: '2026-09-30', endDatum: '2026-10-02' }),
		eintrag('mitte', { startDatum: '2026-10-15' }),
		eintrag('ende', { startDatum: '2026-10-31' }),
		eintrag('danach', { startDatum: '2026-11-01' }),
		eintrag('davor', { startDatum: '2026-09-30' }),
		eintrag('ueber', { startDatum: '2026-10-30', endDatum: '2026-11-02' }),
	];

	it('nimmt Termine, die den Monat beruehren, auch ueber die Monatsgrenze', () => {
		expect(termineImMonat(e, 2026, 10).map((x) => x.threadId)).toEqual(['vor', 'mitte', 'ueber', 'ende']);
	});

	it('zaehlt den Monat von 1 bis 12', () => {
		expect(termineImMonat(e, 2026, 11).map((x) => x.threadId)).toEqual(['ueber', 'danach']);
		expect(termineImMonat(e, 2026, 9).map((x) => x.threadId)).toEqual(['davor', 'vor']);
	});
});

describe('geraetAus und kartenLink', () => {
	it('erkennt das Geraet am User-Agent', () => {
		expect(geraetAus('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('IOS');
		expect(geraetAus('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('IOS');
		expect(geraetAus('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)')).toBe('IOS');
		expect(geraetAus('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile')).toBe('ANDROID');
		expect(geraetAus('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(
			'ANDERE',
		);
		expect(geraetAus('')).toBe('ANDERE');
	});

	it('baut den Kartenlink je Geraet', () => {
		expect(kartenLink('Bowlingcenter Am See 1', 'ANDERE')).toBe(
			'https://www.google.com/maps/search/?api=1&query=Bowlingcenter%20Am%20See%201',
		);
		expect(kartenLink('Bowlingcenter Am See 1', 'IOS')).toBe('maps://?q=Bowlingcenter%20Am%20See%201');
		expect(kartenLink('Bowlingcenter Am See 1', 'ANDROID')).toBe('geo:0,0?q=Bowlingcenter%20Am%20See%201');
	});

	it('kodiert Sonderzeichen im Ort', () => {
		expect(kartenLink('Café & Bar, Hauptstr. 5', 'ANDERE')).toBe(
			'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar%2C%20Hauptstr.%205',
		);
	});
});
