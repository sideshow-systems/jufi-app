import type {
	AutoDaten,
	FahrtDaten,
	MitfahrtDaten,
	Richtung,
	ThreadKopf,
	ThreadPerson,
	UmfrageDaten,
} from '../../threads/typen.js';
import { bowlingUmfeld, JETZT, kopf } from '../../threads/testhilfe.js';
import {
	betrachteteKinder,
	brauchtMitfahrt,
	darfAnbieten,
	darfAutoAendern,
	darfEinsetzen,
	darfHerausnehmen,
	hatPlatzIn,
	pruefeAuto,
	type FahrtKontext,
} from './fahrt.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;

// Teilnahme-Umfrage des Bowling-Threads: Lena dabei, Max vielleicht, alle anderen ohne Antwort.
function teilnahme(): UmfrageDaten {
	const antwort = (fuerId: string, optionId: string) => ({
		fuerId,
		vonId: 'sandra',
		optionIds: [optionId],
		abgegebenAm: new Date('2026-10-21T12:00:00Z'),
	});
	return {
		modulId: 'm-bowling',
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
		antworten: [antwort('lena', 'o-dabei'), antwort('max', 'o-vielleicht')],
	};
}

function auto(id: string, fahrerId: string, daten: Partial<AutoDaten> = {}): AutoDaten {
	return {
		id,
		fahrerId,
		richtung: 'HIN',
		plaetze: 3,
		abfahrtTag: null,
		abfahrtZeit: null,
		ort: null,
		notiz: null,
		angelegtAm: new Date('2026-10-21T12:00:00Z'),
		...daten,
	};
}

function mitfahrt(kindId: string, autoId: string | null, richtung: Richtung = 'HIN'): MitfahrtDaten {
	return { richtung, kindId, autoId, vonId: 'sandra', eingetragenAm: new Date('2026-10-21T13:00:00Z') };
}

function fahrt(autos: AutoDaten[], mitfahrten: MitfahrtDaten[]): FahrtDaten {
	return { modulId: 'm-fahrt', titel: null, hin: true, rueck: true, autos, mitfahrten };
}

function kontext(k: Partial<ThreadKopf> = {}, umfragen: UmfrageDaten[] = [teilnahme()]): FahrtKontext {
	return { kopf: kopf(k), termine: [], umfragen };
}

describe('betrachteteKinder', () => {
	it('liefert ohne Teilnahme-Umfrage alle Kinder des Threads', () => {
		const ids = betrachteteKinder(kopf(), { umfragen: [] }, umfeld).map((k) => k.id);
		expect(ids).toEqual(['jonas', 'lena', 'max', 'paul', 'tim']);
	});

	it('liefert mit Teilnahme nur, wer dabei ist: ein Vielleicht und keine Antwort reservieren keinen Platz', () => {
		const ids = betrachteteKinder(kopf(), { umfragen: [teilnahme()] }, umfeld).map((k) => k.id);
		expect(ids).toEqual(['lena']);
	});

	it('ist bei Nur Jugendleiter leer', () => {
		expect(betrachteteKinder(kopf({ rollenfilter: 'NUR_JUGENDLEITER' }), { umfragen: [] }, umfeld)).toEqual([]);
	});
});

describe('brauchtMitfahrt', () => {
	const kinder = ['lena', 'max', 'tim'].map(person);
	const f = fahrt([auto('a1', 'sandra')], [mitfahrt('lena', 'a1'), mitfahrt('max', null)]);
	const ids = (l: ThreadPerson[]) => l.map((k) => k.id);

	it('nennt, wer in dieser Richtung weder im Auto sitzt noch selbst kommt', () => {
		expect(ids(brauchtMitfahrt(f, 'HIN', kinder))).toEqual(['tim']);
	});

	it('rechnet jede Richtung fuer sich, nach Kurzname sortiert', () => {
		expect(ids(brauchtMitfahrt(f, 'RUECK', [person('tim'), person('max'), person('lena')]))).toEqual([
			'lena',
			'max',
			'tim',
		]);
	});

	it('ist leer, wenn alle versorgt sind', () => {
		const alle = fahrt(
			[auto('a1', 'sandra')],
			kinder.map((k) => mitfahrt(k.id, 'a1')),
		);
		expect(brauchtMitfahrt(alle, 'HIN', kinder)).toEqual([]);
	});
});

