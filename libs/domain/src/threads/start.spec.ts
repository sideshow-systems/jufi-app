import type { TerminDaten } from '../module/termin/termin.js';
import { brauchtAntwort, istNeu, neuKurzangabe, ungeleseneNachrichten, type OffenerPunkt } from './start.js';
import type { AntwortDaten, ThreadDaten, ThreadKopf, UmfrageDaten } from './typen.js';
import { bowlingUmfeld, JETZT, kopf } from './testhilfe.js';

const umfeld = bowlingUmfeld();
const person = (id: string) => umfeld.personen.get(id)!;

const FRIST = new Date('2026-10-22T16:00:00Z');

function umfrage(daten: Partial<UmfrageDaten> = {}): UmfrageDaten {
	return {
		modulId: 'm-bowling',
		frage: 'Kommst du mit?',
		einheit: 'JUNGFISCHER',
		mehrfach: false,
		teilnahme: true,
		vielleicht: true,
		frist: FRIST,
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

function antwort(fuerId: string, vonId: string, optionId = 'o-dabei'): AntwortDaten {
	return { fuerId, vonId, optionIds: [optionId], abgegebenAm: new Date('2026-10-21T12:00:00Z') };
}

function thread(k: ThreadKopf, umfragen: UmfrageDaten[], termine: TerminDaten[] = []): ThreadDaten {
	return { kopf: k, termine, umfragen };
}

// Die zweite Umfrage ohne Frist: pro Erwachsener, damit sie eine eigene Zeile (vorname
// null) fuer Sandra liefert.
const ZELTLAGER = thread(kopf({ id: 'zeltlager', titel: 'Zeltlager' }), [
	umfrage({ modulId: 'm-zelt', einheit: 'ERWACHSENER', frist: null }),
]);

const punkte = (p: OffenerPunkt[]) => p.map((x) => `${x.threadId}/${x.fuerId}`);

describe('brauchtAntwort', () => {
	const bowling = (u: Partial<UmfrageDaten> = {}, k: Partial<ThreadKopf> = {}, termine: TerminDaten[] = []) =>
		thread(kopf(k), [umfrage(u)], termine);
	const fuerSandra = (threads: ThreadDaten[], jetzt = JETZT) =>
		brauchtAntwort(person('sandra'), threads, umfeld, jetzt);

	it('nennt ohne Antworten beide Kinder, dann den Thread ohne Frist', () => {
		const ergebnis = fuerSandra([ZELTLAGER, bowling()]);
		expect(punkte(ergebnis)).toEqual(['bowling/lena', 'bowling/max', 'zeltlager/sandra']);
		expect(ergebnis[0]).toEqual({
			threadId: 'bowling',
			titel: '🎳 Bowling',
			modulId: 'm-bowling',
			fuerId: 'lena',
			vorname: 'Lena',
			frist: FRIST,
		});
	});

	it('gibt fuer die eigene Zeile keinen Vornamen und ohne Frist keine Frist', () => {
		const eigene = fuerSandra([ZELTLAGER]);
		expect(eigene).toEqual([
			{ threadId: 'zeltlager', titel: 'Zeltlager', modulId: 'm-zelt', fuerId: 'sandra', vorname: null, frist: null },
		]);
	});

	it('nennt nur Max, wenn Lena geantwortet hat', () => {
		const ergebnis = fuerSandra([bowling({ antworten: [antwort('lena', 'sandra')] })]);
		expect(punkte(ergebnis)).toEqual(['bowling/max']);
	});

	it('zaehlt Vielleicht als Antwort', () => {
		const ergebnis = fuerSandra([bowling({ antworten: [antwort('lena', 'sandra', 'o-vielleicht')] })]);
		expect(punkte(ergebnis)).toEqual(['bowling/max']);
	});

	it('laesst eine Antwort ohne Option offen (Controller-Entscheidung R12)', () => {
		const leer: AntwortDaten = { ...antwort('lena', 'sandra'), optionIds: [] };
		expect(punkte(fuerSandra([bowling({ antworten: [leer] })]))).toEqual(['bowling/lena', 'bowling/max']);
	});

	it('laesst Bowling nach der Frist weg, ab der Frist selbst schon', () => {
		const t = [bowling()];
		expect(punkte(fuerSandra(t, new Date('2026-10-22T15:59:59Z')))).toEqual(['bowling/lena', 'bowling/max']);
		expect(fuerSandra(t, FRIST)).toEqual([]);
		expect(fuerSandra(t, new Date('2026-10-22T17:00:00Z'))).toEqual([]);
	});

	it('laesst einen archivierten Thread weg', () => {
		expect(fuerSandra([bowling({}, { archivModus: 'ARCHIVIERT' })])).toEqual([]);
	});

	it('laesst einen archivierten Thread nach der Datumsregel weg', () => {
		const termin: TerminDaten = {
			modulId: 't1',
			startDatum: '2026-10-10',
			endDatum: null,
			beginn: null,
			ende: null,
			ort: null,
			treffpunkt: null,
		};
		expect(fuerSandra([bowling({ frist: null }, {}, [termin])])).toEqual([]);
	});

	it('laesst einen Entwurf weg, auch fuer den Jugendleiter', () => {
		const entwurf = bowling({}, { veroeffentlichtAm: null });
		expect(fuerSandra([entwurf])).toEqual([]);
		expect(brauchtAntwort(person('thomas'), [entwurf], umfeld, JETZT)).toEqual([]);
	});

	it('aendert sich bei Sandra nicht, wenn Tim antwortet', () => {
		const ergebnis = fuerSandra([bowling({ antworten: [antwort('tim', 'tim')] })]);
		expect(punkte(ergebnis)).toEqual(['bowling/lena', 'bowling/max']);
	});

	it('nennt fuer Thomas nur Jonas', () => {
		expect(punkte(brauchtAntwort(person('thomas'), [bowling()], umfeld, JETZT))).toEqual(['bowling/jonas']);
	});

	it('nennt bei Untergruppe klein nur Max', () => {
		const klein = bowling({}, { alleUntergruppen: false, untergruppenIds: ['klein'] });
		expect(punkte(fuerSandra([klein]))).toEqual(['bowling/max']);
	});

	it('laesst die Antwort fuer ein nicht mehr gefragtes Kind unbeachtet', () => {
		// Lena ist nicht in klein: ihre Antwort bleibt in der Datenbank, steht aber nicht
		// als Zeile da und schliesst auch Max' Zeile nicht.
		const klein = bowling(
			{ antworten: [antwort('lena', 'sandra')] },
			{ alleUntergruppen: false, untergruppenIds: ['klein'] },
		);
		expect(punkte(fuerSandra([klein]))).toEqual(['bowling/max']);
	});

	it('nennt bei leerer Zielgruppe niemanden, auch nicht den Jugendleiter', () => {
		const leer = bowling({}, { alleUntergruppen: false, untergruppenIds: [] });
		expect(fuerSandra([leer])).toEqual([]);
		expect(brauchtAntwort(person('thomas'), [leer], umfeld, JETZT)).toEqual([]);
	});

	it('nennt nichts, wenn die Person den Thread nicht sieht', () => {
		const nurJugendleiter = bowling({}, { rollenfilter: 'NUR_JUGENDLEITER' });
		expect(fuerSandra([nurJugendleiter])).toEqual([]);
	});

	it('sortiert gleiche Fristen nach Titel, dann nach Vorname', () => {
		const a = thread(kopf({ id: 'b', titel: '🎳 Angeln' }), [umfrage({ modulId: 'm-a' })]);
		const b = bowling();
		const ergebnis = fuerSandra([b, a]);
		expect(punkte(ergebnis)).toEqual(['b/lena', 'b/max', 'bowling/lena', 'bowling/max']);
	});

	it('sortiert die fruehere Frist vor die spaetere', () => {
		const frueh = thread(kopf({ id: 'frueh', titel: 'Zzz' }), [
			umfrage({ modulId: 'm-f', frist: new Date('2026-10-22T12:00:00Z') }),
		]);
		expect(punkte(fuerSandra([bowling(), frueh]))[0]).toBe('frueh/lena');
	});
});

describe('istNeu', () => {
	const basis = {
		personId: 'sandra',
		zugangSeit: new Date('2026-10-01T00:00:00Z'),
		gelesenBis: 4 as number | null,
		erstelltVonId: 'thomas' as string | null,
		veroeffentlichtAm: new Date('2026-10-21T10:00:00Z') as Date | null,
		aenderungen: [] as { stand: number; urheberId: string | null; angelegtAm: Date }[],
	};
	const aenderung = (stand: number, urheberId: string | null, angelegtAm = '2026-10-21T10:00:00Z') => ({
		stand,
		urheberId,
		angelegtAm: new Date(angelegtAm),
	});

	it('ist neu bei fremder Aenderung ueber dem Gelesen-Stand', () => {
		expect(istNeu({ ...basis, aenderungen: [aenderung(5, 'thomas')] })).toBe(true);
	});

	it('ist nicht neu bei nur eigener Aktivitaet', () => {
		expect(istNeu({ ...basis, aenderungen: [aenderung(5, 'sandra')] })).toBe(false);
	});

	it('ist nicht neu, wenn der Stand dem Gelesen-Stand entspricht', () => {
		expect(istNeu({ ...basis, aenderungen: [aenderung(4, 'thomas')] })).toBe(false);
	});

	it('zaehlt eine Aenderung ohne Urheber (System) als fremd', () => {
		expect(istNeu({ ...basis, aenderungen: [aenderung(5, null)] })).toBe(true);
	});

	it('beachtet mit Gelesen-Stand die Veroeffentlichung nicht', () => {
		expect(istNeu({ ...basis })).toBe(false);
	});

	it('ist ohne Gelesen-Stand neu, wenn Thomas nach dem Zugang veroeffentlichte und Sandra betrachtet', () => {
		expect(istNeu({ ...basis, gelesenBis: null })).toBe(true);
	});

	it('ist ohne Gelesen-Stand fuer den Ersteller selbst nicht neu', () => {
		expect(istNeu({ ...basis, gelesenBis: null, personId: 'thomas' })).toBe(false);
	});

	it('ist ohne Gelesen-Stand nicht neu, wenn vor dem Zugang veroeffentlicht und danach nichts geschah', () => {
		expect(istNeu({ ...basis, gelesenBis: null, veroeffentlichtAm: new Date('2026-09-20T10:00:00Z') })).toBe(false);
	});

	it('ist ohne Gelesen-Stand neu bei fremder Aenderung nach dem Zugang trotz frueher Veroeffentlichung', () => {
		expect(
			istNeu({
				...basis,
				gelesenBis: null,
				veroeffentlichtAm: new Date('2026-09-20T10:00:00Z'),
				aenderungen: [aenderung(1, 'thomas', '2026-10-05T00:00:00Z')],
			}),
		).toBe(true);
	});

	it('ist ohne Gelesen-Stand nicht neu bei fremder Aenderung vor dem Zugang', () => {
		expect(
			istNeu({
				...basis,
				gelesenBis: null,
				veroeffentlichtAm: new Date('2026-09-20T10:00:00Z'),
				aenderungen: [aenderung(1, 'thomas', '2026-09-25T00:00:00Z')],
			}),
		).toBe(false);
	});

	it('ist ein Entwurf ohne Gelesen-Stand nicht durch die Veroeffentlichung neu', () => {
		expect(istNeu({ ...basis, gelesenBis: null, veroeffentlichtAm: null })).toBe(false);
	});
});

describe('ungeleseneNachrichten', () => {
	const nachricht = (
		stand: number,
		autorId: string | null,
		geloeschtAm: Date | null = null,
		angelegtAm = '2026-10-21T10:00:00Z',
		art: 'NACHRICHT' | 'SYSTEM' = 'NACHRICHT',
	) => ({
		art,
		stand,
		autorId,
		angelegtAm: new Date(angelegtAm),
		geloeschtAm,
	});
	const basis = {
		personId: 'sandra',
		zugangSeit: new Date('2026-10-01T00:00:00Z'),
		verlaufGelesenBis: 3 as number | null,
	};

	it('zaehlt fremde, nicht geloeschte Nachrichten ueber dem Stand', () => {
		expect(
			ungeleseneNachrichten({
				...basis,
				nachrichten: [
					nachricht(4, 'thomas'),
					nachricht(5, 'tim'),
					nachricht(6, 'sandra'),
					nachricht(7, 'thomas', new Date('2026-10-21T11:00:00Z')),
					nachricht(3, 'thomas'),
				],
			}),
		).toBe(2);
	});

	it('zaehlt ohne Stand die ab dem Zugang', () => {
		expect(
			ungeleseneNachrichten({
				...basis,
				verlaufGelesenBis: null,
				nachrichten: [
					nachricht(1, 'thomas', null, '2026-09-30T23:59:59Z'),
					nachricht(2, 'thomas', null, '2026-10-01T00:00:00Z'),
				],
			}),
		).toBe(1);
	});

	it('zaehlt Systemeintraege nicht', () => {
		// Z.B. TERMIN_GEAENDERT: ohne Autor, ueber dem Stand, nicht geloescht -- und doch keine Nachricht.
		const system = nachricht(4, null, null, '2026-10-21T10:00:00Z', 'SYSTEM');
		expect(ungeleseneNachrichten({ ...basis, nachrichten: [system] })).toBe(0);
		expect(ungeleseneNachrichten({ ...basis, nachrichten: [system, nachricht(5, 'thomas')] })).toBe(1);
	});
});

describe('neuKurzangabe', () => {
	const e = { neuerThread: false, nachrichten: 0, antworten: false };

	it('nennt zuerst den neuen Thread', () => {
		expect(neuKurzangabe('KOMMENTARE', { neuerThread: true, nachrichten: 3, antworten: true })).toBe('Neuer Thread');
	});

	it('nennt vor den Antworten die Kommentare, Singular und Plural', () => {
		expect(neuKurzangabe('KOMMENTARE', { ...e, nachrichten: 1, antworten: true })).toBe('1 neuer Kommentar');
		expect(neuKurzangabe('KOMMENTARE', { ...e, nachrichten: 2 })).toBe('2 neue Kommentare');
	});

	it('nennt im Chat Nachrichten, Singular und Plural', () => {
		expect(neuKurzangabe('CHAT', { ...e, nachrichten: 1 })).toBe('1 neue Nachricht');
		expect(neuKurzangabe('CHAT', { ...e, nachrichten: 2 })).toBe('2 neue Nachrichten');
	});

	it('nennt neue Antworten', () => {
		expect(neuKurzangabe('KOMMENTARE', { ...e, antworten: true })).toBe('Neue Antworten');
	});

	it('nennt sonst den geaenderten Aushang', () => {
		expect(neuKurzangabe('AUSHANG', e)).toBe('Aushang geändert');
	});
});