describe('hatPlatzIn', () => {
	const a = auto('a1', 'sandra', { plaetze: 3 });
	const mit = (...kinder: string[]) =>
		fahrt(
			[a],
			kinder.map((k) => mitfahrt(k, 'a1')),
		);

	it('hat bei 2 von 3 Platz', () => {
		expect(hatPlatzIn(a, mit('lena', 'max'), 'tim')).toBe(true);
	});

	it('hat bei 3 von 3 fuer ein neues Kind keinen Platz', () => {
		expect(hatPlatzIn(a, mit('lena', 'max', 'jonas'), 'tim')).toBe(false);
	});

	it('hat bei 3 von 3 fuer ein Kind, das schon darin sitzt, Platz', () => {
		expect(hatPlatzIn(a, mit('lena', 'max', 'jonas'), 'max')).toBe(true);
	});

	it('zaehlt "kommt selbst" und fremde Autos nicht', () => {
		const f = fahrt(
			[a, auto('a2', 'hans')],
			[mitfahrt('lena', 'a1'), mitfahrt('max', null), mitfahrt('jonas', null), mitfahrt('paul', 'a2')],
		);
		expect(hatPlatzIn(a, f, 'tim')).toBe(true);
	});
});

describe('pruefeAuto', () => {
	const gueltig = { plaetze: 3, abfahrtTag: '2026-10-23', abfahrtZeit: '15:30', ort: ' Vereinsheim ', notiz: '' };

	it('uebernimmt gueltige Werte, schneidet Leerzeichen ab und macht Leeres zu null', () => {
		expect(pruefeAuto(gueltig)).toEqual({
			ok: true,
			auto: { plaetze: 3, abfahrtTag: '2026-10-23', abfahrtZeit: '15:30', ort: 'Vereinsheim', notiz: null },
		});
	});

	it('nimmt fehlende Felder als null, nur plaetze ist Pflicht', () => {
		expect(pruefeAuto({ plaetze: 1 })).toEqual({
			ok: true,
			auto: { plaetze: 1, abfahrtTag: null, abfahrtZeit: null, ort: null, notiz: null },
		});
		expect(pruefeAuto({})).toEqual({ ok: false, feld: 'plaetze' });
	});

	it.each([0, 9, 2.5, '3', null, NaN])('lehnt plaetze %j ab', (plaetze) => {
		expect(pruefeAuto({ ...gueltig, plaetze })).toEqual({ ok: false, feld: 'plaetze' });
	});

	it('nimmt 1 und 8 an', () => {
		expect(pruefeAuto({ ...gueltig, plaetze: 1 }).ok).toBe(true);
		expect(pruefeAuto({ ...gueltig, plaetze: 8 }).ok).toBe(true);
	});

	it('lehnt Eingaben ab, die kein Objekt sind', () => {
		expect(pruefeAuto(null)).toEqual({ ok: false, feld: 'plaetze' });
		expect(pruefeAuto('x')).toEqual({ ok: false, feld: 'plaetze' });
	});

	it('lehnt einen Tag ab, den es nicht gibt, oder einen Nicht-String', () => {
		expect(pruefeAuto({ ...gueltig, abfahrtTag: '2026-02-30' })).toEqual({ ok: false, feld: 'abfahrtTag' });
		expect(pruefeAuto({ ...gueltig, abfahrtTag: 20261023 })).toEqual({ ok: false, feld: 'abfahrtTag' });
	});

	it('lehnt eine Uhrzeit ausserhalb von HH:MM ab', () => {
		expect(pruefeAuto({ ...gueltig, abfahrtZeit: '24:00' })).toEqual({ ok: false, feld: 'abfahrtZeit' });
		expect(pruefeAuto({ ...gueltig, abfahrtZeit: '9:30' })).toEqual({ ok: false, feld: 'abfahrtZeit' });
	});

	it('zaehlt Codepunkte: 201 a sind zu viel, 200 ä nicht', () => {
		expect(pruefeAuto({ ...gueltig, ort: 'a'.repeat(201) })).toEqual({ ok: false, feld: 'ort' });
		expect(pruefeAuto({ ...gueltig, notiz: 'a'.repeat(201) })).toEqual({ ok: false, feld: 'notiz' });
		const r = pruefeAuto({ ...gueltig, ort: 'ä'.repeat(200) });
		expect(r).toMatchObject({ ok: true, auto: { ort: 'ä'.repeat(200) } });
	});

	it('lehnt Steuer- und Formatzeichen in Ort und Notiz ab', () => {
		expect(pruefeAuto({ ...gueltig, notiz: 'a‮b' })).toEqual({ ok: false, feld: 'notiz' });
		expect(pruefeAuto({ ...gueltig, ort: 'a\u0007b' })).toEqual({ ok: false, feld: 'ort' });
	});
});

describe('darfAnbieten', () => {
	const anbieten = (von: string, k: Partial<ThreadKopf> = {}, jetzt = JETZT) =>
		darfAnbieten(person(von), kontext(k), umfeld, jetzt);
	const archiviert = { archivModus: 'ARCHIVIERT' } as const;

	it('erlaubt der Mutter', () => {
		expect(anbieten('sandra')).toBe('ERLAUBT');
	});

	it('verweigert dem Jungfischer: Autos bietet nur ein Erwachsener an', () => {
		expect(anbieten('lena')).toBe('NICHT_GEFUNDEN');
	});

	it('meldet einen Entwurf nur dem, der ihn sieht', () => {
		expect(anbieten('thomas', { veroeffentlichtAm: null })).toBe('ENTWURF');
		expect(anbieten('sandra', { veroeffentlichtAm: null })).toBe('NICHT_GEFUNDEN');
	});

	it('meldet das Archiv, die Leitung bietet auch dort an', () => {
		expect(anbieten('sandra', archiviert)).toBe('ARCHIVIERT');
		expect(anbieten('thomas', archiviert)).toBe('ERLAUBT');
	});

	it('verraet wem, der den Thread nicht sieht, nichts, auch nicht im Archiv', () => {
		expect(anbieten('peter', { rollenfilter: 'NUR_JUGENDLEITER' })).toBe('NICHT_GEFUNDEN');
		expect(anbieten('peter', { rollenfilter: 'NUR_JUGENDLEITER', ...archiviert })).toBe('NICHT_GEFUNDEN');
	});
});

describe('darfAutoAendern', () => {
	const sandras = { fahrerId: 'sandra' };
	const aendern = (von: string, k: Partial<ThreadKopf> = {}) =>
		darfAutoAendern(person(von), sandras, kontext(k), umfeld, JETZT);

	it('erlaubt der Fahrerin und der Leitung', () => {
		expect(aendern('sandra')).toBe('ERLAUBT');
		expect(aendern('thomas')).toBe('ERLAUBT');
	});

	it('verweigert einer anderen Mutter', () => {
		expect(aendern('peter')).toBe('NICHT_GEFUNDEN');
	});

	it('meldet der Fahrerin das Archiv', () => {
		expect(aendern('sandra', { archivModus: 'ARCHIVIERT' })).toBe('ARCHIVIERT');
	});
});

describe('darfEinsetzen', () => {
	const einsetzen = (von: string, kindId: string, k: Partial<ThreadKopf> = {}) =>
		darfEinsetzen(person(von), kindId, kontext(k), umfeld, JETZT);

	it('erlaubt der Mutter ihr Kind, das dabei ist', () => {
		expect(einsetzen('sandra', 'lena')).toBe('ERLAUBT');
	});

	it('meldet fuer ein Kind ohne Zusage NICHT_DABEI, denn ein Vielleicht reserviert keinen Platz', () => {
		expect(einsetzen('sandra', 'max')).toBe('NICHT_DABEI');
	});

	it('verweigert der Mutter ein fremdes Kind, auch ohne etwas ueber dessen Zusage zu verraten', () => {
		expect(einsetzen('sandra', 'tim')).toBe('NICHT_GEFUNDEN');
		expect(einsetzen('sandra', 'jonas')).toBe('NICHT_GEFUNDEN');
	});

	it('erlaubt dem Jungfischer sich selbst, nicht einem anderen', () => {
		expect(einsetzen('lena', 'lena')).toBe('ERLAUBT');
		expect(einsetzen('lena', 'max')).toBe('NICHT_GEFUNDEN');
	});

	it('erlaubt der Leitung jedes betrachtete Kind, aber kein Kind ohne Zusage', () => {
		expect(einsetzen('thomas', 'lena')).toBe('ERLAUBT');
		expect(einsetzen('thomas', 'max')).toBe('NICHT_DABEI');
	});

	it('verweigert eine erwachsene Person und ein Kind ausserhalb des Threads als Kind', () => {
		expect(einsetzen('thomas', 'sandra')).toBe('NICHT_GEFUNDEN');
		expect(einsetzen('thomas', 'mia')).toBe('NICHT_GEFUNDEN');
	});

	it('meldet vor dem eigenen Recht Entwurf und Archiv, wie die anderen Regeln', () => {
		expect(einsetzen('thomas', 'lena', { veroeffentlichtAm: null })).toBe('ENTWURF');
		expect(einsetzen('sandra', 'lena', { archivModus: 'ARCHIVIERT' })).toBe('ARCHIVIERT');
		expect(einsetzen('thomas', 'lena', { archivModus: 'ARCHIVIERT' })).toBe('ERLAUBT');
	});
});

describe('darfHerausnehmen', () => {
	// Max hat nach der Absage noch einen Platz in Sandras Auto, Tim sitzt in Hans' Auto.
	const f = fahrt(
		[auto('a-sandra', 'sandra'), auto('a-hans', 'hans')],
		[mitfahrt('max', 'a-sandra'), mitfahrt('tim', 'a-sandra'), mitfahrt('paul', 'a-hans')],
	);
	const heraus = (von: string, kindId: string, autoId: string | null) =>
		darfHerausnehmen(person(von), { kindId, autoId }, f, kontext(), umfeld, JETZT);

	it('erlaubt der Mutter ihr Kind, das nach der Absage noch im Auto sitzt', () => {
		expect(heraus('sandra', 'max', 'a-sandra')).toBe('ERLAUBT');
	});

	it('erlaubt der Fahrerin ein fremdes Kind in ihrem Auto, in einem anderen nicht', () => {
		expect(heraus('sandra', 'tim', 'a-sandra')).toBe('ERLAUBT');
		expect(heraus('sandra', 'paul', 'a-hans')).toBe('NICHT_GEFUNDEN');
	});

	it('erlaubt der Leitung jede Mitfahrt', () => {
		expect(heraus('thomas', 'paul', 'a-hans')).toBe('ERLAUBT');
	});

	it('verweigert einer fremden Person, auch fuer "kommt selbst"', () => {
		expect(heraus('peter', 'tim', null)).toBe('NICHT_GEFUNDEN');
	});

	it('erlaubt der Mutter, ihr Kind von "kommt selbst" zu loesen', () => {
		expect(heraus('sandra', 'lena', null)).toBe('ERLAUBT');
	});

	it('meldet im Archiv ARCHIVIERT, nur die Leitung darf noch', () => {
		const k = kontext({ archivModus: 'ARCHIVIERT' });
		const von = (id: string) =>
			darfHerausnehmen(person(id), { kindId: 'max', autoId: 'a-sandra' }, f, k, umfeld, JETZT);
		expect(von('sandra')).toBe('ARCHIVIERT');
		expect(von('thomas')).toBe('ERLAUBT');
	});
});
